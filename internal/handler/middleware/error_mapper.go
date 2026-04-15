package middleware

import (
	"errors"
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/domain"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// MapDomainError maps domain errors to HTTP status codes and response format.
func MapDomainError(err error) (int, httputil.APIError) {
	var ve domain.ValidationErrors
	if errors.As(err, &ve) {
		details := make([]httputil.ValidationDetail, len(ve))
		for i, v := range ve {
			details[i] = httputil.ValidationDetail{Field: v.Field, Message: v.Message}
		}
		return http.StatusBadRequest, httputil.APIError{
			Code:    "VALIDATION_ERROR",
			Message: err.Error(),
			Details: details,
		}
	}

	switch {
	case errors.Is(err, domain.ErrNotFound):
		return http.StatusNotFound, httputil.APIError{Code: "NOT_FOUND", Message: err.Error()}
	case errors.Is(err, domain.ErrConflict):
		return http.StatusConflict, httputil.APIError{Code: "CONFLICT", Message: err.Error()}
	case errors.Is(err, domain.ErrUnauthorized):
		return http.StatusUnauthorized, httputil.APIError{Code: "UNAUTHORIZED", Message: err.Error()}
	case errors.Is(err, domain.ErrForbidden):
		return http.StatusForbidden, httputil.APIError{Code: "FORBIDDEN", Message: err.Error()}
	case errors.Is(err, domain.ErrValidation):
		return http.StatusBadRequest, httputil.APIError{Code: "VALIDATION_ERROR", Message: err.Error()}
	case errors.Is(err, domain.ErrRateLimited):
		return http.StatusTooManyRequests, httputil.APIError{Code: "RATE_LIMITED", Message: err.Error()}
	case errors.Is(err, domain.ErrExternalAPI):
		return http.StatusBadGateway, httputil.APIError{Code: "EXTERNAL_API_ERROR", Message: "external service error"}
	default:
		return http.StatusInternalServerError, httputil.APIError{Code: "INTERNAL", Message: "internal server error"}
	}
}

// HandleError maps a domain error to an HTTP response and writes it.
func HandleError(w http.ResponseWriter, err error) {
	status, apiErr := MapDomainError(err)
	httputil.RespondError(w, status, apiErr.Code, apiErr.Message)
}
