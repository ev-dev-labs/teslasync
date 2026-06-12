// Off-device unit coverage for the BrowserPushChannelCard feature view's pure model (P3 acceptance: adapter +
// per-state + a11y label tests). Exercises the web `disabledReason` cascade + derived `isPushSupported`, the
// status-badge and enable/disable action selection, the `PushRegistrationState` → subscription binding (P1/S8),
// the per-device row projection (the web `rows.map`: order, this-device marker, blank-UA and absent-last-used
// folding), the registered-devices lifecycle classifier the composable switches on (per-state incl.
// stale/offline), the tolerant ISO → relative-age formatter (web `formatRelative`), the i18n key mirrors
// (a11y/label coverage), and the PII-safe `view.opened` diagnostic. No Compose / Android / HTTP — runs in
// :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.browserpushchannelcard

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.push.PushRegistrationState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class BrowserPushChannelCardModelTest {
    private val now: Long = Instant.parse("2023-11-14T22:05:00Z").toEpochMilli()

    @Suppress("LongParameterList") // test fixture builder mirroring the 7-field status value object
    private fun status(
        notifSupported: Boolean = true,
        pushApiSupported: Boolean = true,
        serverConfigured: Boolean? = true,
        keyLoading: Boolean = false,
        permission: BrowserPushPermission = BrowserPushPermission.Granted,
        isSubscribed: Boolean = false,
        currentEndpoint: String? = null,
    ) = BrowserPushChannelStatus(
        notifSupported = notifSupported,
        pushApiSupported = pushApiSupported,
        serverConfigured = serverConfigured,
        keyLoading = keyLoading,
        permission = permission,
        isSubscribed = isSubscribed,
        currentEndpoint = currentEndpoint,
    )

    // ── isPushSupported (web `isPushAPISupported && !!publicKey`) ──

    @Test
    fun isPushSupportedRequiresBothTheApiAndAConfiguredServer() {
        val proj = BrowserPushChannelCardProjection
        assertTrue(proj.isPushSupported(status(pushApiSupported = true, serverConfigured = true)))
        assertFalse(proj.isPushSupported(status(pushApiSupported = true, serverConfigured = false)))
        assertFalse(proj.isPushSupported(status(pushApiSupported = true, serverConfigured = null)))
        assertFalse(proj.isPushSupported(status(pushApiSupported = false, serverConfigured = true)))
    }

    // ── disabledReason cascade (web `disabledReason` IIFE order) ──

    @Test
    fun disabledReasonFollowsTheWebCascadeOrder() {
        val proj = BrowserPushChannelCardProjection
        // 1) notifications unsupported wins over everything.
        assertEquals(
            BrowserPushDisabledReason.NotificationUnsupported,
            proj.disabledReason(status(notifSupported = false, pushApiSupported = false, serverConfigured = false)),
        )
        // 2) push unsupported AND the key finished loading AND it is absent → server not configured.
        assertEquals(
            BrowserPushDisabledReason.ServerDisabled,
            proj.disabledReason(status(pushApiSupported = false, serverConfigured = false, keyLoading = false)),
        )
        // 3) push unsupported but the server IS configured → push API unsupported.
        assertEquals(
            BrowserPushDisabledReason.PushApiUnsupported,
            proj.disabledReason(status(pushApiSupported = false, serverConfigured = true)),
        )
        // 3b) while the key is still loading, the server-disabled branch is skipped → push API unsupported.
        assertEquals(
            BrowserPushDisabledReason.PushApiUnsupported,
            proj.disabledReason(status(pushApiSupported = false, serverConfigured = null, keyLoading = true)),
        )
        // 4) supported but permission denied.
        assertEquals(
            BrowserPushDisabledReason.PermissionDenied,
            proj.disabledReason(status(permission = BrowserPushPermission.Denied)),
        )
        // available → null.
        assertNull(proj.disabledReason(status(permission = BrowserPushPermission.Granted)))
    }

    @Test
    fun disabledReasonCarriesTheWebI18nKey() {
        assertEquals(KEY_UNSUPPORTED_NOTIFICATION, BrowserPushDisabledReason.NotificationUnsupported.key)
        assertEquals(KEY_UNSUPPORTED_SERVER_DISABLED, BrowserPushDisabledReason.ServerDisabled.key)
        assertEquals(KEY_UNSUPPORTED_PUSH_API, BrowserPushDisabledReason.PushApiUnsupported.key)
        assertEquals(KEY_UNSUPPORTED_PERMISSION_DENIED, BrowserPushDisabledReason.PermissionDenied.key)
    }

    @Test
    fun isUnsupportedTracksDisabledReasonPresence() {
        val proj = BrowserPushChannelCardProjection
        assertTrue(proj.isUnsupported(status(notifSupported = false)))
        assertFalse(proj.isUnsupported(status()))
    }

    // ── badge + action selection ──

    @Test
    fun badgeMirrorsTheWebStatusChip() {
        val proj = BrowserPushChannelCardProjection
        assertEquals(BrowserPushBadge.Unsupported, proj.badge(status(notifSupported = false)))
        assertEquals(BrowserPushBadge.Subscribed, proj.badge(status(isSubscribed = true)))
        assertEquals(BrowserPushBadge.NotSubscribed, proj.badge(status(isSubscribed = false)))
    }

    @Test
    fun actionIsDisableWhenSubscribedEnableWhenNotAndNullWhenUnsupported() {
        val proj = BrowserPushChannelCardProjection
        assertEquals(BrowserPushAction.Disable, proj.action(status(isSubscribed = true)))
        assertEquals(BrowserPushAction.Enable, proj.action(status(isSubscribed = false)))
        assertNull(proj.action(status(notifSupported = false)))
    }

    // ── PushRegistrationState binding (P1/S8) ──

    @Test
    fun subscriptionIsProjectedFromTheSharedPushRegistrationState() {
        val proj = BrowserPushChannelCardProjection
        val registered = PushRegistrationState.Registered(registrationId = "reg-1", channelFingerprint = "fp")
        assertTrue(proj.isSubscribed(registered))
        assertEquals("reg-1", proj.currentEndpoint(registered))

        assertFalse(proj.isSubscribed(PushRegistrationState.Unregistered))
        assertNull(proj.currentEndpoint(PushRegistrationState.Unregistered))
        assertFalse(proj.isSubscribed(PushRegistrationState.Registering))
        assertNull(proj.currentEndpoint(PushRegistrationState.Registering))
        assertFalse(proj.isSubscribed(PushRegistrationState.Failed("channel_unavailable")))
        assertNull(proj.currentEndpoint(PushRegistrationState.Failed("channel_unavailable")))
    }

    // ── projectDevices — the adapter (server rows → render-ready rows) ──

    @Test
    fun projectDevicesMapsRowsPreservingOrderWithThisDeviceMarkerAndAge() {
        val age = FreshnessAge.Minutes(5)
        val rows =
            BrowserPushChannelCardProjection.projectDevices(
                rows =
                    listOf(
                        PushSubscriptionRow(id = 1, endpoint = "this", userAgent = "UA-A", lastUsedAt = "2023-11-14T22:00:00Z"),
                        PushSubscriptionRow(id = 2, endpoint = "other", userAgent = "   ", lastUsedAt = null),
                    ),
                currentEndpoint = "this",
                ageOf = { age },
            )
        assertEquals(listOf(1L, 2L), rows.map { it.id })
        assertEquals(
            BrowserPushDeviceRow(
                id = 1,
                endpoint = "this",
                userAgent = "UA-A",
                isThisDevice = true,
                lastUsedAge = age,
            ),
            rows[0],
        )
        // Blank user-agent folds to null; absent last_used_at yields a null age ("Not yet used").
        assertNull(rows[1].userAgent)
        assertFalse(rows[1].isThisDevice)
        assertNull(rows[1].lastUsedAge)
    }

    @Test
    fun projectDevicesMarksNoDeviceWhenThereIsNoCurrentEndpoint() {
        val rows =
            BrowserPushChannelCardProjection.projectDevices(
                rows = listOf(PushSubscriptionRow(id = 1, endpoint = "this", userAgent = "UA", lastUsedAt = null)),
                currentEndpoint = null,
                ageOf = { FreshnessAge.JustNow },
            )
        assertFalse(rows.single().isThisDevice)
    }

    @Test
    fun projectDevicesTreatsEmptyAsTheEmptyState() {
        assertTrue(
            BrowserPushChannelCardProjection
                .projectDevices(emptyList(), currentEndpoint = null, ageOf = { FreshnessAge.JustNow })
                .isEmpty(),
        )
    }

    // ── relative "last used" formatting (web `formatRelative`) ──

    @Test
    fun relativeAgeBucketsLikeTheWebFormatRelative() {
        val t = BrowserPushTimeFormatting
        assertEquals(FreshnessAge.JustNow, t.relativeAge("2023-11-14T22:04:30Z", now))
        assertEquals(FreshnessAge.Minutes(5), t.relativeAge("2023-11-14T22:00:00Z", now))
        assertEquals(FreshnessAge.Hours(2), t.relativeAge("2023-11-14T20:05:00Z", now))
        assertEquals(FreshnessAge.Days(2), t.relativeAge("2023-11-12T22:05:00Z", now))
        assertEquals(FreshnessAge.Weeks(2), t.relativeAge("2023-10-31T22:05:00Z", now))
        // A future stamp clamps to "just now"; a blank stamp is Unknown (em-dash at the boundary).
        assertEquals(FreshnessAge.JustNow, t.relativeAge("2023-11-14T22:10:00Z", now))
        assertEquals(FreshnessAge.Unknown, t.relativeAge("", now))
    }

    @Test
    fun ageSecondsIsTolerantAndGuardsInvalidInput() {
        val t = BrowserPushTimeFormatting
        assertEquals(300L, t.ageSeconds("2023-11-14T22:00:00Z", now))
        // A zoneless local date-time is tolerated (treated as UTC).
        assertEquals(300L, t.ageSeconds("2023-11-14T22:00:00", now))
        // A future stamp yields a negative age.
        assertTrue(t.ageSeconds("2023-11-14T22:10:00Z", now)!! < 0)
        // Blank / unparseable inputs yield null.
        assertNull(t.ageSeconds("", now))
        assertNull(t.ageSeconds("   ", now))
        assertNull(t.ageSeconds("not-a-date", now))
    }

    // ── per-state lifecycle classifier ──

    @Test
    fun devicesSurfaceForMapsLifecycleFlags() {
        assertEquals(BrowserPushDevicesSurface.Loading, browserPushDevicesSurfaceFor(isLoading = true, isError = false))
        assertEquals(BrowserPushDevicesSurface.Error, browserPushDevicesSurfaceFor(isLoading = false, isError = true))
        // Loading wins over error so a refresh-with-skeleton never flashes the error surface.
        assertEquals(BrowserPushDevicesSurface.Loading, browserPushDevicesSurfaceFor(isLoading = true, isError = true))
        assertEquals(BrowserPushDevicesSurface.Ready, browserPushDevicesSurfaceFor(isLoading = false, isError = false))
    }

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(BrowserPushDevicesSurface.Loading, surfaceFor(UiState.loading<List<PushSubscriptionRow>>()))
        val error = UiState<List<PushSubscriptionRow>>(UiPhase.Error, errorKind = ErrorKind.Network)
        assertEquals(BrowserPushDevicesSurface.Error, surfaceFor(error))
        val content = UiState(UiPhase.Content, data = listOf(row()))
        assertEquals(BrowserPushDevicesSurface.Ready, surfaceFor(content))
        val empty = UiState(UiPhase.Empty, data = emptyList<PushSubscriptionRow>())
        assertEquals(BrowserPushDevicesSurface.Ready, surfaceFor(empty))
        // Stale/offline "last known" stays on the Ready surface (cached rows + freshness chip), never blanked.
        val offline =
            UiState(
                UiPhase.Content,
                data = listOf(row()),
                stale = true,
                errorKind = ErrorKind.Network,
            )
        assertEquals(BrowserPushDevicesSurface.Ready, surfaceFor(offline))
        assertTrue(offline.isOffline)
    }

    // ── a11y / i18n key mirrors (every web `t('webpush.*')` key) ──

    @Test
    fun i18nKeyMirrorsFollowTheWebNamespace() {
        assertEquals("translation_webpush_title", KEY_TITLE)
        assertEquals("translation_webpush_subtitle", KEY_SUBTITLE)
        assertEquals("translation_webpush_status_subscribed", KEY_STATUS_SUBSCRIBED)
        assertEquals("translation_webpush_status_notSubscribed", KEY_STATUS_NOT_SUBSCRIBED)
        assertEquals("translation_webpush_status_unsupported", KEY_STATUS_UNSUPPORTED)
        assertEquals("translation_webpush_enable", KEY_ENABLE)
        assertEquals("translation_webpush_disable", KEY_DISABLE)
        assertEquals("translation_webpush_iosNote", KEY_IOS_NOTE)
        assertEquals("translation_webpush_devices_title", KEY_DEVICES_TITLE)
        assertEquals("translation_webpush_devices_lastUsed", KEY_DEVICES_LAST_USED)
        assertEquals("translation_webpush_devices_neverUsed", KEY_DEVICES_NEVER_USED)
        assertEquals("translation_webpush_devices_remove", KEY_DEVICES_REMOVE)
        assertEquals("translation_webpush_devices_thisDevice", KEY_DEVICES_THIS_DEVICE)
        assertEquals("translation_webpush_devices_unknownAgent", KEY_DEVICES_UNKNOWN_AGENT)
    }

    @Test
    fun registrationIdentifiersAreStable() {
        assertEquals("BrowserPushChannelCard", BrowserPushChannelCardRegistration.SLUG)
        assertEquals("browser-push-channel-card", BrowserPushChannelCardRegistration.ID)
    }

    // ── diagnostics (P1/S11 view.opened contract) ──

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordBrowserPushChannelCardOpened(logger)
        assertEquals(1, logger.records.size)
        val (level, event, fields) = logger.records.single()
        assertEquals(LogLevel.Info, level)
        assertEquals("view.opened", event)
        assertEquals(mapOf("surface" to "BrowserPushChannelCard"), fields)
    }

    private fun row(): PushSubscriptionRow = PushSubscriptionRow(id = 1, endpoint = "this", userAgent = "UA", lastUsedAt = null)

    /** Bridges a [UiState] to the composable's classifier the same way `BrowserPushDevicesSection` does. */
    private fun surfaceFor(state: UiState<*>): BrowserPushDevicesSurface =
        browserPushDevicesSurfaceFor(isLoading = state.isLoading, isError = state.isError)

    private data class Record(
        val level: LogLevel,
        val event: String,
        val fields: Map<String, String>,
    )

    private class RecordingLogger : Logger {
        val records = mutableListOf<Record>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += Record(level, event, fields)
        }
    }
}
