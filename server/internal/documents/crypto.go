package documents

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
)

var ErrIntegrity = errors.New("stored file integrity check failed")
var objectHeader = []byte("DVLT1")

func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func associatedData(version Version) []byte {
	// Related versions are a live API view, outside the immutable authenticated snapshot.
	version.IdenticalVersions = nil
	data, _ := json.Marshal(struct {
		Domain  string  `json:"domain"`
		Version Version `json:"version"`
	}{"document-vault:version:1", version})
	return data
}
func seal(ctx context.Context, provider KeyWrapper, data []byte, version Version) ([]byte, string, error) {
	if provider == nil {
		return nil, "", ErrKeyUnavailable
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, "", err
	}
	defer clear(key)
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, "", err
	}
	aad := associatedData(version)
	wrapped, err := provider.Wrap(ctx, key, aad)
	if err != nil {
		return nil, "", err
	}
	result := append(append([]byte{}, objectHeader...), nonce...)
	result = gcm.Seal(result, nonce, data, aad)
	return result, wrapped, nil
}
func unseal(ctx context.Context, provider KeyWrapper, data []byte, stored StoredVersion, reference StoredVersion) ([]byte, error) {
	if provider == nil || provider.KeyName() != stored.KeyName {
		return nil, ErrKeyUnavailable
	}
	if len(data) < len(objectHeader)+12+16 || !bytes.Equal(data[:len(objectHeader)], objectHeader) {
		return nil, ErrIntegrity
	}
	aad := associatedData(stored.Version)
	key, err := provider.Unwrap(ctx, stored.WrappedKey, aad)
	if err != nil {
		return nil, err
	}
	defer clear(key)
	if reference.ContentVersionID != "" {
		expected, err := referenceMAC(key, stored.Version.VersionID, reference.Version)
		if err != nil || !hmac.Equal([]byte(expected), []byte(reference.MetadataMAC)) {
			return nil, ErrIntegrity
		}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, ErrIntegrity
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, ErrIntegrity
	}
	nonceStart := len(objectHeader)
	nonceEnd := nonceStart + gcm.NonceSize()
	plaintext, err := gcm.Open(nil, data[nonceStart:nonceEnd], data[nonceEnd:], aad)
	if err != nil {
		return nil, ErrIntegrity
	}
	return plaintext, nil
}

func referenceMAC(key []byte, sourceID string, version Version) (string, error) {
	// Domain separation keeps the reference MAC key distinct from the AES file key.
	derived, err := hkdf.Key(sha256.New, key, nil, "document-vault:reference-metadata:v1", 32)
	if err != nil {
		return "", err
	}
	defer clear(derived)
	mac := hmac.New(sha256.New, derived)
	mac.Write([]byte(sourceID))
	mac.Write([]byte{0})
	mac.Write(associatedData(version))
	return hex.EncodeToString(mac.Sum(nil)), nil
}
func authenticateReference(ctx context.Context, provider KeyWrapper, original StoredVersion, version Version) (string, error) {
	if provider == nil || provider.KeyName() != original.KeyName {
		return "", ErrKeyUnavailable
	}
	key, err := provider.Unwrap(ctx, original.WrappedKey, associatedData(original.Version))
	if err != nil {
		return "", err
	}
	defer clear(key)
	return referenceMAC(key, original.Version.VersionID, version)
}
