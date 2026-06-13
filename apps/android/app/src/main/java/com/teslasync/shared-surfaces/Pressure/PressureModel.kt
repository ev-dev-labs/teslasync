// Pure model + projection + diagnostics for the Pressure shared surface — the native analogue of
// web/src/components/data-display/format/Pressure.tsx together with its single data source
// web/src/hooks/useUnits.ts (the SI → display unit boundary). No Compose, no Android UI, no HTTP: every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer over these pure functions (the accepted sibling-surface contract).
//
// The web source is a PRESENTATIONAL pressure renderer, not a data-fetching view. It takes a caller value in
// `bar` OR `psi` plus an optional `precision`/`className`, resolves that value to SI kilopascals (web
// `bar * 100`, `psi * 6.894757`), converts it to the user's preferred pressure unit (`useUnits().unitPrefs.
// pressure` → `convertPressureFromSI`), formats it with `fmtNumber(value, precision)` and renders
// `{display} {unit}`; when neither input is finite it renders an em dash. A hover `title` shows the RAW
// caller value in its SOURCE unit (`bar.toFixed(2)` / `psi.toFixed(2)`). This file owns that math: the
// [PressureProjection.resolveSourceKpa] SI resolution, the [PressureProjection.sourceTitle] hover assembly,
// the [PressureProjection.resolvePrecision] precision resolution (web `precision ?? _globalPrecision`), and
// the [PressureProjection.display] formatting, which delegates to the sanctioned [UnitFormatter] /
// `formatPressure` SI→display boundary (the golden-tested native port of `convertPressureFromSI` + the
// `fmtNumber` contract) so there is ONE conversion source of truth shared by every native surface.
//
// The user's pressure preference is genuinely live (a settings change re-renders the value in the new unit),
// so the surface binds it through the shared P1/S8 state holder ([PressureSource] → [PressureViewModel] over
// the `DataContainer.unitFormatter` derived from `settingsStore`). The pressure value itself is caller-
// supplied and the unit preference always resolves to at least the metric default (the container seeds
// `UnitFormatter.default()`), so — exactly like the accepted AnimatedNumber / Avatar / VisuallyHidden
// presentational ports — there is no async cache-then-network feed and therefore no loading / error / stale /
// offline lifecycle to fabricate. The surface's real, reproduced states are the web source's actual render
// branches: a formatted value (in bar / psi / kPa) and the em-dash empty state (no finite input). The web
// source renders no static copy of its own — only the number, the unit symbol, and the source-unit title,
// all of which are data / unit identifiers rather than translatable prose — so the surface carries NO i18n
// keys; there is none to map, and none is invented.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/Pressure — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling shared surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pressure

