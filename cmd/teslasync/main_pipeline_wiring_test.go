// Phase-47/04 NOTE: the source-grep cutover guards previously living
// here have been moved to internal/app/wiring_test.go because the
// pipeline wiring they guard moved out of cmd/teslasync/main.go in the
// same commit. This file is intentionally near-empty so the test count
// in cmd/teslasync stays at zero (matching `go test ./cmd/teslasync/...`
// reporting "no test files"). Re-add tests here only if cmd/teslasync
// itself ever grows non-trivial logic again.
package main
