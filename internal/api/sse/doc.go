// Package sse hosts the Server-Sent Events fan-out hub (EventHub) and the
// SSEHandler HTTP endpoint used to stream live signal/state changes to the
// SPA. Producers (telemetry ingest, alert evaluator, export worker) broadcast
// through the hub; carved-out handler subpackages depend on it via their own
// local EventBroadcaster interfaces, so the concrete type lives here.
//
// Layer: handler
package sse
