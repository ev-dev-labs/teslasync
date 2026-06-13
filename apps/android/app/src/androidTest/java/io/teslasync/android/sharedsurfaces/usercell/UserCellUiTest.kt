package io.teslasync.android.sharedsurfaces.usercell

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.User
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * On-device Compose UI + accessibility verification of the UserCell shared surface across every state the
 * web component renders (web/src/components/data-display/UserCell.tsx): the loading skeleton, the avatar +
 * name content (with and without the email line), the empty em-dash branch surfaced as a friendly TalkBack
 * label (never a bare dash), the stale/offline freshness chips, and the classified error with a working
 * Retry. The identity is exposed as a single content description (a11y label test); the stateful path is
 * exercised end to end against the real ViewModel + source seam. Runs under `connectedAndroidTest`; the
 * `testReleaseUnitTest` gate covers the pure projection, this covers the render.
 */
class UserCellUiTest {
    @get:Rule
    val compose = createComposeRule()

    private object NoopLogger : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

    private fun strings(): UserCellStrings {
        val ctx = InstrumentationRegistry.getInstrumentation().targetContext
        return UserCellStrings(
            unknownLabel = ctx.getString(R.string.translation_avatar_unknown),
            loadingLabel = ctx.getString(R.string.translation_a11y_loading),
            staleLabel = ctx.getString(R.string.translation_mqtt_stale),
            offlineLabel = ctx.getString(R.string.translation_common_offline),
            title = ctx.getString(R.string.translation_teslaAccount_profile),
        )
    }

    private fun display(
        phase: UserCellPhase,
        displayName: String = "Ada Lovelace",
        email: String? = "ada@analytical.engine",
        showEmailLine: Boolean = false,
        stale: Boolean = false,
        offline: Boolean = false,
        errorKind: ErrorKind? = null,
        httpStatus: Int? = null,
    ): UserCellDisplay =
        UserCellDisplay(
            phase = phase,
            user = UserCellUser(id = "u1", name = displayName, email = email),
            displayName = displayName,
            email = email,
            showEmailLine = showEmailLine,
            size = AvatarSize.Sm,
            stale = stale,
            offline = offline,
            errorKind = errorKind,
            httpStatus = httpStatus,
        )

    @Test
    fun loadingStateAnnouncesTheLoadingLabel() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(display = display(UserCellPhase.Loading), strings = labels)
            }
        }
        compose.onNodeWithTag(USER_CELL_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.loadingLabel).assertIsDisplayed()
    }

    @Test
    fun contentStateExposesTheNameAsAnAccessibilityLabel() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(display = display(UserCellPhase.Content), strings = strings())
            }
        }
        compose.onNodeWithContentDescription("Ada Lovelace").assertIsDisplayed()
    }

    @Test
    fun contentWithEmailAnnouncesNameAndEmailTogether() {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(display = display(UserCellPhase.Content, showEmailLine = true), strings = strings())
            }
        }
        compose.onNodeWithContentDescription("Ada Lovelace, ada@analytical.engine").assertIsDisplayed()
    }

    @Test
    fun emptyStateAnnouncesUnknownUserNotABareDash() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(display = display(UserCellPhase.Empty, displayName = labels.unknownLabel, email = null), strings = labels)
            }
        }
        compose.onNodeWithTag(USER_CELL_TEST_TAG).assertIsDisplayed()
        compose.onNodeWithContentDescription(labels.unknownLabel).assertIsDisplayed()
    }

    @Test
    fun staleStateShowsTheStaleFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(display = display(UserCellPhase.Content, stale = true), strings = labels)
            }
        }
        compose.onNodeWithText(labels.staleLabel).assertIsDisplayed()
    }

    @Test
    fun offlineStateShowsTheOfflineFreshnessChip() {
        val labels = strings()
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                UserCellContent(
                    display = display(UserCellPhase.Content, offline = true, errorKind = ErrorKind.Network),
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
                UserCellContent(
                    display = display(UserCellPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
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
    fun statefulUserCellBindsTheCurrentUserAndRendersContent() {
        val source =
            UserCellSource {
                MutableStateFlow(
                    Resource.Success(
                        User(id = "u9", email = "grace@navy.mil", displayName = "Grace Hopper"),
                        fetchedAt = STAMP,
                        stale = false,
                    ),
                )
            }
        val vm = UserCellViewModel(source, NoopLogger)
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                CompositionLocalProvider(LocalReducedMotion provides true) {
                    UserCell(viewModel = vm)
                }
            }
        }
        compose.waitForIdle()
        compose.onNodeWithContentDescription("Grace Hopper").assertIsDisplayed()
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_SERVER_ERROR = 503
    }
}
