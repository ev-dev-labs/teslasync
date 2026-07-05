package elevation

import "context"

// Provider looks up terrain elevation for a single (lat, lon) fix. See
// the package doc comment for why this exists — Tesla Fleet Telemetry
// never transmits elevation on the wire.
//
// Implementations MUST be:
//
//   - Best-effort. ok=false (with a nil err) is the correct response
//     for "no data available right now" — a disabled/unconfigured
//     provider, a transient failure already logged internally, or a
//     genuine void in the underlying terrain model. Callers treat
//     ok=false as "omit the value," never as elevation zero.
//
//   - Bounded. Lookup must not block past its own short, internal
//     timeout. Callers (e.g. positionsWriter.Write) run this on the
//     telemetry hot path — as often as once per completed lat/lng fix,
//     which Fleet Telemetry can deliver every couple of seconds per
//     vehicle — so an implementation that hangs would stall position
//     ingestion for every vehicle sharing that writer.
//
// err is returned so callers MAY log it, but err MUST NOT be treated as
// fatal: a Provider failure is always non-blocking for the caller's own
// write.
type Provider interface {
	Lookup(ctx context.Context, lat, lon float64) (metersMSL float64, ok bool, err error)
}

// NoopProvider is the zero-configuration Provider. It always reports
// ok=false so callers behave exactly as they did before elevation
// support existed — the column stays NULL. Production wiring falls
// back to NoopProvider when no elevation service is configured
// (Config.ServiceURL empty), so operators who have not deployed a
// self-hosted elevation service see no behavior change.
type NoopProvider struct{}

// Lookup implements Provider.
func (NoopProvider) Lookup(_ context.Context, _, _ float64) (float64, bool, error) {
	return 0, false, nil
}

// Compile-time assertion that NoopProvider satisfies Provider.
var _ Provider = NoopProvider{}
