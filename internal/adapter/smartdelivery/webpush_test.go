package smartdelivery

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	gowebpush "github.com/SherClockHolmes/webpush-go"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
)

type capturedClient struct {
	calls  int
	status int
	err    error
	body   []byte
	header http.Header
}

func (c *capturedClient) Do(request *http.Request) (*http.Response, error) {
	c.calls++
	c.header = request.Header.Clone()
	c.body, _ = io.ReadAll(request.Body)
	if c.err != nil {
		return nil, c.err
	}
	return &http.Response{StatusCode: c.status, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(nil))}, nil
}

func TestWebPushSendsOnlyEncryptedPayloadToOneSubscription(t *testing.T) {
	private, public, err := gowebpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	client := &capturedClient{status: http.StatusCreated}
	sender := NewWebPushWithClient(public, private, "mailto:operator@example.invalid", client)
	subscription := domain.Subscription{
		Endpoint: "https://push.example.invalid/device-token",
		P256DH:   "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		Auth:     "tBHItJI5svbpez7KI4CCXg",
	}
	payload := []byte(`{"kind":"verify","token":"synthetic-private-token"}`)
	status, err := sender.Send(context.Background(), subscription, payload, time.Minute)
	if err != nil || status != domain.DeliveryAccepted || client.calls != 1 {
		t.Fatalf("send = %q, %v, calls=%d", status, err, client.calls)
	}
	if bytes.Contains(client.body, payload) || bytes.Contains(client.body, []byte("synthetic-private-token")) {
		t.Fatal("push body contained plaintext")
	}
	if client.header.Get("Content-Encoding") != "aes128gcm" || client.header.Get("TTL") != "60" ||
		!strings.HasPrefix(client.header.Get("Authorization"), "vapid ") {
		t.Fatalf("missing Web Push protocol headers: %v", client.header)
	}
	client.err = errors.New("synthetic network error containing device-token")
	status, err = sender.Send(context.Background(), subscription, payload, time.Minute)
	if status != domain.DeliveryUnknown || err == nil || strings.Contains(err.Error(), "device-token") {
		t.Fatalf("uncertain transport result = %q, %v", status, err)
	}
}

func TestWebPushLocalProviderContract(t *testing.T) {
	type received struct {
		method, path, encoding, contentType, authorization, ttl string
		body                                                    []byte
	}
	requests := make(chan received, 2)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "read request", http.StatusBadRequest)
			return
		}
		requests <- received{
			method: r.Method, path: r.URL.Path, encoding: r.Header.Get("Content-Encoding"),
			contentType: r.Header.Get("Content-Type"), authorization: r.Header.Get("Authorization"),
			ttl: r.Header.Get("TTL"), body: body,
		}
		if r.URL.Path == "/expired-device" {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	transport := server.Client().Transport.(*http.Transport).Clone()
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
	}
	client := &http.Client{Transport: transport, Timeout: 5 * time.Second}
	private, public, err := gowebpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	sender := NewWebPushWithClient(public, private, "mailto:operator@example.invalid", client)
	subscription := domain.Subscription{
		Endpoint: "https://example.com/synthetic-device",
		P256DH:   "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
		Auth:     "tBHItJI5svbpez7KI4CCXg",
	}
	payload := []byte(`{"kind":"charging","token":"synthetic-private-token"}`)
	status, err := sender.Send(context.Background(), subscription, payload, time.Minute)
	if err != nil || status != domain.DeliveryAccepted {
		t.Fatalf("local provider accepted response = %q, %v", status, err)
	}
	request := <-requests
	if request.method != http.MethodPost || request.path != "/synthetic-device" ||
		request.encoding != "aes128gcm" || request.contentType != "application/octet-stream" ||
		request.ttl != "60" || !strings.HasPrefix(request.authorization, "vapid ") ||
		len(request.body) == 0 || bytes.Contains(request.body, []byte("synthetic-private-token")) {
		t.Fatal("local provider received an invalid or unencrypted Web Push request")
	}
	subscription.Endpoint = "https://example.com/expired-device"
	status, err = sender.Send(context.Background(), subscription, payload, time.Minute)
	if err != nil || status != domain.DeliveryFailed {
		t.Fatalf("local provider expired response = %q, %v", status, err)
	}
	<-requests
	select {
	case <-requests:
		t.Fatal("expired subscription was retried")
	default:
	}
}

type fakeResolver []netip.Addr

func (r fakeResolver) LookupNetIP(context.Context, string, string) ([]netip.Addr, error) {
	return r, nil
}

type fakeDialer struct{ addresses []string }

func (d *fakeDialer) DialContext(_ context.Context, _, address string) (net.Conn, error) {
	d.addresses = append(d.addresses, address)
	return nil, errors.New("synthetic dial failure")
}

func TestPublicDialRejectsPrivateAndRebindingAddresses(t *testing.T) {
	dialer := &fakeDialer{}
	resolver := fakeResolver{
		netip.MustParseAddr("127.0.0.1"),
		netip.MustParseAddr("10.2.3.4"),
		netip.MustParseAddr("100.64.1.1"),
		netip.MustParseAddr("169.254.169.254"),
		netip.MustParseAddr("::ffff:192.168.1.1"),
		netip.MustParseAddr("8.8.8.8"),
	}
	_, _ = publicDialContext(resolver, dialer)(context.Background(), "tcp", "push.example.invalid:443")
	if len(dialer.addresses) != 1 || dialer.addresses[0] != "8.8.8.8:443" {
		t.Fatalf("dialed destinations = %v", dialer.addresses)
	}
	if _, err := publicDialContext(resolver, dialer)(context.Background(), "tcp", "push.example.invalid:8443"); err == nil {
		t.Fatal("nonstandard port was accepted")
	}
}
