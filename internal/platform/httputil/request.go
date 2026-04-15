package httputil

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// DecodeAndValidate reads the request body as JSON and returns a decoded value.
// Returns a domain.ErrValidation-wrapped error if decoding fails.
func DecodeAndValidate[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, fmt.Errorf("decoding request body: %w", domain.ErrValidation)
	}
	return req, nil
}
