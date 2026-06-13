package io.teslasync.android.sharedsurfaces.reloadprompt

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the ReloadPrompt shared surface across every state the
 * web component renders (web/src/components/feedback/ReloadPrompt.tsx): the loading skeleton, the Available
 * banner (heading + countdown announced as one polite live label, with both actions), the dismissed banner
 * (manual reload only), the explicit "up to date" empty state, the stale/offline freshness chips, and the
 * classified error with a working Retry. The stateful path is exercised end to end against the real ViewModel
 * + source seam, forwarding the reload to the host. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class ReloadPromptUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): ReloadPromptStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return ReloadPromptStrings(
            title = ctx.getString(R.string.translation_pwa_newVersion),
            later = ctx.getString(R.string.translation_pwa_later),
            reloadNow = ctx.getString(R.string.translation_pwa_reloadNow),
            upToDate = ctx.getString(R.string.translation_widget_upToDate),
            loadingLabel = ctx.getString(R.string.translation_a11y_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
        )
    }

    private fun reloadingIn(seconds: Int): String =
        InstrumentationRegistry
            .getInstrumentation()
            .targetContext
            .getString(R.string.translation_pwa_reloadingIn, seconds.toString())

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ReloadPromptContent(display = ReloadPromptDisplay(phase = ReloadPromptPhase.Loading), strings = labels)
            }
        }
        compose.onNodeWithTag(RELOAD_PROMPT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun availableStateAnnouncesTheHeadingAndCountdownTogether() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ReloadPromptContent(
                        display =
                            ReloadPromptDisplay(
                                phase = ReloadPromptPhase.Available,
                                version = "0.2.0",
                                countdownSeconds = 3,
                                autoReloadArmed = true,
                            ),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithContentDescription("${labels.title}. ${reloadingIn(3)}").assertIsDisplayed()
    }

    @Test
    fun availableStateShowsBothActions() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ReloadPromptContent(
                        display =
                            ReloadPromptDisplay(
                                phase = ReloadPromptPhase.Available,
                                version = "0.2.0",
                                autoReloadArmed = true,
                            ),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithText(labels.later).assertIsDisplayed()
        compose.onNodeWithText(labels.reloadNow).assertIsDisplayed()
    }

    @Test
    fun dismissedAvailableStateKeepsOnlyTheManualReload() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ReloadPromptContent(
                        display =
                            ReloadPromptDisplay(
                                phase = ReloadPromptPhase.Available,
                                version = "0.2.0",
                                autoReloadArmed = false,
                                dismissed = true,
                            ),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithText(labels.reloadNow).assertIsDisplayed()
        compose.onNodeWithText(labels.later).assertDoesNotExist()
    }

    @Test
    fun upToDateStateAnnouncesUpToDate() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ReloadPromptContent(display = ReloadPromptDisplay(phase = ReloadPromptPhase.UpToDate), strings = labels)
            }
        }
        compose.onNodeWithTag(RELOAD_PROMPT_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.upToDate).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ReloadPromptContent(
                        display =
                            ReloadPromptDisplay(
                                phase = ReloadPromptPhase.Available,
                                version = "0.2.0",
                                autoReloadArmed = true,
                                stale = true,
                                refreshing = true,
                            ),
                        strings = labels,
                    )
                }
            }
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ReloadPromptContent(
                    display =
                        ReloadPromptDisplay(
                            phase = ReloadPromptPhase.UpToDate,
                            offline = true,
                            errorKind = ErrorKind.Network,
                        ),
                    strings = labels,
                )
            }
        }
        compose.onNodeWithText(labels.offlineLabel).assertIsDisplayed()
    }

    @Test
    fun errorStateOffersAWorkingRetry() {
        var retried = false
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                ReloadPromptContent(
                    display =
                        ReloadPromptDisplay(
                            phase = ReloadPromptPhase.Error,
                            errorKind = ErrorKind.Http,
                            httpStatus = HTTP_SERVER_ERROR,
                        ),
                    strings = strings(),
                    onRetry = { retried = true },
                )
            }
        }
        compose.onNodeWithText("Retry").assertIsDisplayed()
        compose.onNodeWithText("Retry").performClick()
        assertTrue(retried)
    }

    @Test
    fun statefulReloadPromptForwardsTheReloadToTheHost() {
        var reloaded = false
        val source = staticReloadPromptSource(ReloadAvailability(updateAvailable = true, version = "0.2.0"))
        val vm = ReloadPromptViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    ReloadPrompt(viewModel = vm, onReload = { reloaded = true })
                }
            }
        }
        compose.waitForIdle()
        val reloadLabel =
            InstrumentationRegistry.getInstrumentation().targetContext.getString(R.string.translation_pwa_reloadNow)
        compose.onNodeWithText(reloadLabel).performClick()
        compose.waitForIdle()
        assertTrue(reloaded)
    }

    private companion object {
        const val HTTP_SERVER_ERROR = 503
    }
}
