// Pure, framework-free model + projection + diagnostics for the Distance shared surface — the native
// analogue of web/src/components/data-display/format/Distance.tsx. No Compose, no Android framework, no
// HTTP: every declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer over these pure functions (the accepted sibling-surface contract).
//
// The web source is a metric/imperial-aware distance renderer. It reads the user's unit preference via
// `useUnits` (`unitPrefs.distance`, "mi" or "km"), accepts a value in EITHER miles (preferred) or
// kilometres, normalises that caller value to SI metres (`miles * 1609.344` or `km * 1000` — the web
// local is misleadingly named `sourceMiles` but holds metres), converts metres to the display unit with
// `convertDistanceFromSI`, formats the result with `fmtNumber(value, precision)` (locale grouping, fixed
// fraction digits, where `precision` defaults to the user's `decimal_precision` setting — 2 when unset),
// and renders `{value} {unit}`. It always exposes the RAW caller value in its ORIGINAL unit through the
// `title` attribute, fixed to two decimals (`Number.toFixed(2)`, no grouping). When neither input is a
// finite number it renders a bare em dash.
//
// This file owns that math: the input -> metres normalisation, the precision resolution
// (`prop ?? settings ?? 2`), the call into the shared `convertDistanceFromSI` (one source of truth for
// the factor), the `fmtNumber`-parity grouped formatter, the `toFixed`-parity title formatter, and the
// em-dash no-value branch. The composable only binds the live unit preference and draws the text.
//
// States: the web source has exactly two render branches — a formatted value and the em-dash no-value
// fallback. It has NO async cache-then-network feed; its single dependency (`useUnits`) is a synchronous
// preference that the native unit formatter always resolves (it falls back to metric defaults before
// settings load — never a loading / error surface), so there is no loading / error / stale / offline
// lifecycle to project. Modelling those would fabricate behaviour the web spec does not have, exactly as
// the accepted AnimatedNumber / VisuallyHidden presentational ports document. The surface renders no
// static copy of its own — only the formatted number, the unit symbol, and the em dash — so it carries
// NO i18n keys; there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Distance — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.distance

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import io.teslasync.shared.core.units.UnitPref
import io.teslasync.shared.core.units.convertDistanceFromSI
import java.util.Locale

/**
 * Canonical registry metadata for the Distance surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Distance`).
 */
object DistanceRegistration {
    /** Stable surface id (also the key a host would bind the surface with). */
    const val ID: String = "distance"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "Distance"
}

/**
 * The web-source constants, kept named so the composable, the projection, and the unit gate agree on one
 * source of truth — no loose numerals drift between the render layer and its tests.
 */
object DistanceDefaults {
    /** 1 mile = 1609.344 m exactly — web `miles * 1609.344` normalises the miles input to metres. */
    const val METERS_PER_MILE: Double = 1609.344

    /** 1 km = 1000 m exactly — web `km * 1000` normalises the kilometres input to metres. */
    const val METERS_PER_KM: Double = 1000.0

    /**
     * Fraction digits when neither the caller nor the user setting supplies one. Mirrors the web
     * `fmtNumber` global default, which `useSettings` seeds from `decimal_precision ?? 2`.
     */
    const val DEFAULT_PRECISION: Int = 2

    /** Fixed fraction digits of the raw-value `title` tooltip — web `Number.toFixed(2)`. */
    const val TITLE_PRECISION: Int = 2

    /** Upper precision clamp, matching the web `setGlobalPrecision` 0..20 range so output stays bounded. */
    const val MAX_PRECISION: Int = 20

    /** The no-value marker — web renders a bare em dash when neither input is finite. */
    const val EMPTY: String = "\u2014"
}

/**
 * The presentational inputs — the native analogue of the web `Distance` props. [miles] is preferred over
 * [km] (web checks miles first); [precision] is the optional per-call fraction-digit override.
 */
data class DistanceInput(
    val miles: Double? = null,
    val km: Double? = null,
    val precision: Int? = null,
)

/**
 * The fully projected render state of the surface — what the composable draws. Either a formatted
 * [Value] (with the raw-value [title] the web exposes via its `title` attribute) or the [Empty] em-dash
 * fallback. [text] is the visible string in both cases, so the renderer is a single `Text(display.text)`.
 */
sealed interface DistanceDisplay {
    /** The visible string: the formatted `{value} {unit}`, or the em dash for [Empty]. */
    val text: String

    /** The raw caller value in its original unit (web `title` tooltip); null when there is no value. */
    val title: String?

