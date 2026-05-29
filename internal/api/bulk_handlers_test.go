package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newBulkRequest(t *testing.T, method, path string, body any) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if s, ok := body.(string); ok {
			buf.WriteString(s)
		} else if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeBulkResult(t *testing.T, body []byte) bulkOperationResult {
	t.Helper()
	var got bulkOperationResult
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("unmarshal response: %v; body=%s", err, string(body))
	}
	return got
}
