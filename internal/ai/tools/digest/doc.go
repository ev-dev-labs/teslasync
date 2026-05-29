// Package digest contains the weekly-digest AI tool.
//
// RegisterDigestTools registers query_weekly_digest_context and preserves the
// exported contract used by the AI route registry and frontend feature mirror.
// Cross-tool shadowing is covered from the parent tools tests to avoid import
// cycles.
//
// Layer: domain
package digest
