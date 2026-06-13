package io.teslasync.android.sharedsurfaces.usercell

import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.presentation.user.User
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the pure [UserCellProjection] + model — the cached → projection adapter test
 * the prompt mandates. Covers the web component's display-name priority and em-dash empty branch
 * (web/src/components/data-display/UserCell.tsx), the cache-then-network freshness fold
 * (loading/content/empty/error/stale/offline), the TalkBack content-description for every state, and the
 * shared QueryError recovery-bucket mapping. No Android, no coroutines.
 */
class UserCellProjectionTest {
    private val strings =
        UserCellStrings(
            unknownLabel = "Unknown user",
            loadingLabel = "Loading",
            staleLabel = "Stale",
            offlineLabel = "Offline",
            title = "Profile",
        )

    private fun content(user: User): UiState<User> = UiState(UiPhase.Content, data = user, fetchedAt = STAMP)

    private fun displayNameOf(user: UserCellUser?): String = UserCellProjection.displayName(user, strings.unknownLabel)

    private fun project(
        state: UiState<User>,
        showEmail: Boolean,
        size: AvatarSize,
    ): UserCellDisplay = UserCellProjection.project(state, showEmail, size, strings.unknownLabel)

    // ── fromUser / isAttributable ────────────────────────────────────────────────────────────────────

    @Test
    fun fromUserMapsTheCurrentUserDocumentAndCollapsesEmptiesToNull() {
        val mapped = UserCellUser.fromUser(User(id = "u1", email = "ada@x.io", displayName = "Ada", avatarUrl = "https://a"))
        assertEquals(UserCellUser(id = "u1", name = "Ada", email = "ada@x.io", avatarUrl = "https://a"), mapped)

        val blank = UserCellUser.fromUser(User())
        assertEquals(UserCellUser(), blank)
        assertFalse(blank.isAttributable)
    }

    @Test
    fun isAttributableTreatsAnyNonEmptyIdentityFieldAsPresent() {
        assertTrue(UserCellUser(id = "x").isAttributable)
        assertTrue(UserCellUser(email = "a@b").isAttributable)
        assertTrue(UserCellUser(name = "Ada").isAttributable)
        // A whitespace-only name is "present" (the web `''` falsy check only rejects empties).
        assertTrue(UserCellUser(name = "   ").isAttributable)
        assertFalse(UserCellUser().isAttributable)
        assertFalse(UserCellUser(id = "", name = "", email = "").isAttributable)
    }

    // ── displayName priority (web name → email local-part → id → unknown) ──────────────────────────────

    @Test
    fun displayNamePrefersTrimmedName() {
        val name = displayNameOf(UserCellUser(name = "  Ada Lovelace  ", email = "ada@x.io", id = "u1"))
        assertEquals("Ada Lovelace", name)
    }

    @Test
    fun displayNameFallsBackToEmailLocalPartWhenNameBlank() {
        val name = displayNameOf(UserCellUser(name = "   ", email = "ada@analytical.engine", id = "u1"))
        assertEquals("ada", name)
    }

    @Test
    fun displayNameUsesWholeEmailWhenItHasNoAtSign() {
        val name = UserCellProjection.displayName(UserCellUser(email = "operator"), strings.unknownLabel)
        assertEquals("operator", name)
    }

    @Test
    fun displayNameFallsBackToIdThenUnknown() {
        assertEquals("auth0|42", UserCellProjection.displayName(UserCellUser(id = "auth0|42"), strings.unknownLabel))
        assertEquals("Unknown user", UserCellProjection.displayName(UserCellUser(name = "  ", email = "", id = ""), strings.unknownLabel))
        assertEquals("Unknown user", UserCellProjection.displayName(null, strings.unknownLabel))
    }

    // ── project: phases + freshness ────────────────────────────────────────────────────────────────────

    @Test
    fun projectLoadingRendersSkeletonPhaseWithNoIdentity() {
        val display = project(UiState.loading(), showEmail = true, size = AvatarSize.Sm)
        assertEquals(UserCellPhase.Loading, display.phase)
        assertNull(display.user)
        assertFalse(display.showEmailLine)
        assertFalse(display.canRetry)
    }

    @Test
    fun projectContentResolvesNameAndOptionalEmail() {
        val user = User(id = "u1", email = "ada@x.io", displayName = "Ada Lovelace")
        val withEmail = project(content(user), showEmail = true, size = AvatarSize.Md)
        assertEquals(UserCellPhase.Content, withEmail.phase)
        assertEquals("Ada Lovelace", withEmail.displayName)
        assertEquals("ada@x.io", withEmail.email)
        assertTrue(withEmail.showEmailLine)
        assertEquals(AvatarSize.Md, withEmail.size)

        val noEmail = project(content(user), showEmail = false, size = AvatarSize.Sm)
        assertFalse(noEmail.showEmailLine)
    }

