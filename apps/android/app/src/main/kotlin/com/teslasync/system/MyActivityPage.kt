// The native Jetpack Compose + Material 3 MyActivityPage system surface — a parity port of
// web/src/features/system/pages/MyActivityPage.tsx, the per-user activity-feed screen mounted at /me/activity. It
// reproduces the web page's header (title + subtitle, web `PageContainer`), the range filter the header carries
// as its action (web `actions={<RangePicker align="end" />}`), and the activity GlassPanel — which switches
// between the audit feed (web `<RecentActivityFeed entries={…} />`), the "Activity feed disabled" 503 state, the
// "Identity required" 401 state, and the "Could not load activity" error state with a Retry action. Every visible
// string resolves from the generated res/values catalog (ADR-014); the feed's loading / empty / content states
// are drawn by the shared RecentActivityFeed surface it delegates to.
//
// Composition: [MyActivityPage] is the stateful entry (constructs the view-model over the host-wired source,
// records the one-shot `view.opened` diagnostic, collects the resolved snapshot + the committed range, and
// threads the range/retry/open-entity seams); [MyActivityPageContent] is the stateless render layer that switches
// the feature-disabled / unauthenticated / error / feed surfaces off the bound [UiState] (the 503 / 401 branches
// keyed on its `httpStatus`, exactly as the web keys on `apiError.status`). The header + panel render together
// (web `PageContainer` children); the panel never collapses to a blank box.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located content + section composables + the strings holder.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.system.myactivity

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PageTitle
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.sharedsurfaces.rangepicker.RangePicker
import io.teslasync.android.sharedsurfaces.rangepicker.RangePickerValue
import io.teslasync.android.sharedsurfaces.recentactivityfeed.RecentActivityFeed
import io.teslasync.android.sharedsurfaces.recentactivityfeed.UserActivityEntry as FeedActivityEntry
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.UserActivityEntry

/**
 * The already-localized microcopy the composable reads from the i18n catalog (P1/S10). The first seven fields map
 * one-to-one to a web `t('activity.myActivity.*')` call; [errorMessage] is the localized server-error body the
 * native surface shows in place of the web's raw `apiError.message` (which would be an un-localizable technical
 * string), and [retry] is the shared `common.retry` label.
 */
data class MyActivityStrings(
    val title: String,
    val subtitle: String,
    val disabledTitle: String,
    val disabledDescription: String,
    val unauthorizedTitle: String,
    val unauthorizedDescription: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

// ── Stateful entry points ───────────────────────────────────────────────────────────────────────────────────

/**
 * Stateful entry: constructs the [MyActivityPageViewModel] over the supplied [source] (the host wires the shared
 * User/Account holder via [myActivityPageSourceOf]). [onOpenEntity] navigates to a tapped feed row's entity (the
 * native analogue of the web `<Link>` click-through); [logger] defaults to the app's redacting logger.
 */
@Composable
fun MyActivityPage(
    source: MyActivityPageSource,
    modifier: Modifier = Modifier,
    onOpenEntity: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: MyActivityPageViewModel =
        viewModel(
            key = MyActivityPageRegistration.SLUG,
            factory = viewModelFactory { initializer { MyActivityPageViewModel(source, logger) } },
        )
    MyActivityPage(viewModel = viewModel, onOpenEntity = onOpenEntity, modifier = modifier)
}

/**
 * Stateful entry: records the one-shot `view.opened` diagnostic (P1/S11), collects the resolved snapshot + the
 * committed range, and hands the stateless content the accessibility pane title (web
 * `usePageTitle(t('activity.myActivity.title'))`).
 */
@Composable
fun MyActivityPage(
    viewModel: MyActivityPageViewModel,
    modifier: Modifier = Modifier,
    onOpenEntity: (String) -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val range by viewModel.range.collectAsStateWithLifecycle()

    val title = stringResource(R.string.translation_activity_myActivity_title)

    MyActivityPageContent(
        state = uiState,
        range = range,
        onRangeChange = viewModel::setRange,
        onRetry = viewModel::retry,
        onOpenEntity = onOpenEntity,
        modifier = modifier.semantics { paneTitle = title },
    )
}

// ── Stateless content ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The stateless page body (web root `PageContainer` column). Renders the always-visible header (title + subtitle
 * + the range filter), then the activity GlassPanel whose body switches off the bound [state]: a 503 surfaces the
 * feature-disabled state, a 401 the identity-required state, any other failure the error+retry state, and
 * otherwise the audit feed (whose loading / empty / content states the shared RecentActivityFeed draws).
 */
@Composable
fun MyActivityPageContent(
    state: UiState<List<UserActivityEntry>>,
    range: RangePickerValue,
    onRangeChange: (RangePickerValue) -> Unit,
    onRetry: () -> Unit,
    onOpenEntity: (String) -> Unit,
    modifier: Modifier = Modifier,
    strings: MyActivityStrings = rememberMyActivityStrings(),
) {
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(Spacing.lg),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        MyActivityHeader(strings = strings, range = range, onRangeChange = onRangeChange)

        FadeIn {
            GlassPanel(padding = PanelPadding.Md) {
                MyActivityBody(
                    state = state,
                    strings = strings,
                    onRetry = onRetry,
                    onOpenEntity = onOpenEntity,
                )
            }
        }
    }
}

