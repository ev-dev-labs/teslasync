// Package daylog serves GET /api/v1/day-log — one vehicle's
// local-calendar-day event timeline.
//
// Layer: handler
//
// # Taxonomy
//
// Every event carries {id, ts, type, layer, vehicle_id, source,
// ref_kind, ref_id, payload}. Timestamps are UTC (RFC3339); ts values
// are the source row's event time, never synthesised. Titles are NOT
// served by this API: the frontend localises by type so i18n stays
// complete. Transitions report previous → new in payload from/to;
// absent states are omitted, never invented.
//
// The default view is the COMPLETE history: an omitted ?layers=
// enables every optional layer. An explicit CSV narrows to a subset.
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
//	parked             fsm_transitions   ts               from, to                                —
//	online             fsm_transitions   ts               from, to                                —
//	asleep             fsm_transitions   ts               from, to                                —
//	offline            fsm_transitions   ts               from, to                                —
//	state_change       fsm_transitions   ts               from, to (unknown target)               —
//	locked             security_events   ts (locked=true) from, to (bool)                        —
//	unlocked           security_events   ts (locked=false) from, to (bool)                       —
//	lock_unknown       security_events   ts               from, to (raw)                         —
//	sentry_on          security_events   ts               from, to (full proto tokens)           —
//	sentry_off         security_events   ts               from, to (full proto tokens)           —
//	sentry_unknown     security_events   ts               from, to (raw)                         —
//	valet_on/off       security_events   ts               from, to (bool)                        —
//	security           security_events   ts               event_type, from, to (unrecognized)    —
//	remote_start_on    signal_log        ts               from, to (bool)                        —
//	remote_start_off   signal_log        ts               from, to (bool)                        —
//	sw_update          software_updates  created_at       version, status                       —
//	sw_update_installed software_updates installed_at     version                               —
//
// Optional layers (on by default; narrowed via ?layers=):
//
//	layer         type(s)                                                 signal field(s)
//	turn_signals  turn_signal {component, from, to, from/to_value}        LightsTurnSignal (direction IS in the enum)
//	lights        hazards_on/off, high_beams_on/off {from, to}            LightsHazardsActive, LightsHighBeams
//	doors_windows door_open/closed {door, from, to},                      DoorState* (bool), Fd/Fp/Rd/RpWindow
//	              window {window, from, to, from/to_value}                (WindowState enum)
//	hvac          hvac_on/off {from, to, from/to_value}                   HvacPower (HvacPowerState enum, not watts)
//	gear          gear {from, to, from/to_raw}                            drive_telemetry.gear ("ShiftStateD"/"D")
//	homelink      homelink_nearby_on/off, arrived/left_{home,              HomelinkNearby, LocatedAtHome,
//	              work,favorite} {from, to}                               LocatedAtWork, LocatedAtFavorite
//
// Unmapped signal fields surface as generic signal events
// {field, from, to} on the layer that queried them.
//
// # Enum display labels
//
// signal_log stores proto enum NUMBERS. The timeline labels them with
// read-side display maps (turnSignalShort, windowShort, hvacShort,
// gearShortForm) that cite their generated sources
// (internal/tesla/protomodel/enum_parsers_gen.go + the proto). These
// maps do not import proto bindings and do not re-run the codec's
// prefix-trim; the parity test asserts every entry against the
// generated String() output. Unknown numbers render raw, never guessed.
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
//   - Previous states come from stored data only: the prior row of the
//     same series (in-window chain seeded by a pre-window lookup for
//     security_events, whose writer leaves from_state NULL).
//
// # Bounds
//
// Events page with limit (default 500, max 2000) + offset;
// total_events counts every assembled event so callers page until
// complete. truncated=true reports data LOSS (a signal/gear input cap
// was hit), never paging: a partial page is not truncation.
package daylog