    @Test
    fun projectEmptyWhenUserHasNoAttributableIdentity() {
        val display =
            UserCellProjection.project(
                UiState(UiPhase.Empty, data = User(), fetchedAt = STAMP),
                showEmail = true,
                size = AvatarSize.Sm,
                unknownLabel = strings.unknownLabel,
            )
        assertEquals(UserCellPhase.Empty, display.phase)
        assertFalse(display.showEmailLine)
        assertFalse(display.showFreshnessChip)
    }

    @Test
    fun projectHardErrorWithNoCacheRendersErrorPhaseWithRetry() {
        val display =
            UserCellProjection.project(
                UiState(UiPhase.Error, errorKind = ErrorKind.Http, httpStatus = HTTP_SERVER_ERROR),
                showEmail = false,
                size = AvatarSize.Sm,
                unknownLabel = strings.unknownLabel,
            )
        assertEquals(UserCellPhase.Error, display.phase)
        assertTrue(display.canRetry)
        assertEquals(QueryErrorKind.ServerError, UserCellProjection.queryErrorKind(display))
    }

    @Test
    fun projectStaleRefreshingFlagsStaleNotOffline() {
        val display =
            UserCellProjection.project(
                UiState(UiPhase.Content, data = User(displayName = "Ada"), stale = true, refreshing = true, fetchedAt = STAMP),
                showEmail = false,
                size = AvatarSize.Sm,
                unknownLabel = strings.unknownLabel,
            )
        assertTrue(display.stale)
        assertFalse(display.offline)
        assertTrue(display.refreshing)
        assertTrue(display.showFreshnessChip)
    }

    @Test
    fun projectCachedAfterFailedRefreshFlagsOfflineNotStale() {
        val display =
            UserCellProjection.project(
                UiState(UiPhase.Content, data = User(displayName = "Ada"), stale = true, errorKind = ErrorKind.Network, fetchedAt = STAMP),
                showEmail = false,
                size = AvatarSize.Sm,
                unknownLabel = strings.unknownLabel,
            )
        assertFalse(display.stale)
        assertTrue(display.offline)
        assertTrue(display.showFreshnessChip)
    }

    // ── contentDescription (a11y) ──────────────────────────────────────────────────────────────────────

    @Test
    fun contentDescriptionAnnouncesEachStateForTalkBack() {
        val base = UserCellDisplay(UserCellPhase.Loading, null, "Unknown user", null, false, AvatarSize.Sm)
        assertEquals("Loading", UserCellProjection.contentDescription(base, strings))
        assertEquals("Unknown user", UserCellProjection.contentDescription(base.copy(phase = UserCellPhase.Empty), strings))
        assertEquals("Profile", UserCellProjection.contentDescription(base.copy(phase = UserCellPhase.Error), strings))

        val content =
            base.copy(phase = UserCellPhase.Content, user = UserCellUser(name = "Ada"), displayName = "Ada", email = "ada@x.io")
        assertEquals("Ada", UserCellProjection.contentDescription(content, strings))
        assertEquals("Ada, ada@x.io", UserCellProjection.contentDescription(content.copy(showEmailLine = true), strings))
    }

    // ── queryErrorKind mapping ─────────────────────────────────────────────────────────────────────────

    @Test
    fun queryErrorKindMapsEveryFailureClass() {
        fun kindFor(
            errorKind: ErrorKind?,
            status: Int? = null,
        ): QueryErrorKind {
            val display =
                UserCellDisplay(
                    phase = UserCellPhase.Error,
                    user = null,
                    displayName = "Unknown user",
                    email = null,
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                    errorKind = errorKind,
                    httpStatus = status,
                )
            return UserCellProjection.queryErrorKind(display)
        }

        assertEquals(QueryErrorKind.Waiting, kindFor(ErrorKind.CircuitOpen))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Network))
        assertEquals(QueryErrorKind.Network, kindFor(ErrorKind.Timeout))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_UNAUTHORIZED))
        assertEquals(QueryErrorKind.Unauthorized, kindFor(ErrorKind.Http, HTTP_FORBIDDEN))
        assertEquals(QueryErrorKind.NotFound, kindFor(ErrorKind.Http, HTTP_NOT_FOUND))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Http, HTTP_SERVER_ERROR))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Decode))
        assertEquals(QueryErrorKind.ServerError, kindFor(ErrorKind.Unknown))
        assertEquals(QueryErrorKind.ServerError, kindFor(null))
    }

    private companion object {
        const val STAMP = 1_700_000_000_000L
        const val HTTP_UNAUTHORIZED = 401
        const val HTTP_FORBIDDEN = 403
        const val HTTP_NOT_FOUND = 404
        const val HTTP_SERVER_ERROR = 503
    }
}
