// Layer: platform
//
// Package gdpr provides the streaming tar.gz GDPR data-subject
// exporter used by the /admin/gdpr/exports surface and the export-worker. Per-domain JSONL files are streamed through a
// sha256 MultiWriter and assembled into a manifest.json for download.
package gdpr
