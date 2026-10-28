package auth

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/resend/resend-go/v3"
)

// The sender interface and Resend adapter follow domyshev-labs/road-rules-trainer.
type EmailSender interface {
	SendLoginCode(context.Context, string, string) error
}
type LogSender struct{}

func (LogSender) SendLoginCode(_ context.Context, email, code string) error {
	log.Printf("LOCAL DEVELOPMENT ONLY: login code for %s: %s", email, code)
	return nil
}

type ResendSender struct {
	client *resend.Client
	from   string
}

func NewResendSender(apiKey, from string) (EmailSender, error) {
	if apiKey == "" || from == "" {
		return nil, fmt.Errorf("RESEND_API_KEY and EMAIL_FROM are required")
	}
	client := resend.NewCustomClient(&http.Client{Timeout: 10 * time.Second}, apiKey)
	return &ResendSender{client, from}, nil
}
func (s *ResendSender) SendLoginCode(ctx context.Context, email, code string) error {
	_, err := s.client.Emails.SendWithContext(ctx, &resend.SendEmailRequest{From: s.from, To: []string{email}, Subject: "Your Document Vault sign-in code", Text: fmt.Sprintf("Your sign-in code is %s.\n\nIt expires in 10 minutes. If you did not request this code, you can ignore this email.", code), Html: fmt.Sprintf(`<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto"><h1 style="color:#206751">Document Vault</h1><p>Your sign-in code:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">%s</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>`, code)})
	return err
}
