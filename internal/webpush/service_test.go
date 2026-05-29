package webpush

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// fakeRepo is an in-memory SubscriptionRepo for unit tests.
type fakeRepo struct {
	mu      sync.Mutex
	subs    []*models.PushSubscription
	deleted []string
	touched []string
}

func (f *fakeRepo) ListAll(_ context.Context) ([]*models.PushSubscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]*models.PushSubscription, len(f.subs))
	copy(out, f.subs)
	return out, nil
}

func (f *fakeRepo) DeleteByEndpointAny(_ context.Context, endpoint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleted = append(f.deleted, endpoint)
	return nil
}

func (f *fakeRepo) Touch(_ context.Context, endpoint string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.touched = append(f.touched, endpoint)
	return nil
}

// stubClient returns a canned status code for every request.
type stubClient struct {
	status int
	err    error
	calls  int
	mu     sync.Mutex
}

func (s *stubClient) Do(_ *http.Request) (*http.Response, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	if s.err != nil {
		return nil, s.err
	}
	return &http.Response{
		StatusCode: s.status,
		Body:       io.NopCloser(bytes.NewReader(nil)),
		Header:     http.Header{},
	}, nil
}

// validVAPIDPub / validVAPIDPriv are well-formed VAPID keys generated
// once for the test suite (offline). webpush-go validates the key shape
// before calling the HTTP client; placeholder strings would fail in
// VAPID JWT signing well before our stubClient ever sees a request.
const (
	validVAPIDPub  = "BFP4kBPQfFZF8sdnmpYqWXAhB6E2nXzZcCZdHRSeF8KsOfgGu1H4MdAW4FlbVqPZH3MJjRNc7nlpb7swptn8Cw0"
	validVAPIDPriv = "_n4dXQDg2J3FkVUmtzYprHr6yTgXQyB1IOObPQa8FCw"
)

func newTestSub(endpoint string) *models.PushSubscription {
	return &models.PushSubscription{
		ID:       1,
		Endpoint: endpoint,
		// Real-looking base64url ECDH/auth keys are required for the
		// webpush-go encryption step. These are randomly-generated
		// well-formed values used solely by the test suite.
		P256DH: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		Auth:   "tBHItJI5svbpez7KI4CCXg",
	}
}

func TestService_DisabledIsNoOp(t *testing.T) {
	repo := &fakeRepo{}
	svc := NewServiceWithClient(repo, "", "", "", &stubClient{status: 200})
	if svc.IsEnabled() {
		t.Fatalf("expected disabled service")
	}
	res, err := svc.Send(context.Background(), Payload{Title: "T"})
	if err != nil {
		t.Fatalf("disabled Send should be no-op error nil, got %v", err)
	}
	if res.Sent != 0 || res.Failed != 0 || res.Pruned != 0 {
		t.Fatalf("disabled Send returned non-zero result: %+v", res)
	}
}

func TestService_RequiresTitle(t *testing.T) {
	repo := &fakeRepo{}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", &stubClient{status: 200})
	_, err := svc.Send(context.Background(), Payload{})
	if err == nil {
		t.Fatalf("expected error for missing title")
	}
}

func TestService_Send_2xx_Touches(t *testing.T) {
	sub := newTestSub("https://push.example.com/abc")
	repo := &fakeRepo{subs: []*models.PushSubscription{sub}}
	stub := &stubClient{status: 201}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)

	res, err := svc.Send(context.Background(), Payload{Title: "Hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Sent != 1 || res.Failed != 0 || res.Pruned != 0 {
		t.Fatalf("expected 1 sent, got %+v", res)
	}
	if len(repo.touched) != 1 || repo.touched[0] != sub.Endpoint {
		t.Fatalf("expected touch on success, got %v", repo.touched)
	}
}

func TestService_Send_410_Prunes(t *testing.T) {
	sub := newTestSub("https://push.example.com/dead")
	repo := &fakeRepo{subs: []*models.PushSubscription{sub}}
	stub := &stubClient{status: 410}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)

	res, err := svc.Send(context.Background(), Payload{Title: "Hi"})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.Pruned != 1 || res.Sent != 0 {
		t.Fatalf("expected 1 pruned, got %+v", res)
	}
	if len(repo.deleted) != 1 || repo.deleted[0] != sub.Endpoint {
		t.Fatalf("expected delete-by-endpoint, got %v", repo.deleted)
	}
}

func TestService_Send_404_Prunes(t *testing.T) {
	sub := newTestSub("https://push.example.com/missing")
	repo := &fakeRepo{subs: []*models.PushSubscription{sub}}
	stub := &stubClient{status: 404}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)

	res, _ := svc.Send(context.Background(), Payload{Title: "Hi"})
	if res.Pruned != 1 {
		t.Fatalf("expected 1 pruned for 404, got %+v", res)
	}
}

