package io.teslasync.android.featureviews.redisdiagnosticemptystate

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.teslasync.android.ui.theme.TeslaSyncTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of [RedisDiagnosticEmptyStateContent] across every
 * branch the surface renders: the pre-meta legacy empty state, the four error banners (cache-not-wired,
 * unreachable, request-failed, network), and the four meta-driven banners (mode-local, mirror-broken,
 * no-telemetry, empty fall-through), plus the always-present meta list and the tappable "other vehicles"
 * chips. Asserts the rendered i18n strings, the interpolated values, the docs-CTA wiring, and the
 * TalkBack labels. Runs under `connectedAndroidTest`; the offline `testReleaseUnitTest` gate covers the
 * pure projection. Mirrors the web spec (web/src/features/admin/components/RedisDiagnosticEmptyState.tsx).
 */
class RedisDiagnosticEmptyStateUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val metaHybrid =
        RedisSignalsMeta(
            liveSignalStoreMode = "hybrid",
            redisKey = "vehicle:7:signals",
            redisFieldCount = 0,
            l1SignalCount = 0,
            l1LastSeenAt = null,
            l2LastSeenAt = null,
            vehicleVin = "TESLA1234567890",
        )

    private val sampleOtherKeys =
        listOf(
            RedisSignalKeyEntry(vehicleId = 1, fieldCount = 230, vehicleVin = "VIN1", displayName = "Falcon"),
            RedisSignalKeyEntry(vehicleId = 12, fieldCount = 142, vehicleVin = "VIN12", displayName = "Phoenix"),
        )

    private fun setContent(
        state: RedisDiagnosticState,
        onSelectVehicle: (Int) -> Unit = {},
        onOpenDocs: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                RedisDiagnosticEmptyStateContent(
                    state = state,
                    onSelectVehicle = onSelectVehicle,
                    onOpenDocs = onOpenDocs,
                )
            }
        }
    }

    @Test
    fun legacyEmptyShowsGenericMessageAndNoBanner() {
        setContent(RedisDiagnosticState.LegacyEmpty)
        compose.onNodeWithText("No signals cached for this vehicle").assertIsDisplayed()
        compose.onNodeWithTag(REDIS_DIAGNOSTIC_BANNER_TEST_TAG).assertDoesNotExist()
    }

    @Test
    fun legacyEmptyExposesAccessibleMessage() {
        setContent(RedisDiagnosticState.LegacyEmpty)
        // EmptyState folds its message into a TalkBack content description.
        compose.onNodeWithContentDescription("No signals cached for this vehicle").assertIsDisplayed()
    }

    @Test
    fun cacheNotWiredBannerShowsTitleAndDocsCta() {
        var opened: String? = null
        setContent(
            state = RedisDiagnosticState.Banner(DiagnosticKind.CacheNotWired, metaHybrid),
            onOpenDocs = { opened = it },
        )
        compose.onNodeWithTag(REDIS_DIAGNOSTIC_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Redis cache is not configured").assertIsDisplayed()
        compose.onNodeWithText("See cache configuration docs").assertIsDisplayed().performClick()
        assertEquals("/docs/caching#configuration", opened)
    }

    @Test
    fun modeLocalBannerShowsTitleAndContractDocsCta() {
        var opened: String? = null
        setContent(
            state = RedisDiagnosticState.Banner(DiagnosticKind.ModeLocal, metaHybrid.copy(liveSignalStoreMode = "local")),
            onOpenDocs = { opened = it },
        )
        compose.onNodeWithText("Redis L2 writes are disabled").assertIsDisplayed()
        compose.onNodeWithText("See live-state contract docs").performClick()
        assertEquals("/docs/caching", opened)
    }

    @Test
    fun mirrorBrokenBannerInterpolatesL1Count() {
        setContent(
            RedisDiagnosticState.Banner(
                kind = DiagnosticKind.MirrorBroken,
                meta = metaHybrid.copy(l1SignalCount = 42),
                otherKeys = sampleOtherKeys,
            ),
        )
        compose.onNodeWithText("L2 mirror is failing").assertIsDisplayed()
        compose.onNodeWithText("has 42 signals", substring = true).assertIsDisplayed()
    }

    @Test
    fun noTelemetryAbsentBannerShowsAbsentBody() {
        setContent(RedisDiagnosticState.Banner(DiagnosticKind.NoTelemetry, metaHybrid.copy(l1LastSeenAt = null)))
        compose.onNodeWithText("No recent telemetry for this vehicle").assertIsDisplayed()
        compose.onNodeWithText("has no L1 entries on this pod", substring = true).assertIsDisplayed()
    }

    @Test
    fun noTelemetryStaleBannerShowsTtlBody() {
        setContent(
            RedisDiagnosticState.Banner(
                DiagnosticKind.NoTelemetry,
                metaHybrid.copy(l1LastSeenAt = "2026-01-01T00:00:00Z"),
            ),
        )
        compose.onNodeWithText("7-day Redis TTL has likely expired", substring = true).assertIsDisplayed()
    }

    @Test
    fun requestFailedBannerShowsStatusAndMessage() {
        setContent(
            RedisDiagnosticState.Banner(
                kind = DiagnosticKind.RequestFailed,
                meta = null,
                requestStatus = 500,
                requestMessage = "database query failed",
            ),
        )
        compose.onNodeWithText("Could not load Redis signals").assertIsDisplayed()
        compose.onNodeWithText("500", substring = true).assertIsDisplayed()
        compose.onNodeWithText("database query failed", substring = true).assertIsDisplayed()
    }

    @Test
    fun networkErrorBannerShowsTitle() {
        setContent(RedisDiagnosticState.Banner(DiagnosticKind.NetworkError, meta = null))
        compose.onNodeWithText("Cannot reach the API server").assertIsDisplayed()
    }

    @Test
    fun emptyFallthroughBannerShowsNeutralTitle() {
        setContent(RedisDiagnosticState.Banner(DiagnosticKind.Empty, metaHybrid, sampleOtherKeys))
        compose.onNodeWithTag(REDIS_DIAGNOSTIC_BANNER_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("No signals cached for this vehicle").assertIsDisplayed()
    }

    @Test
    fun metaListShowsKeyCountsAndVin() {
        setContent(RedisDiagnosticState.Banner(DiagnosticKind.Empty, metaHybrid, sampleOtherKeys))
        compose.onNodeWithText("Redis key").assertIsDisplayed()
        compose.onNodeWithText("vehicle:7:signals").assertIsDisplayed()
        compose.onNodeWithText("L1 signals").assertIsDisplayed()
        compose.onNodeWithText("L2 fields (raw)").assertIsDisplayed()
        compose.onNodeWithText("VIN").assertIsDisplayed()
        compose.onNodeWithText("TESLA1234567890").assertIsDisplayed()
    }

    @Test
    fun otherVehiclesChipsRenderAndInvokeCallback() {
        var selected = -1
        setContent(
            state = RedisDiagnosticState.Banner(DiagnosticKind.Empty, metaHybrid, sampleOtherKeys),
            onSelectVehicle = { selected = it },
        )
        compose.onNodeWithTag(REDIS_DIAGNOSTIC_OTHER_VEHICLES_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithText("Falcon").assertIsDisplayed()
        compose.onNodeWithText("Phoenix").assertIsDisplayed()
        compose.onNodeWithTag(redisDiagnosticOtherVehicleTestTag(1)).performClick()
        assertEquals(1, selected)
    }

    @Test
    fun otherVehiclesSectionHiddenWhenNoKeys() {
        setContent(RedisDiagnosticState.Banner(DiagnosticKind.Empty, metaHybrid, otherKeys = emptyList()))
        compose.onNodeWithTag(REDIS_DIAGNOSTIC_OTHER_VEHICLES_TEST_TAG).assertDoesNotExist()
    }
}
