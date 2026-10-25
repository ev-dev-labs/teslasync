// Command slogen is the SLO codegen toolkit.
//
// Usage:
//
//	slogen validate <catalog.yaml>
//	    Validates the catalog against the embedded schema and exits non-zero
//	    on any violation.
//
//	slogen generate recording [--catalog slo/catalog.yaml] [--out <file>]
//	    Regenerates the Prometheus recording rules YAML from the catalog.
//	    Default output: helm/teslasync/files/prometheus/recording-rules.yaml.
//
// Implementation note:
//
//	cmd/slogen intentionally depends only on the Go standard library so
//	that the codegen toolkit does not pull new modules into go.mod. The
//	catalogue therefore obeys a strict YAML subset (single-line scalars,
//	inline arrays for `tags`, two-space indentation) that the parser in
//	this file enforces. The strict subset is documented in
//	`slo/catalog.yaml` and pinned by `slo/catalog.schema.json`.
package main

import (
	"fmt"
	"os"

	"github.com/ev-dev-labs/teslasync/internal/slo/catalogparser"
)

// Catalog mirrors the strict YAML subset described above and the JSON
// Schema in slo/catalog.schema.json.
type Catalog = catalogparser.Catalog

type SLO = catalogparser.SLO

type SLI = catalogparser.SLI

const requiredVersion = catalogparser.RequiredVersion

var (
	nameRE   = catalogparser.NameRE
	windowRE = catalogparser.WindowRE
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "validate":
		if len(os.Args) < 3 {
			usage()
			os.Exit(2)
		}
		if err := validateFile(os.Args[2]); err != nil {
			fmt.Fprintf(os.Stderr, "validate: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintln(os.Stdout, "catalog OK")
	case "generate":
		if err := runGenerate(os.Args[2:]); err != nil {
			fmt.Fprintf(os.Stderr, "generate: %v\n", err)
			os.Exit(1)
		}
	case "-h", "--help", "help":
		usage()
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage:")
	fmt.Fprintln(os.Stderr, "  slogen validate <catalog.yaml>")
	fmt.Fprintln(os.Stderr, "  slogen generate recording  [--catalog FILE] [--out FILE]")
	fmt.Fprintln(os.Stderr, "  slogen generate alerts     [--catalog FILE] [--out FILE]")
	fmt.Fprintln(os.Stderr, "  slogen generate dashboards [--catalog FILE] [--out-dir DIR]")
}

// validateFile parses the catalogue and applies the schema invariants.
// Returns the first violation as an error.
func validateFile(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	cat, err := parseCatalog(string(raw))
	if err != nil {
		return fmt.Errorf("%s: %w", path, err)
	}
	return validateCatalog(cat)
}

func validateCatalog(c *Catalog) error {
	return catalogparser.Validate(c)
}

func validateSLO(idx int, s SLO) error {
	return catalogparser.ValidateSLO(idx, s)
}

func parseCatalog(text string) (*Catalog, error) {
	return catalogparser.Parse(text)
}

func stripComment(line string) string {
	return catalogparser.StripComment(line)
}

func unquote(v string) string {
	return catalogparser.Unquote(v)
}

func parseInlineArray(v string) ([]string, error) {
	return catalogparser.ParseInlineArray(v)
}
