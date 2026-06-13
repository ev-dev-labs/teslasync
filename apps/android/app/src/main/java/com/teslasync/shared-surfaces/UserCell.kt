// The native Jetpack Compose + Material 3 UserCell shared surface — a parity port of
// web/src/components/data-display/UserCell.tsx. The web component is a tiny presentational cell for
// user-attributed columns: it renders the shared Avatar beside a display name with an optional muted email
// line, or an em dash when the user has no identity worth showing. This native surface keeps that contract
// end to end and renders every state the prompt's matrix mandates without ever hiding a region: loading (the
// first current-user fetch's skeleton), content (the avatar + name), empty (the em dash — the web
// `!name && !email && !id` branch), a hard error with Retry, and a stale/offline freshness chip over a
// cached identity.
//
// It performs NO HTTP and binds the current-user document only through the shared S8/S7 User seam
// ([UserCellSource]) folded through [UserCellViewModel] + the pure [UserCellProjection]; the composable
// resolves the i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns, using
// the shared component library (ui GlassPanel/StatusPill/typography, datadisplay Avatar, feedback
// QueryError/Skeleton, motion FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on
// first composition. The atomic `datadisplay/UserCell` is the bare inline cell (component-library bundle,
// out of scope); this surface is the state-aware identity card built around the same Avatar.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/UserCell) cannot form a valid Kotlin package. `MatchingDeclarationName` is
// suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.usercell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.Avatar
import io.teslasync.android.components.datadisplay.AvatarKind
import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered cell in any state. */
const val USER_CELL_TEST_TAG: String = "user-cell"

/**
 * Stateful entry point — the parity port of the web `<UserCell user={me} … />`. Binds the shared current-user
 * feed via [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition, collects
 * the [io.teslasync.android.data.UiState], projects it together with the caller's [showEmail] + avatar [size]
 * preferences (the web props), auto-refreshes a stale cache, and renders.
 *
 * @param viewModel the state holder bound to the shared S8 UserStore / S7 UserRepository seam.
 * @param showEmail when true, renders the email beneath the name (web `showEmail`, default false).
 * @param size the avatar size (web `size`, default `sm`).
 */
@Composable
fun UserCell(
    viewModel: UserCellViewModel,
    modifier: Modifier = Modifier,
    showEmail: Boolean = false,
    size: AvatarSize = AvatarSize.Sm,
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val strings = rememberUserCellStrings()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val display =
        remember(state, showEmail, size, strings.unknownLabel) {
            UserCellProjection.project(state, showEmail, size, strings.unknownLabel)
        }

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        UserCellContent(display = display, strings = strings, onRetry = viewModel::retry)
    }
}

/**
 * Stateless UserCell card — renders every branch the web source draws plus the current-user document's
 * lifecycle: a loading skeleton, the avatar + name (+ optional email), the empty em dash, and the classified
 * error with retry, with a stale/offline freshness chip over a cached identity. Hoisted out of the ViewModel
 * so it is preview- and screenshot-testable for each state.
 */
@Composable
fun UserCellContent(
    display: UserCellDisplay,
    strings: UserCellStrings,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth().testTag(USER_CELL_TEST_TAG), padding = PanelPadding.Md) {
        when (display.phase) {
            UserCellPhase.Loading -> UserCellLoading(display = display, strings = strings)
            UserCellPhase.Error ->
                QueryError(
                    kind = UserCellProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
            UserCellPhase.Content, UserCellPhase.Empty -> UserCellIdentity(display = display, strings = strings)
        }
    }
}

