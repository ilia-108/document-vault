package documents

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func testKeyService(t *testing.T) KeyWrapper {
	t.Helper()
	key := make([]byte, 32)
	rand.Read(key)
	block, _ := aes.NewCipher(key)
	gcm, _ := cipher.NewGCM(block)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Vault-Token") != "test-token" {
			http.Error(w, "denied", 403)
			return
		}
		var value map[string]string
		if json.NewDecoder(r.Body).Decode(&value) != nil {
			http.Error(w, "bad payload", 400)
			return
		}
		aad, _ := base64.StdEncoding.DecodeString(value["associated_data"])
		data := map[string]string{}
		switch r.URL.Path {
		case "/v1/transit/encrypt/document-vault":
			plaintext, _ := base64.StdEncoding.DecodeString(value["plaintext"])
			if len(plaintext) != 32 {
				t.Error("OpenBao received file bytes instead of a 32-byte key")
			}
			nonce := make([]byte, gcm.NonceSize())
			rand.Read(nonce)
			sealed := gcm.Seal(nonce, nonce, plaintext, aad)
			data["ciphertext"] = "vault:v1:" + base64.StdEncoding.EncodeToString(sealed)
		case "/v1/transit/decrypt/document-vault":
			encoded := value["ciphertext"]
			if len(encoded) < 9 {
				http.Error(w, "invalid", 400)
				return
			}
			sealed, err := base64.StdEncoding.DecodeString(encoded[len("vault:v1:"):])
			if err != nil || len(sealed) < gcm.NonceSize() {
				http.Error(w, "invalid", 400)
				return
			}
			plaintext, err := gcm.Open(nil, sealed[:gcm.NonceSize()], sealed[gcm.NonceSize():], aad)
			if err != nil {
				http.Error(w, "invalid", 400)
				return
			}
			data["plaintext"] = base64.StdEncoding.EncodeToString(plaintext)
		default:
			http.Error(w, "not found", 404)
			return
		}
		responseData := map[string]any{"key_version": 1}
		for key, value := range data {
			responseData[key] = value
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": responseData})
	}))
	t.Cleanup(server.Close)
	provider, err := NewOpenBao(server.URL, "test-token", "transit", "document-vault")
	if err != nil {
		t.Fatal(err)
	}
	return provider
}
func openTestStore(t *testing.T, provider KeyWrapper) *Store {
	t.Helper()
	store, err := OpenStore(t.TempDir(), provider)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}
