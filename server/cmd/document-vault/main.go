package main

import (
	"context"
	"document-vault/server/internal/auth"
	"document-vault/server/internal/documents"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

func environment(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
func main() {
	var provider documents.KeyWrapper
	if address := os.Getenv("BAO_ADDR"); address != "" {
		token := os.Getenv("BAO_TOKEN")
		if path := os.Getenv("BAO_TOKEN_FILE"); path != "" {
			bytes, err := os.ReadFile(path)
			if err != nil {
				log.Fatal("Cannot read OpenBao token file")
			}
			token = strings.TrimSpace(string(bytes))
			clear(bytes)
		}
		var err error
		provider, err = documents.NewOpenBao(address, token, environment("BAO_TRANSIT_MOUNT", "transit"), environment("BAO_TRANSIT_KEY", "document-vault"))
		if err != nil {
			log.Fatal(err)
		}
	}
	store, err := documents.OpenStore(environment("DOCUMENT_DATA_DIR", ".data/documents"), provider)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	dataRoot := environment("DOCUMENT_DATA_DIR", ".data/documents")
	secret, err := auth.LoadSecret(filepath.Join(dataRoot, "auth", "session-secret"))
	if err != nil {
		log.Fatal(err)
	}
	emailMode := environment("EMAIL_MODE", "log")
	var sender auth.EmailSender
	switch emailMode {
	case "log":
		sender = auth.LogSender{}
	case "resend":
		sender, err = auth.NewResendSender(os.Getenv("RESEND_API_KEY"), os.Getenv("EMAIL_FROM"))
		if err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatal("EMAIL_MODE must be log or resend")
	}
	allowedEmails := []string{}
	if value := os.Getenv("DOCUMENT_ALLOWED_EMAILS"); value != "" {
		allowedEmails = strings.Split(value, ",")
	}
	cookieDefault := "true"
	if emailMode == "log" {
		cookieDefault = "false"
	}
	authService, err := auth.Open(auth.Config{DatabasePath: filepath.Join(dataRoot, "auth", "sessions.db"), Secret: secret, Sender: sender, CookieSecure: environment("COOKIE_SECURE", cookieDefault) == "true", AllowedOrigin: environment("DOCUMENT_ALLOWED_ORIGIN", "http://127.0.0.1:3040"), EmailMode: emailMode, AllowedEmails: allowedEmails})
	if err != nil {
		log.Fatal(err)
	}
	defer authService.Close()
	server := &http.Server{Addr: environment("DOCUMENT_LISTEN", "127.0.0.1:3050"), Handler: authService.Handler(documents.Handler(store, environment("DOCUMENT_ALLOWED_ORIGIN", "http://127.0.0.1:3040"))), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	log.Printf("Document Vault API listening on %s", server.Addr)
	if provider == nil {
		log.Print("OpenBao is not configured; encrypted uploads will fail closed")
	}
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
