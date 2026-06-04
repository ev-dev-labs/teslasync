// Package adminfeedback serves the SPA admin feedback queue and optional
// GitHub Issues forwarding. Authz remains provider-agnostic: ForwardAuth gates
// the route, and audit_logs provide mutation accountability.
//
// Layer: handler
package adminfeedback
