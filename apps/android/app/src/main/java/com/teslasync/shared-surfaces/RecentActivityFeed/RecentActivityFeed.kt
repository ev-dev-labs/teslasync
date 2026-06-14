// The native Jetpack Compose + Material 3 view for the RecentActivityFeed shared surface — the parity port of
// the web `RecentActivityFeed` component (web/src/components/data-display/RecentActivityFeed.tsx). Its data
// layer (the [UserActivityEntry] render shape, the [getActivityVisual] registry, the [entityHref] routing, the
// [activityTime] bucketing, the [RecentActivityFeedState] holder, and the [RecentActivityFeedDiagnostics]
// event) lives in RecentActivityFeedModel.kt; the marker glyphs in RecentActivityFeedGlyphs.kt.
//
// Web parity, branch for branch: the web component renders an `<EmptyState>` with the history icon and the
// localized "No recent activity in this window." message when `entries.length === 0`, otherwise a `<Timeline>`
// whose rows it derives — a tinted marker glyph + the localized action title (a cyan link when the entity is
// routable, else plain text), an `entity_type · entity_id — detail` subtitle, and the right-pinned
// `formatRelative(ts)` timestamp. The native port reproduces each piece: the empty branch is the shared
// [EmptyState]; the populated branch is the shared [Timeline], one [TimelineEntry] per projected
// [RecentActivityRow], with the glyph resolved through [RecentActivityFeedGlyphs], the accent through the fixed
// [ActivityAccent] palette, the title through the P1/S10 catalog, and the timestamp through the localized
// relative/absolute formatter.
//
// Lifecycle states (P3 tier mandate, on top of the web's empty/content): the host binds the feed as a
// [UiState] via the P1/S8 [RecentActivityFeedState], so the surface also renders a loading skeleton, a
// hard-error retry surface ([ErrorDisplay], the web `QueryError` equivalent), and a freshness chip
// ([DataFreshness]) for the stale ("last known", auto-refreshing) and offline branches — exactly as the
// accepted sibling AutomationActivityFeed port does. No decorative panel wraps the feed, because the web
// surface has none (its parent owns the panel). A web-parity overload taking the raw `entries` (+ optional
// `emptyMessage`) is provided for hosts that already hold the loaded list.
//
// Data binding: the view performs NO HTTP. The stateful entry collects the holder's [UiState] with
// `collectAsStateWithLifecycle` and forwards an `onRetry` (the host's refetch) and an `onOpenEntity` (the
// host's navigator, the native analogue of the web `<Link to={href}>`). Diagnostics: one PII-safe
// `view.opened` (P1/S11) fires on first composition.
//
// Accessibility: each populated row is a single merged TalkBack node leading with the localized action title,
// then the subtitle and timestamp; routable rows are a 48 dp tappable target (the native analogue of the web
// title link — making the whole row tappable is the Material idiom and a larger touch target than a cyan word,
// a deliberate, documented adaptation per Honesty Covenant #9). The loading surface carries the localized
// "loading" description, the error surface a labelled retry button, and the freshness chip a spoken relative
// age. All copy resolves through the P1/S10 catalog — no English literals.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/RecentActivityFeed) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.recentactivityfeed

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** Loading skeleton rows — the web `isLoading` skeleton-row count. */
private const val SKELETON_ROWS: Int = 5

/** Skeleton row height. */
private val SKELETON_ROW_HEIGHT: Dp = 40.dp

/** Test tag for the feed container — lets a UI test assert the surface mounted. */
const val RECENT_ACTIVITY_FEED_TAG: String = "recent-activity-feed"

/** Test tag for the loading skeleton column. */
const val RECENT_ACTIVITY_LOADING_TAG: String = "recent-activity-loading"

/**
 * Stateful entry point — binds the P1/S8 [RecentActivityFeedState] and renders every lifecycle state its
 * [UiState] feed carries. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11). The host owns the
 * fetch and supplies [onRetry] (its refetch) and [onOpenEntity] (its navigator); this view never performs HTTP.
 *
 * @param state the cache-then-network feed the surface binds to.
 * @param onOpenEntity invoked with a route (e.g. `/vehicles/3`) when a routable row is tapped (web `<Link>`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param emptyMessage overrides the empty-state copy (web `emptyMessage` prop); defaults to the catalog string.
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun RecentActivityFeed(
    state: RecentActivityFeedState,
    modifier: Modifier = Modifier,
    onOpenEntity: (String) -> Unit = {},
    onRetry: () -> Unit = {},
    emptyMessage: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RecentActivityFeedDiagnostics.recordViewOpened(logger) }
    val ui by state.state.collectAsStateWithLifecycle()
    RecentActivityFeedContent(
        state = ui,
        onOpenEntity = onOpenEntity,
        onRetry = onRetry,
        modifier = modifier,
        emptyMessage = emptyMessage,
    )
}

/**
 * Web-parity overload mirroring the web component's props (`entries`, `emptyMessage`) for hosts that already
 * hold the loaded list. Maps them onto a [UiState] — [isLoading] shows the loading surface, an empty [entries]
 * the empty state (web `entries.length === 0`), else the rows. Records `view.opened` like the stateful entry;
 * there is no fetch behind it, so it offers no retry affordance.
 *
 * @param onOpenEntity invoked with a route when a routable row is tapped (the native analogue of `<Link>`).
 */
