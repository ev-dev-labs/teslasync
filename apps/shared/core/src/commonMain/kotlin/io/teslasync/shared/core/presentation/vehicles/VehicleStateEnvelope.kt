package io.teslasync.shared.core.presentation.vehicles

import io.teslasync.shared.core.api.generated.VehicleState

/**
 * The result of reading a vehicle's last-known state — the cross-platform port of what the web
 * `useVehicleState` hook returns (`{ state, live }`).
 *
 * The web hook normalises three on-the-wire shapes into one envelope (see
 * `normalizeVehicleStateResponse`):
 *  1. the already-normalised `{ state: VehicleState, live }` shape (passed through verbatim);
 *  2. the legacy `{ vehicle, position, … }` shape (folded field-by-field into a [VehicleState]
 *     with the web's exact `?? 0 / ?? false / ?? 'offline' / ?? true` defaults);
 *  3. neither shape present ⇒ [state] is `null` (the screen renders its empty state).
 *
 * Values are SI (ranges in meters, speeds in m/s, temps in °C); display conversion is the render
 * boundary's job (S5), never this layer's.
 *
 * @property state the normalised vehicle state, or `null` when the response carried no decodable
 *   state (the web `state: undefined` branch — the UI shows an empty/offline fallback).
 * @property live whether the backend flagged the reading as a live signal (`res.live`, default
 *   `false`).
 */
public data class VehicleStateEnvelope(
    public val state: VehicleState?,
    public val live: Boolean,
)
