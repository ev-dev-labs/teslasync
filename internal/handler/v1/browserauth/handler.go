package browserauth

import (
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strings"
	"unicode"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"go.opentelemetry.io/otel"
)

type Handler struct{}

func NewHandler() *Handler {
	return &Handler{}
}

// Login is reached only after the proxy authenticates the top-level navigation.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "browser_auth.login")
	defer span.End()
	r = r.WithContext(ctx)
	target := r.URL.Query().Get("rd")
	if target == "" {
		target = "/"
	}
	u, err := url.Parse(target)
	if err != nil || u.IsAbs() || u.Host != "" || !strings.HasPrefix(u.Path, "/") ||
		strings.HasPrefix(u.Path, "//") || strings.Contains(target+u.Path, "\\") ||
		strings.ContainsFunc(target+u.Path, unicode.IsControl) ||
		path.Clean(u.Path) == "/api/v1/auth/browser-login" {
		span.RecordError(fmt.Errorf("invalid browser return path"))
		httputil.RespondError(w, http.StatusBadRequest, "INVALID_RETURN_PATH", "return path must stay inside TeslaSync")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, u.String(), http.StatusSeeOther)
}
