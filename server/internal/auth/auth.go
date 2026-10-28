package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

const cookieName = "document_vault_session"

type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}
type userContextKey struct{}

func CurrentUser(ctx context.Context) User {
	value, _ := ctx.Value(userContextKey{}).(User)
	return value
}

type Config struct {
	DatabasePath  string
	Secret        []byte
	Sender        EmailSender
	CookieSecure  bool
	AllowedOrigin string
	EmailMode     string
	AllowedEmails []string
}
type attemptWindow struct {
	start time.Time
	count int
}
type Service struct {
	db       *sql.DB
	cfg      Config
	mu       sync.Mutex
	attempts map[string]attemptWindow
	now      func() time.Time
}

func Open(cfg Config) (*Service, error) {
	if len(cfg.Secret) < 32 || cfg.Sender == nil {
		return nil, errors.New("a session secret of at least 32 bytes and an email sender are required")
	}
	if err := os.MkdirAll(filepath.Dir(cfg.DatabasePath), 0700); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(cfg.DatabasePath, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	file.Close()
	db, err := sql.Open("sqlite", cfg.DatabasePath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_codes(id TEXT PRIMARY KEY,email TEXT NOT NULL,code_hash TEXT NOT NULL,request_ip TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL,consumed_at INTEGER,created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS codes_email ON login_codes(email,created_at DESC);
CREATE INDEX IF NOT EXISTS codes_ip ON login_codes(request_ip,created_at);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return &Service{db: db, cfg: cfg, attempts: map[string]attemptWindow{}, now: func() time.Time { return time.Now().UTC() }}, nil
}
func (s *Service) Close() error { return s.db.Close() }
func LoadSecret(path string) ([]byte, error) {
	if value := os.Getenv("SESSION_SECRET"); value != "" {
		if len(value) < 32 {
			return nil, errors.New("SESSION_SECRET must have at least 32 characters")
		}
		return []byte(value), nil
	}
	if bytes, err := os.ReadFile(path); err == nil {
		if len(bytes) != 32 {
			return nil, errors.New("invalid saved session secret")
		}
		return bytes, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return nil, err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	_, err = file.Write(bytes)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	return bytes, err
}
func token() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(bytes), nil
}
func tokenHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
func (s *Service) codeHash(email, id, code string) string {
	mac := hmac.New(sha256.New, s.cfg.Secret)
	mac.Write([]byte(email + ":" + id + ":" + code))
	return hex.EncodeToString(mac.Sum(nil))
}
func normalizeEmail(value string) (string, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || len(value) > 254 {
		return "", errors.New("invalid email")
	}
	return value, nil
}
func write(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, status int, message string) {
	write(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, value any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		fail(w, 415, "JSON is required")
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, 400, "Invalid JSON request")
		return false
	}
	return true
}
func (s *Service) requestCode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &input) {
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil {
		fail(w, 422, "Enter a valid email address")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := s.now().Unix()
	s.mu.Lock()
	var recent int
	var last sql.NullInt64
	err = s.db.QueryRow(`SELECT count(*),max(created_at) FROM login_codes WHERE email=? AND created_at>?`, email, now-3600).Scan(&recent, &last)
	if err != nil {
		s.mu.Unlock()
		fail(w, 500, "Cannot request a sign-in code")
		return
	}
	if recent >= 5 || (last.Valid && now-last.Int64 < 60) {
		s.mu.Unlock()
		fail(w, 429, "Please wait before requesting another code")
		return
	}
	err = s.db.QueryRow(`SELECT count(*) FROM login_codes WHERE request_ip=? AND created_at>?`, ip, now-3600).Scan(&recent)
	if err != nil {
		s.mu.Unlock()
		fail(w, 500, "Cannot request a sign-in code")
		return
	}
	if recent >= 20 {
		s.mu.Unlock()
		fail(w, 429, "Too many requests; try again later")
		return
	}
	codeBytes := make([]byte, 6)
	for index := range codeBytes {
		number, err := rand.Int(rand.Reader, big.NewInt(10))
		if err != nil {
			s.mu.Unlock()
			fail(w, 500, "Cannot create a sign-in code")
			return
		}
		codeBytes[index] = '0' + byte(number.Int64())
	}
	code := string(codeBytes)
	id, err := token()
	if err != nil {
		s.mu.Unlock()
		fail(w, 500, "Cannot create a sign-in code")
		return
	}
	tx, err := s.db.Begin()
	if err == nil {
		_, err = tx.Exec(`UPDATE login_codes SET consumed_at=? WHERE email=? AND consumed_at IS NULL`, now, email)
		if err == nil {
			_, err = tx.Exec(`INSERT INTO login_codes(id,email,code_hash,request_ip,expires_at,created_at)VALUES(?,?,?,?,?,?)`, id, email, s.codeHash(email, id, code), ip, now+600, now)
		}
		if err == nil {
			err = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
	}
	s.mu.Unlock()
	if err != nil {
		fail(w, 500, "Cannot request a sign-in code")
		return
	}
	allowed := len(s.cfg.AllowedEmails) == 0
	for _, value := range s.cfg.AllowedEmails {
		if strings.EqualFold(strings.TrimSpace(value), email) {
			allowed = true
		}
	}
	if allowed {
		err = s.cfg.Sender.SendLoginCode(r.Context(), email, code)
	}
	if err != nil || !allowed {
		_, _ = s.db.Exec(`UPDATE login_codes SET consumed_at=? WHERE id=?`, now, id)
		if err != nil {
			fail(w, 502, "Cannot send the sign-in email")
			return
		}
	}
	_, _ = s.db.Exec(`DELETE FROM login_codes WHERE created_at<?`, now-86400)
	_, _ = s.db.Exec(`DELETE FROM sessions WHERE expires_at<=?`, now)
	write(w, 202, map[string]any{"data": map[string]string{"message": "If this address is allowed, a sign-in code has been sent"}})
}
func (s *Service) verifyCode(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if !decode(w, r, &input) {
		return
	}
	email, err := normalizeEmail(input.Email)
	if err != nil || !regexp.MustCompile(`^[0-9]{6}$`).MatchString(input.Code) {
		fail(w, 401, "Invalid or expired sign-in code")
		return
	}
	ip, _, _ := net.SplitHostPort(r.RemoteAddr)
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	window := s.attempts[ip]
	if now.Sub(window.start) >= time.Minute {
		window = attemptWindow{start: now}
	}
	window.count++
	s.attempts[ip] = window
	for key, value := range s.attempts {
		if now.Sub(value.start) > time.Hour {
			delete(s.attempts, key)
		}
	}
	if window.count > 30 {
		fail(w, 429, "Too many verification attempts; try again later")
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		fail(w, 500, "Cannot verify sign-in code")
		return
	}
	defer tx.Rollback()
	var id, hash string
	var expires int64
	var attempts int
	err = tx.QueryRow(`SELECT id,code_hash,expires_at,attempts FROM login_codes WHERE email=? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1`, email).Scan(&id, &hash, &expires, &attempts)
	if err != nil {
		fail(w, 401, "Invalid or expired sign-in code")
		return
	}
	if expires <= now.Unix() || attempts >= 5 || !hmac.Equal([]byte(hash), []byte(s.codeHash(email, id, input.Code))) {
		if _, err = tx.Exec(`UPDATE login_codes SET attempts=attempts+1 WHERE id=? AND consumed_at IS NULL`, id); err == nil {
			_ = tx.Commit()
		}
		fail(w, 401, "Invalid or expired sign-in code")
		return
	}
	result, err := tx.Exec(`UPDATE login_codes SET consumed_at=? WHERE id=? AND consumed_at IS NULL AND attempts<5 AND expires_at>?`, now.Unix(), id, now.Unix())
	if err != nil {
		fail(w, 500, "Cannot consume sign-in code")
		return
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		fail(w, 401, "Invalid or expired sign-in code")
		return
	}
	userID, err := token()
	if err != nil {
		fail(w, 500, "Cannot create session")
		return
	}
	_, err = tx.Exec(`INSERT INTO users(id,email,created_at)VALUES(?,?,?) ON CONFLICT(email) DO NOTHING`, userID, email, now.Unix())
	if err != nil {
		fail(w, 500, "Cannot create account")
		return
	}
	var user User
	if tx.QueryRow(`SELECT id,email FROM users WHERE email=?`, email).Scan(&user.ID, &user.Email) != nil {
		fail(w, 500, "Cannot read account")
		return
	}
	session, err := token()
	if err != nil {
		fail(w, 500, "Cannot create session")
		return
	}
	_, err = tx.Exec(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at)VALUES(?,?,?,?)`, tokenHash(session), user.ID, now.Add(30*24*time.Hour).Unix(), now.Unix())
	if err != nil || tx.Commit() != nil {
		fail(w, 500, "Cannot create session")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: session, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: 30 * 24 * 60 * 60, Expires: now.Add(30 * 24 * time.Hour)})
	write(w, 200, map[string]any{"data": user})
}
func (s *Service) user(r *http.Request) (User, error) {
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return User{}, err
	}
	var user User
	var expires int64
	err = s.db.QueryRow(`SELECT users.id,users.email,sessions.expires_at FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=?`, tokenHash(cookie.Value)).Scan(&user.ID, &user.Email, &expires)
	if err != nil || expires <= s.now().Unix() {
		return User{}, errors.New("session expired")
	}
	return user, nil
}
func (s *Service) Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" && r.Method != "HEAD" {
			if origin := r.Header.Get("Origin"); origin != "" && origin != s.cfg.AllowedOrigin {
				fail(w, 403, "Request origin is not allowed")
				return
			}
		}
		switch r.URL.Path {
		case "/api/health":
			next.ServeHTTP(w, r)
			return
		case "/api/auth/config":
			if r.Method == "GET" {
				write(w, 200, map[string]any{"data": map[string]any{"emailMode": s.cfg.EmailMode, "codeLifetimeSeconds": 600}})
				return
			}
		case "/api/auth/request-code":
			if r.Method == "POST" {
				s.requestCode(w, r)
				return
			}
		case "/api/auth/verify-code":
			if r.Method == "POST" {
				s.verifyCode(w, r)
				return
			}
		}
		user, err := s.user(r)
		if err != nil {
			fail(w, 401, "Sign in to open your document library")
			return
		}
		if r.URL.Path == "/api/auth/me" && r.Method == "GET" {
			write(w, 200, map[string]any{"data": user})
			return
		}
		if r.URL.Path == "/api/auth/logout" && r.Method == "POST" {
			cookie, _ := r.Cookie(cookieName)
			if _, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash=?`, tokenHash(cookie.Value)); err != nil {
				fail(w, 500, "Cannot sign out")
				return
			}
			http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode, MaxAge: -1})
			write(w, 200, map[string]any{"data": map[string]bool{"signedOut": true}})
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userContextKey{}, user)))
	})
}
