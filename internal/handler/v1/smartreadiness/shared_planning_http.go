package smartreadiness

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

func verifiedSharedPlanningSubject(w http.ResponseWriter, r *http.Request, headerName string) (string, bool) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Add("Vary", tsauth.ExpectedPrincipalHeader)
	if tsauth.IsOpenMode(headerName) {
		httputil.RespondError(w, http.StatusNotImplemented, tsauth.AuthModeOpenCode, "shared planning requires verified browser sign-in")
		return "", false
	}
	w.Header().Add("Vary", headerName)
	_, token := tsauth.AppTokenSubjectFromContext(r.Context())
	authorization := strings.Fields(r.Header.Get("Authorization"))
	if token || r.Header.Get("X-API-Key") != "" ||
		(len(authorization) > 0 && strings.EqualFold(authorization[0], "Bearer")) {
		httputil.RespondError(w, http.StatusForbidden, "BROWSER_IDENTITY_REQUIRED", "shared planning is only available to verified browsers")
		return "", false
	}
	if tsauth.IsImpersonating(r.Context()) {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_DATA_IMPERSONATION_DENIED", "shared planning is unavailable during impersonation")
		return "", false
	}
	subject, ok := tsauth.SubjectFromRequest(r, headerName)
	if !ok || subject == personal.OpenSubject || len(r.Header.Values(headerName)) != 1 {
		httputil.RespondError(w, http.StatusUnauthorized, tsauth.MissingIdentityCode, "missing verified browser identity")
		return "", false
	}
	if len(r.Header.Values(tsauth.ExpectedPrincipalHeader)) != 1 || r.Header.Get(tsauth.ExpectedPrincipalHeader) == "" ||
		!tsauth.MatchesExpectedPrincipal(r, headerName, subject) {
		httputil.RespondError(w, http.StatusConflict, "IDENTITY_CHANGED", "refresh the verified browser identity before continuing")
		return "", false
	}
	return subject, true
}

func decodeSharedPlanning[T any](w http.ResponseWriter, r *http.Request) (T, error) {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
	decoder.DisallowUnknownFields()
	var request *T
	if err := decoder.Decode(&request); err != nil || request == nil || !errors.Is(decoder.Decode(new(json.RawMessage)), io.EOF) {
		var zero T
		return zero, smartreadinesssvc.ErrInvalidInput
	}
	return *request, nil
}