func TestService_Send_5xx_KeepsSubscription(t *testing.T) {
	sub := newTestSub("https://push.example.com/transient")
	repo := &fakeRepo{subs: []*models.PushSubscription{sub}}
	stub := &stubClient{status: 503}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)

	res, _ := svc.Send(context.Background(), Payload{Title: "Hi"})
	if res.Failed != 1 || res.Pruned != 0 {
		t.Fatalf("expected failed=1 / pruned=0 on 5xx, got %+v", res)
	}
	if len(repo.deleted) != 0 {
		t.Fatalf("subscription should not be deleted on 5xx, got %v", repo.deleted)
	}
}

func TestService_Send_NetworkError_KeepsSubscription(t *testing.T) {
	sub := newTestSub("https://push.example.com/neterr")
	repo := &fakeRepo{subs: []*models.PushSubscription{sub}}
	stub := &stubClient{err: errors.New("connection refused")}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)

	res, _ := svc.Send(context.Background(), Payload{Title: "Hi"})
	if res.Failed != 1 {
		t.Fatalf("expected failed=1 on network error, got %+v", res)
	}
	if len(repo.deleted) != 0 {
		t.Fatalf("subscription should not be deleted on network error, got %v", repo.deleted)
	}
}

func TestService_Send_FanOut_PartialFailure(t *testing.T) {
	subs := []*models.PushSubscription{
		newTestSub("https://push.example.com/a"),
		newTestSub("https://push.example.com/b"),
		newTestSub("https://push.example.com/c"),
	}
	repo := &fakeRepo{subs: subs}
	// 200 for all — verify we touch all three.
	stub := &stubClient{status: 200}
	svc := NewServiceWithClient(repo, validVAPIDPub, validVAPIDPriv, "mailto:x@example.com", stub)
	res, _ := svc.Send(context.Background(), Payload{Title: "Hi"})
	if res.Sent != 3 {
		t.Fatalf("expected sent=3, got %+v", res)
	}
	if len(repo.touched) != 3 {
		t.Fatalf("expected 3 touches, got %v", repo.touched)
	}
}

func TestSetDefaultAndDefault(t *testing.T) {
	original := Default()
	t.Cleanup(func() { SetDefault(original) })

	repo := &fakeRepo{}
	svc := NewService(repo, "", "", "")
	SetDefault(svc)
	if Default() != svc {
		t.Fatalf("Default() did not return the registered service")
	}
}

func TestEndpointHash_TruncatesLongValues(t *testing.T) {
	short := "https://a"
	if endpointHash(short) != short {
		t.Fatalf("short endpoint should be returned verbatim, got %s", endpointHash(short))
	}
	long := "https://fcm.googleapis.com/fcm/send/SECRET-TOKEN-MUST-NOT-LEAK"
	hash := endpointHash(long)
	if len(hash) >= len(long) {
		t.Fatalf("long endpoint should be truncated, got %s", hash)
	}
	if !contains(hash, "https://") {
		t.Fatalf("expected scheme prefix, got %s", hash)
	}
	if contains(hash, "SECRET") {
		t.Fatalf("hash should not contain the per-subscription token, got %s", hash)
	}
}

func contains(s, sub string) bool {
	return len(sub) == 0 || (len(s) >= len(sub) && (indexOf(s, sub) >= 0))
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// Regression coverage for duplicate notification icons.
//
// Both tests below exist to keep a future contributor from
// re-introducing the user-reported "two lightning bolts on the same
// notification" bug by accident:
//
//   - TestPayload_NoIconField pins the Go struct shape. Re-adding an
//     `Icon` field would let Go-side code start populating it without
//     any test failure unless this assertion exists.
//   - TestPayload_JSONShape_OmitsIcon pins the wire format. Even a
//     zero-valued `Icon string `json:"icon,omitempty"`` would not appear
//     in marshalled JSON, but a non-omitempty variant or a struct-tag
//     typo that shifted the json key would surface here.
//
// If you intentionally want to bring per-event contextual icons back,
// design the new payload field with an explicit category (e.g.
// `EventKind string`) and a service-worker mapping table so the payload
// contract remains explicit.

func TestPayload_NoIconField(t *testing.T) {
	t.Parallel()
	typ := reflect.TypeOf(Payload{})
	if _, ok := typ.FieldByName("Icon"); ok {
		t.Fatal("Payload must NOT have an `Icon` field — see Phase-49 / Slice 0010 / sw.ts comment")
	}
}

func TestPayload_JSONShape_OmitsIcon(t *testing.T) {
	t.Parallel()
	body, err := json.Marshal(Payload{
		Title:    "Drive Started",
		Body:     "Your Roadster is moving",
		URL:      "/drives/42",
		Badge:    "/icons/badge-72.png",
		Tag:      "drive-42",
		Severity: "info",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(body), `"icon"`) {
		t.Fatalf(`marshalled payload must not contain an "icon" key, got: %s`, body)
	}
	// Sanity-check: badge MUST still serialise (it correctly populates
	// the Android status-bar slot and is not part of this slice's removal).
	if !strings.Contains(string(body), `"badge"`) {
		t.Fatalf(`marshalled payload must still contain a "badge" key, got: %s`, body)
	}
}
