// Instrumented Compose UI + accessibility verification of [ShareDriveDialogContent] across the branches the web
// component renders (web/src/features/driving/components/ShareDriveDialog.tsx): the create form (every labelled control
// present — the a11y label test), the Generate hand-off (the assembled request from the typed form), the created-link
// result panel (the URL + copy / open / create-another actions), the existing-links content rows (title, view count,
// the Expired / No-expiry status, copy + revoke), the revoke hand-off, the empty state, the loading spinner, and the
// error retry surface. Runs under `connectedAndroidTest` (a device/emulator); the offline gate's `testReleaseUnitTest`
// covers the pure model + the ViewModel orchestration.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.sharedrivedialog

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.dp
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.shared.core.presentation.sharing.CreateShareRequest
import io.teslasync.shared.core.presentation.sharing.ShareToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ShareDriveDialogUiTest {
    @get:Rule
    val compose = createComposeRule()

    private val strings =
        ShareDriveDialogStrings(
            title = "Share Drive",
            close = "Close",
            description = "Generate a public link to share this drive report.",
            titleHint = "Optional title",
            includeSpeed = "Include speed data",
            includeTelemetry = "Include detailed telemetry (battery, power)",
            expiryLabel = "Link expires after",
            expiry7d = "7 days",
            expiry30d = "30 days",
            expiry90d = "90 days",
            expiryNever = "Never",
            generate = "Generate Link",
            created = "Share link created!",
            copy = "Copy Link",
            copied = "Copied!",
            copyLink = "Copy link",
            createAnother = "Create another link",
            openLink = "Open",
            existing = "Active Share Links",
            untitled = "Untitled share",
            views = "views",
            expired = "Expired",
            noExpiry = "No expiry",
            revoke = "Revoke",
            emptyMessage = "No active share links",
            loading = "Loading",
            refresh = "Refresh",
        )

    private fun row(
        token: String,
        title: String?,
        views: Int,
        expiresAt: String?,
    ): ShareToken =
        ShareToken(
            id = token.hashCode().toLong(),
            token = token,
            driveId = 7L,
            title = title,
            includeMap = true,
            includeTelemetry = false,
            includeSpeed = true,
            views = views,
            expiresAt = expiresAt,
            createdAt = "2025-01-01T00:00:00Z",
        )

    private fun setContent(
        sharesState: UiState<List<ShareToken>> = UiState(UiPhase.Content, data = emptyList(), fetchedAt = NOW),
        createdToken: String? = null,
        creating: Boolean = false,
        revoking: Set<String> = emptySet(),
        onCreate: (CreateShareRequest) -> Unit = {},
        onCreateAnother: () -> Unit = {},
        onRevoke: (String) -> Unit = {},
        onRefresh: () -> Unit = {},
        onOpenLink: (String) -> Unit = {},
    ) {
        compose.setContent {
            TeslaSyncTheme(dynamicColor = false) {
                Host {
                    ShareDriveDialogContent(
                        strings = strings,
                        sharesState = sharesState,
                        creating = creating,
                        createdToken = createdToken,
                        revoking = revoking,
                        onCreate = onCreate,
                        onCreateAnother = onCreateAnother,
                        onRevoke = onRevoke,
                        onRefresh = onRefresh,
                        onOpenLink = onOpenLink,
                        shareBaseUrl = "https://teslasync.example",
                        nowProvider = { NOW },
                    )
                }
            }
        }
    }

    @Test
    fun createForm_everyControlExposesItsLabel() {
        setContent()
        compose.onNodeWithText(strings.description, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.titleHint, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.includeSpeed).assertIsDisplayed()
        compose.onNodeWithText(strings.includeTelemetry).assertIsDisplayed()
        compose.onNodeWithText(strings.expiryLabel, substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.generate).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithText(strings.existing).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.refresh).assertIsDisplayed().assertHasClickAction()
    }

    @Test
    fun generate_buildsRequestFromTheTypedForm() {
        var request: CreateShareRequest? = null
        setContent(onCreate = { request = it })

        compose.onNodeWithText(strings.titleHint, substring = true).performTextInput("SF to LA")
        compose.onNodeWithText(strings.generate).performClick()

        assertEquals("SF to LA", request?.title)
        assertEquals(true, request?.includeSpeed)
        assertEquals(false, request?.includeTelemetry)
        assertEquals(30, request?.expiresInDays)
    }

    @Test
    fun createdResult_showsTheUrlAndActions() {
        var another = false
        setContent(createdToken = "tok-xyz", onCreateAnother = { another = true })

        compose.onNodeWithText(strings.created).assertIsDisplayed()
        compose.onNodeWithText("https://teslasync.example/s/tok-xyz", substring = true).assertIsDisplayed()
        compose.onNodeWithText(strings.copy).assertIsDisplayed().assertHasClickAction()
        compose.onNodeWithContentDescription(strings.openLink).assertIsDisplayed().assertHasClickAction()

        compose.onNodeWithText(strings.createAnother).performClick()
        assertTrue(another)
    }

    @Test
    fun existingRows_showViewsExpiryStatusesAndRevoke() {
        var revoked: String? = null
        setContent(
            sharesState =
                UiState(
                    UiPhase.Content,
                    data =
                        listOf(
                            row("alive", title = "Road Trip", views = 12, expiresAt = null),
                            row("dead", title = null, views = 0, expiresAt = "2000-01-01T00:00:00Z"),
                        ),
                    fetchedAt = NOW,
                ),
            onRevoke = { revoked = it },
        )

        compose.onNodeWithText("Road Trip").assertIsDisplayed()
        compose.onNodeWithText(strings.untitled).assertIsDisplayed()
        compose.onNodeWithText("12 ${strings.views}").assertIsDisplayed()
        compose.onNodeWithText(strings.noExpiry).assertIsDisplayed()
        compose.onNodeWithText(strings.expired).assertIsDisplayed()

        compose.onNodeWithContentDescription(strings.revoke).performClick()
        assertEquals("alive", revoked)
    }

    @Test
    fun emptyState_rendersWhenThereAreNoLinks() {
        setContent(sharesState = UiState(UiPhase.Empty, data = emptyList(), fetchedAt = NOW))
        compose.onNodeWithText(strings.emptyMessage).assertIsDisplayed()
    }

    @Test
    fun loadingState_showsTheSpinner() {
        setContent(sharesState = UiState.loading())
        compose.onNodeWithContentDescription(strings.loading).assertIsDisplayed()
    }

    @Test
    fun errorState_offersARetryAffordance() {
        var refreshed = false
        setContent(
            sharesState = UiState(UiPhase.Error, data = null, errorKind = ErrorKind.Network),
            onRefresh = { refreshed = true },
        )

        compose.onNodeWithText(strings.existing).assertIsDisplayed()
        compose.onNodeWithContentDescription(strings.refresh).performClick()
        assertTrue(refreshed)
    }

    @Composable
    private fun Host(content: @Composable () -> Unit) {
        Box(modifier = Modifier.size(width = HOST_WIDTH, height = HOST_HEIGHT)) { content() }
    }

    private companion object {
        const val NOW = 1_700_000_000_000L
        val HOST_WIDTH = 420.dp
        val HOST_HEIGHT = 1400.dp
    }
}
