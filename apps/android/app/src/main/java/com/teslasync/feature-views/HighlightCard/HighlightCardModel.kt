// Pure, framework-free model + projection for the HighlightCard feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/HighlightCard.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// HighlightCard is a purely presentational surface — the web component takes its `icon`, `label`, `value`,
// optional `change`, optional `subtitle`, and a `color` accent straight as props from the weekly-digest
// slides (which own whatever query produced the numbers), so this surface binds NO data hook and reads NO
// i18n catalog of its own (every string arrives pre-localized from the caller). As in the sibling ToolCard /
// AchievementBadge / SummaryStatsRow ports, the cache-then-network lifecycle (loading / error / stale /
// offline) lives on the owning page, not here; modelling those states would invent behaviour the spec does
// not have (drift). The branches the web source actually defines — the optional change row (present/absent ×
// positive/negative) and the optional subtitle — are the complete state set this surface renders, and each
// is projected here.
//
// Faithful-to-the-source nuance on `color`: the web maps it through `glowMap` to GlassPanel's `glow` prop,
// but GlassPanel only emits the glow utilities when its `hover` prop is set (`hover && glowClasses[glow]`),
// and HighlightCard never passes `hover`. So `color` produces no resting visual difference in the web source
// — all five variants render as the same glass surface. We still reproduce `glowMap` here (and unit-test it)
// so the one derivation the source performs is faithfully ported and the accent intent is documented for any
// future hover-enabled host, exactly as the sibling ports reproduce their source quirks rather than silently
// "fixing" them. The five-key accent union itself (cyan/green/purple/amber/red) is identical to ToolCard's,
// so [HighlightColor] reuses ToolCard's canonical design-token mapping at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/HighlightCard — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ToolCard / AchievementBadge surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.highlightcard

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The accent key of a [HighlightCard] — the native analogue of the web `color` prop's typed union
 * (`'cyan' | 'green' | 'purple' | 'amber' | 'red'`, default `'cyan'`). The composable maps each case to a
 * design-token color at the render boundary; the dark-theme tokens equal the web neon hexes exactly
 * (cyan → status.info #00F0FF, green → status.success #10B981, purple → chart.power #A855F7,
 * amber → status.warning #F59E0B, red → status.danger #EF4444) — the same mapping the sibling ToolCard
 * surface uses, so the two accent-keyed cards stay visually consistent.
 */
enum class HighlightColor {
    Cyan,
    Green,
    Purple,
    Amber,
    Red,
    ;

    companion object {
        /**
         * Maps a raw `color` prop to its [HighlightColor], reproducing the web typed union with its
         * `color = 'cyan'` default: an absent (`null`) or unrecognised value (the web keys are exact
         * lowercase) folds to [Cyan].
         */
        fun fromRaw(color: String?): HighlightColor =
            when (color) {
                "cyan" -> Cyan
                "green" -> Green
                "purple" -> Purple
                "amber" -> Amber
                "red" -> Red
                else -> Cyan
            }
    }
}

/**
 * The decorative glow of the card's panel — the codomain of the web `glowMap` lookup
 * (`{ cyan: 'cyan', green: 'green', purple: 'purple', amber: 'none', red: 'none' }`). Note the web collapses
 * the amber and red accents to [None]: those cards never glow. See the file header for why the glow has no
 * resting visual effect in the source (it is gated behind GlassPanel's unused `hover` prop); this type exists
 * so the one derivation the source performs is modelled and unit-tested.
 */
enum class HighlightGlow {
    Cyan,
    Green,
    Purple,
    None,
}

/**
 * The optional trend indicator — the native mirror of the web `change?: { value: string; positive: boolean }`
 * prop. [value] is the already-localized delta string the caller supplies (e.g. "+12%"); [positive] selects
 * the upward (success) vs downward (danger) treatment.
 *
 * @property value the pre-formatted change text rendered beside the trend glyph (web `change.value`).
 * @property positive whether the change is an improvement — drives the up/down glyph and success/danger color
 *   (web `change.positive`).
 */
data class HighlightChange(
    val value: String,
    val positive: Boolean,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component resolves
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property label the secondary label shown beside the icon (web `label`).
 * @property value the headline value (web `value`).
 * @property glow the panel glow resolved from the accent via the web `glowMap` (see [HighlightGlow]).
 * @property change the optional trend indicator, or `null` when the web `{change && …}` branch is skipped.
 * @property subtitle the optional caption, or `null` when absent/empty — the web `{subtitle && …}` branch
 *   treats an empty string as falsy, so an empty subtitle is normalized to `null` (not rendered).
 */
data class HighlightCardDisplay(
    val label: String,
    val value: String,
    val glow: HighlightGlow,
    val change: HighlightChange?,
    val subtitle: String?,
)

/**
 * Pure projection from the surface's props to its render-ready [HighlightCardDisplay] — a 1:1 port of the one
 * derivation the web component performs (`glowMap[color] ?? 'none'`) plus the two conditional render branches
 * it defines (`{change && …}`, `{subtitle && …}`).
 */
object HighlightCardProjection {
    /**
     * Resolve the panel glow for an accent — a verbatim port of the web `glowMap`:
     * cyan/green/purple keep their hue, amber and red collapse to [HighlightGlow.None].
     */
    fun glowFor(color: HighlightColor): HighlightGlow =
        when (color) {
            HighlightColor.Cyan -> HighlightGlow.Cyan
            HighlightColor.Green -> HighlightGlow.Green
            HighlightColor.Purple -> HighlightGlow.Purple
            HighlightColor.Amber -> HighlightGlow.None
            HighlightColor.Red -> HighlightGlow.None
        }

    /**
     * Select the render-ready view for the given props. Mirrors the web component's body exactly: the glow is
     * looked up from [color]; [change] passes through (the composable renders the row only when it is
     * non-null, web `{change && …}`); an empty [subtitle] is normalized to `null` so the caption row is
     * skipped (web `{subtitle && …}` treats `''` as falsy while a non-empty string — even whitespace — is
     * truthy).
     */
    fun project(
        label: String,
        value: String,
        color: HighlightColor,
        change: HighlightChange?,
        subtitle: String?,
    ): HighlightCardDisplay =
        HighlightCardDisplay(
            label = label,
            value = value,
            glow = glowFor(color),
            change = change,
            subtitle = subtitle?.takeIf { it.isNotEmpty() },
        )
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the label,
 * value, change, or subtitle the caller threaded in — so a diagnostics line can never leak the digest's
 * numbers.
 */
object HighlightCardDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "HighlightCard"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
