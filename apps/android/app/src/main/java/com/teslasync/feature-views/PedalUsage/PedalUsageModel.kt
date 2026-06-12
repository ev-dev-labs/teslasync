// Pure, framework-free model + projection for the PedalUsage feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/PedalUsage.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// PedalUsage is a presentational surface. The web component reads its snapshot from
// `useDriveDynamicsLatest(vehicleId)` (the `/drive-dynamics/latest` projection of the live PedalPosition /
// BrakePedalPos / BrakePedal signals), but — exactly like the sibling LiveMotorStatus / LiveVehicleState
// ports — the native surface takes that decoded snapshot as a prop from its owning Driving Dynamics page,
// which owns the query's loading / error / stale / offline handling. So this surface binds no data fetch;
// its two web data sources are `useTranslation` (the i18n catalog, P1/S10) and `useUnits` (the live decimal
// precision, P1/S8), and the cache-then-network lifecycle states live on the owning page, not here. The two
// branches the web source itself defines are the complete render set:
//   • at least one pedal reading present (web `hasAny`) → the three-up gauge row, and
//   • no reading present → a friendly empty state ("No pedal telemetry received yet"), never a blank box
//     (web `<EmptyState/>`), which doubles as the offline-cached-empty surface.
// A skeleton loading branch is offered behind an opt-in `loading` flag the owning page threads while its
// query is first in flight — the same convention the sibling surfaces use — defaulting to the web's
// no-loading contract.
//
// The web reads a `DriveDynamicsSnapshot` (web/src/api/types.ts); [DriveDynamicsLive] mirrors the slice it
// consumes in snake_case (matching the Go JSON tags served verbatim — no camelCaseKeys transform in the
// shared layer), so the projection runs straight off the cached API JSON. `pedal_position` /
// `brake_pedal_position` are already percentages (0..100), so no unit conversion is applied — the only
// display preference the surface honors is the global decimal precision the web `RadialGauge` reads through
// `getGlobalPrecision()` for a non-integer reading (web `d = decimals ?? (isInteger ? 0 : precision)`); the
// locale-aware number rendering itself is delegated to the shared RadialGauge component, as every gauge
// surface does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/PedalUsage — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.pedalusage

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.floor

/** The em-dash the web renders as a gauge's unit when its reading is absent (`'—'`). */
internal const val DASH: String = "\u2014"

/** Web gauge unit for a present pedal reading (`'%'`). */
internal const val PERCENT_UNIT: String = "%"

/** Pedal-position scale — the web `max={100}` (0..100 %). */
internal const val PEDAL_MAX: Double = 100.0

/** Web `getGlobalPrecision()` default — the user's `decimal_precision`, 2 when unset. */
internal const val DEFAULT_DECIMAL_PRECISION: Int = 2

// Raw `/drive-dynamics/latest` (DriveDynamicsSnapshot) document keys read by the surface — snake_case,
// served verbatim by the Go handler (no camelCaseKeys transform in the shared layer), so the native reads
// match the wire contract.
private const val FIELD_PEDAL_POSITION = "pedal_position"
private const val FIELD_BRAKE_PEDAL_POSITION = "brake_pedal_position"
private const val FIELD_BRAKE_PEDAL_ACTIVE = "brake_pedal_active"

/**
 * The slice of `/drive-dynamics/latest` this surface reads — the native mirror of the `DriveDynamicsSnapshot`
 * fields the web `PedalUsage` consumes (web/src/api/types.ts). Field names keep their snake_case wire form so
 * the projection runs directly off the cached API JSON, and every field is nullable because the backend omits
 * a reading whenever the underlying telemetry has not reported (the web reads each behind a `typeof` guard
 * and falls back to the empty state / em-dash).
 *
 * @property pedalPosition throttle pedal position 0..100 (%), or null when not reported (web `pedal_position`).
 * @property brakePedalPosition brake pedal position 0..100 (%), or null when not reported
 *   (web `brake_pedal_position`).
 * @property brakePedalActive whether the brake pedal is depressed, or null when not reported
 *   (web `brake_pedal_active`).
 */
