package documents

import "context"

type FileInfo struct {
	Name      string `json:"name"`
	MediaType string `json:"mediaType"`
	SizeBytes int64  `json:"sizeBytes"`
}
type Checksum struct {
	Algorithm string `json:"algorithm"`
	Value     string `json:"value"`
}
type Snapshot struct {
	Title          string   `json:"title"`
	Author         string   `json:"author"`
	Tags           []string `json:"tags"`
	Source         string   `json:"source"`
	SourceRevision string   `json:"sourceRevision,omitempty"`
}
type EncryptionInfo struct {
	Enabled   bool   `json:"enabled"`
	Algorithm string `json:"algorithm,omitempty"`
	Provider  string `json:"provider,omitempty"`
}
type VersionReference struct {
	VersionID     string `json:"versionId"`
	VersionNumber int    `json:"versionNumber"`
	VersionName   string `json:"versionName,omitempty"`
}
type Version struct {
	VersionID         string             `json:"versionId"`
	DocumentID        string             `json:"documentId"`
	VersionNumber     int                `json:"versionNumber"`
	VersionName       string             `json:"versionName,omitempty"`
	CapturedAt        int64              `json:"capturedAt"`
	CapturedBy        string             `json:"capturedBy"`
	File              FileInfo           `json:"file"`
	Checksum          Checksum           `json:"checksum"`
	Snapshot          Snapshot           `json:"snapshot"`
	Encryption        EncryptionInfo     `json:"encryption"`
	IdenticalVersions []VersionReference `json:"identicalVersions,omitempty"`
}
type Document struct {
	OwnerID            string   `json:"ownerId"`
	DocumentID         string   `json:"documentId"`
	Title              string   `json:"title"`
	Owner              string   `json:"owner"`
	Tags               []string `json:"tags"`
	CreatedAt          int64    `json:"createdAt"`
	LatestVersionID    string   `json:"latestVersionId"`
	VersionCount       int      `json:"versionCount"`
	LatestVersion      Version  `json:"latestVersion"`
	EncryptionRequired bool     `json:"encryptionRequired"`
}
type EncryptionSettings struct {
	EncryptByDefault     bool `json:"encryptByDefault"`
	AllowPerFileOverride bool `json:"allowPerFileOverride"`
}
type StoredVersion struct {
	ContentVersionID string  `json:"contentVersionId,omitempty"`
	MetadataMAC      string  `json:"metadataMac,omitempty"`
	Version          Version `json:"version"`
	ObjectName       string  `json:"objectName"`
	StorageChecksum  string  `json:"storageChecksum"`
	KeyName          string  `json:"keyName,omitempty"`
	WrappedKey       string  `json:"wrappedKey,omitempty"`
}
type diskState struct {
	WorkspaceSettings map[string]EncryptionSettings `json:"workspaceSettings"`
	FormatVersion     int                           `json:"formatVersion"`
	Settings          EncryptionSettings            `json:"settings"`
	Documents         map[string]Document           `json:"documents"`
	Versions          map[string][]StoredVersion    `json:"versions"`
}
type Upload struct {
	OwnerID           string
	Actor             string
	Title             string
	Owner             string
	Tags              []string
	VersionName       string
	FileName          string
	MediaType         string
	Bytes             []byte
	ConfirmationToken string
	Encrypt           *bool
}
type UploadResult struct {
	Document Document `json:"document"`
	Version  Version  `json:"version"`
}
type KeyWrapper interface {
	Wrap(context.Context, []byte, []byte) (string, error)
	Unwrap(context.Context, string, []byte) ([]byte, error)
	KeyName() string
}
type APIError struct {
	Status  int
	Message string
}

func (e *APIError) Error() string               { return e.Message }
func apiError(status int, message string) error { return &APIError{status, message} }

type ExtensionChange struct {
	First    string `json:"first"`
	Latest   string `json:"latest"`
	Incoming string `json:"incoming"`
}
type UploadReview struct {
	ConfirmationToken string             `json:"confirmationToken"`
	DuplicateVersions []VersionReference `json:"duplicateVersions"`
	ExtensionChange   *ExtensionChange   `json:"extensionChange,omitempty"`
	ReuseFile         bool               `json:"reuseFile"`
}
type UploadReviewError struct{ Review UploadReview }

func (e *UploadReviewError) Error() string { return "Review and confirm the version before adding it" }
