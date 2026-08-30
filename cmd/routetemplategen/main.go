package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
)

// Default paths are relative to the MODULE ROOT, not the working directory, so
// the tool behaves identically whether it is invoked from the repository root
// or from internal/api/webvitals via `go generate`.
const (
	defaultSource = "web/src/lib/routeRegistry.ts"
	defaultOut    = "internal/api/webvitals/routetemplates_gen.go"
)

// findModuleRoot walks up from `start` until it finds a directory containing
// go.mod. `go generate` invokes directives with the working directory set to
// the package that declares them, so a plain relative default would resolve
// against internal/api/webvitals and fail.
func findModuleRoot(start string) (string, error) {
	dir, err := filepath.Abs(start)
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("go.mod not found in any parent directory")
		}
		dir = parent
	}
}

// resolvePath makes a path absolute against the module root unless the caller
// supplied an absolute one.
func resolvePath(root, path string) string {
	if filepath.IsAbs(path) {
		return path
	}
	return filepath.Join(root, path)
}

func main() {
	sourceFlag := flag.String("source", defaultSource, "path to web/src/lib/routeRegistry.ts (relative to the module root)")
	outFlag := flag.String("out", defaultOut, "path to the generated Go file (relative to the module root)")
	check := flag.Bool("check", false, "verify the generated file is up to date instead of writing it")
	flag.Parse()

	cwd, err := os.Getwd()
	if err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: %v\n", err)
		os.Exit(1)
	}
	root, err := findModuleRoot(cwd)
	if err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: %v\n", err)
		os.Exit(1)
	}

	source := resolvePath(root, *sourceFlag)
	out := resolvePath(root, *outFlag)

	raw, err := os.ReadFile(source)
	if err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: read %s: %v\n", source, err)
		os.Exit(1)
	}

	paths, err := ParseRoutePaths(string(raw))
	if err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: parse %s: %v\n", source, err)
		os.Exit(1)
	}

	rendered := Render(paths)

	if *check {
		existing, err := os.ReadFile(out)
		if err != nil {
			fmt.Fprintf(os.Stderr, "routetemplategen: read %s: %v\n", out, err)
			os.Exit(1)
		}
		if string(existing) != rendered {
			fmt.Fprintf(os.Stderr,
				"routetemplategen: %s is stale — run `go run ./cmd/routetemplategen`\n", out)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stdout, "%s up to date (%d routes)\n", *outFlag, len(paths))
		return
	}

	if err := os.MkdirAll(filepath.Dir(out), 0o755); err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: %v\n", err)
		os.Exit(1)
	}
	// Idempotent: an unchanged run leaves the file's bytes AND mtime alone.
	if existing, err := os.ReadFile(out); err == nil && string(existing) == rendered {
		fmt.Fprintf(os.Stdout, "%s unchanged (%d routes)\n", *outFlag, len(paths))
		return
	}
	if err := os.WriteFile(out, []byte(rendered), 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "routetemplategen: %v\n", err)
		os.Exit(1)
	}
	fmt.Fprintf(os.Stdout, "wrote %s (%d routes)\n", *outFlag, len(paths))
}
