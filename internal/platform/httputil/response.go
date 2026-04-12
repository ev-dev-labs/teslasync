package httputil

import (
	"encoding/json"
	"net/http"
)

// Response is the standard response envelope.
type Response struct {
	Data       interface{} `json:"data,omitempty"`
	Error      *APIError   `json:"error,omitempty"`
	Pagination *Pagination `json:"pagination,omitempty"`
}

// APIError represents a structured error response.
type APIError struct {
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Details []ValidationDetail  `json:"details,omitempty"`
}

// ValidationDetail holds field-level validation error info.
type ValidationDetail struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Pagination holds cursor-based pagination metadata.
type Pagination struct {
	Cursor     string `json:"cursor,omitempty"`
	HasMore    bool   `json:"hasMore"`
	TotalCount int    `json:"totalCount,omitempty"`
}

// Respond writes a JSON success response.
func Respond(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{Data: data})
}

// RespondWithPagination writes a JSON response with pagination metadata.
func RespondWithPagination(w http.ResponseWriter, data interface{}, pagination Pagination) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(Response{Data: data, Pagination: &pagination})
}

// RespondError writes a JSON error response.
func RespondError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(Response{
		Error: &APIError{Code: code, Message: message},
	})
}

// RespondValidationError writes a JSON validation error response with field details.
func RespondValidationError(w http.ResponseWriter, details []ValidationDetail) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	_ = json.NewEncoder(w).Encode(Response{
		Error: &APIError{
			Code:    "VALIDATION_ERROR",
			Message: "validation failed",
			Details: details,
		},
	})
}
