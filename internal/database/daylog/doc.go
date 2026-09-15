// Package daylog is the read-model repo behind GET /api/v1/day-log.
//
// Layer: repository
//
// It reassembles one vehicle's local-calendar-day event timeline from
// existing durable sources — no new tables, no write-path changes:
//
//	drives              completed + in-progress drive sessions (started_at/ended_at)
//	charging_sessions   completed + in-progress charge sessions (started_at/ended_at)
//	fsm_transitions     vehicle-FSM log, fsm_name='vehicle' (mig 000187)
//	security_events     lock + sentry transitions (mig 000183/000189)
//	software_updates    firmware history (version/status/installed_at)
//	signal_log          boolean/enum edges for default (remote start) + optional layers
//	drive_telemetry     gear ticks for the optional gear layer (mig 000190)
//
// Source-of-truth decisions (see handler package doc for the full taxonomy):
//
//	drive/charge boundaries come from session rows; FSM driving/charging
//	transitions are suppressed because the session tracker already
//	materialised them as rows. FSM is authoritative only for
//	parked/online/asleep/offline. signal_log carries edges, never state:
//	callers detect in-window transitions and must not treat the first
//	observed row as a transition.
package daylog
