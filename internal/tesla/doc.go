// Package tesla provides a resilient client for the Tesla Fleet API.
//
// [Client] manages OAuth2 authentication (authorization code exchange
// and automatic token refresh) and exposes methods for listing vehicles,
// fetching full vehicle data, waking vehicles, and sending commands.
// All outbound requests pass through a circuit breaker (sony/gobreaker)
// that opens after 5 consecutive failures and half-opens after 30 s,
// preventing cascading load on the upstream API. Response types such as
// [VehicleDataResponse], [ChargeState], and [DriveState] mirror the
// Tesla Fleet API schema.
// Layer: platform
//
package tesla
