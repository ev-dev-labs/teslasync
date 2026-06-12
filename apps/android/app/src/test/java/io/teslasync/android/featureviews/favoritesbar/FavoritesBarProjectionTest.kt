package io.teslasync.android.featureviews.favoritesbar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the FavoritesBar pure adapter — the native mirror of the single derivation the
 * web component performs before its JSX (web/src/features/system/components/FavoritesBar.tsx):
 * `const favCmds = commands.filter(c => favorites.includes(c.id))`. Because the surface is purely
 * presentational, the projected list is exactly what the thin composable renders, so these assertions double
 * as the per-state "snapshot" of the data layer: the populated subset (in catalogue order), and the empty
 * subset that drives the web `favCmds.length === 0` → render-nothing branch.
 */
class FavoritesBarProjectionTest {
    /** Minimal [FavoriteCommand] — the projection reads only the id, exactly as the web filter does. */
    private data class Cmd(
        override val id: String,
    ) : FavoriteCommand

    // The catalogue in its canonical display order (the web `commands` / `COMMANDS` array order).
    private val catalogue = listOf(Cmd("lock"), Cmd("unlock"), Cmd("climate_on"), Cmd("flash"), Cmd("frunk"))

    @Test
    fun selectsOnlyFavouritedCommands() {
        val result = FavoritesBarProjection.select(listOf("unlock", "flash"), catalogue)
        assertEquals(listOf("unlock", "flash"), result.map { it.id })
    }

    @Test
    fun preservesCatalogueOrderNotFavouritesOrder() {
        // Favourites supplied in an arbitrary order; the result must follow the CATALOGUE order, because the
        // web filters the catalogue (`commands.filter(...)`) rather than mapping over the favourites list.
        val result = FavoritesBarProjection.select(listOf("flash", "lock", "climate_on"), catalogue)
        assertEquals(listOf("lock", "climate_on", "flash"), result.map { it.id })
    }

    @Test
    fun allFavouritedReturnsWholeCatalogueInCatalogueOrder() {
        val ids = catalogue.map { it.id }
        val result = FavoritesBarProjection.select(ids.reversed(), catalogue)
        assertEquals(ids, result.map { it.id })
    }

    @Test
    fun emptyFavouritesYieldsEmpty() {
        // Nothing favourited → the web `favCmds.length === 0` gate (the surface renders nothing).
        assertTrue(FavoritesBarProjection.select(emptyList(), catalogue).isEmpty())
    }

    @Test
    fun noMatchingFavouritesYieldsEmpty() {
        assertTrue(FavoritesBarProjection.select(listOf("does_not_exist"), catalogue).isEmpty())
    }

    @Test
    fun unknownFavouriteIdsAreSilentlyDropped() {
        val result = FavoritesBarProjection.select(listOf("lock", "ghost", "frunk"), catalogue)
        assertEquals(listOf("lock", "frunk"), result.map { it.id })
    }

    @Test
    fun duplicateFavouriteIdsDoNotDuplicateCommands() {
        val result = FavoritesBarProjection.select(listOf("lock", "lock"), catalogue)
        assertEquals(listOf("lock"), result.map { it.id })
    }

    @Test
    fun emptyCatalogueYieldsEmpty() {
        assertTrue(FavoritesBarProjection.select(listOf("lock"), emptyList<Cmd>()).isEmpty())
    }

    @Test
    fun returnsTheCatalogueInstancesUnchanged() {
        // The whole command travels to renderTile untouched (the web hands `cmd` straight to renderTile).
        val result = FavoritesBarProjection.select(listOf("climate_on"), catalogue)
        assertSame(catalogue[2], result.single())
    }
}
