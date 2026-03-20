// Package resilience provides reliability primitives used throughout TeslaSync.
//
// [RetryConfig] implements exponential backoff with jitter (configurable
// max attempts, initial/max wait, and multiplier). [HealthMonitor] tracks
// per-component health via [RecordSuccess]/[RecordFailure], deriving a
// [ComponentStatus] of healthy, degraded (2+ consecutive failures), or
// unhealthy (5+ consecutive failures). SafeGo and SafeGoLoop launch
// goroutines with panic recovery and optional automatic restart, ensuring
// background tasks do not crash the process.
package resilience
