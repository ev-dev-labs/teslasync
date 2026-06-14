package io.teslasync.android.sharedsurfaces.maptilelayer

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.maps.MapStyleId
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the MapTileLayer shared surface across every state the
 * web component renders (web/src/components/maps/MapTileLayer.tsx): the loading skeleton, the resolved tile
 * attribution + fullscreen control for a custom and a community-default provider, the stale / offline freshness
 * chips, and the classified error with a working Retry. The map-free overlay chrome carries the i18n strings +
 * TalkBack labels (a11y label test); the live `GoogleMap` needs Play Services, so — per the maps-layer testing
 * contract — its render is out of scope here and the pure tile resolution is covered by `MapTileLayerModelTest`
 * in the `testReleaseUnitTest` gate.
 */
class MapTileLayerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private fun strings(): MapTileLayerStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return MapTileLayerStrings(
            mapLabel = ctx.getString(R.string.translation_mapOverview_title),
            loadingLabel = ctx.getString(R.string.translation_a11y_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            fullscreenEnter = ctx.getString(R.string.translation_common_fullscreen_enter),
            fullscreenExit = ctx.getString(R.string.translation_common_fullscreen_exit),
        )
    }

    @Composable
    private fun OverlayHarness(
        projection: MapTileLayerProjection,
        labels: MapTileLayerStrings,
        freshness: MapTileLayerFreshness = MapTileLayerFreshness(),
        onToggleFullscreen: () -> Unit = {},
    ) {
        TeslaSyncTheme(dynamicColor = false) {
            Box(modifier = Modifier.fillMaxWidth().height(MAP_HEIGHT.dp)) {
                MapTileLayerOverlay(
                    projection = projection,
                    strings = labels,
                    freshness = freshness,
                    onToggleFullscreen = onToggleFullscreen,
                    modifier = Modifier.fillMaxSize().padding(8.dp),
                )
            }
        }
    }

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MapTileLayerContent(state = UiState.loading(), style = MapStyleId.Dark)
            }
        }
        compose.onNodeWithTag(MAP_TILE_LAYER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun customProviderOverlayShowsItsAttributionAndFullscreenLabel() {
        val labels = strings()
        compose.setContent {
            OverlayHarness(
                projection = projectMapTileLayer(MapConfig(provider = PROVIDER_AZURE, apiKey = "k"), MapStyleId.Dark),
                labels = labels,
            )
        }
        compose.onNodeWithText(ATTRIBUTION_AZURE).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.fullscreenEnter).assertIsDisplayed()
    }

    @Test
    fun communityDefaultOverlayShowsTheCommunityAttribution() {
        compose.setContent {
            OverlayHarness(
                projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Streets),
                labels = strings(),
            )
        }
        compose.onNodeWithText(ATTRIBUTION_OSM).assertIsDisplayed()
    }

    @Test
    fun staleOverlayShowsTheStaleChip() {
        val labels = strings()
        compose.setContent {
            OverlayHarness(
                projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Dark),
                labels = labels,
                freshness = MapTileLayerFreshness(stale = true),
            )
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineOverlayShowsTheOfflineChip() {
        val labels = strings()
        compose.setContent {
            OverlayHarness(
                projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Dark),
                labels = labels,
                freshness = MapTileLayerFreshness(offline = true),
            )
        }
        compose.onNodeWithText(labels.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun fullscreenControlTogglesWhenTapped() {
        var toggled = false
        val labels = strings()
        compose.setContent {
            OverlayHarness(
                projection = projectMapTileLayer(MapConfig.FREE, MapStyleId.Dark),
                labels = labels,
                onToggleFullscreen = { toggled = true },
            )
        }
        compose.onNodeWithContentDescription(labels.fullscreenEnter).performClick()
        assertTrue(toggled)
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                MapTileLayerContent(
                    state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
                    style = MapStyleId.Dark,
                    onRetry = { retried = true },
                )
            }
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    private companion object {
        const val MAP_HEIGHT = 280
        const val HTTP_SERVER_ERROR = 503
    }
}
