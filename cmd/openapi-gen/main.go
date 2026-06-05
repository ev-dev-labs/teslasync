// Command openapi-gen emits the TeslaSync OpenAPI 3.1 contract by walking the
// Chi router (the source of truth, ADR-003) and serialising the assembled
// document to JSON.
//
// Usage:
//
//	go run ./cmd/openapi-gen -out api/openapi/teslasync.openapi.json
//
// Layer: tooling
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ev-dev-labs/teslasync/cmd/openapi-gen/gen"
)

func main() {
	out := flag.String("out", "api/openapi/teslasync.openapi.json", "output path for the OpenAPI 3.1 JSON document")
	flag.Parse()

	if err := run(*out); err != nil {
		fmt.Fprintf(os.Stderr, "openapi-gen: %v\n", err)
		os.Exit(1)
	}
}

func run(out string) error {
	handler, cleanup, err := gen.BuildRouter()
	if err != nil {
		return fmt.Errorf("build router: %w", err)
	}
	defer cleanup()

	routes, err := gen.WalkRoutes(handler)
	if err != nil {
		return fmt.Errorf("walk routes: %w", err)
	}
	if len(routes) == 0 {
		return fmt.Errorf("no routes enumerated from router")
	}

	doc := gen.BuildSpec(routes)

	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal spec: %w", err)
	}
	data = append(data, '\n')

	if dir := filepath.Dir(out); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return fmt.Errorf("create output dir %s: %w", dir, err)
		}
	}
	if err := os.WriteFile(out, data, 0o644); err != nil {
		return fmt.Errorf("write %s: %w", out, err)
	}

	fmt.Printf("openapi-gen: wrote %s (%d routes)\n", out, len(routes))
	return nil
}