func uploadInput() Upload {
	return Upload{Title: "A document", OwnerID: "owner", Actor: "owner@example.com", VersionName: "First draft", FileName: "notes.txt", MediaType: "text/plain", Bytes: []byte("Exact original file\x00\r\n")}
}
func boolPointer(value bool) *bool { return &value }
func TestEncryptedReferencesSurviveRestart(t *testing.T) {
	provider := testKeyService(t)
	store := openTestStore(t, provider)
	input := uploadInput()
	first, err := store.Upload(context.Background(), "", input)
	if err != nil {
		t.Fatal(err)
	}
	second := confirmedUpload(t, store, first.Document.DocumentID, input)
	err = nil
	if err != nil {
		t.Fatal(err)
	}
	if !second.Document.EncryptionRequired || !first.Version.Encryption.Enabled || first.Version.Checksum != second.Version.Checksum || first.Version.VersionID == second.Version.VersionID {
		t.Fatal("version identity or encryption invariant violated")
	}
	one, _ := store.storedVersion(first.Document.DocumentID, first.Version.VersionID)
	two, _ := store.storedVersion(first.Document.DocumentID, second.Version.VersionID)
	data1, _ := os.ReadFile(filepath.Join(store.root, "objects", one.ObjectName))
	data2, _ := os.ReadFile(filepath.Join(store.root, "objects", two.ObjectName))
	if bytes.Equal(data1, input.Bytes) || !bytes.Equal(data1, data2) || one.ObjectName != two.ObjectName || two.ContentVersionID != first.Version.VersionID {
		t.Fatal("identical versions did not reuse the encrypted object")
	}
	if bytes.Contains(data1, []byte("Exact original file")) {
		t.Fatal("plaintext saved")
	}
	root := store.root
	store.Close()
	reopened, err := OpenStore(root, provider)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	alias, _, aliasErr := reopened.Content(context.Background(), first.Document.DocumentID, second.Version.VersionID)
	if aliasErr != nil || !bytes.Equal(alias, input.Bytes) {
		t.Fatal("reference did not survive restart", aliasErr)
	}
	content, version, err := reopened.Content(context.Background(), first.Document.DocumentID, first.Version.VersionID)
	if err != nil || !bytes.Equal(content, input.Bytes) || version.VersionName != "First draft" {
		t.Fatal("snapshot did not survive restart", err)
	}
}
func TestEncryptionPolicyIsStickyAndScoped(t *testing.T) {
	store := openTestStore(t, testKeyService(t))
	if !store.Settings("owner").EncryptByDefault || store.Settings("owner").AllowPerFileOverride {
		t.Fatal("incorrect safe defaults")
	}
	input := uploadInput()
	input.Encrypt = boolPointer(false)
	if _, err := store.Upload(context.Background(), "", input); err == nil {
		t.Fatal("forbidden override accepted")
	}
	if err := store.UpdateSettings("owner", EncryptionSettings{false, true}); err != nil {
		t.Fatal(err)
	}
	if !store.Settings("another-user").EncryptByDefault {
		t.Fatal("settings leaked across accounts")
	}
	plain, err := store.Upload(context.Background(), "", input)
	if err != nil || plain.Version.Encryption.Enabled {
		t.Fatal("plain choice ignored", err)
	}
	input.Encrypt = boolPointer(true)
	encrypted := confirmedUpload(t, store, plain.Document.DocumentID, input)
	if err != nil || !encrypted.Document.EncryptionRequired {
		t.Fatal("encryption was not locked", err)
	}
	input.Encrypt = boolPointer(false)
	if _, err := store.Upload(context.Background(), plain.Document.DocumentID, input); err == nil {
		t.Fatal("locked encryption was disabled")
	}
	store.UpdateSettings("owner", EncryptionSettings{false, false})
	input.Encrypt = nil
	next := confirmedUpload(t, store, plain.Document.DocumentID, input)
	if err != nil || !next.Version.Encryption.Enabled {
		t.Fatal("global setting bypassed document lock", err)
	}
	old, _, err := store.Content(context.Background(), plain.Document.DocumentID, plain.Version.VersionID)
	if err != nil || !bytes.Equal(old, input.Bytes) {
		t.Fatal("old plaintext snapshot was changed")
	}
	if len(store.Documents("another-user")) != 0 {
		t.Fatal("document listing leaked")
	}
}
func TestMissingKeyServiceFailsClosed(t *testing.T) {
	store := openTestStore(t, nil)
	if _, err := store.Upload(context.Background(), "", uploadInput()); !errors.Is(err, ErrKeyUnavailable) {
		t.Fatal("encrypted upload did not fail closed", err)
	}
	files, _ := os.ReadDir(filepath.Join(store.root, "objects"))
	if len(files) != 0 || len(store.Documents("owner")) != 0 {
		t.Fatal("failed upload left a document or plaintext file")
	}
}
func TestTamperingAndForeignVersionAreRejected(t *testing.T) {
	store := openTestStore(t, testKeyService(t))
	first, err := store.Upload(context.Background(), "", uploadInput())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Version("different-document", first.Version.VersionID); err == nil {
		t.Fatal("foreign version accepted")
	}
	stored, _ := store.storedVersion(first.Document.DocumentID, first.Version.VersionID)
	path := filepath.Join(store.root, "objects", stored.ObjectName)
	bytes, _ := os.ReadFile(path)
	bytes[len(bytes)-1] ^= 1
	os.WriteFile(path, bytes, 0600)
	if _, _, err := store.Content(context.Background(), first.Document.DocumentID, first.Version.VersionID); !errors.Is(err, ErrIntegrity) {
		t.Fatal("tampered ciphertext accepted", err)
	}
}
func TestRealOpenBao(t *testing.T) {
	address := os.Getenv("TEST_BAO_ADDR")
	tokenFile := os.Getenv("TEST_BAO_TOKEN_FILE")
	if address == "" || tokenFile == "" {
		t.Skip("set TEST_BAO_ADDR and TEST_BAO_TOKEN_FILE for the real OpenBao integration test")
	}
	token, err := os.ReadFile(tokenFile)
	if err != nil {
		t.Fatal(err)
	}
	provider, err := NewOpenBao(address, string(bytes.TrimSpace(token)), "transit", "document-vault")
	if err != nil {
		t.Fatal(err)
	}
	store := openTestStore(t, provider)
	upload, err := store.Upload(context.Background(), "", uploadInput())
	if err != nil {
		t.Fatal(err)
	}
	duplicate := confirmedUpload(t, store, upload.Document.DocumentID, uploadInput())
	content, _, aliasErr := store.Content(context.Background(), upload.Document.DocumentID, duplicate.Version.VersionID)
	if aliasErr != nil || !bytes.Equal(content, uploadInput().Bytes) {
		t.Fatal("real OpenBao reference failed", aliasErr)
	}
	content, _, err = store.Content(context.Background(), upload.Document.DocumentID, upload.Version.VersionID)
	if err != nil || !bytes.Equal(content, uploadInput().Bytes) {
		t.Fatal("OpenBao round-trip failed", err)
	}
}

