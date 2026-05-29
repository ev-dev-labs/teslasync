// Package synthetic serves the synthetic-monitoring board read endpoint.
// Probe state stays in synthetic.Runner; a missing runner returns 503 so the SPA
// can distinguish an unwired deployment from an empty board.
//
// Layer: handler
package synthetic
