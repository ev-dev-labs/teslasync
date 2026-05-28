package database

// NullIfEmpty returns nil for empty strings, otherwise the string.
// Useful for INSERT/UPDATE parameters where empty values should map
// to SQL NULL rather than the empty string. Exported (Phase R4) so
// sibling subpackages (e.g. internal/database/auth,
// internal/database/audit) can reuse it without duplicating the
// helper.
//
// Promoted to its own file in Phase R4.10 (audit cluster carve) so
// that audit_repo.go could be moved into internal/database/audit/
// without taking its only NullIfEmpty consumer along — auth/sessions_repo.go
// already depends on database.NullIfEmpty.
func NullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
