// The native Jetpack Compose + Material 3 TeslaAccountPage system surface — a parity port of
// web/src/features/system/pages/TeslaAccountPage.tsx, the Tesla-account profile screen mounted at
// /tesla-account. It reproduces the web page's header (title + subtitle, web `PageContainer`), the sync bar (the
// "Last synced …" / "Never synced …" status line + the Refresh action), and the profile GlassPanel — which, when
// a profile is present, shows the avatar (the image-attributed representation or the no-image frame) beside a
// Name / Email / Fetched-At list, and otherwise the no-profile empty state. Every visible string resolves from
// the generated res/values catalog (ADR-014); the two date faces format at the render boundary via the shared
// model (web `formatRelative` for the sync age, web `formatDateTime` for the Fetched-At stamp).
//
// Composition: [TeslaAccountPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the resolved snapshot + the refresh in-flight flag, and
// threads the refresh/retry seams); [TeslaAccountPageContent] is the stateless render layer that switches the
// loading / error / (success | empty) surfaces off the bound [UiState]. The sync bar + profile panel render
// together whenever data is available (web `PageContainer` children); a first load with nothing cached shows the
// loading spinner, a hard read failure with no cache shows the error-retry surface (web `PageContainer`
// loading / error props).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the strings holder.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.teslaaccount

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.Avatar
import io.teslasync.android.components.datadisplay.AvatarSize
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaProfileEnvelope
import java.time.ZoneId
import java.util.Locale

/** The web `<FadeIn delay={0.05}>` profile-card entrance delay, in milliseconds. */
private const val PROFILE_FADE_DELAY_MS: Int = 50

/** Avatar diameter — the web `h-20 w-20` frame, kept in step across the image / no-image branches. */
private val AVATAR_SIZE: Dp = 56.dp

/** Avatar ring width — the web `border-2`. */
private val AVATAR_BORDER_WIDTH: Dp = 2.dp

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). The first eleven fields
 * map one-to-one to a web `t('teslaAccount.*')` call; the rest are the loading / error chrome the
 * cache-then-network lifecycle implies (web `PageContainer` loading / error).
 */
