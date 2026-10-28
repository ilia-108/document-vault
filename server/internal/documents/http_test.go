package documents

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"document-vault/server/internal/auth"
)

type accountSender struct{ codes map[string]string }

func (s *accountSender) SendLoginCode(_ context.Context, email, code string) error {
	s.codes[email] = code
	return nil
}
func callAPI(handler http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
func loginAccount(t *testing.T, handler http.Handler, sender *accountSender, email string) *http.Cookie {
	t.Helper()
	response := callAPI(handler, "POST", "/api/auth/request-code", `{"email":"`+email+`"}`, nil)
	if response.Code != 202 {
		t.Fatal(response.Body)
	}
	response = callAPI(handler, "POST", "/api/auth/verify-code", `{"email":"`+email+`","code":"`+sender.codes[email]+`"}`, nil)
	if response.Code != 200 {
		t.Fatal(response.Body)
	}
	return response.Result().Cookies()[0]
}
func uploadAPI(t *testing.T, handler http.Handler, path string, cookie *http.Cookie, fields map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	for key, value := range fields {
		writer.WriteField(key, value)
	}
	file, _ := writer.CreateFormFile("file", "original.txt")
	file.Write([]byte("original upload bytes\x00\r\n"))
	writer.Close()
	r := httptest.NewRequest("POST", path, &buffer)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
func TestAccountsCannotAccessEachOthersFilesOrSettings(t *testing.T) {
	store := openTestStore(t, testKeyService(t))
	sender := &accountSender{map[string]string{}}
	service, err := auth.Open(auth.Config{DatabasePath: filepath.Join(t.TempDir(), "auth.db"), Secret: []byte(strings.Repeat("s", 32)), Sender: sender, AllowedOrigin: "http://127.0.0.1:3040"})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	handler := service.Handler(Handler(store, "http://127.0.0.1:3040"))
	if callAPI(handler, "GET", "/api/v1/documents/schema", "", nil).Code != 401 {
		t.Fatal("anonymous access accepted")
	}
	alice := loginAccount(t, handler, sender, "alice@example.com")
	bob := loginAccount(t, handler, sender, "bob@example.com")
	response := uploadAPI(t, handler, "/api/v1/documents", alice, map[string]string{"title": "Private document", "versionName": "Editorial review"})
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body)
	}
	var result struct {
		Data UploadResult `json:"data"`
	}
	if json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("invalid upload response")
	}
	document := result.Data.Document
	version := result.Data.Version
	if version.VersionName != "Editorial review" || !version.Encryption.Enabled || version.CapturedBy != "alice@example.com" {
		t.Fatal("upload metadata mismatch", version)
	}
	prefix := "/api/v1/documents/" + document.DocumentID
	for _, path := range []string{prefix, prefix + "/versions", prefix + "/versions/" + version.VersionID, prefix + "/versions/" + version.VersionID + "/content"} {
		if callAPI(handler, "GET", path, "", bob).Code != 404 {
			t.Fatal("another account accessed", path)
		}
	}
	if uploadAPI(t, handler, prefix+"/versions", bob, map[string]string{}).Code != 404 {
		t.Fatal("foreign version upload accepted")
	}
	search := callAPI(handler, "POST", "/api/v1/documents/search", `{}`, bob)
	if !strings.Contains(search.Body.String(), `"total":0`) {
		t.Fatal("private document appeared in another account", search.Body)
	}
	settings := `{"encryptByDefault":false,"allowPerFileOverride":true}`
	if callAPI(handler, "PUT", "/api/v1/settings/encryption", settings, alice).Code != 200 {
		t.Fatal("cannot change own settings")
	}
	if !strings.Contains(callAPI(handler, "GET", "/api/v1/settings/encryption", "", bob).Body.String(), `"encryptByDefault":true`) {
		t.Fatal("settings crossed accounts")
	}
	if uploadAPI(t, handler, prefix+"/versions", alice, map[string]string{"encrypt": "false"}).Code != 409 {
		t.Fatal("encryption lock bypassed through HTTP")
	}
	content := callAPI(handler, "GET", prefix+"/versions/"+version.VersionID+"/content", "", alice)
	if content.Code != 200 || !bytes.Equal(content.Body.Bytes(), []byte("original upload bytes\x00\r\n")) {
		t.Fatal("downloaded bytes differ", content.Code)
	}
	if strings.Contains(response.Body.String(), "wrappedKey") {
		t.Fatal("internal key envelope exposed in API")
	}
}
