package documents

import (
	"document-vault/server/internal/auth"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
)

func Handler(store *Store, allowedOrigin string) http.Handler {
	mux := http.NewServeMux()
	respond := func(w http.ResponseWriter, status int, value any) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(value)
	}
	data := func(w http.ResponseWriter, value any) { respond(w, 200, map[string]any{"data": value}) }
	fail := func(w http.ResponseWriter, err error) {
		var review *UploadReviewError
		if errors.As(err, &review) {
			respond(w, 409, map[string]any{"error": review.Error(), "code": "upload_confirmation_required", "data": review.Review})
			return
		}
		status, message := 500, "Cannot process the document request"
		var api *APIError
		if errors.As(err, &api) {
			status, message = api.Status, api.Message
		}
		if errors.Is(err, ErrKeyUnavailable) {
			status, message = 503, err.Error()
		}
		if errors.Is(err, ErrIntegrity) {
			message = err.Error()
		}
		respond(w, status, map[string]string{"error": message})
	}
	decode := func(w http.ResponseWriter, r *http.Request, value any) bool {
		r.Body = http.MaxBytesReader(w, r.Body, 65536)
		decoder := json.NewDecoder(r.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
			fail(w, apiError(400, "Invalid JSON request"))
			return false
		}
		return true
	}
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"status": "ok", "application": "document-vault", "mode": "server", "keyProviderConfigured": store.provider != nil})
	})
	mux.HandleFunc("GET /api/v1/documents/schema", func(w http.ResponseWriter, r *http.Request) { data(w, map[string]any{"fields": SchemaFields}) })
	mux.HandleFunc("POST /api/v1/documents/search", func(w http.ResponseWriter, r *http.Request) {
		var query SearchRequest
		if !decode(w, r, &query) {
			return
		}
		result, err := search(store.Documents(auth.CurrentUser(r.Context()).ID), query)
		if err != nil {
			fail(w, err)
			return
		}
		data(w, result)
	})
	settingsData := func(w http.ResponseWriter, r *http.Request) {
		settings := store.Settings(auth.CurrentUser(r.Context()).ID)
		data(w, map[string]any{"encryptByDefault": settings.EncryptByDefault, "allowPerFileOverride": settings.AllowPerFileOverride, "keyProvider": "openbao-transit", "keyProviderConfigured": store.provider != nil})
	}
	mux.HandleFunc("GET /api/v1/settings/encryption", func(w http.ResponseWriter, r *http.Request) { settingsData(w, r) })
	mux.HandleFunc("PUT /api/v1/settings/encryption", func(w http.ResponseWriter, r *http.Request) {
		var value struct {
			EncryptByDefault     *bool `json:"encryptByDefault"`
			AllowPerFileOverride *bool `json:"allowPerFileOverride"`
		}
		if !decode(w, r, &value) {
			return
		}
		if value.EncryptByDefault == nil || value.AllowPerFileOverride == nil {
			fail(w, apiError(400, "Both encryption settings are required"))
			return
		}
		if err := store.UpdateSettings(auth.CurrentUser(r.Context()).ID, EncryptionSettings{*value.EncryptByDefault, *value.AllowPerFileOverride}); err != nil {
			fail(w, err)
			return
		}
		settingsData(w, r)
	})
	upload := func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 26<<20)
		if err := r.ParseMultipartForm(32 << 20); err != nil {
			fail(w, apiError(400, "Invalid upload; files must be at most 25 MiB"))
			return
		}
		defer r.MultipartForm.RemoveAll()
		file, header, err := r.FormFile("file")
		if err != nil || len(r.MultipartForm.File["file"]) != 1 {
			fail(w, apiError(400, "Exactly one file is required"))
			return
		}
		defer file.Close()
		bytes, err := io.ReadAll(io.LimitReader(file, (25<<20)+1))
		if err != nil {
			fail(w, err)
			return
		}
		var encrypt *bool
		if values, ok := r.MultipartForm.Value["encrypt"]; ok {
			if len(values) != 1 || (values[0] != "true" && values[0] != "false") {
				fail(w, apiError(400, "Invalid encryption choice"))
				return
			}
			value := values[0] == "true"
			encrypt = &value
		}
		mediaType, _, err := mime.ParseMediaType(header.Header.Get("Content-Type"))
		if err != nil {
			mediaType, _, _ = mime.ParseMediaType(http.DetectContentType(bytes))
		}
		tags := []string{}
		for _, tag := range strings.Split(r.FormValue("tags"), ",") {
			if tag = strings.TrimSpace(tag); tag != "" {
				tags = append(tags, tag)
			}
		}
		result, err := store.Upload(r.Context(), r.PathValue("documentId"), Upload{OwnerID: auth.CurrentUser(r.Context()).ID, Actor: auth.CurrentUser(r.Context()).Email, Title: r.FormValue("title"), Owner: r.FormValue("owner"), Tags: tags, VersionName: r.FormValue("versionName"), FileName: filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/")), MediaType: mediaType, Bytes: bytes, ConfirmationToken: r.FormValue("confirmationToken"), Encrypt: encrypt})
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, 201, map[string]any{"data": result})
	}
	mux.HandleFunc("POST /api/v1/documents", upload)
	mux.HandleFunc("POST /api/v1/documents/{documentId}/versions", upload)
	mux.HandleFunc("PATCH /api/v1/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Title string `json:"title"`
		}
		if !decode(w, r, &input) {
			return
		}
		value, err := store.Rename(auth.CurrentUser(r.Context()).ID, r.PathValue("documentId"), input.Title)
		if err != nil {
			fail(w, err)
			return
		}
		data(w, value)
	})
	mux.HandleFunc("GET /api/v1/documents/{documentId}", func(w http.ResponseWriter, r *http.Request) {
		value, err := store.Document(r.PathValue("documentId"))
		if err != nil {
			fail(w, err)
			return
		}
		data(w, value)
	})
	mux.HandleFunc("GET /api/v1/documents/{documentId}/versions", func(w http.ResponseWriter, r *http.Request) {
		versions, err := store.History(r.PathValue("documentId"))
		if err != nil {
			fail(w, err)
			return
		}
		limit := 20
		if raw := r.URL.Query().Get("limit"); raw != "" {
			limit, err = strconv.Atoi(raw)
			if err != nil {
				fail(w, apiError(400, "Invalid limit"))
				return
			}
		}
		var cursor *string
		if raw := r.URL.Query().Get("cursor"); raw != "" {
			cursor = &raw
		}
		result, err := paginate(versions, limit, cursor, r.PathValue("documentId"))
		if err != nil {
			fail(w, err)
			return
		}
		data(w, result)
	})
	mux.HandleFunc("GET /api/v1/documents/{documentId}/versions/{versionId}", func(w http.ResponseWriter, r *http.Request) {
		version, err := store.Version(r.PathValue("documentId"), r.PathValue("versionId"))
		if err != nil {
			fail(w, err)
			return
		}
		data(w, version)
	})
	mux.HandleFunc("GET /api/v1/documents/{documentId}/versions/{versionId}/content", func(w http.ResponseWriter, r *http.Request) {
		bytes, version, err := store.Content(r.Context(), r.PathValue("documentId"), r.PathValue("versionId"))
		if err != nil {
			fail(w, err)
			return
		}
		defer clear(bytes)
		w.Header().Set("Content-Type", version.File.MediaType)
		w.Header().Set("Content-Length", strconv.Itoa(len(bytes)))
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": version.File.Name}))
		w.WriteHeader(200)
		_, _ = w.Write(bytes)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segments := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(segments) >= 4 && strings.Join(segments[:3], "/") == "api/v1/documents" && segments[3] != "schema" && segments[3] != "search" {
			document, err := store.Document(segments[3])
			if err != nil || document.OwnerID != auth.CurrentUser(r.Context()).ID {
				fail(w, apiError(404, "Document not found"))
				return
			}
		}

		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		if r.Method != "GET" && r.Method != "HEAD" {
			if origin := r.Header.Get("Origin"); origin != "" && origin != allowedOrigin {
				fail(w, apiError(403, "Request origin is not allowed"))
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}
