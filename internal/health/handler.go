// Package health provides dependency-free liveness and dependency-aware
// readiness handlers for standalone worker processes.
package health

import (
	"context"
	"encoding/json"
	"net/http"
)

// Checker is the dependency health surface used by ReadinessHandler.
type Checker interface {
	Health(context.Context) error
}

// Response is the JSON contract returned by probe handlers.
type Response struct {
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

// LivenessHandler reports only whether the process can serve HTTP. Shared
// dependency failures must not trigger Kubernetes restart loops.
func LivenessHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeResponse(w, http.StatusOK, Response{Status: "ok"})
	}
}

// ReadinessHandler reports whether the worker's required dependency is
// available. A failure removes the pod from service without restarting it.
func ReadinessHandler(checker Checker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := checker.Health(r.Context()); err != nil {
			writeResponse(w, http.StatusServiceUnavailable, Response{
				Status: "unhealthy",
				Error:  err.Error(),
			})
			return
		}
		writeResponse(w, http.StatusOK, Response{Status: "ok"})
	}
}

func writeResponse(w http.ResponseWriter, status int, response Response) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(response)
}
