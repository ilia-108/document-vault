package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

type capturedSender struct {
	mu    sync.Mutex
	codes map[string]string
	err   error
}

func (s *capturedSender) SendLoginCode(_ context.Context, email, code string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.codes[email] = code
	return s.err
}
func (s *capturedSender) code(email string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.codes[email]
}
func testService(t *testing.T) (*Service, *capturedSender, http.Handler) {
	t.Helper()
	sender := &capturedSender{codes: map[string]string{}}
	service, err := Open(Config{DatabasePath: filepath.Join(t.TempDir(), "auth.db"), Secret: []byte(strings.Repeat("x", 32)), Sender: sender, CookieSecure: true, AllowedOrigin: "http://127.0.0.1:3040", EmailMode: "test"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { service.Close() })
	return service, sender, service.Handler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, map[string]any{"data": CurrentUser(r.Context())})
	}))
}
func request(handler http.Handler, method, path, body string, cookie *http.Cookie) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}
func body(values map[string]string) string { data, _ := json.Marshal(values); return string(data) }
func TestSignInAndOneTimeSession(t *testing.T) {
	service, sender, handler := testService(t)
	response := request(handler, "POST", "/api/auth/request-code", `{"email":"Person@Example.com"}`, nil)
	if response.Code != 202 {
		t.Fatal(response.Code, response.Body)
	}
	code := sender.code("person@example.com")
	if len(code) != 6 {
		t.Fatal("code not delivered")
	}
	response = request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "person@example.com", "code": code}), nil)
	if response.Code != 200 {
		t.Fatal(response.Code, response.Body)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatal("invalid session cookie")
	}
	cookie := cookies[0]
	if request(handler, "GET", "/api/auth/me", "", cookie).Code != 200 {
		t.Fatal("session missing")
	}
	if request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "person@example.com", "code": code}), nil).Code != 401 {
		t.Fatal("code was reusable")
	}
	var saved string
	if service.db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&saved) != nil || saved == cookie.Value {
		t.Fatal("session token was not hashed")
	}
	if request(handler, "POST", "/api/auth/logout", "", cookie).Code != 200 {
		t.Fatal("logout failed")
	}
	if request(handler, "GET", "/api/auth/me", "", cookie).Code != 401 {
		t.Fatal("logged-out session accepted")
	}
}
func TestExpiryAttemptsCooldownAndDeliveryFailure(t *testing.T) {
	t.Run("expired", func(t *testing.T) {
		service, sender, handler := testService(t)
		request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil)
		service.now = func() time.Time { return time.Now().UTC().Add(11 * time.Minute) }
		if request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "a@example.com", "code": sender.code("a@example.com")}), nil).Code != 401 {
			t.Fatal("expired code accepted")
		}
	})
	t.Run("attempts", func(t *testing.T) {
		_, sender, handler := testService(t)
		request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil)
		code := sender.code("a@example.com")
		wrong := "000000"
		if code == wrong {
			wrong = "111111"
		}
		for index := 0; index < 5; index++ {
			if request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "a@example.com", "code": wrong}), nil).Code != 401 {
				t.Fatal("bad code accepted")
			}
		}
		if request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "a@example.com", "code": code}), nil).Code != 401 {
			t.Fatal("exhausted code accepted")
		}
	})
	t.Run("cooldown", func(t *testing.T) {
		_, _, handler := testService(t)
		request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil)
		if request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil).Code != 429 {
			t.Fatal("cooldown missing")
		}
	})
	t.Run("failed delivery", func(t *testing.T) {
		_, sender, handler := testService(t)
		sender.err = errors.New("unavailable")
		if request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil).Code != 502 {
			t.Fatal("delivery error ignored")
		}
		if request(handler, "POST", "/api/auth/verify-code", body(map[string]string{"email": "a@example.com", "code": sender.code("a@example.com")}), nil).Code != 401 {
			t.Fatal("undelivered code accepted")
		}
	})
}
func TestCodeIsConsumedAtomically(t *testing.T) {
	_, sender, handler := testService(t)
	request(handler, "POST", "/api/auth/request-code", `{"email":"a@example.com"}`, nil)
	payload := body(map[string]string{"email": "a@example.com", "code": sender.code("a@example.com")})
	var group sync.WaitGroup
	statuses := make(chan int, 8)
	for index := 0; index < 8; index++ {
		group.Add(1)
		go func() {
			defer group.Done()
			statuses <- request(handler, "POST", "/api/auth/verify-code", payload, nil).Code
		}()
	}
	group.Wait()
	close(statuses)
	successes := 0
	for status := range statuses {
		if status == 200 {
			successes++
		} else if status != 401 {
			t.Fatal(status)
		}
	}
	if successes != 1 {
		t.Fatal("single-use invariant violated", successes)
	}
}
func TestAuthenticationAndOriginAreRequired(t *testing.T) {
	_, _, handler := testService(t)
	if request(handler, "GET", "/api/v1/documents/schema", "", nil).Code != 401 {
		t.Fatal("private API exposed")
	}
	r := httptest.NewRequest("POST", "/api/auth/request-code", strings.NewReader(`{"email":"a@example.com"}`))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Origin", "https://untrusted.example")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross-site request allowed")
	}
}
