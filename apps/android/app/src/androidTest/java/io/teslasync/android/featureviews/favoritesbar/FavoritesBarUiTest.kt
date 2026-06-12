package io.teslasync.android.featureviews.favoritesbar

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Rule
import org.junit.Test

/**
 * Instrumented Compose UI + accessibility verification of [FavoritesBarContent] across the states the web
 * source defines (web/src/features/system/components/FavoritesBar.tsx): the populated header + tile grid, and
 * the empty subset that renders NOTHING (web `if (favCmds.length === 0) return null`). Asserts the header
 * label + count + every tile are exposed to TalkBack (present in the semantics tree), and that the empty
 * branch composes no header and no tiles (never a blank box — there is no box at all). The surface has no
 * interactive elements (the web source has none; tiles are drawn by the owning page's renderTile slot), so
 * accessibility coverage is the presence of the surface's single textual label. Runs under
 * `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the pure projection + diagnostics.
 */
class FavoritesBarUiTest {
    @get:Rule
    val compose = createComposeRule()

    private data class Cmd(
        override val id: String,
        val label: String,
    ) : FavoriteCommand

    private val favourites = listOf(Cmd("lock", "Lock"), Cmd("climate_on", "Climate On"))

    private fun setContent(commands: List<Cmd>) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    FavoritesBarContent(commands = commands) { command -> Text(command.label) }
                }
            }
        }
    }

    @Test
    fun populatedShowsHeaderLabelCountAndEveryTile() {
        setContent(favourites)

        // Header: the uppercase "Quick Actions" eyebrow + the `(count)` (web `({favCmds.length})`).
        compose.onNodeWithText("QUICK ACTIONS").assertIsDisplayed()
        compose.onNodeWithText("(2)").assertIsDisplayed()

        // Every favourited tile is rendered through the renderTile slot.
        compose.onNodeWithText("Lock").assertIsDisplayed()
        compose.onNodeWithText("Climate On").assertIsDisplayed()
    }

    @Test
    fun headerLabelIsExposedToAccessibility() {
        setContent(favourites)

        // The surface's only label must be present in the semantics tree TalkBack reads.
        compose.onNodeWithText("QUICK ACTIONS").assertExists()
    }

    @Test
    fun emptyFavouritesRenderNothing() {
        setContent(emptyList())

        // Web `if (favCmds.length === 0) return null` — no header, no tiles.
        compose.onNodeWithText("QUICK ACTIONS").assertDoesNotExist()
        compose.onNodeWithText("Lock").assertDoesNotExist()
        compose.onNodeWithText("Climate On").assertDoesNotExist()
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        val HOST_WIDTH = 360.dp
        val HOST_HEIGHT = 640.dp
    }
}
