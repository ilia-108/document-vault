package documents

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode/utf8"
)

type Store struct {
	mu       sync.RWMutex
	root     string
	state    diskState
	provider KeyWrapper
	lock     *os.File
}

func OpenStore(root string, provider KeyWrapper) (*Store, error) {
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "objects"), 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(root, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, errors.New("data directory is already in use")
	}
	s := &Store{root: root, provider: provider, lock: lock, state: diskState{FormatVersion: 2, Settings: EncryptionSettings{EncryptByDefault: true}, Documents: map[string]Document{}, Versions: map[string][]StoredVersion{}}}
	content, err := os.ReadFile(filepath.Join(root, "state.json"))
	if err == nil {
		if json.Unmarshal(content, &s.state) != nil || (s.state.FormatVersion != 1 && s.state.FormatVersion != 2) || s.state.Documents == nil || s.state.Versions == nil {
			s.Close()
			return nil, errors.New("invalid document metadata store")
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error {
	if s.lock == nil {
		return nil
	}
	_ = syscall.Flock(int(s.lock.Fd()), syscall.LOCK_UN)
	err := s.lock.Close()
	s.lock = nil
	return err
}
func cloneState(state diskState) diskState {
	data, _ := json.Marshal(state)
	var result diskState
	_ = json.Unmarshal(data, &result)
	return result
}
func (s *Store) save(state diskState) error {
	state.FormatVersion = 2
	bytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(s.root, "state-*.tmp")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(bytes); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(s.root, "state.json")); err != nil {
		return err
	}
	if directory, err := os.Open(s.root); err == nil {
		_ = directory.Sync()
		_ = directory.Close()
	}
	s.state = state
	return nil
}
func (s *Store) Settings(ownerID string) EncryptionSettings {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if settings, ok := s.state.WorkspaceSettings[ownerID]; ok {
		return settings
	}
	return s.state.Settings
}
func (s *Store) UpdateSettings(ownerID string, settings EncryptionSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneState(s.state)
	if next.WorkspaceSettings == nil {
		next.WorkspaceSettings = map[string]EncryptionSettings{}
	}
	next.WorkspaceSettings[ownerID] = settings
	return s.save(next)
}
func encryptionChoice(settings EncryptionSettings, required bool, requested *bool) (bool, error) {
	if required {
		if requested != nil && !*requested {
			return false, apiError(409, "Encryption is required for every new version of this document")
		}
		return true, nil
	}
	if requested != nil && !settings.AllowPerFileOverride {
		return false, apiError(400, "Per-file encryption choices are disabled")
	}
	if requested != nil {
		return *requested, nil
	}
	return settings.EncryptByDefault, nil
}
func newID(prefix string) (string, error) {
	data := make([]byte, 16)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(data), nil
}
func (s *Store) Upload(ctx context.Context, documentID string, upload Upload) (UploadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var empty UploadResult
	upload.Title = strings.TrimSpace(upload.Title)
	upload.Owner = strings.TrimSpace(upload.Owner)
	upload.VersionName = strings.TrimSpace(upload.VersionName)
	if utf8.RuneCountInString(upload.VersionName) > 200 {
		return empty, apiError(400, "Version name must be at most 200 characters")
	}
	if utf8.RuneCountInString(upload.Title) > 300 {
		return empty, apiError(400, "Document title is too long")
	}
	if upload.FileName == "" || len(upload.FileName) > 1024 {
		return empty, apiError(400, "A valid filename is required")
	}
	if len(upload.Bytes) > 25<<20 {
		return empty, apiError(413, "Files must be at most 25 MiB")
	}
	document, exists := s.state.Documents[documentID]
	if documentID != "" && (!exists || document.OwnerID != upload.OwnerID) {
		return empty, apiError(404, "Document not found")
	}
	if !exists {
		if upload.Title == "" {
			return empty, apiError(400, "Document title is required")
		}
		id, err := newID("doc_")
		if err != nil {
			return empty, err
		}
		documentID = id
		if upload.Owner == "" {
			upload.Owner = "Local workspace"
		}
		if upload.Tags == nil {
			upload.Tags = []string{}
		}
		document = Document{OwnerID: upload.OwnerID, DocumentID: id, Title: upload.Title, Owner: upload.Owner, Tags: upload.Tags, CreatedAt: time.Now().UTC().Unix()}
	}
	settings := s.state.Settings
	if scoped, ok := s.state.WorkspaceSettings[upload.OwnerID]; ok {
		settings = scoped
	}
	encrypted, err := encryptionChoice(settings, document.EncryptionRequired, upload.Encrypt)
	if err != nil {
		return empty, err
	}
	checksum := digest(upload.Bytes)
	review, reusable, err := reviewUpload(s.state, document, upload, encrypted, checksum)
	if err != nil {
		return empty, err
	}
	needsReview := len(review.DuplicateVersions) > 0 || review.ExtensionChange != nil
	if (needsReview && upload.ConfirmationToken != review.ConfirmationToken) || (upload.ConfirmationToken != "" && upload.ConfirmationToken != review.ConfirmationToken) {
		return empty, &UploadReviewError{review}
	}
	versionID, err := newID("ver_")
	if err != nil {
		return empty, err
	}
	version := Version{VersionID: versionID, DocumentID: documentID, VersionNumber: document.VersionCount + 1, VersionName: upload.VersionName, CapturedAt: time.Now().UTC().Unix(), CapturedBy: upload.Actor, File: FileInfo{upload.FileName, upload.MediaType, int64(len(upload.Bytes))}, Checksum: Checksum{"sha256", checksum}, Snapshot: Snapshot{Title: document.Title, Author: document.Owner, Tags: document.Tags, Source: "Document Vault"}, Encryption: EncryptionInfo{Enabled: encrypted}}
	if encrypted {
		version.Encryption.Algorithm = "AES-256-GCM"
		version.Encryption.Provider = "openbao-transit"
	}
	stored := StoredVersion{Version: version, ObjectName: versionID + ".bin"}
	createdObject := ""
	if reusable != nil {
		original, err := resolveObject(s.state, documentID, *reusable)
		if err != nil {
			return empty, err
		}
		content, err := s.loadObject(ctx, *reusable, original)
		if err != nil {
			return empty, err
		}
		equal := bytes.Equal(content, upload.Bytes)
		clear(content)
		if !equal {
			return empty, ErrIntegrity
		}
		stored.ObjectName = original.ObjectName
		stored.StorageChecksum = original.StorageChecksum
		stored.KeyName = original.KeyName
		stored.WrappedKey = original.WrappedKey
		stored.ContentVersionID = original.Version.VersionID
		if encrypted {
			stored.MetadataMAC, err = authenticateReference(ctx, s.provider, original, version)
			if err != nil {
				return empty, err
			}
		}
	} else {
		content := upload.Bytes
		if encrypted {
			content, stored.WrappedKey, err = seal(ctx, s.provider, upload.Bytes, version)
			if err != nil {
				return empty, err
			}
			stored.KeyName = s.provider.KeyName()
		}
		stored.StorageChecksum = digest(content)
		objectPath := filepath.Join(s.root, "objects", stored.ObjectName)
		file, err := os.OpenFile(objectPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return empty, err
		}
		if _, err = file.Write(content); err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(objectPath)
			return empty, err
		}
		createdObject = objectPath
	}

	next := cloneState(s.state)
	document.VersionCount = version.VersionNumber
	document.LatestVersionID = versionID
	document.LatestVersion = version
	document.EncryptionRequired = document.EncryptionRequired || encrypted
	next.Documents[documentID] = document
	next.Versions[documentID] = append(next.Versions[documentID], stored)
	if err = s.save(next); err != nil {
		if createdObject != "" {
			_ = os.Remove(createdObject)
		}
		return empty, err
	}
	return UploadResult{documentView(s.state, document), versionView(s.state, version)}, nil
}
func (s *Store) Document(id string) (Document, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	document, ok := s.state.Documents[id]
	if !ok {
		return Document{}, apiError(404, "Document not found")
	}
	return documentView(s.state, document), nil
}
func (s *Store) Documents(ownerID string) []Document {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]Document, 0, len(s.state.Documents))
	for _, document := range s.state.Documents {
		if document.OwnerID == ownerID {
			result = append(result, documentView(s.state, document))
		}
	}
	return result
}
func (s *Store) History(id string) ([]Version, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, ok := s.state.Documents[id]; !ok {
		return nil, apiError(404, "Document not found")
	}
	entries := s.state.Versions[id]
	result := make([]Version, 0, len(entries))
	for index := len(entries) - 1; index >= 0; index-- {
		result = append(result, versionView(s.state, entries[index].Version))
	}
	return result, nil
}
func (s *Store) storedVersion(documentID, versionID string) (StoredVersion, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, version := range s.state.Versions[documentID] {
		if version.Version.VersionID == versionID {
			return version, nil
		}
	}
	return StoredVersion{}, apiError(404, "Version not found")
}
func (s *Store) Version(documentID, versionID string) (Version, error) {
	stored, err := s.storedVersion(documentID, versionID)
	if err != nil {
		return Version{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return versionView(s.state, stored.Version), nil
}
func (s *Store) Content(ctx context.Context, documentID, versionID string) ([]byte, Version, error) {
	s.mu.RLock()
	var stored StoredVersion
	found := false
	for _, item := range s.state.Versions[documentID] {
		if item.Version.VersionID == versionID {
			stored = item
			found = true
			break
		}
	}
	if !found {
		s.mu.RUnlock()
		return nil, Version{}, apiError(404, "Version not found")
	}
	original, err := resolveObject(s.state, documentID, stored)
	s.mu.RUnlock()
	if err != nil {
		return nil, Version{}, err
	}
	content, err := s.loadObject(ctx, stored, original)
	return content, stored.Version, err
}
func (s *Store) loadObject(ctx context.Context, stored, original StoredVersion) ([]byte, error) {
	if filepath.Base(original.ObjectName) != original.ObjectName || original.ObjectName == "." {
		return nil, ErrIntegrity
	}
	content, err := os.ReadFile(filepath.Join(s.root, "objects", original.ObjectName))
	if err != nil {
		return nil, fmt.Errorf("read stored object: %w", err)
	}
	if digest(content) != original.StorageChecksum {
		return nil, ErrIntegrity
	}
	if original.Version.Encryption.Enabled {
		content, err = unseal(ctx, s.provider, content, original, stored)
		if err != nil {
			return nil, err
		}
	}
	if int64(len(content)) != stored.Version.File.SizeBytes || digest(content) != stored.Version.Checksum.Value {
		clear(content)
		return nil, ErrIntegrity
	}
	return content, nil
}
