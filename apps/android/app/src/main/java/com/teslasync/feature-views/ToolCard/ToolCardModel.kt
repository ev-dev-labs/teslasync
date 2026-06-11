// Pure, framework-free model for the ToolCard feature view — the native analogue of the only
// derivation the web component performs before returning JSX
// (web/src/features/admin/components/devtools/ToolCard.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is a purely presentational container — its parent passes `icon`, `color`,
// `title`, `description`, and `children`, and it renders a GlassPanel with a colored icon box and a
// title/description header above the children. It binds NO data hook (its only logic is the icon
// color lookup `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`), so there is no loading/error/stale
// state to derive here — only the accent classification (with the web cyan fallback) and the
// surface registration identifiers.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ToolCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling AlertDetailTimeline surface
// does. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.toolcard

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ToolCardRegistration {
    /** Stable surface id. */
    const val ID: String = "tool-card"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ToolCard"
}

/**
 * Semantic accent of a [ToolCard] — the native analogue of the web `ICON_COLOR_MAP` keys
 * (`cyan`/`green`/`purple`/`amber`/`red`). The composable maps each case to a design-token color
 * (dark theme matches the web neon hexes exactly: cyan → status.info #00F0FF, green →
 * status.success #10B981, amber → status.warning #F59E0B, red → status.danger #EF4444, purple →
 * chart.power #A855F7) and tints the icon box's wash, ring, and glyph with it.
 */
enum class ToolCardAccent {
    Cyan,
    Green,
    Purple,
    Amber,
    Red,
    ;

    companion object {
        /**
         * Maps a raw `color` prop to its [ToolCardAccent], reproducing the web lookup
         * `ICON_COLOR_MAP[color] ?? ICON_COLOR_MAP.cyan`: an unknown (or differently-cased, since
         * the web map's keys are exact lowercase) value folds to [Cyan].
         */
        fun fromRaw(color: String): ToolCardAccent =
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
