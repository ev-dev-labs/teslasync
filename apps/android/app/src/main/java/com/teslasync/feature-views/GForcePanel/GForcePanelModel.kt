// Pure, framework-free model + projection for the GForcePanel feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/driving/components/driving-dynamics/GForcePanel.tsx). No Compose, no Android framework,
// no HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer. The web component reads the polled `useDriveDynamicsLatest(vehicleId)`
// snapshot (`/drive-dynamics/latest`) and pulls two optional g-force readings — `lateral_acceleration` and
// `longitudinal_acceleration`, both already in g — guarding each with a `typeof === 'number'` check, then
// renders three StatCards (Lateral / Longitudinal / Combined magnitude) when at least one reading is present
// or a friendly "No G-force telemetry received yet" empty state otherwise. The readers below narrow each
// field exactly as that `typeof` guard does (a JSON number only — a quoted string is rejected like JS), and
// the magnitude is the same `sqrt(lat² + lon²)` the web computes only when both readings exist.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/GForcePanel — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling LiveMotorStatus / DriveStatCards surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.gforcepanel

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.util.Locale
import kotlin.math.sqrt

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, location, or any
 * g-force payload, so a diagnostics line can never leak the vehicle's identity or movement.
 */
const val G_FORCE_PANEL_SLUG: String = "GForcePanel"

/**
 * The hard-coded `g` unit suffix — the web component itself hard-codes `unit="g"` on every StatCard (g-force
 * is dimensionless, never converted by `useUnits`), so it is the only non-key display string this surface
 * carries, exactly as the sibling LiveMotorStatus hard-codes its `RPM` / `Nm` suffixes.
 */
const val G_FORCE_UNIT: String = "g"

/** Web `fmtNumber(value, 2)` precision for every g-force tile. */
internal const val G_FORCE_DECIMALS: Int = 2

/**
 * Em dash shown for a `null` reading — the web `value != null ? fmtNumber(value, 2) : '—'` fallback, and the
 * exact marker [ChartFormat.number] returns for a `null` / non-finite value (so the projected tile matches).
 */
internal const val EM_DASH: String = "\u2014"

// The two g-force fields the web reads off `/drive-dynamics/latest`. Both arrive as SI-irrelevant g values
// (dimensionless) in snake_case; the readers narrow them with the web `typeof === 'number'` guard.
private const val FIELD_LATERAL: String = "lateral_acceleration"
private const val FIELD_LONGITUDINAL: String = "longitudinal_acceleration"

/** Which of the three tiles a [GForceTile] represents; the render layer resolves its label + glyph from this. */
enum class GForceAxis {
    /** Lateral (cornering) acceleration — web `t('dynamics.lateral')`. */
    Lateral,

    /** Longitudinal (accel/braking) acceleration — web `t('dynamics.longitudinal')`. */
    Longitudinal,

    /** Combined magnitude `sqrt(lat² + lon²)` — web `t('dynamics.combined')`. */
    Combined,
}

/**
 * The two optional g-force readings this surface consumes — the native mirror of the web `lateral` /
 * `longitudinal` locals (each `number | null`). Pure data so the projection stays unit-testable off-device.
 *
 * @property lateral lateral acceleration in g, or `null` when the field is absent / not a JSON number.
 * @property longitudinal longitudinal acceleration in g, or `null` when absent / not a JSON number.
 */
data class GForceReading(
    val lateral: Double?,
    val longitudinal: Double?,
) {
    /** Web `hasAny = lateral != null || longitudinal != null`: at least one reading is present. */
    val hasAny: Boolean get() = lateral != null || longitudinal != null

    /** Web `magnitude`: `sqrt(lat² + lon²)` only when BOTH readings are present, else `null`. */
    val magnitude: Double?
        get() =
            if (lateral != null && longitudinal != null) {
                sqrt(lateral * lateral + longitudinal * longitudinal)
            } else {
                null
            }
}

/**
 * One render-ready tile — the native analogue of one web `<StatCard label value unit="g" />`. Pure data (no
 * Compose types) so every branch is unit-tested directly: [value] is already formatted (a locale-grouped
 * number, or the em-dash the web shows for a `null` reading).
 */
data class GForceTile(
    val axis: GForceAxis,
    val label: String,
    val value: String,
) {
    /** The merged TalkBack phrase for the tile (label, value, unit) — one focusable node per tile. */
    fun accessibilityLabel(unit: String): String = "$label, $value $unit"
}

