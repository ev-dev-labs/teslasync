// Package locsnap hosts the location history and latest-state handlers backed
// by the signal change feed and layered live-state reader. It stays independent
// from the parent internal/api package as part of the handler decomposition.
//
// Layer: handler
package locsnap