@Composable
fun RecentActivityFeed(
    entries: List<UserActivityEntry>,
    modifier: Modifier = Modifier,
    emptyMessage: String? = null,
    isLoading: Boolean = false,
    onOpenEntity: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { RecentActivityFeedDiagnostics.recordViewOpened(logger) }
    val state =
        remember(entries, isLoading) {
            val phase =
                when {
                    isLoading -> UiPhase.Loading
                    entries.isEmpty() -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = entries)
        }
    RecentActivityFeedContent(
        state = state,
        onOpenEntity = onOpenEntity,
        onRetry = {},
        modifier = modifier,
        emptyMessage = emptyMessage,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview seam. Reproduces the web component's
 * empty / content branches and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, and a freshness chip that reflects refreshing / stale / offline. Stale (non-error)
 * data auto-refreshes via [onRetry], mirroring the web freshness contract. [nowMillis] anchors the relative
 * "time ago", [locale]/[zoneId] the absolute-date fall-through.
 */
@Composable
fun RecentActivityFeedContent(
    state: UiState<List<UserActivityEntry>>,
    onOpenEntity: (String) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    emptyMessage: String? = null,
    nowMillis: Long = System.currentTimeMillis(),
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val formatTime = rememberActivityTimeFormatter(locale, zoneId)
    val formatAge = rememberFreshnessFormatter()
    val muted = MaterialTheme.colorScheme.onSurfaceVariant

    Column(
        modifier = modifier.fillMaxWidth().testTag(RECENT_ACTIVITY_FEED_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (shouldShowFreshness(state)) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                DataFreshness(
                    updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                    isFetching = state.refreshing,
                    isStale = state.stale,
                    isError = state.hasError,
                    fetchingLabel = stringResource(R.string.translation_common_loading),
                    errorLabel = stringResource(R.string.translation_common_offline),
                    formatAge = formatAge,
                )
            }
        }
        when {
            state.isLoading -> RecentActivityLoading()
            state.isError -> RecentActivityError(onRetry = onRetry)
            else -> {
                val entries = state.data ?: emptyList()
                val rows = entries.toRows(nowMillis)
                if (rows.isEmpty()) {
                    RecentActivityEmpty(message = emptyMessage)
                } else {
                    val items =
                        rows.map { row ->
                            TimelineEntry(
                                title = stringResource(actionLabelRes(row.titleKey)),
                                time = formatTime(row.time),
                                subtitle = row.subtitle,
                                icon = RecentActivityFeedGlyphs.resolve(row.glyph),
                                accent = row.accent.argb?.let { Color(it) } ?: muted,
                                onClick = row.href?.let { href -> { onOpenEntity(href) } },
                            )
                        }
                    Timeline(items = items, modifier = Modifier.fillMaxWidth())
                }
            }
        }
    }
}

/** First-load skeleton — five shimmering rows so the surface is never blank (web `isLoading` branch). */
@Composable
private fun RecentActivityLoading() {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(RECENT_ACTIVITY_LOADING_TAG)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROWS) { Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true) }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun RecentActivityError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_activity_myActivity_error_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Empty state — the web `<EmptyState>` with the history icon and the "No recent activity…" message. */
@Composable
private fun RecentActivityEmpty(message: String?) {
    EmptyState(
        message = message ?: stringResource(R.string.translation_activity_myActivity_empty),
        icon = DataDisplayGlyphs.History,
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Localized relative-age formatter (`translation_freshness_*`), shared by the row "time ago" (under seven
 * days) and the freshness chip — the same render-only concern the sibling surfaces resolve.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> EM_DASH
                FreshnessAge.JustNow -> justNow
                is FreshnessAge.Seconds -> seconds.format(age.value)
                is FreshnessAge.Minutes -> minutes.format(age.value)
                is FreshnessAge.Hours -> hours.format(age.value)
                is FreshnessAge.Days -> days.format(age.value)
                is FreshnessAge.Weeks -> weeks.format(age.value)
            }
        }
    }
}

/**
 * Formats an [ActivityTime] for display — a relative bucket under seven days (web "Nm/Nh/Nd ago") or a
 * localized absolute date beyond (web `formatDate` fall-through), with [EM_DASH] for an unknown timestamp.
 */
@Composable
private fun rememberActivityTimeFormatter(
    locale: Locale,
    zoneId: ZoneId,
): (ActivityTime) -> String {
    val formatAge = rememberFreshnessFormatter()
    val dateFormatter =
        remember(locale, zoneId) {
            DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).withZone(zoneId)
        }
    return remember(formatAge, dateFormatter) {
        { time ->
            when (time) {
                ActivityTime.Unknown -> EM_DASH
                is ActivityTime.Relative -> formatAge(time.age)
                is ActivityTime.Absolute -> dateFormatter.format(Instant.ofEpochMilli(time.epochMillis))
            }
        }
    }
}

