// Package cache wraps the cache adapter behind a small API used by services.
//
// Layer: platform
//
// DEPRECATED per ADR-007: new code belongs in internal/cache (the
// canonical home, 4 .go files). Existing symbols here remain
// functional; consolidation tracked in phase-48 (see
// docs/architecture/platform-consolidation-todo.md).
package cache
