package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	"github.com/felixge/httpsnoop"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// LimitByIP retains the existing counter and IP trust model, adding quota
// metadata so a rejected refresh does not pause unrelated vehicle reads.
// Anonymous chi groups must supply their affected scopes, not the root wildcard.
func LimitByIP(limit int, window time.Duration, scopes ...string) func(http.Handler) http.Handler {
	bucketFor := httputil.NewRateLimitBucket()
	explicitScope := strings.Join(scopes, " ")
	policyFor := func(r *http.Request) httputil.RateLimitPolicy {
		key, _ := httprate.KeyByIP(r)
		scope := ""
		if route := chi.RouteContext(r.Context()); route != nil {
			scope = route.RoutePattern()
		}
		methods := r.Method
		if scope == "" || strings.HasSuffix(scope, "/*") {
			methods = "*"
		}
		if scope == "" {
			scope = "/*"
		}
		if explicitScope != "" {
			scope = explicitScope
			methods = "*"
		}
		return httputil.RateLimitPolicy{
			Bucket: bucketFor(key), Scope: strings.TrimPrefix(scope, "/api/v1"),
			Methods: methods, Source: "teslasync", Enforcement: "process",
		}
	}
	limiter := httprate.LimitBy(limit, window, httprate.KeyByIP, httprate.WithLimitHandler(
		func(w http.ResponseWriter, r *http.Request) {
			policyFor(r).SetHeaders(w.Header())
			w.Header().Set(httputil.RateLimitLimitedHeader, "true")
			w.Header().Set("Cache-Control", "no-store")
			httputil.RespondError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests")
		},
	))
	return func(next http.Handler) http.Handler {
		limited := limiter(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			policyFor(r).SetHeaders(w.Header())
			limited.ServeHTTP(w, r)
		})
	}
}

// RateLimitResponses preserves upstream Retry-After without changing Tesla
// client return signatures. httpsnoop preserves streaming/optional interfaces.
func RateLimitResponses(principalHeader string) func(http.Handler) http.Handler {
	bucketFor := httputil.NewRateLimitBucket()
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, capture := httputil.CaptureUpstreamRateLimit(r.Context())
			r = r.WithContext(ctx)
			next.ServeHTTP(httpsnoop.Wrap(w, httpsnoop.Hooks{
				WriteHeader: func(writeHeader httpsnoop.WriteHeaderFunc) httpsnoop.WriteHeaderFunc {
					return func(status int) {
						if status == http.StatusTooManyRequests {
							if w.Header().Get(httputil.RateLimitLimitedHeader) != "true" {
								if source, retry := capture.Snapshot(); source != "" {
									identity := r.Header.Get(principalHeader)
									if identity == "" {
										identity, _ = httprate.KeyByIP(r)
									}
									// Tesla does not identify a shared quota. Do not
									// guess that different resources share this one.
									httputil.RateLimitPolicy{
										Bucket:  bucketFor(identity + "\x00" + r.Method + "\x00" + r.URL.Path),
										Scope:   strings.TrimPrefix(r.URL.EscapedPath(), "/api/v1"),
										Methods: r.Method, Source: source, Enforcement: "upstream",
									}.SetHeaders(w.Header())
									w.Header().Set(httputil.RateLimitLimitedHeader, "true")
									w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
								}
							}
							w.Header().Set("Cache-Control", "no-store")
							trace.SpanFromContext(ctx).AddEvent("rate_limit.exceeded", trace.WithAttributes(
								attribute.String("rate_limit.source", w.Header().Get(httputil.RateLimitSourceHeader)),
							))
						}
						writeHeader(status)
					}
				},
			}), r)
		})
	}
}
