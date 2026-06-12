// Pure, framework-free model + projection + diagnostics for the FavoritesBar feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/system/components/FavoritesBar.tsx). No Compose, no Android, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// FavoritesBar is a presentational surface — the web component's ONLY hook is `useTranslation`; the owning
// VehicleCommandCenter page threads everything else in as props (the persisted `favorites` id list, the full
// `commands` catalogue, and the `renderTile` callback that draws each tile). So this surface binds NO data
// feed: like the committed FleetStatsBar / SummaryStatsRow / QuickMetrics siblings, the cache-then-network
// states (loading skeleton / hard fetch-error / stale / offline) live on the owning page — which owns the
// vehicle-state query, the command mutations, and the stale-data banner — NOT on this presentational bar.
// Modelling those states here would fabricate behaviour the web spec does not have (honesty covenant: no
// silent drift). The branches the web source itself defines are the complete state set reproduced here:
//   • populated (web `favCmds.length > 0`) — the FadeIn header + responsive tile grid;
//   • empty (web `favCmds.length === 0 → return null`) — the surface renders NOTHING. The web component
//     literally returns null, so the faithful native empty branch composes nothing (the owning page fills the
//     space with the category groups / search results). This is parity, not a hidden surface: there is no
//     blank box because there is no box at all, exactly as on the web.
//
// The one derivation the web performs before its JSX is the favourite filter:
//   `const favCmds = commands.filter(c => favorites.includes(c.id))`
// — selecting the catalogue entries whose id is favourited, in CATALOGUE order (not favourites order). That
// is [FavoritesBarProjection.select]. The web reads only `c.id` off each command (everything else is handed
// straight to `renderTile`), so the projection is generic over the minimal [FavoriteCommand] id contract and
// the composable hands whole commands back to its `renderTile` slot — the native port of the web render-prop.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FavoritesBar — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.favoritesbar

import io.teslasync.shared.core.diagnostics.Logger

/**
 * The minimal command contract this surface reads — the native analogue of the only field the web
 * `FavoritesBar` touches on a `CommandDef`: its [id]. The web filters the catalogue by id
 * (`favorites.includes(c.id)`) and hands the whole command to `renderTile`; everything else a tile needs
 * (label, icon, toggle state, …) travels with the concrete command type the owning page supplies, so the
 * projection + composable stay generic over this id-only contract and never depend on a tile's internals.
 */
interface FavoriteCommand {
    /** Stable command id matched against the favourites list (web `c.id`). */
    val id: String
}

/**
 * Pure projection from the surface's props to its render-ready favourites list — a 1:1 port of the single
 * derivation the web component performs before its JSX:
 * `const favCmds = commands.filter(c => favorites.includes(c.id))`. No Compose, no Android; unit-tested end
 * to end.
 */
object FavoritesBarProjection {
    /**
     * Select the favourited commands from [commands], in CATALOGUE order — the exact web
     * `commands.filter(c => favorites.includes(c.id))`. Filtering the catalogue (rather than mapping over
     * [favorites]) preserves the catalogue's canonical ordering and silently drops favourite ids that no
     * longer resolve to a command, both matching the web. The result's size is the web `favCmds.length` (the
     * header count); an empty result is the web `favCmds.length === 0` gate that renders nothing.
     *
     * @param favorites the persisted favourite command ids (web `favorites: string[]`).
     * @param commands the full command catalogue, in display order (web `commands: CommandDef[]`).
     * @return the favourited subset of [commands], in catalogue order; empty when nothing is favourited.
     */
    fun <C : FavoriteCommand> select(
        favorites: List<String>,
        commands: List<C>,
    ): List<C> {
        if (favorites.isEmpty()) return emptyList()
        val favouriteIds = favorites.toHashSet()
        return commands.filter { it.id in favouriteIds }
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * favourite ids, the favourite count, or any command identity — so a diagnostics line can never leak which
 * commands the user has favourited.
 */
object FavoritesBarDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "FavoritesBar"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
