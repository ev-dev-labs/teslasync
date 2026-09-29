package auth

import "context"

// appTokenSubjectKey marks a request authenticated by an app-bound API
// key. The session tracker honours it by skipping cookie minting: a
// native app re-authenticates every request with `Authorization:
// Bearer` and never presents a session cookie, so minting a session
// row per request would spam auth_sessions with orphan rows the
// client can never reuse.
type appTokenSubjectKey struct{}

// WithAppTokenSubject returns ctx carrying the app-token subject.
func WithAppTokenSubject(ctx context.Context, subject string) context.Context {
	return context.WithValue(ctx, appTokenSubjectKey{}, subject)
}

// AppTokenSubjectFromContext returns the token subject when the request
// was authenticated by an app-bound API key, or ("", false) otherwise.
func AppTokenSubjectFromContext(ctx context.Context) (string, bool) {
	subject, ok := ctx.Value(appTokenSubjectKey{}).(string)
	if !ok || subject == "" {
		return "", false
	}
	return subject, true
}