func confirmedUpload(t *testing.T, s *Store, id string, input Upload) UploadResult {
	t.Helper()
	_, err := s.Upload(context.Background(), id, input)
	var review *UploadReviewError
	if !errors.As(err, &review) {
		t.Fatal("expected explicit upload confirmation", err)
	}
	input.ConfirmationToken = review.Review.ConfirmationToken
	result, err := s.Upload(context.Background(), id, input)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func TestUploadReviewRenameAndAllMatchingVersions(t *testing.T) {
	s := openTestStore(t, testKeyService(t))
	ctx := context.Background()
	input := uploadInput()
	first, err := s.Upload(ctx, "", input)
	if err != nil {
		t.Fatal(err)
	}
	id := first.Document.DocumentID
	input.FileName = "another.PDF"
	_, err = s.Upload(ctx, id, input)
	var review *UploadReviewError
	if !errors.As(err, &review) || review.Review.ExtensionChange == nil || len(review.Review.DuplicateVersions) != 1 || !review.Review.ReuseFile {
		t.Fatal("combined review missing", err)
	}
	if len(s.state.Versions[id]) != 1 {
		t.Fatal("unconfirmed upload persisted")
	}
	input.ConfirmationToken = review.Review.ConfirmationToken
	if _, err = s.Rename("foreign", id, "Renamed"); err == nil {
		t.Fatal("foreign rename accepted")
	}
	if _, err = s.Rename("owner", id, "  Renamed  "); err != nil {
		t.Fatal(err)
	}
	_, err = s.Upload(ctx, id, input)
	if !errors.As(err, &review) {
		t.Fatal("rename did not invalidate confirmation", err)
	}
	input.ConfirmationToken = review.Review.ConfirmationToken
	second, err := s.Upload(ctx, id, input)
	if err != nil {
		t.Fatal(err)
	}
	if second.Version.Snapshot.Title != "Renamed" {
		t.Fatal("new snapshot ignored current title")
	}
	input.ConfirmationToken = ""
	input.VersionName = "Restored"
	third := confirmedUpload(t, s, id, input)
	history, _ := s.History(id)
	for _, v := range history {
		if len(v.IdenticalVersions) != 2 {
			t.Fatal("not all matching versions linked")
		}
	}
	old, _ := s.Version(id, first.Version.VersionID)
	if old.File.Name != "notes.txt" || old.Snapshot.Title != "A document" {
		t.Fatal("rename changed immutable original")
	}
	if s.state.Versions[id][0].Version.IdenticalVersions != nil {
		t.Fatal("derived links persisted in snapshot")
	}
	objects, _ := os.ReadDir(filepath.Join(s.root, "objects"))
	if len(objects) != 1 {
		t.Fatal("duplicate physical files written")
	}
	content, _, err := s.Content(ctx, id, third.Version.VersionID)
	if err != nil || !bytes.Equal(content, input.Bytes) {
		t.Fatal("reference download failed", err)
	}
	// Alias metadata is authenticated independently from the shared ciphertext.
	s.state.Versions[id][2].Version.VersionName = "Tampered"
	if _, _, err = s.Content(ctx, id, third.Version.VersionID); !errors.Is(err, ErrIntegrity) {
		t.Fatal("tampered reference accepted", err)
	}
}
func TestExtensionReviewAndStaleConfirmation(t *testing.T) {
	s := openTestStore(t, testKeyService(t))
	ctx := context.Background()
	input := uploadInput()
	first, _ := s.Upload(ctx, "", input)
	id := first.Document.DocumentID
	input.Bytes = []byte("different")
	input.FileName = "notes.TXT"
	if _, err := s.Upload(ctx, id, input); err != nil {
		t.Fatal("case-only extension warned", err)
	}
	input.Bytes = []byte("pdf content")
	input.FileName = "file.pdf"
	second := confirmedUpload(t, s, id, input)
	input.Bytes = []byte("text again")
	input.FileName = "file.txt"
	_, err := s.Upload(ctx, id, input)
	var review *UploadReviewError
	if !errors.As(err, &review) || review.Review.ExtensionChange.First != ".txt" || review.Review.ExtensionChange.Latest != ".pdf" {
		t.Fatal("first/latest extension comparison incorrect", err)
	}
	input.ConfirmationToken = review.Review.ConfirmationToken
	other := input
	other.Bytes = []byte("concurrent")
	other.ConfirmationToken = ""
	confirmedUpload(t, s, id, other)
	_, err = s.Upload(ctx, id, input)
	if !errors.As(err, &review) {
		t.Fatal("stale history confirmation accepted", err)
	}
	input.ConfirmationToken = review.Review.ConfirmationToken
	input.Bytes = []byte("changed bytes")
	_, err = s.Upload(ctx, id, input)
	if !errors.As(err, &review) {
		t.Fatal("changed upload confirmation accepted", err)
	}
	if second.Version.VersionNumber != 3 {
		t.Fatal("incorrect version numbering")
	}
}
func TestEncryptedTransitionDoesNotReferencePlaintext(t *testing.T) {
	s := openTestStore(t, testKeyService(t))
	s.UpdateSettings("owner", EncryptionSettings{false, true})
	input := uploadInput()
	first, err := s.Upload(context.Background(), "", input)
	if err != nil {
		t.Fatal(err)
	}
	input.Encrypt = boolPointer(true)
	second := confirmedUpload(t, s, first.Document.DocumentID, input)
	a, _ := s.storedVersion(first.Document.DocumentID, first.Version.VersionID)
	b, _ := s.storedVersion(first.Document.DocumentID, second.Version.VersionID)
	if a.ObjectName == b.ObjectName || b.ContentVersionID != "" || !b.Version.Encryption.Enabled {
		t.Fatal("encrypted version referenced plaintext")
	}
	content, _, err := s.Content(context.Background(), first.Document.DocumentID, second.Version.VersionID)
	if err != nil || !bytes.Equal(content, input.Bytes) {
		t.Fatal(err)
	}
}

func TestLegacyMetadataRemainsReadable(t *testing.T) {
	provider := testKeyService(t)
	s := openTestStore(t, provider)
	first, err := s.Upload(context.Background(), "", uploadInput())
	if err != nil {
		t.Fatal(err)
	}
	state := cloneState(s.state)
	state.FormatVersion = 1
	data, _ := json.Marshal(state)
	root := s.root
	s.Close()
	if err = os.WriteFile(filepath.Join(root, "state.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(root, provider)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	content, _, err := reopened.Content(context.Background(), first.Document.DocumentID, first.Version.VersionID)
	if err != nil || !bytes.Equal(content, uploadInput().Bytes) {
		t.Fatal("legacy ciphertext unreadable", err)
	}
	confirmedUpload(t, reopened, first.Document.DocumentID, uploadInput())
	disk, _ := os.ReadFile(filepath.Join(root, "state.json"))
	var upgraded diskState
	json.Unmarshal(disk, &upgraded)
	if upgraded.FormatVersion != 2 {
		t.Fatal("metadata not upgraded")
	}
}
