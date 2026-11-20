// Package smartdelivery sends one encrypted Web Push to one verified device.
package smartdelivery

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"time"

	gowebpush "github.com/SherClockHolmes/webpush-go"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

type WebPush struct {
	publicKey  string
	privateKey string
	subject    string
	client     gowebpush.HTTPClient
}

func NewWebPush(publicKey, privateKey, subject string) *WebPush {
	dialer := &net.Dialer{Timeout: 5 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		DialContext:         publicDialContext(net.DefaultResolver, dialer),
		ForceAttemptHTTP2:   true,
		TLSHandshakeTimeout: 5 * time.Second,
		IdleConnTimeout:     30 * time.Second,
	}
	return NewWebPushWithClient(publicKey, privateKey, subject, &http.Client{
		Timeout:       10 * time.Second,
		Transport:     httputil.NewPrivateTransport(transport),
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	})
}

func NewWebPushWithClient(publicKey, privateKey, subject string, client gowebpush.HTTPClient) *WebPush {
	return &WebPush{publicKey: publicKey, privateKey: privateKey, subject: subject, client: client}
}

func (s *WebPush) IsEnabled() bool {
	return s != nil && s.client != nil && s.publicKey != "" && s.privateKey != "" && s.subject != ""
}

func (s *WebPush) PublicKey() string {
	if !s.IsEnabled() {
		return ""
	}
	return s.publicKey
}

func (s *WebPush) Send(
	ctx context.Context, subscription domain.Subscription, payload []byte, ttl time.Duration,
) (domain.DeliveryStatus, error) {
	if !s.IsEnabled() || !domain.ValidSubscriptionEndpoint(subscription.Endpoint) || ttl < time.Second || ttl > 24*time.Hour {
		return domain.DeliveryFailed, errors.New("personal push is not configured or the subscription is invalid")
	}
	response, err := gowebpush.SendNotificationWithContext(ctx, payload, &gowebpush.Subscription{
		Endpoint: subscription.Endpoint,
		Keys:     gowebpush.Keys{Auth: subscription.Auth, P256dh: subscription.P256DH},
	}, &gowebpush.Options{
		HTTPClient: s.client, Subscriber: s.subject, VAPIDPublicKey: s.publicKey,
		VAPIDPrivateKey: s.privateKey, TTL: int(ttl / time.Second), Urgency: gowebpush.UrgencyNormal,
	})
	if err != nil {
		return domain.DeliveryUnknown, errors.New("personal push transport failed")
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return domain.DeliveryAccepted, nil
	}
	return domain.DeliveryFailed, nil
}

type ipResolver interface {
	LookupNetIP(context.Context, string, string) ([]netip.Addr, error)
}

type contextDialer interface {
	DialContext(context.Context, string, string) (net.Conn, error)
}

func publicDialContext(resolver ipResolver, dialer contextDialer) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil || port != "443" {
			return nil, errors.New("personal push destination is not permitted")
		}
		addresses, err := resolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, errors.New("personal push destination lookup failed")
		}
		for _, address := range addresses {
			address = address.Unmap()
			if !publicIP(address) {
				continue
			}
			conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.String(), port))
			if dialErr == nil {
				return conn, nil
			}
		}
		return nil, errors.New("personal push destination is not reachable")
	}
}

var excludedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("64:ff9b::/96"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"),
	netip.MustParsePrefix("2002::/16"),
}

func publicIP(address netip.Addr) bool {
	if !address.IsValid() || !address.IsGlobalUnicast() || address.IsPrivate() ||
		address.IsLoopback() || address.IsLinkLocalUnicast() || address.IsUnspecified() {
		return false
	}
	for _, prefix := range excludedNetworks {
		if prefix.Contains(address) {
			return false
		}
	}
	return true
}