/** Maps a web action i18n key to its Android string resource — the catalog the registry's `labelKey` names. */
private fun actionLabelRes(key: String): Int = ACTION_LABEL_RES[key] ?: R.string.translation_activity_action_unknown

/** True when the freshness chip should show: a refresh is running, or data is stale, or it is offline. */
private fun shouldShowFreshness(state: UiState<List<UserActivityEntry>>): Boolean =
    state.refreshing || state.stale || (state.hasError && state.hasData)

/**
 * The web `activity.action.*` i18n key -> `R.string.translation_activity_action_*` catalog mapping. Kept as a
 * map (not a `when`) so the resolver stays a one-liner within the detekt complexity budget for non-composables.
 */
private val ACTION_LABEL_RES: Map<String, Int> =
    mapOf(
        "activity.action.vehicleCommand" to R.string.translation_activity_action_vehicleCommand,
        "activity.action.vehicleCommandWake" to R.string.translation_activity_action_vehicleCommandWake,
        "activity.action.vehicleCommandHonk" to R.string.translation_activity_action_vehicleCommandHonk,
        "activity.action.vehicleCommandFlash" to R.string.translation_activity_action_vehicleCommandFlash,
        "activity.action.vehicleCommandLock" to R.string.translation_activity_action_vehicleCommandLock,
        "activity.action.vehicleCommandUnlock" to R.string.translation_activity_action_vehicleCommandUnlock,
        "activity.action.vehicleCommandClimate" to R.string.translation_activity_action_vehicleCommandClimate,
        "activity.action.vehicleCommandCharge" to R.string.translation_activity_action_vehicleCommandCharge,
        "activity.action.settingsUpdate" to R.string.translation_activity_action_settingsUpdate,
        "activity.action.settings" to R.string.translation_activity_action_settings,
        "activity.action.alertRuleCreate" to R.string.translation_activity_action_alertRuleCreate,
        "activity.action.alertRuleUpdate" to R.string.translation_activity_action_alertRuleUpdate,
        "activity.action.alertRuleDelete" to R.string.translation_activity_action_alertRuleDelete,
        "activity.action.alert" to R.string.translation_activity_action_alert,
        "activity.action.automationCreate" to R.string.translation_activity_action_automationCreate,
        "activity.action.automationUpdate" to R.string.translation_activity_action_automationUpdate,
        "activity.action.automationDelete" to R.string.translation_activity_action_automationDelete,
        "activity.action.automation" to R.string.translation_activity_action_automation,
        "activity.action.dashboardLayoutSave" to R.string.translation_activity_action_dashboardLayoutSave,
        "activity.action.dashboard" to R.string.translation_activity_action_dashboard,
        "activity.action.dataExportCreate" to R.string.translation_activity_action_dataExportCreate,
        "activity.action.dataExport" to R.string.translation_activity_action_dataExport,
        "activity.action.apiKeyCreate" to R.string.translation_activity_action_apiKeyCreate,
        "activity.action.apiKeyUpdate" to R.string.translation_activity_action_apiKeyUpdate,
        "activity.action.apiKeyDelete" to R.string.translation_activity_action_apiKeyDelete,
        "activity.action.apiKey" to R.string.translation_activity_action_apiKey,
        "activity.action.authLogin" to R.string.translation_activity_action_authLogin,
        "activity.action.authLogout" to R.string.translation_activity_action_authLogout,
        "activity.action.auth" to R.string.translation_activity_action_auth,
        "activity.action.unknown" to R.string.translation_activity_action_unknown,
    )

// ── Previews (tooling only — invoked by Android Studio, never from code) ───────────────────────────────────

private val PREVIEW_ENTRIES: List<UserActivityEntry> =
    listOf(
        UserActivityEntry(1, "2026-06-14T12:29:30Z", "vehicle.command.wake", "vehicle", "3", "Model 3"),
        UserActivityEntry(2, "2026-06-14T11:30:00Z", "charging_session.start", "charging_session", "88", null),
        UserActivityEntry(3, "2026-06-12T09:00:00Z", "alert.rule.create", "alert_rule", "12", "Low battery"),
        UserActivityEntry(4, "2026-05-30T09:00:00Z", "auth.login", null, null, null),
    )

@Preview(name = "RecentActivityFeed · content", showBackground = true)
@Composable
private fun RecentActivityFeedContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityFeedContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_ENTRIES),
            onOpenEntity = {},
            onRetry = {},
            nowMillis = 1_780_000_000_000L,
        )
    }
}

@Preview(name = "RecentActivityFeed · empty", showBackground = true)
@Composable
private fun RecentActivityFeedEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityFeedContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            onOpenEntity = {},
            onRetry = {},
        )
    }
}

@Preview(name = "RecentActivityFeed · loading", showBackground = true)
@Composable
private fun RecentActivityFeedLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        RecentActivityFeedContent(
            state = UiState.loading(),
            onOpenEntity = {},
            onRetry = {},
        )
    }
}
