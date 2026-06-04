// Package gdpr holds persistence for GDPR data-subject-export artifacts. It
// stores only manifests (path/checksum/size), never the export bytes themselves;
// the export worker streams JSONL/gzip to
// disk or S3 and inserts an [Artifact] row when done.
//
// Layer: adapter
//
// Carved from the parent `internal/database` package as part of Phase R4
// (bounded-context restructure per ADR-011 §3 + ADR-015-amend).
package gdpr