/**
 * The page header — the title + subtitle on the left (web `PageContainer` `title` / `subtitle`) and the date
 * range filter pinned to the right (web `actions={<RangePicker align="end" />}`).
 */
@Composable
private fun MyActivityHeader(
    strings: MyActivityStrings,
    range: RangePickerValue,
    onRangeChange: (RangePickerValue) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            PageTitle(strings.title)
            BodyText(strings.subtitle, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        RangePicker(
            value = range,
            onChange = { value, _ -> onRangeChange(value) },
            align = Alignment.End,
        )
    }
}

/**
 * The activity panel body — the native analogue of the web `GlassPanel`'s conditional chain: the feature-disabled
 * (503) and identity-required (401) states are keyed on the read's `httpStatus` (web `apiError.status`), any other
 * failure is the error+retry state (web `apiError ? <EmptyState action=… /> : …`), and otherwise the audit feed
 * renders (web `<RecentActivityFeed entries={entries} />`) — its loading / empty / content states drawn by the
 * shared surface. The shared-core rows are projected to the feed's render shape, dropping the `ip` / `user_agent`
 * PII columns at the boundary.
 */
@Composable
private fun MyActivityBody(
    state: UiState<List<UserActivityEntry>>,
    strings: MyActivityStrings,
    onRetry: () -> Unit,
    onOpenEntity: (String) -> Unit,
) {
    when {
        state.hasError && isFeatureDisabled(state.httpStatus) -> MyActivityDisabled(strings)
        state.hasError && isUnauthenticated(state.httpStatus) -> MyActivityUnauthorized(strings)
        state.hasError -> MyActivityError(strings = strings, onRetry = onRetry)
        else ->
            RecentActivityFeed(
                entries = (state.data ?: emptyList()).map { it.toFeedEntry() },
                isLoading = state.isLoading,
                onOpenEntity = onOpenEntity,
            )
    }
}

/**
 * The feature-disabled (503) surface — web `<EmptyState icon={securityCheck} title={disabled.title}
 * message={disabled.description} />`: the per-user feed is only available behind a ForwardAuth identity provider.
 */
@Composable
private fun MyActivityDisabled(strings: MyActivityStrings) {
    EmptyState(
        icon = MyActivityGlyphs.ShieldCheck,
        title = strings.disabledTitle,
        message = strings.disabledDescription,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The identity-required (401) surface — web `<EmptyState icon={user} title={unauthorized.title}
 * message={unauthorized.description} />`: the request carried no identity header.
 */
@Composable
private fun MyActivityUnauthorized(strings: MyActivityStrings) {
    EmptyState(
        icon = MyActivityGlyphs.User,
        title = strings.unauthorizedTitle,
        message = strings.unauthorizedDescription,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * The hard-error surface — web `<EmptyState icon={warning} title={error.title} message={apiError.message}
 * action={{ label: retry, onClick: refetch }} />`. The localized server-error body stands in for the web's raw
 * technical message so no un-localizable string reaches the UI.
 */
@Composable
private fun MyActivityError(
    strings: MyActivityStrings,
    onRetry: () -> Unit,
) {
    EmptyState(
        icon = MyActivityGlyphs.Warning,
        title = strings.errorTitle,
        message = strings.errorMessage,
        action = EmptyStateAction(label = strings.retry, onClick = onRetry),
        modifier = Modifier.fillMaxWidth(),
    )
}

// ── Render-only helpers ────────────────────────────────────────────────────────────────────────────────────

/**
 * Builds the localized [MyActivityStrings] from the i18n catalog (P1/S10): the seven `activity.myActivity.*` keys
 * the web page reads, the localized server-error body, and the shared `common.retry` label. Remembered against
 * the resolved strings so a locale change re-projects.
 */
@Composable
private fun rememberMyActivityStrings(): MyActivityStrings =
    MyActivityStrings(
        title = stringResource(R.string.translation_activity_myActivity_title),
        subtitle = stringResource(R.string.translation_activity_myActivity_subtitle),
        disabledTitle = stringResource(R.string.translation_activity_myActivity_disabled_title),
        disabledDescription = stringResource(R.string.translation_activity_myActivity_disabled_description),
        unauthorizedTitle = stringResource(R.string.translation_activity_myActivity_unauthorized_title),
        unauthorizedDescription = stringResource(R.string.translation_activity_myActivity_unauthorized_description),
        errorTitle = stringResource(R.string.translation_activity_myActivity_error_title),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retry = stringResource(R.string.translation_common_retry),
    )

/**
 * Projects a shared-core [UserActivityEntry] onto the RecentActivityFeed surface's render shape, dropping the
 * `ip` / `user_agent` PII columns the feed never renders (mirrors the surface's own `AuditLogRow.toActivityEntry`).
 */
private fun UserActivityEntry.toFeedEntry(): FeedActivityEntry =
    FeedActivityEntry(
        id = id,
        ts = ts,
        action = action,
        entityType = entityType,
        entityId = entityId,
        detail = detail,
    )