data class DriveDynamicsLive(
    val pedalPosition: Double?,
    val brakePedalPosition: Double?,
    val brakePedalActive: Boolean?,
) {
    companion object {
        /**
         * Decode a `/drive-dynamics/latest` body into a tolerant snapshot, or `null` when the body is absent
         * / not a JSON object — web parity: `data` is `DriveDynamicsSnapshot | null`. Unlike a present-but-empty
         * snapshot rendering grids elsewhere, PedalUsage gates on `hasAny` (at least one of the three readings
         * present), so a decoded snapshot with all three fields null still resolves to the empty state via the
         * projection, exactly like the web `hasAny` check.
         */
        fun fromJson(element: JsonElement?): DriveDynamicsLive? {
            val obj = element as? JsonObject ?: return null
            return DriveDynamicsLive(
                pedalPosition = obj.numberField(FIELD_PEDAL_POSITION),
                brakePedalPosition = obj.numberField(FIELD_BRAKE_PEDAL_POSITION),
                brakePedalActive = obj.boolField(FIELD_BRAKE_PEDAL_ACTIVE),
            )
        }
    }
}

/**
 * The semantic accent each gauge tints with — the native analogue of the web per-gauge hex (`#06b6d4` cyan /
 * `#ef4444` red). The render layer resolves each to a design token so no hex literal leaks into the view.
 */
enum class PedalAccent { Cyan, Red }

/** Stable identity of each gauge, in the order the web grid emits them. */
enum class PedalGaugeKey { Throttle, Brake }

/**
 * One projected radial gauge — everything the web passes to its `RadialGauge` for the throttle / brake cell.
 * Pure data so the projection is unit-tested without a UI host; the view maps [key] onto its i18n label and
 * [accent] onto a design token, then hands [value] / [max] / [unit] / [decimals] to the shared RadialGauge.
 *
 * @property key the gauge identity (drives the label in the view).
 * @property value the pedal position clamped to `0..`[max] (web `Math.max(0, Math.min(value, max))`).
 * @property max the gauge scale (always [PEDAL_MAX]).
 * @property unit `'%'` when the reading is present, the em-dash otherwise (web `value != null ? '%' : '—'`).
 * @property decimals fraction digits the gauge renders (web `isInteger ? 0 : globalPrecision`).
 * @property accent the arc color (web per-gauge hex), resolved to a token by the view.
 * @property present whether the underlying reading was non-null (drives the unit and is asserted by tests).
 */
data class PedalGauge(
    val key: PedalGaugeKey,
    val value: Double,
    val max: Double,
    val unit: String,
    val decimals: Int,
    val accent: PedalAccent,
    val present: Boolean,
)

/**
 * The localized labels this surface resolves once (P1/S10) and hands to the renderer. Keeping the strings
 * injectable lets the stateless content composable be exercised in a UI test without a resources host and
 * keeps the projection free of any English literal.
 */
data class PedalUsageStrings(
    val title: String,
    val throttle: String,
    val throttlePosition: String,
    val brake: String,
    val brakePedalPosition: String,
    val brakeActive: String,
    val brakeInactive: String,
    val brakePedal: String,
    val noData: String,
    val loadingLabel: String,
)

/**
 * The fully projected, render-ready view — everything the web component computes before returning JSX. Pure
 * data (no Compose types) so the projection is unit-tested without a UI host and each per-state instance
 * doubles as the surface's snapshot.
 *
 * @property loading whether the owning query is still in flight; the surface renders skeleton chrome while
 *   true (the opt-in branch the owning page threads; default false is the web's no-loading contract).
 * @property hasData whether at least one pedal reading is present (web `hasAny`); when false the surface
 *   renders the empty state instead of the gauges.
 * @property throttle the throttle gauge spec (always built so the projection is fully testable; rendered only
 *   when [hasData]).
 * @property brake the brake gauge spec (always built; rendered only when [hasData]).
 * @property brakeActive whether the brake pedal is active — true only when the reading is explicitly true, so
 *   a null/absent reading reads as inactive (web `brakeActive ? … : …`, where null is falsy).
 */
