// Package dlq serves dead-letter queue inspection and gated replay endpoints.
// Replay stays behind sudo-token routing plus the DLQ_REPLAY_ENABLED flag.
//
// Layer: handler
package dlq
