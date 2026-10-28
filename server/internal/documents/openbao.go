package documents

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var ErrKeyUnavailable = errors.New("OpenBao key service is unavailable; encrypted files cannot be written or opened")

type OpenBao struct {
	address, token, mount, name string
	client                      *http.Client
}

func NewOpenBao(address, token, mount, name string) (*OpenBao, error) {
	parsed, err := url.Parse(address)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("invalid OpenBao address")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && (parsed.Hostname() == "localhost" || net.ParseIP(parsed.Hostname()).IsLoopback())) {
		return nil, errors.New("OpenBao requires HTTPS except on loopback")
	}
	valid := regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)
	if token == "" || !valid.MatchString(mount) || !valid.MatchString(name) {
		return nil, errors.New("OpenBao token, transit mount and key name are required")
	}
	return &OpenBao{strings.TrimRight(address, "/"), token, mount, name, &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}
func (b *OpenBao) KeyName() string { return b.mount + "/" + b.name }
func (b *OpenBao) call(ctx context.Context, operation string, body map[string]string) (map[string]string, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, b.address+"/v1/"+b.mount+"/"+operation+"/"+b.name, bytes.NewReader(encoded))
	if err != nil {
		return nil, ErrKeyUnavailable
	}
	request.Header.Set("X-Vault-Token", b.token)
	request.Header.Set("Content-Type", "application/json")
	response, err := b.client.Do(request)
	if err != nil {
		return nil, ErrKeyUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, ErrKeyUnavailable
	}
	var payload struct {
		Data map[string]json.RawMessage `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload) != nil || payload.Data == nil {
		return nil, ErrKeyUnavailable
	}
	result := map[string]string{}
	for _, key := range []string{"ciphertext", "plaintext"} {
		if value, ok := payload.Data[key]; ok {
			var decoded string
			if json.Unmarshal(value, &decoded) != nil {
				return nil, ErrKeyUnavailable
			}
			result[key] = decoded
		}
	}
	return result, nil
}
func (b *OpenBao) Wrap(ctx context.Context, key, aad []byte) (string, error) {
	data, err := b.call(ctx, "encrypt", map[string]string{"plaintext": base64.StdEncoding.EncodeToString(key), "associated_data": base64.StdEncoding.EncodeToString(aad)})
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(data["ciphertext"], "vault:v") {
		return "", ErrKeyUnavailable
	}
	return data["ciphertext"], nil
}
func (b *OpenBao) Unwrap(ctx context.Context, wrapped string, aad []byte) ([]byte, error) {
	data, err := b.call(ctx, "decrypt", map[string]string{"ciphertext": wrapped, "associated_data": base64.StdEncoding.EncodeToString(aad)})
	if err != nil {
		return nil, err
	}
	key, err := base64.StdEncoding.DecodeString(data["plaintext"])
	if err != nil || len(key) != 32 {
		clear(key)
		return nil, ErrKeyUnavailable
	}
	return key, nil
}
