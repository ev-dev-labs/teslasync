// Package docsfs exposes the operator and user documentation as a read-only
// embedded filesystem for Helix application-knowledge retrieval.
package docsfs

import "embed"

// FS contains only maintained Markdown sources. Build artifacts, node_modules,
// public assets, archives, and audit logs are intentionally excluded.
//
//go:embed *.md guide/*.md user/*.md features/*.md runbooks/*.md deployment/*.md architecture/*.md architecture/adr/*.md architecture/migration/*.md observability/*.md
var FS embed.FS
