package documents

import (
	"encoding/json"
	"path"
	"strings"
	"unicode/utf8"
)

func versionReference(v Version) VersionReference {
	return VersionReference{v.VersionID, v.VersionNumber, v.VersionName}
}
func versionView(state diskState, v Version) Version {
	v.IdenticalVersions = nil
	for _, candidate := range state.Versions[v.DocumentID] {
		c := candidate.Version
		if c.VersionID != v.VersionID && c.Checksum == v.Checksum && c.File.SizeBytes == v.File.SizeBytes {
			v.IdenticalVersions = append(v.IdenticalVersions, versionReference(c))
		}
	}
	return v
}
func documentView(state diskState, d Document) Document {
	d.LatestVersion = versionView(state, d.LatestVersion)
	return d
}
func extension(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	ext := strings.ToLower(path.Ext(name))
	if ext == "." || strings.EqualFold(ext, name) {
		return ""
	}
	return ext
}
func reviewUpload(state diskState, d Document, u Upload, encrypted bool, checksum string) (UploadReview, *StoredVersion, error) {
	review := UploadReview{DuplicateVersions: []VersionReference{}}
	var reusable *StoredVersion
	entries := state.Versions[d.DocumentID]
	for _, entry := range entries {
		if entry.Version.Checksum.Value == checksum && entry.Version.File.SizeBytes == int64(len(u.Bytes)) {
			review.DuplicateVersions = append(review.DuplicateVersions, versionReference(entry.Version))
			if entry.Version.Encryption.Enabled == encrypted && reusable == nil {
				copy := entry
				reusable = &copy
			}
		}
	}
	if len(entries) > 0 {
		first, last, incoming := extension(entries[0].Version.File.Name), extension(entries[len(entries)-1].Version.File.Name), extension(u.FileName)
		if incoming != first || incoming != last {
			review.ExtensionChange = &ExtensionChange{first, last, incoming}
		}
	}
	review.ReuseFile = reusable != nil
	payload, _ := json.Marshal(struct {
		Document                                         Document
		Owner, Actor, Name, Media, Checksum, VersionName string
		Size                                             int
		Encrypted                                        bool
	}{d, u.OwnerID, u.Actor, u.FileName, u.MediaType, checksum, u.VersionName, len(u.Bytes), encrypted})
	review.ConfirmationToken = digest(payload)
	return review, reusable, nil
}
func resolveObject(state diskState, documentID string, stored StoredVersion) (StoredVersion, error) {
	if stored.ContentVersionID == "" {
		if path.Base(stored.ObjectName) != stored.ObjectName {
			return StoredVersion{}, ErrIntegrity
		}
		return stored, nil
	}
	for _, original := range state.Versions[documentID] {
		if original.Version.VersionID == stored.ContentVersionID {
			if original.ContentVersionID != "" || original.Version.Checksum != stored.Version.Checksum || original.Version.File.SizeBytes != stored.Version.File.SizeBytes || original.Version.Encryption != stored.Version.Encryption || original.ObjectName != stored.ObjectName || original.StorageChecksum != stored.StorageChecksum || original.KeyName != stored.KeyName || original.WrappedKey != stored.WrappedKey {
				return StoredVersion{}, ErrIntegrity
			}
			return resolveObject(state, documentID, original)
		}
	}
	return StoredVersion{}, ErrIntegrity
}
func (s *Store) Rename(ownerID, id, title string) (Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	d, ok := s.state.Documents[id]
	if !ok || d.OwnerID != ownerID {
		return Document{}, apiError(404, "Document not found")
	}
	title = strings.TrimSpace(title)
	if title == "" || utf8.RuneCountInString(title) > 300 {
		return Document{}, apiError(400, "Document title must contain 1–300 characters")
	}
	next := cloneState(s.state)
	d.Title = title
	next.Documents[id] = d
	if err := s.save(next); err != nil {
		return Document{}, err
	}
	return documentView(s.state, d), nil
}
