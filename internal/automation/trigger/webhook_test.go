package trigger

import (
	"context"
	"errors"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeWebhookRepo is a WebhookRepo test double.
type fakeWebhookRepo struct {
	automation      *models.AutomationFull
	getErr          error
	gotToken        string
	autoDisabledIDs []int64
}

func (r *fakeWebhookRepo) GetByWebhookToken(_ context.Context, token string) (*models.AutomationFull, error) {
	r.gotToken = token
	if r.getErr != nil {
		return nil, r.getErr
	}
	return r.automation, nil
}

func (r *fakeWebhookRepo) SetAutoDisabled(_ context.Context, id int64, _ string) error {
	r.autoDisabledIDs = append(r.autoDisabledIDs, id)
	return nil
}

func TestHandleWebhook_EmptyToken(t *testing.T) {
	tr := NewWebhookTrigger(&fakeWebhookRepo{}, &fakeEngine{})
	err := tr.HandleWebhook(context.Background(), "", []byte(`{}`), "", "1.2.3.4")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestHandleWebhook_RepoError(t *testing.T) {
	repo := &fakeWebhookRepo{getErr: errors.New("db down")}
	tr := NewWebhookTrigger(repo, &fakeEngine{})

	err := tr.HandleWebhook(context.Background(), "tok", []byte(`{}`), "sig", "1.2.3.4")
	if err == nil {
		t.Fatal("expected error when repo lookup fails")
	}
	if !errors.Is(err, repo.getErr) {
		t.Fatalf("expected wrapped repo error, got %v", err)
	}
	if repo.gotToken != "tok" {
		t.Fatalf("repo received token %q, want tok", repo.gotToken)
	}
}

func TestHandleWebhook_NotFound(t *testing.T) {
	repo := &fakeWebhookRepo{automation: nil}
	tr := NewWebhookTrigger(repo, &fakeEngine{})

	err := tr.HandleWebhook(context.Background(), "tok", nil, "", "1.2.3.4")
	if !errors.Is(err, ErrWebhookNotFound) {
		t.Fatalf("expected ErrWebhookNotFound, got %v", err)
	}
}

func TestHandleWebhook_KindUnavailable(t *testing.T) {
	// Even when a matching automation exists, the typed runtime has no webhook
	// CTI kind, so the request is rejected with ErrWebhookNotFound and the
	// engine is never invoked.
	repo := &fakeWebhookRepo{automation: &models.AutomationFull{
		Automation: models.Automation{ID: 55, Name: "hook", Enabled: true},
	}}
	eng := &fakeEngine{}
	tr := NewWebhookTrigger(repo, eng)

	err := tr.HandleWebhook(context.Background(), "tok", []byte(`{"x":1}`), "sig", "10.0.0.1")
	if !errors.Is(err, ErrWebhookNotFound) {
		t.Fatalf("expected ErrWebhookNotFound, got %v", err)
	}
	if eng.callCount() != 0 {
		t.Fatalf("engine must not be called for webhook kind, got %d", eng.callCount())
	}
}

func TestWebhookSentinelErrorsAreDistinct(t *testing.T) {
	if errors.Is(ErrWebhookNotFound, ErrWebhookSignatureInvalid) {
		t.Fatal("sentinel errors must be distinct")
	}
	if ErrWebhookNotFound.Error() == "" || ErrWebhookSignatureInvalid.Error() == "" {
		t.Fatal("sentinel errors must have messages")
	}
}
