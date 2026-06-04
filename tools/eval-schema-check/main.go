// Command eval-schema-check validates every goldens.yaml file under
// internal/ai/strategies. Exits 1 on any structural error.
//
// The check is offline and never reaches a provider.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"github.com/ev-dev-labs/teslasync/internal/ai/eval"
)

func main() {
	root := flag.String("root", "internal/ai/strategies", "root directory to scan")
	flag.Parse()

	// Walk for raw paths first so we can report per-file failures
	// instead of bailing on the first parse error.
	var paths []string
	err := filepath.WalkDir(*root, func(p string, d os.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if !d.IsDir() && filepath.Base(p) == "goldens.yaml" {
			paths = append(paths, p)
		}
		return nil
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "walk %s: %v\n", *root, err)
		os.Exit(1)
	}
	sort.Strings(paths)
	if len(paths) == 0 {
		fmt.Fprintf(os.Stderr, "no goldens.yaml files under %s\n", *root)
		os.Exit(1)
	}

	failed := 0
	for _, p := range paths {
		set, err := eval.LoadGoldenSet(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "FAIL %s: %v\n", p, err)
			failed++
			continue
		}
		fmt.Printf("ok   %s (feature=%s, %d goldens)\n", p, set.Feature.ID, len(set.Goldens))
	}

	if failed > 0 {
		fmt.Fprintf(os.Stderr, "\n%d file(s) failed schema check\n", failed)
		os.Exit(1)
	}
	fmt.Printf("\nAll %d file(s) passed schema check\n", len(paths))
}
