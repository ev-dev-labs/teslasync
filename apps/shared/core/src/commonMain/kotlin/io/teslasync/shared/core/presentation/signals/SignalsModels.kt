package io.teslasync.shared.core.presentation.signals

/*
 * Cross-platform port of the typed signal-inspector models the web `useSignals` hook domain
 * surfaces (web/src/api/hooks/useSignals.ts + the `Signal*` types in web/src/api/types.ts).
 *
 * The backend's `/signals/` endpoints return each value as a `{kind, value, ts}` envelope keyed by
 * the canonical `protomodel.ValueKind` discriminator. The web hooks normalize the long-form
 * ValueKind / UnitKind names into the compact unions below, then surface the typed primitive `value`
 * directly so consumers can switch on `kind` without re-parsing strings. The same normalization is
 * ported verbatim to the data layer (see `normalizeSignalKind` etc. in
 * `io.teslasync.shared.core.data.repo.SignalsRepository`); these are the resulting read models the
 * S8 store exposes.
 *
 * No field here is unit-bearing in a way this layer converts — values are carried as the typed
 * primitive exactly as the backend emits them (SI on disk per Phase-42); any display formatting is
 * the render boundary's job (S5).
 */

/**
 * Compact discriminator for a typed signal value — the port of the web `SignalKind` union. Maps the
 * backend's `protomodel.ValueKind` after normalization:
 *  - [String] ← ValueKindString
 *  - [Bool] ← ValueKindBool
 *  - [Int] ← ValueKindInt32 / ValueKindInt64 / ValueKindEnum
 *  - [Float] ← ValueKindFloat / ValueKindDouble
 *  - [Time] ← ValueKindTime
 *  - [Unknown] ← anything unrecognised
 */
public enum class SignalKind {
    String,
    Bool,
    Int,
    Float,
    Time,
    Unknown,
}

/**
 * UnitKind discriminator surfaced by `/signals/{vehicleID}/available` — the port of the web
 * `SignalUnitKind` union. Mirrors `protomodel.UnitKind` (none/distance/temperature/pressure/charge);
 * [Speed] is included so callers can flag distance-derived rate signals separately even though the
 * backend currently rolls them into UnitKindNone.
 */
public enum class SignalUnitKind {
    None,
    Distance,
    Temperature,
    Pressure,
    Charge,
    Speed,
}

/**
 * The typed primitive carried by a [SignalEnvelope] — the port of the web `SignalValue`
 * (`string | boolean | number | null`). The concrete arm matches the envelope's [SignalKind]:
 * [Text] for `string`/`time`, [Bool] for `bool`, [Num] for `int`/`float` (the web models both as a
 * JS `number`), and [Null] for an empty typed column.
 */
public sealed interface SignalValue {
    /** A string (kind `string`) or RFC3339 timestamp (kind `time`). */
    public data class Text(
        val value: String,
    ) : SignalValue

    /** A boolean (kind `bool`). */
    public data class Bool(
        val value: Boolean,
    ) : SignalValue

    /** A numeric value (kind `int` or `float`); both are a JS `number` in the web model. */
    public data class Num(
        val value: Double,
    ) : SignalValue

    /** The typed column was empty (`null`). */
    public data object Null : SignalValue
}

/**
 * The typed live/history envelope returned by the `/signals/` endpoints — the port of the web `SignalEnvelope`.
 * [ts] is RFC3339 / ISO 8601 (empty string when absent).
 */
public data class SignalEnvelope(
    val kind: SignalKind,
    val value: SignalValue,
    val ts: String,
)

/** A single entry in the `/signals/{vehicleID}/available` catalog — the port of the web `SignalDescriptor`. */
public data class SignalDescriptor(
    val name: String,
    val category: String,
    val valueKind: SignalKind,
    val unitKind: SignalUnitKind,
    val isCompound: Boolean,
    val isSettingUnit: Boolean,
)

/** Response shape of `GET /signals/{vehicleID}/available` — the port of the web `AvailableSignalsResponse`. */
public data class AvailableSignalsResponse(
    val vehicleId: Long,
    val count: Int,
    val source: String,
    val signals: List<SignalDescriptor>,
)

/** Response shape of `GET /signals/{vehicleID}/live` — the port of the web `LiveSignalsResponse`. */
public data class LiveSignalsResponse(
    val vehicleId: Long,
    val count: Int,
    val at: String,
    val signals: Map<String, SignalEnvelope>,
)

/** Response shape of `GET /signals/{vehicleID}/{signalName}/history` — the port of the web `SignalHistoryResponseTyped`. */
public data class SignalHistoryResponse(
    val vehicleId: Long,
    val signal: String,
    val expectedKind: String,
    val from: String,
    val to: String,
    val count: Int,
    val data: List<SignalEnvelope>,
)

/**
 * The time window for a `/history` query — the port of the web `SignalHistoryRange`. [hours] is the
 * simplest form (sent as the snake_case `hours` query param, defaulting to [DEFAULT_HOURS]); an
 * explicit [from]/[to] RFC3339 pair wins when both are present. [limit] caps the row count when > 0.
 */
public data class SignalHistoryRange(
    val hours: Int = DEFAULT_HOURS,
    val from: String? = null,
    val to: String? = null,
    val limit: Int? = null,
) {
    public companion object {
        /** The web `useSignalHistory(range = { hours: 24 })` default window. */
        public const val DEFAULT_HOURS: Int = 24
    }
}