data class TeslaAccountStrings(
    val title: String,
    val subtitle: String,
    val lastSynced: String,
    val neverSynced: String,
    val refresh: String,
    val profile: String,
    val avatar: String,
    val name: String,
    val email: String,
    val fetchedAt: String,
    val noProfile: String,
    val loading: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [TeslaAccountPageViewModel] over the supplied [source] (the host wires the
 * shared User/Account holder via [teslaAccountPageSourceOf]). [logger] defaults to the app's redacting logger.
 */
@Composable
fun TeslaAccountPage(
    source: TeslaAccountPageSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: TeslaAccountPageViewModel =
        viewModel(
            key = TeslaAccountPageRegistration.SLUG,
            factory = viewModelFactory { initializer { TeslaAccountPageViewModel(source, logger) } },
        )
    TeslaAccountPage(viewModel = viewModel, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot + the
 * refresh in-flight flag, and hands the stateless content the accessibility pane title (web
 * `usePageTitle(t('teslaAccount.title'))`).
 */
@Composable
fun TeslaAccountPage(
    viewModel: TeslaAccountPageViewModel,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val refreshing by viewModel.refreshing.collectAsStateWithLifecycle()

    val title = stringResource(R.string.translation_teslaAccount_title)

    TeslaAccountPageContent(
        state = uiState,
        refreshing = refreshing || uiState.refreshing,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the always-visible header, then switches the
 * body off the bound [state]: a first load with nothing cached shows the loading spinner (web `PageContainer`
 * `loading`); a hard read failure with no cache shows the error-retry surface (web `PageContainer` `error`);
 * otherwise the sync bar + profile panel render together (web `PageContainer` children), the panel itself
 * switching between the populated detail list and the no-profile empty state.
 */
@Composable
fun TeslaAccountPageContent(
    state: UiState<TeslaProfileEnvelope>,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    zone: ZoneId = ZoneId.systemDefault(),
    locale: Locale = Locale.getDefault(),
    nowMillis: Long = System.currentTimeMillis(),
    strings: TeslaAccountStrings = rememberTeslaAccountStrings(),
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        TeslaAccountHeader(strings = strings)

        when {
            state.isLoading -> TeslaAccountLoading(strings = strings)
            state.isError -> TeslaAccountError(onRetry = onRetry, strings = strings)
            else -> {
                TeslaAccountSyncBar(
                    envelope = state.data,
                    refreshing = refreshing,
                    onRefresh = onRefresh,
                    zone = zone,
                    locale = locale,
                    nowMillis = nowMillis,
                    strings = strings,
                )
                TeslaAccountProfileCard(
                    view = TeslaAccountProjection.profileView(state.data),
                    zone = zone,
                    locale = locale,
                    strings = strings,
                )
            }
        }
    }
}

/** The page header — the title + subtitle the web `PageContainer` renders (web `teslaAccount.title` / `.subtitle`). */
@Composable
private fun TeslaAccountHeader(strings: TeslaAccountStrings) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        PageTitle(strings.title)
        BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The sync bar — the "Last synced …" / "Never synced …" status line on the left (web `formatRelative`) and the
 * Refresh action on the right (web `<Button>` with the spinning `RefreshCw` while pending). Always visible once
 * data is available, exactly as the web renders it above the profile card.
 */
@Composable
private fun TeslaAccountSyncBar(
    envelope: TeslaProfileEnvelope?,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    zone: ZoneId,
    locale: Locale,
    nowMillis: Long,
    strings: TeslaAccountStrings,
) {
    val formatSyncedAge = rememberSyncedFormatter()
    val fetchedAt = envelope?.fetchedAt
    val statusText =
        if (!fetchedAt.isNullOrBlank()) {
            val age = TeslaAccountProjection.relativeSynced(fetchedAt, nowMillis, zone, locale)
            strings.lastSynced.format(if (age != null) formatSyncedAge(age) else EM_DASH)
        } else {
            strings.neverSynced
        }

    FadeIn {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HelperText(statusText, modifier = Modifier.weight(1f))
            Button(
                label = strings.refresh,
                onClick = onRefresh,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
                loading = refreshing,
                leadingIcon = TeslaAccountGlyphs.Refresh,
            )
        }
    }
}

/**
 * The profile card (GlassPanel1) — a "Profile" heading above either the populated avatar + detail list (web
 * `profile ?`) or the no-profile empty state. The panel is always rendered with a fallback so it never collapses
 * to a blank box (the web `profile ? … : <EmptyState/>` split).
 */
@Composable
private fun TeslaAccountProfileCard(
    view: TeslaProfileView?,
    zone: ZoneId,
    locale: Locale,
    strings: TeslaAccountStrings,
) {
    FadeIn(delayMs = PROFILE_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                SectionTitle(strings.profile)
                if (view != null) {
                    TeslaAccountProfileDetails(view = view, zone = zone, locale = locale, strings = strings)
                } else {
                    TeslaAccountEmpty(strings = strings)
                }
            }
        }
    }
}

/** The populated profile — the avatar beside the Name / Email / Fetched-At list (web `flex items-start gap-6`). */
@Composable
private fun TeslaAccountProfileDetails(
    view: TeslaProfileView,
    zone: ZoneId,
    locale: Locale,
    strings: TeslaAccountStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.Top,
    ) {
        TeslaAccountAvatar(view = view, contentDescription = strings.avatar)
        KVList(
            items =
                listOf(
                    KVItem(label = strings.name, value = view.fullName),
                    KVItem(label = strings.email, value = view.email),
                    KVItem(
                        label = strings.fetchedAt,
                        value = TeslaAccountProjection.formatFetchedAt(view.fetchedAtIso, zone, locale),
                    ),
                ),
            modifier = Modifier.weight(1f),
        )
    }
}

