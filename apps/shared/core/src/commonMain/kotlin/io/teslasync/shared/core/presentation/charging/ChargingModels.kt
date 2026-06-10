package io.teslasync.shared.core.presentation.charging

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The `POST /charge-planner/optimize` body — the cross-platform port of the web
 * `OptimizeChargeRequest` (web/src/types/charging.ts), consumed by the web `useOptimizeCharge`
 * mutation. Keys are snake_case, matching the Go `chargePlannerHandler.Optimize` request shape,
 * and are serialized through the networking client's `explicitNulls = false` JSON so a null
 * optional field is dropped from the wire — byte-for-byte parity with the web
 * `JSON.stringify(params)` body (which omits `undefined` keys).
 *
 * The five required fields ([vehicleId], [targetSoc], [departBy], [ratePlanId]) are always
 * sent; the four tuning knobs are optional. The `*_kwh`/`charger_voltage` names are the
 * existing backend request contract carried verbatim for parity — this is a request body, not
 * a stored SI column, so the Phase-48 unit-suffix rule (which governs DB columns and stored Go
 * struct fields) does not apply here.
 */
@Serializable
public data class OptimizeChargeInput(
    @SerialName("vehicle_id") val vehicleId: Long,
    @SerialName("target_soc") val targetSoc: Int,
    @SerialName("depart_by") val departBy: String,
    @SerialName("rate_plan_id") val ratePlanId: String,
    @SerialName("max_amps") val maxAmps: Int? = null,
    @SerialName("battery_capacity_kwh") val batteryCapacityKwh: Double? = null,
    @SerialName("charger_voltage") val chargerVoltage: Int? = null,
    @SerialName("prefer_off_peak") val preferOffPeak: Boolean? = null,
)

/**
 * The `POST /charge-planner/apply` body — the port of the web `ApplyScheduleRequest`, consumed
 * by the web `useApplySchedule` mutation. Carries only the [planId] of a previously-optimized
 * plan (snake_case `plan_id`), matching the Go `chargePlannerHandler.Apply` request shape.
 */
@Serializable
public data class ApplyScheduleInput(
    @SerialName("plan_id") val planId: Long,
)