data class PedalUsageDisplay(
    val loading: Boolean,
    val hasData: Boolean,
    val throttle: PedalGauge,
    val brake: PedalGauge,
    val brakeActive: Boolean,
)

/**
 * Pure projection from the surface's prop to its render-ready [PedalUsageDisplay] — a 1:1 port of the
 * derivations the web component performs: the per-field `typeof === 'number' | 'boolean'` guards, the
 * `hasAny` presence gate, the `value ?? 0` clamp the web `RadialGauge` applies, the `value != null ? '%' :
 * '—'` unit, and the `brakeActive ? danger/Active : success/Inactive` badge ternary (null → inactive).
 */
object PedalUsageProjection {
    /**
     * Select the render-ready view for the given [dynamics] snapshot and [loading] flag. [precision] is the
     * user's global decimal precision (web `getGlobalPrecision()`), used only for a non-integer reading.
     */
    fun project(
        dynamics: DriveDynamicsLive?,
        loading: Boolean,
        precision: Int,
    ): PedalUsageDisplay {
        val throttleRaw = dynamics?.pedalPosition
        val brakeRaw = dynamics?.brakePedalPosition
        val brakeActiveRaw = dynamics?.brakePedalActive
        val hasAny = throttleRaw != null || brakeRaw != null || brakeActiveRaw != null
        val safePrecision = precision.coerceAtLeast(0)
        return PedalUsageDisplay(
            loading = loading,
            hasData = hasAny,
            throttle = gauge(PedalGaugeKey.Throttle, throttleRaw, PedalAccent.Cyan, safePrecision),
            brake = gauge(PedalGaugeKey.Brake, brakeRaw, PedalAccent.Red, safePrecision),
            brakeActive = brakeActiveRaw == true,
        )
    }

    /** Build one gauge spec — web `value={raw ?? 0}` clamped to `0..max`, with the present/absent unit. */
    private fun gauge(
        key: PedalGaugeKey,
        raw: Double?,
        accent: PedalAccent,
        precision: Int,
    ): PedalGauge {
        val present = raw != null
        val clamped = (raw ?: 0.0).coerceIn(0.0, PEDAL_MAX)
        return PedalGauge(
            key = key,
            value = clamped,
            max = PEDAL_MAX,
            unit = if (present) PERCENT_UNIT else DASH,
            decimals = gaugeDecimals(clamped, precision),
            accent = accent,
            present = present,
        )
    }

    /**
     * The fraction-digit count the web `RadialGauge` derives when no `decimals` prop is passed:
     * `Number.isInteger(clamped) ? 0 : getGlobalPrecision()`.
     */
    internal fun gaugeDecimals(
        clamped: Double,
        precision: Int,
    ): Int = if (clamped.isFinite() && clamped == floor(clamped)) 0 else precision.coerceAtLeast(0)
}

/**
 * Resolve the global decimal [precision] from the user's settings (web `getGlobalPrecision()`), falling back
 * to [DEFAULT_DECIMAL_PRECISION] when unset — the same default the web helper applies.
 */
internal fun resolveDisplayPrecision(precision: Int?): Int = (precision ?: DEFAULT_DECIMAL_PRECISION).coerceAtLeast(0)

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a pedal
 * reading — so a diagnostics line can never leak fleet telemetry.
 */
object PedalUsageDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "PedalUsage"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

/** Read a numeric field, or `null` when absent / JSON `null` / not a JSON number (web `typeof === 'number'`). */
private fun JsonObject.numberField(key: String): Double? = (this[key] as? JsonPrimitive)?.let { if (it.isString) null else it.doubleOrNull }

/** Read a boolean field, or `null` when absent / JSON `null` / not a JSON bool (web `typeof === 'boolean'`). */
private fun JsonObject.boolField(key: String): Boolean? = (this[key] as? JsonPrimitive)?.let { if (it.isString) null else it.booleanOrNull }
