// Package authsession serves session metadata for the SPA monitor.
//
// GET /api/v1/auth/session stays outside ForwardAuth and always returns 200 so an expired upstream session cannot trap the polling hook in a loop.
//
// Layer: handler
package authsession
