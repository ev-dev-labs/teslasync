// Layer: platform
//
// Package rotation tracks secret rotation status (Tesla refresh token,
// MQTT mTLS cert, DB password, session JWK, app signing key, Authentik
// secret) and computes per-kind severity for the
// /admin/observability/secret-rotation surface. Fingerprints use
// HMAC-SHA256 with APP_SECRET_PEPPER so the secret_rotation_log table
// can be persisted without enabling offline secret guessing.
package rotation