/**
 * The avatar — the image-attributed representation when a profile image exists (web `<img>` with the
 * "Profile picture" alt), or the bordered no-image frame with the [TeslaAccountGlyphs.ImageOff] glyph when it
 * does not (web `<ImageOff/>`). Both carry the same [contentDescription] so the region is named in either branch.
 */
@Composable
private fun TeslaAccountAvatar(
    view: TeslaProfileView,
    contentDescription: String,
) {
    if (view.imageUrl != null) {
        Avatar(
            name = view.fullName,
            size = AvatarSize.Lg,
            contentDescription = contentDescription,
        )
    } else {
        Box(
            modifier =
                Modifier
                    .size(AVATAR_SIZE)
                    .clip(CircleShape)
                    .border(AVATAR_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                    .semantics { this.contentDescription = contentDescription },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                TeslaAccountGlyphs.ImageOff,
                contentDescription = null,
                size = IconSize.Lg,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/** The no-profile empty state — web `<EmptyState icon={User} message={teslaAccount.noProfile} />`. */
@Composable
private fun TeslaAccountEmpty(strings: TeslaAccountStrings) {
    EmptyState(
        message = strings.noProfile,
        icon = TeslaAccountGlyphs.User,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** First-load spinner — the web `PageContainer` `loading` chrome; never a blank region. */
@Composable
private fun TeslaAccountLoading(strings: TeslaAccountStrings) {
    Box(
        modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.xl3),
        contentAlignment = Alignment.Center,
    ) {
        Spinner(size = SpinnerSize.Lg, label = strings.loading)
    }
}

/** Hard-error surface with a retry affordance — the web `PageContainer` `error` chrome. */
@Composable
private fun TeslaAccountError(
    onRetry: () -> Unit,
    strings: TeslaAccountStrings,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Render-only helpers ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [TeslaAccountStrings] from the i18n catalog (P1/S10): the eleven `teslaAccount.*` keys the
 * web page reads, plus the loading / error chrome. Remembered against the resolved strings so a locale change
 * re-projects.
 */
@Composable
private fun rememberTeslaAccountStrings(): TeslaAccountStrings =
    TeslaAccountStrings(
        title = stringResource(R.string.translation_teslaAccount_title),
        subtitle = stringResource(R.string.translation_teslaAccount_subtitle),
        lastSynced = stringResource(R.string.translation_teslaAccount_lastSynced),
        neverSynced = stringResource(R.string.translation_teslaAccount_neverSynced),
        refresh = stringResource(R.string.translation_teslaAccount_refresh),
        profile = stringResource(R.string.translation_teslaAccount_profile),
        avatar = stringResource(R.string.translation_teslaAccount_avatar),
        name = stringResource(R.string.translation_teslaAccount_name),
        email = stringResource(R.string.translation_teslaAccount_email),
        fetchedAt = stringResource(R.string.translation_teslaAccount_fetchedAt),
        noProfile = stringResource(R.string.translation_teslaAccount_noProfile),
        loading = stringResource(R.string.translation_common_loading),
        errorTitle = stringResource(R.string.translation_error_serverError_title),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retry = stringResource(R.string.translation_common_retry),
    )

/**
 * Localized relative-age formatter for the sync bar — maps each [SyncedAge] bucket to its catalog phrase
 * (`freshness.*`, the same keys the sibling freshness chips use), so the web `formatRelative` output is fully
 * localized rather than English microcopy. The over-a-week [SyncedAge.AbsoluteDate] tail is already a
 * locale-formatted date string.
 */
@Composable
private fun rememberSyncedFormatter(): (SyncedAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return { age ->
        when (age) {
            SyncedAge.JustNow -> justNow
            is SyncedAge.Minutes -> minutes.format(age.count)
            is SyncedAge.Hours -> hours.format(age.count)
            is SyncedAge.Days -> days.format(age.count)
            is SyncedAge.AbsoluteDate -> age.value
        }
    }
}
