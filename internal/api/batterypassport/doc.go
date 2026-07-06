// Package batterypassport serves the Battery Passport — a verifiable,
// tamper-evident State-of-Health provenance certificate for a vehicle's
// high-voltage battery, aligned with the EU Battery Passport regulation
// (mandatory 2027).
//
// The passport is a certificate-style provenance artifact distinct from the
// batterydegradation analytics page: it condenses the battery's health
// history and usage into a signed, exportable snapshot whose core immutable
// facts are bound by a SHA-256 provenance hash. A companion verify endpoint
// recomputes that hash so a prospective buyer can detect tampering or
// staleness.
//
// Layer: handler
package batterypassport