@Composable
private fun UserCellIdentity(
    display: UserCellDisplay,
    strings: UserCellStrings,
) {
    val spoken = UserCellProjection.contentDescription(display, strings)
    val isContent = display.phase == UserCellPhase.Content
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(
            userId = display.user?.id,
            name = if (isContent) display.displayName else null,
            size = display.size,
            kind = AvatarKind.User,
            contentDescription = null,
        )
        Column(
            modifier =
                Modifier
                    .weight(1f, fill = false)
                    .clearAndSetSemantics { contentDescription = spoken },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            if (isContent) {
                BodyText(display.displayName, maxLines = 1)
            } else {
                BodyText(UserCellRegistration.EMPTY_VALUE, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (display.showEmailLine) {
                display.email?.let { Caption(it) }
            }
        }
        if (display.showFreshnessChip) {
            UserCellFreshnessChip(display = display, strings = strings)
        }
    }
}

@Composable
private fun UserCellFreshnessChip(
    display: UserCellDisplay,
    strings: UserCellStrings,
) {
    if (display.offline) {
        StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
    } else {
        StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
    }
}

@Composable
private fun UserCellLoading(
    display: UserCellDisplay,
    strings: UserCellStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = strings.loadingLabel },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val avatarSize = avatarSkeletonSize(display.size)
        Skeleton(modifier = Modifier.size(avatarSize), rounded = true, height = avatarSize)
        Column(
            modifier = Modifier.weight(1f, fill = false),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Skeleton(widthFraction = NAME_SKELETON_FRACTION, height = NAME_SKELETON_HEIGHT)
            Skeleton(widthFraction = EMAIL_SKELETON_FRACTION, height = EMAIL_SKELETON_HEIGHT)
        }
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberUserCellStrings(): UserCellStrings =
    UserCellStrings(
        unknownLabel = stringResource(R.string.translation_avatar_unknown),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
        title = stringResource(R.string.translation_teslaAccount_profile),
    )

/** Avatar skeleton diameter per [AvatarSize] — mirrors the private dimensions of the shared Avatar. */
private fun avatarSkeletonSize(size: AvatarSize): Dp =
    when (size) {
        AvatarSize.Xs -> 16.dp
        AvatarSize.Sm -> 24.dp
        AvatarSize.Md -> 32.dp
        AvatarSize.Lg -> 48.dp
    }

private const val NAME_SKELETON_FRACTION = 0.5f
private const val EMAIL_SKELETON_FRACTION = 0.35f
private val NAME_SKELETON_HEIGHT = 14.dp
private val EMAIL_SKELETON_HEIGHT = 10.dp

// ── Previews — one per rendered state (loading / content / content + email / empty / stale / offline /
// error). ─────────────────────────────────────────────────────────────────────────────────────────────

private fun previewStrings(): UserCellStrings =
    UserCellStrings(
        unknownLabel = "Unknown user",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
        title = "Profile",
    )

private fun previewUser(): UserCellUser = UserCellUser(id = "auth0|42", name = "Ada Lovelace", email = "ada@analytical.engine")

@Preview(name = "UserCell · loading", showBackground = true)
@Composable
private fun UserCellLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Loading,
                    user = null,
                    displayName = "Unknown user",
                    email = null,
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · content", showBackground = true)
@Composable
private fun UserCellContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Content,
                    user = previewUser(),
                    displayName = "Ada Lovelace",
                    email = "ada@analytical.engine",
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · content + email", showBackground = true)
@Composable
private fun UserCellContentEmailPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Content,
                    user = previewUser(),
                    displayName = "Ada Lovelace",
                    email = "ada@analytical.engine",
                    showEmailLine = true,
                    size = AvatarSize.Md,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · empty", showBackground = true)
@Composable
private fun UserCellEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Empty,
                    user = null,
                    displayName = "Unknown user",
                    email = null,
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · stale", showBackground = true)
@Composable
private fun UserCellStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Content,
                    user = previewUser(),
                    displayName = "Ada Lovelace",
                    email = "ada@analytical.engine",
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                    stale = true,
                    refreshing = true,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · offline", showBackground = true)
@Composable
private fun UserCellOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Content,
                    user = previewUser(),
                    displayName = "Ada Lovelace",
                    email = "ada@analytical.engine",
                    showEmailLine = true,
                    size = AvatarSize.Sm,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewStrings(),
        )
    }
}

@Preview(name = "UserCell · error", showBackground = true)
@Composable
private fun UserCellErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        UserCellContent(
            display =
                UserCellDisplay(
                    phase = UserCellPhase.Error,
                    user = null,
                    displayName = "Unknown user",
                    email = null,
                    showEmailLine = false,
                    size = AvatarSize.Sm,
                    errorKind = ErrorKind.Http,
                    httpStatus = HTTP_SERVER_ERROR,
                ),
            strings = previewStrings(),
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