/**
 * The fully projected, render-ready panel — the native analogue of the JSX the web component returns. When
 * [hasAny] is false the surface renders its empty state (web `<EmptyState />`); otherwise it renders the three
 * [tiles] in source order. Pure data so every branch is unit-tested directly.
 */
data class GForcePanelDisplay(
    val hasAny: Boolean,
    val tiles: List<GForceTile>,
    val unit: String,
)

/**
 * The localized strings the panel renders — the native mirror of every `t('dynamics.…')` call the web
 * component makes, resolved once at the Compose boundary (P1/S10) and passed in so the projection stays
 * framework-free yet fully localized. [snapshotLabel] personalizes the error surface's retry copy; [unit] is
 * the web-hard-coded `g` suffix.
 */
data class GForcePanelStrings(
    val title: String,
    val lateral: String,
    val longitudinal: String,
    val combined: String,
    val noData: String,
    val unit: String = G_FORCE_UNIT,
    val snapshotLabel: String = title,
)

/**
 * Pure projection from the polled snapshot to the panel's render state — a 1:1 port of the web component's
 * field guards, magnitude computation, and per-StatCard branch. Stateless and side-effect-free so it is fully
 * covered by the off-device unit gate; the composable only resolves localized strings + the display locale and
 * draws what these return.
 */
object GForcePanelProjection {
    /**
     * The two readings the web derives from the snapshot, narrowing each with the web `typeof === 'number'`
     * guard: only a JSON number counts, so a quoted-string field (JS `typeof 'string'`) reads as `null`.
     */
    fun parse(snapshot: JsonElement?): GForceReading {
        val obj = snapshot as? JsonObject
        return GForceReading(
            lateral = obj.numberOrNull(FIELD_LATERAL),
            longitudinal = obj.numberOrNull(FIELD_LONGITUDINAL),
        )
    }

    /**
     * Whether the snapshot carries no usable g-force reading — the web `!hasAny` branch that renders the empty
     * state. Used by the view-model to classify the cache-then-network feed onto [io.teslasync.android.data.UiPhase.Empty].
     */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = !parse(snapshot).hasAny

    /**
     * Projects the snapshot onto the render-ready [GForcePanelDisplay] for the user's display [locale] (web
     * `fmtNumber` global locale). When no reading is present the display carries no tiles (the empty branch);
     * otherwise it carries the three tiles in web source order — Lateral, Longitudinal, Combined — each value
     * formatted at [G_FORCE_DECIMALS] with the em-dash fallback the web shows for a `null` reading.
     */
    fun project(
        snapshot: JsonElement?,
        strings: GForcePanelStrings,
        locale: Locale,
    ): GForcePanelDisplay {
        val reading = parse(snapshot)
        if (!reading.hasAny) {
            return GForcePanelDisplay(hasAny = false, tiles = emptyList(), unit = strings.unit)
        }
        val tiles =
            listOf(
                GForceTile(GForceAxis.Lateral, strings.lateral, format(reading.lateral, locale)),
                GForceTile(GForceAxis.Longitudinal, strings.longitudinal, format(reading.longitudinal, locale)),
                GForceTile(GForceAxis.Combined, strings.combined, format(reading.magnitude, locale)),
            )
        return GForcePanelDisplay(hasAny = true, tiles = tiles, unit = strings.unit)
    }

    /**
     * Web `value != null ? fmtNumber(value, 2) : '—'`: a present reading is locale-grouped at two fraction
     * digits; a `null` (or non-finite) reading renders the em dash. Delegated to the golden-pinned shared
     * [ChartFormat.number], which already returns the em-dash marker for `null` / NaN / ±∞.
     */
    private fun format(
        value: Double?,
        locale: Locale,
    ): String = ChartFormat.number(value, G_FORCE_DECIMALS, locale)
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [G_FORCE_PANEL_SLUG] (P1/S11). Carries no
 * acceleration value or vehicle id, so a diagnostics line can never leak fleet telemetry. Kept free of Compose
 * so it is unit-tested with a recording [Logger]; the view-model calls it from the composable's
 * first-composition effect.
 */
fun recordGForcePanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to G_FORCE_PANEL_SLUG))
}

/** Resolves a BCP-47 [tag] to a [Locale], falling back to en-US when blank/absent (web `fmtNumber` default). */
internal fun resolveDisplayLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

/** A JSON number field as a [Double], or `null` when absent or not a JSON number (web `typeof === 'number'`). */
private fun JsonObject?.numberOrNull(key: String): Double? {
    val primitive = this?.get(key) as? JsonPrimitive ?: return null
    return if (primitive.isString) null else primitive.doubleOrNull
}
