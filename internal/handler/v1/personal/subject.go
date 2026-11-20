// Package personal resolves the ownership boundary for personal features.
package personal

import (
	"net/http"

	tsauth "github.com/ev-dev-labs/teslasync/internal/auth"
	personaldomain "github.com/ev-dev-labs/teslasync/internal/domain/personal"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

func Subject(w http.ResponseWriter, r *http.Request, headerName, feature string) (string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	if tsauth.IsImpersonating(r.Context()) {
		httputil.RespondError(w, http.StatusForbidden, "PERSONAL_DATA_IMPERSONATION_DENIED",
			"private "+feature+" is unavailable while impersonating another identity")
		return "", false
	}
	subject, ok := tsauth.SubjectFromRequest(r, headerName)
	if tsauth.IsOpenMode(headerName) {
		subject, ok = personaldomain.OpenSubject, true
	}
	if !ok || (!tsauth.IsOpenMode(headerName) && subject == personaldomain.OpenSubject) {
		httputil.RespondError(w, http.StatusUnauthorized, tsauth.MissingIdentityCode,
			"missing identity header")
		return "", false
	}
	if !tsauth.MatchesExpectedPrincipal(r, headerName, subject) {
		httputil.RespondError(w, http.StatusConflict, "IDENTITY_CHANGED",
			"authenticated identity changed; refresh before continuing")
		return "", false
	}
	return subject, true
}
