// Package daylog serves GET /api/v1/day-log — one vehicle's
// local-calendar-day event timeline.
//
// # Taxonomy
//
// Every event carries {id, ts, type, layer, vehicle_id, ref_kind,
// ref_id, payload}. Timestamps are UTC (RFC3339); ts values are the
// source row's event time, never synthesised. Titles are NOT served
// by this API: the frontend localises by type so i18n stays complete.
//
// Default layer (always on):
//
//	type               source table      timestamp field  payload (SI)                        deep link
//	drive_start        drives            started_at       start_place, start_soc_pct            /drives/:id
//	drive_end          drives            ended_at         end_place, distance_m, duration_s,    /drives/:id
//	                                         energy_used_wh, end_soc_pct
//	charge_start       charging_sessions started_at       start_place, start_soc_pct            /charging/:id
//	charge_end         charging_sessions ended_at         energy_added_wh, duration_s,          /charging/:id
//	                                         end_soc_pct
//	parked             fsm_transitions   ts               from_state                            —
//	online             fsm_transitions   ts               from_state                            —
//	asleep             fsm_transitions   ts               from_state                            —
//	offline            fsm_transitions   ts               from_state                            —
//	state_change       fsm_transitions   ts               from_state, to_state (unknown target) —
//	locked             security_events   ts (locked=true) —                                    —
//	unlocked           security_events   ts (locked=false)—                                    —
//	lock_unknown       security_events   ts               state (unparseable to_state)          —
//	sentry_on          security_events   ts               state (proto token, e.g. Armed)       —
//	sentry_off         security_events   ts               state (Off/Unknown token)             —
//	sentry_unknown     security_events   ts               state (missing to_state)              —
//	remote_start_on    signal_log        ts               —                                    —
//	remote_start_off   signal_log        ts               —                                    —
//	sw_update          software_updates  created_at       version, status                       —
//	sw_update_installed software_updates installed_at     version                               —
//
// Optional layers (off by default, enabled via ?layers=):
//
//	layer         type(s)                                     signal field(s)
//	turn_signals  turn_signal {value}                         LightsTurnSignal (enum number, no label map)
//	lights        hazards_on/off, high_beams_on/off           LightsHazardsActive, LightsHighBeams
//	doors_windows door_open/closed {door}, window {window, value} DoorState*, Fd/Fp/Rd/RpWindow
//	hvac          hvac_on {power_w} / hvac_off                HvacPower (on = watts != 0)
//	gear          gear {gear}                                 drive_telemetry.gear (P/R/N/D)
//	homelink      homelink_nearby_on/off, arrived/left_{home, HomelinkNearby, LocatedAtHome,
//	              work,favorite}                              LocatedAtWork, LocatedAtFavorite
//
// # Source-of-truth decisions
//
//   - Drive/charge boundaries come from session rows (drives,
//     charging_sessions), including in-progress rows (NULL end). FSM
//     transitions targeting driving/charging are suppressed: the session
//     tracker already materialised them, and emitting both would double
//     count every trip. FSM is authoritative only for
//     parked/online/asleep/offline.
//   - signal_log carries a change feed, not state. Only in-window
//     transitions become events; the first observation per field is the
//     baseline and emits nothing (state-at-midnight is not something
//     that "happened today").
//   - user_present has NO source: no telemetry signal, no table, and the
//     legacy security_snapshots table is dropped (ADR-001). It is
//     reported as unavailable, never synthesised.
//   - ValetMode transitions exist in security_events but are out of v1
//     scope and intentionally not mapped.
//   - Summary sums skip NULL measures; a sum with zero contributors is
//     null (unknown), never a fake 0 — except that counts are exact.
//
// # Bounds
//
// Output is hard-capped at dayLogEventCap events (truncated=true when
// over). signal_log and drive_telemetry inputs are fetched with LIMITs;
// hitting an input cap also sets truncated because edges may be lost.
package daylog
