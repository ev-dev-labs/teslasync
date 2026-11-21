package auth

import (
	"context"
	"strings"
)

// OperatorAccess authorizes only explicitly named browser ForwardAuth subjects.
type OperatorAccess struct {
	subjects map[string]struct{}
}

func NewOperatorAccess(headerName, allowlist string) OperatorAccess {
	access := OperatorAccess{}
	if IsOpenMode(headerName) {
		return access
	}
	access.subjects = make(map[string]struct{})
	for entry := range strings.SplitSeq(allowlist, ",") {
		if subject := strings.TrimSpace(entry); subject != "" {
			access.subjects[subject] = struct{}{}
		}
	}
	return access
}

func (a OperatorAccess) Enabled() bool {
	return len(a.subjects) > 0
}

func (a OperatorAccess) IncidentRecipient(subject string) string {
	if _, ok := a.subjects[subject]; ok && len(subject) <= 512 {
		return subject
	}
	return ""
}

func (a OperatorAccess) Allows(ctx context.Context, subject string) bool {
	if _, ok := a.subjects[subject]; !ok || IsImpersonating(ctx) {
		return false
	}
	_, token := AppTokenSubjectFromContext(ctx)
	return !token
}
