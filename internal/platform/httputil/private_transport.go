package httputil

import (
	"context"
	"errors"
	"net/http"
	"net/url"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// NewPrivateTransport instruments only the origin; private paths and queries
// are restored after instrumentation, immediately before the actual transport.
func NewPrivateTransport(base http.RoundTripper) http.RoundTripper {
	return redactingTransport{otelhttp.NewTransport(restoringTransport{base})}
}

type originalURLKey struct{}

type redactingTransport struct{ next http.RoundTripper }

func (t redactingTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	original := *request.URL
	redacted := url.URL{Scheme: original.Scheme, Host: original.Host, Path: "/"}
	clone := request.Clone(context.WithValue(request.Context(), originalURLKey{}, &original))
	clone.URL = &redacted
	return t.next.RoundTrip(clone)
}

type restoringTransport struct{ next http.RoundTripper }

func (t restoringTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	original, ok := request.Context().Value(originalURLKey{}).(*url.URL)
	if !ok {
		return nil, errors.New("private HTTP destination unavailable")
	}
	clone := request.Clone(request.Context())
	clone.URL = original
	response, err := t.next.RoundTrip(clone)
	if err != nil {
		return nil, errors.New("private HTTP transport failed")
	}
	return response, nil
}
