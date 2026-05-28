// Package vampiredrain serves GET /api/v1/vampire-drain and
// GET /api/v1/vampire-drain/stats. The endpoints derive vampire drain
// events and rollups live from fsm_transitions and signal_log rather
// than the deleted vampire_drain_events table.
//
// Layer: handler
package vampiredrain
