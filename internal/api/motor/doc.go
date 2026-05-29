// Package motor hosts /api/v1/motor history and latest-state handlers backed by
// signal.StateReader / signal.LiveStateReader.
//
// Layer: handler
//
// Carved in Phase R2d.77, this package depends only on shared API helpers and
// core signal interfaces; it must not import its parent package.
package motor
