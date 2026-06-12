// Pure, framework-free model + projection for the InfoTile feature view — the native analogue of everything
// the web component derives before returning JSX
// (web/src/features/vehicles/components/telemetry-panels/InfoTile.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// InfoTile is a purely presentational surface — the web component takes its `icon`, `label`, `value`,
// optional `color`, and optional `sub` straight as props from the live-telemetry TelemetryGrid (which owns
// the vehicle-state query and pre-formats every value through `useUnits`/`fmtInt`). So this surface binds NO
// data hook and reads NO i18n catalog of its own for the label/value/sub — they arrive already localized. As
// in the sibling HighlightCard / BatteryPill / AchievementBadge ports, the cache-then-network lifecycle
// (loading / error / stale / offline) lives on the owning page, not here; modelling those phases would invent
// behaviour the spec does not have (drift). The branches the web source actually defines — the boolean value
// rendered as Yes/No, the optional `sub`, and the never-blank value box — are the complete state set this
// surface renders, and each is projected here.
//
// The one string the web component generates itself is the boolean `value ? 'Yes' : 'No'`. That is the single
// i18n concern of the surface (the web hardcodes the English literals); the native port resolves it through
// the generated catalog (P1/S10) `common.yes` / `common.no` keys at the render boundary, so there is no
// English literal in the shipped code. The projection stays pure by taking the already-resolved yes/no labels
// as parameters — the composable looks them up via `stringResource` and hands them in, which also lets the
// unit test drive the boolean arm with any locale's strings.
//
// `color` parity: the web `color` prop is a Tailwind text-color class string (default `text-[var(--text-
// primary)]`, plus the `text-emerald-300` / `text-amber-300` / `text-rose-300` / `text-[var(--text-muted)]`
// values the TelemetryGrid threads in). Per "use platform tokens, never ported Tailwind" (P1/S9), that union
// maps to the semantic [InfoTileColor] enum the composable resolves to a design-token color at the render
// boundary; [InfoTileColor.fromTailwind] models the web string→accent mapping so the one classification the
// source performs is faithfully ported and unit-tested.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/InfoTile — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling HighlightCard / BatteryPill surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infotile

import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.abs
import kotlin.math.floor

/**
 * The accent of an [InfoTile]'s value text — the native analogue of the web `color` prop's Tailwind class
 * string (default `text-[var(--text-primary)]`). The composable maps each case to a design-token color at the
 * render boundary: [Primary] → the primary on-surface text, [Success]/[Warning]/[Danger] → the per-theme
 * `TeslaTokens.status` palette (the toned-down emerald/amber/rose the TelemetryGrid uses for healthy / low /
 * critical readings), and [Muted] → the secondary on-surface-variant text (web `--text-muted`).
 */
enum class InfoTileColor {
    Primary,
    Success,
    Warning,
    Danger,
    Muted,
    ;

    companion object {
        /**
         * Maps a raw web `color` class string to its [InfoTileColor], reproducing the values the TelemetryGrid
         * threads into the source. An absent (`null`/blank) value or the explicit primary class folds to
         * [Primary] (the web `color = 'text-[var(--text-primary)]'` default); any unrecognised class also
         * folds to [Primary] so an unknown accent degrades to readable primary text rather than vanishing.
         */
        fun fromTailwind(color: String?): InfoTileColor =
            when (color?.trim()) {
                null, "", "text-[var(--text-primary)]" -> Primary
                "text-emerald-300" -> Success
                "text-amber-300" -> Warning
                "text-rose-300" -> Danger
                "text-[var(--text-muted)]" -> Muted
                else -> Primary
            }
    }
}

/**
 * The value an [InfoTile] renders — the native port of the web `value: string | number | boolean` union. The
 * composable renders [Text] and [Numeric] verbatim and folds [Flag] to the localized Yes/No labels, exactly
 * as the web `typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value` expression does.
 */
sealed interface InfoTileValue {
    /** A pre-formatted string value (the web `string` arm — every real TelemetryGrid call site uses this). */
    data class Text(
        val value: String,
    ) : InfoTileValue

    /**
     * A numeric value (the web `number` arm); rendered like JavaScript `String(value)` — see
     * [InfoTileProjection.formatNumeric].
     */
    data class Numeric(
        val value: Double,
    ) : InfoTileValue

