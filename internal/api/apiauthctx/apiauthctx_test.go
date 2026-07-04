package apiauthctx

import (
	"context"
	"testing"
)

func TestWithAndFromContext(t *testing.T) {
	tests := []struct {
		name  string
		perms string
	}{
		{"read", "read"},
		{"read-write", "read-write"},
		{"admin", "admin"},
		{"empty", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := WithPermissions(context.Background(), tt.perms)
			got, ok := PermissionsFromContext(ctx)
			if !ok {
				t.Fatal("PermissionsFromContext reported the value absent, want present")
			}
			if got != tt.perms {
				t.Errorf("got %q, want %q", got, tt.perms)
			}
		})
	}
}

func TestFromContext_Absent(t *testing.T) {
	got, ok := PermissionsFromContext(context.Background())
	if ok {
		t.Errorf("expected absent, got ok=true value=%q", got)
	}
	if got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// foreignKey mirrors the class of bug this package exists to prevent: a
// structurally identical key defined in another package must NOT collide with
// this package's key.
type foreignKey struct{}

func TestKeyIsolation(t *testing.T) {
	ctx := context.WithValue(context.Background(), foreignKey{}, "admin")
	if _, ok := PermissionsFromContext(ctx); ok {
		t.Error("a foreign context key must not be readable via PermissionsFromContext")
	}

	ctx = WithPermissions(context.Background(), "admin")
	if v := ctx.Value(foreignKey{}); v != nil {
		t.Error("WithPermissions must not populate a foreign key")
	}
}