import io.teslasync.android.data.UnitFormatter
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * Canonical registry metadata for the Pressure surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Pressure`).
 */
object PressureRegistration {
    /** Stable surface id (also the `viewModel` key a host binds the surface with). */
    const val ID: String = "pressure"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "Pressure"
}

/**
 * The web-default constants, kept as named values so the composable, the projection, and the unit gate agree
 * on one source of truth — no loose numerals drift between the render layer and its tests.
 */
object PressureDefaults {
    /** 1 bar = 100 kPa (web `sourceBar = bar * 100`; mirrors the shared `KPA_PER_BAR`). */
    const val KPA_PER_BAR: Double = 100.0

    /** 1 psi = 6.894757 kPa (web `sourceBar = psi * 6.894757`; mirrors the shared `KPA_PER_PSI`). */
    const val KPA_PER_PSI: Double = 6.894757

    /**
     * Fallback fraction digits when neither the caller nor the user's `decimal_precision` sets one — the web
     * `numberFormat._globalPrecision` default (`2`). The shared `formatPressure` would otherwise fall back to
     * its quantity default (1); the surface pins the web value so the rendered number matches the source.
     */
    const val GLOBAL_PRECISION_FALLBACK: Int = 2

    /** Fraction digits of the raw-value hover title — web `bar.toFixed(2)` / `psi.toFixed(2)`. */
    const val TITLE_PRECISION: Int = 2

    /** The em dash rendered when no finite input is supplied (web `—`; mirrors the shared empty display). */
    const val EMPTY_DISPLAY: String = "\u2014"

    /** Source-unit symbol shown in the hover title for a `bar` input (web literal `bar`). */
    const val SOURCE_UNIT_BAR: String = "bar"

    /** Source-unit symbol shown in the hover title for a `psi` input (web literal `psi`). */
    const val SOURCE_UNIT_PSI: String = "psi"
}

/**
 * The presentational inputs — the native analogue of the web `Pressure` props that affect output. [bar] and
 * [psi] are the two mutually-exclusive source values (bar wins when both are finite, exactly as the web
 * checks `bar` first); [precision] overrides the fraction digits. `className` is a render-layer concern
 * (styling), so it lives on the composable, not in this pure projection.
 */
data class PressureSpec(
    val bar: Double? = null,
    val psi: Double? = null,
    val precision: Int? = null,
)

/**
 * The pure projection the composable renders — a 1:1 port of the resolution + formatting the web `Pressure`
 * performs. Stateless and side-effect-free so it is fully covered by the off-device unit gate; the composable
 * only collects the live [UnitFormatter] and applies the text style.
 */
object PressureProjection {
    /**
     * Resolves the spec's source value to SI kilopascals, mirroring the web priority order: a finite [bar]
     * (→ `bar * 100`) wins, else a finite [psi] (→ `psi * 6.894757`), else `null` (no finite input). A
     * non-finite value is treated as absent, exactly as the web `Number.isFinite` guards.
     */
    fun resolveSourceKpa(spec: PressureSpec): Double? {
        val bar = spec.bar
        val psi = spec.psi
        return when {
            bar != null && bar.isFinite() -> bar * PressureDefaults.KPA_PER_BAR
            psi != null && psi.isFinite() -> psi * PressureDefaults.KPA_PER_PSI
            else -> null
        }
    }

    /**
     * The raw-value hover title — web `${bar.toFixed(2)} bar` / `${psi.toFixed(2)} psi`. Shows the ORIGINAL
     * caller value in its SOURCE unit (never converted), at a fixed two decimals, so a power user can read the
     * input independent of their display preference. `null` when no finite input exists (the web em-dash
     * branch has no `title`). Formatted with [Locale.ROOT] so the decimal point matches `toFixed` exactly.
     */
    fun sourceTitle(spec: PressureSpec): String? {
        val bar = spec.bar
        val psi = spec.psi
        return when {
            bar != null && bar.isFinite() -> "${fixed(bar)} ${PressureDefaults.SOURCE_UNIT_BAR}"
            psi != null && psi.isFinite() -> "${fixed(psi)} ${PressureDefaults.SOURCE_UNIT_PSI}"
            else -> null
        }
    }

    /**
     * Resolves the fraction digits the value is rendered with — the native mirror of web
     * `fmtNumber(value, precision ?? _globalPrecision)`: an explicit [precision] wins, else the user's
     * `decimal_precision` ([prefPrecision], surfaced by `UnitFormatter.prefs.precision`), else the web global
     * default (`2`). Negative values are ignored so the digit count is always valid.
     */
    fun resolvePrecision(
        precision: Int?,
        prefPrecision: Int?,
    ): Int =
        when {
            precision != null && precision >= 0 -> precision
            prefPrecision != null && prefPrecision >= 0 -> prefPrecision
            else -> PressureDefaults.GLOBAL_PRECISION_FALLBACK
        }

    /**
     * The full display string — web `{fmtNumber(convertPressureFromSI(sourceBar, unit), precision)} {unit}`,
     * delegated to the sanctioned [UnitFormatter.pressure] (kPa → user unit + label) so the conversion factor
     * and the number contract are the shared golden-tested ones. No finite input renders the em dash (the
     * formatter's empty display equals the web `—`), so both render branches flow through one call.
     */
    fun display(
        spec: PressureSpec,
        formatter: UnitFormatter,
    ): String {
        val kpa = resolveSourceKpa(spec)
        val digits = resolvePrecision(spec.precision, formatter.prefs.precision)
        return formatter.pressure(kpa, digits)
    }

    /** Fixed two-decimal, locale-independent rendering of the raw source value (web `Number.toFixed(2)`). */
    private fun fixed(value: Double): String = String.format(Locale.ROOT, "%.${PressureDefaults.TITLE_PRECISION}f", value)
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [PressureRegistration.SLUG] — never the rendered pressure value or the caller's
 * input, so a diagnostics line can never leak the reading the surface displays. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the ViewModel calls it once per surface open.
 */
object PressureDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the one PII-safe `view.opened` diagnostic. Call from the ViewModel's first-open hook. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to PressureRegistration.SLUG))
    }
}
