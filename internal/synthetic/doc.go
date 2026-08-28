// Package synthetic runs read-only outside-in canary probes against TeslaSync
// HTTP paths.
//
// Layer: platform
//
// It is embedded inside the TeslaSync API process so endpoint and multi-step
// operator-journey failures share the application's observability surface.
// Probes are bounded and idempotent: they inspect existing data but never
// create vehicles or mutate fleet state.
package synthetic
