package azure

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/ai/provider"
)

type operationError struct {
	operation  string
	status     int
	raw        string
	code       string
	message    string
	structured bool
}

func newOperationError(operation string, status int, raw []byte) *operationError {
	e := &operationError{operation: operation, status: status, raw: string(raw)}
	var envelope struct {
		Error *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &envelope) == nil && envelope.Error != nil {
		e.code = strings.ToLower(envelope.Error.Code)
		e.message = strings.TrimSpace(envelope.Error.Message)
		e.structured = e.code != "" || e.message != ""
	}
	return e
}

func (e *operationError) Error() string {
	return fmt.Sprintf("%s: azure %s status %d: %s", provider.ErrUpstream, e.operation, e.status, e.raw)
}

func (e *operationError) Unwrap() error { return provider.ErrUpstream }

func canTryResponses(err error) bool {
	var e *operationError
	if !errors.As(err, &e) || !e.structured {
		return false
	}
	// Never infer capability from arbitrary text, transport failures, or
	// authentication, throttling, server and token-budget errors.
	if e.status == http.StatusNotFound {
		return e.code == "deploymentnotfound" || e.code == "notfound" ||
			e.code == "not_found" || e.code == "404"
	}
	if e.status != http.StatusBadRequest {
		return false
	}
	switch e.code {
	case "operationnotsupported", "unsupported_operation", "operation_not_supported":
		return true
	case "", "badrequest", "bad_request", "invalid_request_error":
		return strings.EqualFold(strings.TrimSuffix(e.message, "."), "The requested operation is unsupported")
	default:
		return false
	}
}
