package database

// NullIfEmpty returns nil for empty strings, otherwise the string.
// Useful for INSERT/UPDATE parameters where empty values should map
// to SQL NULL rather than the empty string. Exported so sibling
// subpackages (e.g. internal/database/auth, internal/database/audit)
// can reuse it without duplicating the helper.
func NullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
