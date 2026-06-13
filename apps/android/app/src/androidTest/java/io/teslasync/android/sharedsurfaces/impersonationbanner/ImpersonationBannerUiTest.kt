package io.teslasync.android.sharedsurfaces.impersonationbanner

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.impersonation.ImpersonationStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ImpersonationBanner shared surface across every state
 * the web component renders (web/src/components/feedback/ImpersonationBanner.tsx): the active amber bar (title +
 * body + live countdown + End button), the End-button click contract, the in-flight "Ending…" disabled button,
 * the loading skeleton, the hard error with a working Retry, the stale/offline freshness chips, and the hidden
 * (not-impersonating) state that renders nothing. The bar exposes a merged TalkBack announcement (a11y label
 * test). Runs under `connectedAndroidTest`; the `testReleaseUnitTest` gate covers the pure projection, this
 * covers the render.
 */
class ImpersonationBannerUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): ImpersonationBannerStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return ImpersonationBannerStrings(
            title = { ctx.getString(R.string.translation_impersonation_banner_title, it) },
            body = ctx.getString(R.string.translation_impersonation_banner_body),
            end = ctx.getString(R.string.translation_impersonation_banner_end),
            ending = ctx.getString(R.string.translation_impersonation_banner_ending),
            endsIn = { ctx.getString(R.string.translation_impersonation_banner_endsIn, it) },
            expired = ctx.getString(R.string.translation_impersonation_banner_expired),
            loadingLabel = ctx.getString(R.string.translation_common_loading),
            errorTitle = ctx.getString(R.string.translation_error_serverError_title),
            errorMessage = ctx.getString(R.string.translation_error_serverError_message),
            retry = ctx.getString(R.string.translation_common_retry),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
        )
    }

    private fun activeState(
        stale: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<ImpersonationBannerView> =
        UiState(
            phase = UiPhase.Content,
            data = ImpersonationBannerView(ImpersonationMode.Active, target = "alice", expiresAt = EXPIRES),
            stale = stale,
            errorKind = errorKind,
            fetchedAt = NOW,
        )

    private fun setContent(
        state: UiState<ImpersonationBannerView>,
        ending: Boolean = false,
        onEnd: () -> Unit = {},
        onRetry: () -> Unit = {},
    ) {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ImpersonationBannerContent(
                        state = state,
                        ending = ending,
                        nowMillis = NOW,
                        onEnd = onEnd,
                        onRetry = onRetry,
                        strings = labels,
                    )
                }
            }
        }
    }

    @Test
    fun activeSessionShowsTheTitleBodyCountdownAndEndButton() {
        setContent(activeState())
        compose.onNodeWithTag(BANNER_TAG).assertIsDisplayed()
        compose.onNodeWithText("Impersonating alice").assertIsDisplayed()
        compose.onNodeWithTag(COUNTDOWN_TAG).assertIsDisplayed()
        compose.onNodeWithText("Expires in 5m 25s").assertIsDisplayed()
        compose.onNodeWithTag(END_TAG).assertIsDisplayed()
        compose.onNodeWithText("End impersonation").assertIsDisplayed()
    }

    @Test
    fun activeSessionExposesAMergedAccessibilityAnnouncement() {
        setContent(activeState())
        compose.onNodeWithContentDescription("Impersonating alice", substring = true).assertIsDisplayed()
    }

    @Test
    fun clickingEndFiresTheEndCallback() {
        var ended = false
        setContent(activeState(), onEnd = { ended = true })
        compose.onNodeWithTag(END_TAG).performClick()
        assertTrue(ended)
    }

    @Test
    fun endingShowsTheEndingLabelAndDisablesTheButton() {
        setContent(activeState(), ending = true)
        compose.onNodeWithText("Ending\u2026").assertIsDisplayed()
        compose.onNodeWithTag(END_TAG).assertIsNotEnabled()
    }

    @Test
    fun expiredSessionShowsTheSessionExpiredLine() {
        setContent(
            UiState(
                phase = UiPhase.Content,
                data = ImpersonationBannerView(ImpersonationMode.Active, target = "alice", expiresAt = PAST_EXPIRES),
                fetchedAt = NOW,
            ),
        )
        compose.onNodeWithText("Session expired").assertIsDisplayed()
    }

    @Test
    fun loadingShowsAnAccessibleSkeletonBar() {
        setContent(UiState.loading())
        compose.onNodeWithTag(BANNER_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription("Loading...").assertIsDisplayed()
    }

    @Test
    fun errorShowsAWorkingRetry() {
        var retried = false
        setContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = { retried = true })
        compose.onNodeWithText("Server error").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun staleSessionShowsTheStaleChip() {
        setContent(activeState(stale = true))
        compose.onNodeWithText("Stale").assertIsDisplayed()
        compose.onNodeWithTag(END_TAG).assertIsDisplayed()
    }

    @Test
    fun offlineSessionShowsTheOfflineChip() {
        setContent(activeState(stale = true, errorKind = ErrorKind.Network))
        compose.onNodeWithText("Offline").assertIsDisplayed()
    }

    @Test
    fun inactiveSessionRendersNothing() {
        setContent(UiState(phase = UiPhase.Empty, data = ImpersonationBannerView(ImpersonationMode.Inactive)))
        compose.onNodeWithTag(BANNER_TAG).assertDoesNotExist()
    }

    @Test
    fun statefulBannerBindsTheActiveSessionAndRenders() {
        val source =
            object : ImpersonationBannerSource {
                override val status: StateFlow<Resource<ImpersonationStatus>> =
                    MutableStateFlow(
                        Resource.Success(
                            ImpersonationStatus.Active(originalAdmin = "admin", target = "alice", expiresAt = EXPIRES),
                            fetchedAt = NOW,
                            stale = false,
                        ),
                    )

                override suspend fun endImpersonation(): Result<Unit> = Result.success(Unit)

                override fun refresh() = Unit
            }
        val vm = ImpersonationBannerViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ImpersonationBanner(viewModel = vm)
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithText("Impersonating alice").assertIsDisplayed()
    }

    private companion object {
        const val BANNER_TAG = "impersonation-banner"
        const val END_TAG = "impersonation-banner-end"
        const val COUNTDOWN_TAG = "impersonation-banner-countdown"
        const val EXPIRES = "2026-01-01T00:05:25Z"
        const val PAST_EXPIRES = "2026-01-01T00:00:00Z"
        const val NOW = 1_767_225_600_000L
    }
}
