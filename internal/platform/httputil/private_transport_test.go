package httputil

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

type privateTestTransport func(*http.Request) (*http.Response, error)

func (f privateTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestPrivateInstrumentationCannotSeePathQueryOrTransportError(t *testing.T) {
	const destination = "https://provider.example.invalid/private-token?secret=value"
	endpoint, err := url.Parse(destination)
	if err != nil {
		t.Fatal(err)
	}
	for _, transportFailure := range []bool{false, true} {
		var instrumented, forwarded string
		base := privateTestTransport(func(request *http.Request) (*http.Response, error) {
			forwarded = request.URL.String()
			if transportFailure {
				return nil, errors.New("failed to contact " + forwarded)
			}
			return &http.Response{StatusCode: http.StatusCreated, Body: io.NopCloser(strings.NewReader(""))}, nil
		})
		middle := privateTestTransport(func(request *http.Request) (*http.Response, error) {
			instrumented = request.URL.String()
			return (restoringTransport{base}).RoundTrip(request)
		})
		request := &http.Request{Method: http.MethodPost, URL: endpoint, Header: make(http.Header)}
		response, err := (redactingTransport{middle}).RoundTrip(request)
		if transportFailure {
			if err == nil || strings.Contains(err.Error(), endpoint.Host) || strings.Contains(err.Error(), "private-token") {
				t.Fatalf("private destination exposed in instrumentation error: %v", err)
			}
		} else if err != nil {
			t.Fatal(err)
		} else {
			_ = response.Body.Close()
		}
		if instrumented != "https://provider.example.invalid/" || forwarded != destination {
			t.Fatalf("instrumented=%q forwarded=%q", instrumented, forwarded)
		}
	}
}