    /** A boolean value (the web `boolean` arm); rendered as the localized Yes/No labels. */
    data class Flag(
        val value: Boolean,
    ) : InfoTileValue
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component resolves
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property value the resolved display string. Never blank: a blank resolved value folds to an em-dash so the
 *   tile never renders an empty value box (the surface's empty state, per the prompt's "never a blank box").
 * @property sub the optional caption, or `null` when absent/empty — the web `{sub && …}` branch treats an
 *   empty string as falsy, so an empty sub is normalized to `null` (the caption row is then skipped).
 */
data class InfoTileDisplay(
    val value: String,
    val sub: String?,
)

/**
 * Pure projection from the surface's props to its render-ready [InfoTileDisplay] — a 1:1 port of the
 * derivations the web component performs (`typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value`, the
 * `{sub && …}` truthiness guard) plus the prompt's never-blank empty-state guarantee.
 */
object InfoTileProjection {
    /**
     * The em-dash shown when the resolved [InfoTileValue] is blank, so the tile renders a friendly fallback
     * instead of an empty value box (the surface's empty state — the prompt's "never a blank box"). Mirrors
     * the codebase's `value ?? '—'` null-safety convention.
     */
    const val BLANK_VALUE_DASH: String = "\u2014"

    // Beyond JavaScript's MAX_SAFE_INTEGER a Double can no longer represent every integer, so the integral
    // fast-path below stops there and defers to Double.toString rather than a lossy Long conversion.
    private const val MAX_SAFE_INTEGER: Double = 9_007_199_254_740_992.0

    /**
     * Resolve the raw display string for [value], reproducing the web `display` expression: a [InfoTileValue.Flag]
     * folds to [yesLabel]/[noLabel] (already localized by the caller), a [InfoTileValue.Numeric] formats like
     * JavaScript `String(value)`, and a [InfoTileValue.Text] passes through unchanged.
     */
    fun resolveValue(
        value: InfoTileValue,
        yesLabel: String,
        noLabel: String,
    ): String =
        when (value) {
            is InfoTileValue.Text -> value.value
            is InfoTileValue.Numeric -> formatNumeric(value.value)
            is InfoTileValue.Flag -> if (value.value) yesLabel else noLabel
        }

    /**
     * Select the render-ready view for the given props. Mirrors the web component's body: the value is
     * resolved (boolean → Yes/No, number → string, string → as-is) and folded to the em-dash when blank
     * (never-blank empty state); an empty [sub] is normalized to `null` so the caption row is skipped (web
     * `{sub && …}` treats `''` as falsy while a non-empty string is truthy).
     */
    fun project(
        value: InfoTileValue,
        yesLabel: String,
        noLabel: String,
        sub: String?,
    ): InfoTileDisplay =
        InfoTileDisplay(
            value = resolveValue(value, yesLabel, noLabel).ifBlank { BLANK_VALUE_DASH },
            sub = sub?.takeIf { it.isNotEmpty() },
        )

    /**
     * Build the merged accessibility phrase from the visible, already-localized fields — the label, the
     * resolved value, and the optional sub — joined for a single coherent TalkBack announcement (the web tile
     * exposes the value's `title` tooltip; native merges the whole tile into one node). A blank label is
     * dropped so the phrase never opens with a stray separator.
     */
    fun describe(
        label: String,
        display: InfoTileDisplay,
    ): String =
        listOfNotNull(label.takeIf { it.isNotBlank() }, display.value, display.sub)
            .joinToString(separator = ", ")

    /**
     * Format a numeric value like JavaScript's `String(value)` — the web `number` arm renders the raw value
     * via JSX with no locale grouping. A whole number within the safe-integer range drops its fraction
     * (`42.0` → "42"); any other finite value uses [Double.toString] (`3.14` → "3.14"); non-finite values
     * stringify as JavaScript does ("NaN" / "Infinity" / "-Infinity").
     */
    fun formatNumeric(n: Double): String =
        if (n.isFinite() && n == floor(n) && abs(n) < MAX_SAFE_INTEGER) {
            n.toLong().toString()
        } else {
            n.toString()
        }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the label,
 * value, or sub the caller threaded in — so a diagnostics line can never leak a vehicle's live telemetry.
 */
object InfoTileDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "InfoTile"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
