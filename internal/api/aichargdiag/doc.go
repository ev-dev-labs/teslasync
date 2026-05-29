// Package aichargdiag serves the AI per-charging-session diagnosis
// endpoint for narrating charging behavior, anomalies, and next steps.
//
// It owns only the AI diagnosis surface; baseline charging aggregation
// and AI route aggregation remain in the root api package during Phase R.
//
// Layer: handler
package aichargdiag
