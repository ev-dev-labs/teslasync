package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// spaFallback serves the SPA's index.html for any non-API GET request
// whose path doesn't match a static asset on disk. Used as the catch-all
// route in NewRouter so client-side router paths like /vehicles/{id}
// return the SPA shell instead of 404.
//
// Extracted from router.go to keep the route-mount block focused on
// route mounting and to make this helper independently testable.
func spaFallback(dir string, fs http.Handler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Only serve SPA fallback for GET requests
		if r.Method != http.MethodGet {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// Don't intercept API paths — let them 404 naturally
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.Error(w, "Not Found", http.StatusNotFound)
			return
		}

		// If the file exists on disk, serve it directly
		path := filepath.Join(dir, filepath.Clean(r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fs.ServeHTTP(w, r)
			return
		}

		// SPA fallback — serve index.html for client-side routing
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	}
}