    /** A formatted distance plus the raw-value title the web surfaces through its `title` attribute. */
    data class Value(
        override val text: String,
        override val title: String,
    ) : DistanceDisplay

    /** The no-value fallback — a bare em dash, with no title (web renders `<span>—</span>`). */
    data object Empty : DistanceDisplay {
        override val text: String = DistanceDefaults.EMPTY
        override val title: String? = null
    }
}

/**
 * The pure projection the composable renders — a 1:1 port of the work the web `Distance` performs each
 * render. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the
 * composable only binds the live [UnitPref] and applies the text style.
 */
object DistanceProjection {
    /**
     * Projects the caller [input] under the user's [prefs] into the render-ready [DistanceDisplay].
     * Miles wins over kilometres (web order); a non-finite or absent value on the chosen input falls
     * through to [DistanceDisplay.Empty]. [locale] controls the display grouping/separators (web
     * `fmtNumber` uses the settings locale); the raw-value title is always locale-independent like
     * `Number.toFixed`.
     */
    fun project(
        input: DistanceInput,
        prefs: UnitPref,
        locale: Locale = Locale.US,
    ): DistanceDisplay {
        val miles = input.miles
        val km = input.km
        val meters: Double
        val title: String
        when {
            miles != null && miles.isFinite() -> {
                meters = miles * DistanceDefaults.METERS_PER_MILE
                title = formatTitle(miles, DistanceUnitPref.MI)
            }
            km != null && km.isFinite() -> {
                meters = km * DistanceDefaults.METERS_PER_KM
                title = formatTitle(km, DistanceUnitPref.KM)
            }
            else -> return DistanceDisplay.Empty
        }
        val digits = resolvePrecision(input.precision, prefs.precision)
        val display = convertDistanceFromSI(meters, prefs.distance)
        val text = "${formatGrouped(display, digits, locale)} ${prefs.distance.label}"
        return DistanceDisplay.Value(text = text, title = title)
    }

    /**
     * Resolves the effective fraction digits — web `fmtNumber`'s `decimals ?? _globalPrecision`, where
     * the global default is the user's `decimal_precision` (or 2). A per-call [override] wins, then the
     * preference [prefPrecision], then [DistanceDefaults.DEFAULT_PRECISION]; negatives are ignored (they
     * would throw in `Intl.NumberFormat`) and the result is clamped to a bounded range.
     */
    fun resolvePrecision(
        override: Int?,
        prefPrecision: Int?,
    ): Int {
        val chosen =
            when {
                override != null && override >= 0 -> override
                prefPrecision != null && prefPrecision >= 0 -> prefPrecision
                else -> DistanceDefaults.DEFAULT_PRECISION
            }
        return chosen.coerceIn(0, DistanceDefaults.MAX_PRECISION)
    }

    /**
     * Resolves a BCP-47 [tag] (web settings `locale`) to a [Locale] for display formatting. A null or
     * blank tag falls back to en-US, the web `fmtNumber` default.
     */
    fun resolveLocale(tag: String?): Locale = if (tag.isNullOrBlank()) Locale.US else Locale.forLanguageTag(tag)

    /** The raw-value title — web `${value.toFixed(2)} ${unit}`: fixed digits, '.' decimal, no grouping. */
    private fun formatTitle(
        raw: Double,
        unit: DistanceUnitPref,
    ): String = "${formatPlain(raw, DistanceDefaults.TITLE_PRECISION)} ${unit.label}"

    /**
     * `fmtNumber` parity for the visible value: locale grouping with fixed (min == max) fraction digits.
     * A non-finite value is coerced to 0 first (web `safeNumber`) so a degenerate input never renders
     * `NaN`; `%,` applies the locale grouping separators and HALF_UP matches `Intl` `halfExpand`.
     */
    private fun formatGrouped(
        value: Double,
        digits: Int,
        locale: Locale,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(locale, "%,.${digits}f", safe)
    }

    /**
     * `Number.toFixed` parity for the title: fixed fraction digits, a '.' decimal separator, and NO
     * grouping — locale-independent, so the title reads the same regardless of the display locale.
     */
    private fun formatPlain(
        value: Double,
        digits: Int,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        return String.format(Locale.US, "%.${digits}f", safe)
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened`
 * event tagged with the surface [DistanceRegistration.SLUG] — never the rendered distance, raw value, or
 * unit, so a diagnostics line can never leak what the surface displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it once per surface open.
 */
object DistanceDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to DistanceRegistration.SLUG))
    }
}
