// The native Jetpack Compose + Material 3 Sentry Event Log dashboard surface — a parity port of
// web/src/features/dashboard/widgets/SentryEventLogWidget.tsx. It mirrors the web `WidgetShell` (a
// skeleton while loading, a `QueryError` retry surface on hard failure, otherwise a title + shield glyph
// + freshness header) wrapping the web `WidgetEventFeed`: a newest-first list of recent security events,
// each a marker icon + a derived title ("Vehicle locked", "Door open: …", …) + a relative-time stamp and
// — on the wide (≥3-column) footprint — a lock/sentry subtitle, or a friendly "No security events
// recorded" empty state. All data flows through the shared [SentryEventLogWidgetViewModel] (P1/S8); the
// view performs no HTTP. The only `t()`-backed strings (the title + empty message) resolve through the
// i18n catalog and the refresh control carries a TalkBack label; each feed row exposes one folded TalkBack
// phrase.
//
// Documented native deviations (Android has no bundled Lucide; see the glyph mapping below):
//   • Glyphs are approximated from the curated shared glyph set — DoorOpen → an alert triangle (the
//     open-door warning), DoorClosed → a shield (the neutral "security state updated" fallback), Unlock →
//     the lock glyph (there is no open-lock glyph; the critical/red tone distinguishes it from a lock).
//   • Older-than-a-day rows render a relative "Xd ago" / "Xw ago" where the web shows an absolute date —
//     the shared `relativeAge` bucket, the same minor deviation the sibling GuardMode feed already ships.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/SentryEventLogWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.sentryeventlog

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.datadisplay.TimelineItem
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import kotlinx.coroutines.delay

private const val NOW_TICK_MS = 30_000L
private const val LOADING_BAR_COUNT = 4
private val BODY_MIN_HEIGHT = 140.dp

/**
 * Stateful entry point. Collects the shared [SentryEventLogWidgetViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard host supplies the
 * view-model (wired via [SentryEventLogWidgetViewModel.factory]).
 */
@Composable
fun SentryEventLogWidget(
    viewModel: SentryEventLogWidgetViewModel,
    modifier: Modifier = Modifier,
    size: SentryEventLogSize = SentryEventLogRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    SentryEventLogWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless Sentry Event Log panel — renders every state the web widget does (loading skeleton / content
 * feed / empty / hard error + retry, plus stale + offline via the header freshness chip over the cached
 * feed). Stale (non-error) data auto-refreshes (web TanStack stale refetch). Hoisted out of the ViewModel
 * so each state is preview- and screenshot-testable with hand-built [UiState] inputs. [nowMillis] is
 * injectable for deterministic relative-time in tests.
 */
@Composable
fun SentryEventLogWidgetContent(
    state: UiState<SentryEventLogSnapshot>,
    size: SentryEventLogSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    nowMillis: Long = rememberNowMillis(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberSentryEventLogStrings()
    val title = stringResource(R.string.translation_widget_sentryEventLog)
    val emptyMessage = stringResource(R.string.translation_widget_noSentryEvents)
    val display =
        remember(state.data, size, strings, nowMillis) {
            SentryEventLogProjection.project(
                snapshot = state.data ?: SentryEventLogSnapshot.EMPTY,
                size = size,
                strings = strings,
                nowMillis = nowMillis,
            )
        }
    GlassPanel(modifier = modifier.fillMaxSize(), padding = PanelPadding.Md) {
        when {
            state.isLoading -> LoadingChrome()
            state.isError -> ErrorChrome(state = state, title = title, onRetry = onRefresh)
            else ->
                Column(modifier = Modifier.fillMaxSize()) {
                    WidgetHeader(state = state, title = title, onRefresh = onRefresh)
                    Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
                        if (display.hasItems) {
                            SentryEventFeed(rows = display.items)
                        } else {
                            SentryEventLogEmpty(message = emptyMessage)
                        }
                    }
                }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<SentryEventLogSnapshot>,
    title: String,
    onRefresh: () -> Unit,
) {
    val strings = rememberSentryEventLogStrings()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = stringResource(R.string.translation_common_refresh),
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun SentryEventFeed(rows: List<SecurityEventRow>) {
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
    ) {
        rows.forEachIndexed { index, row ->
            TimelineItem(
                entry =
                    TimelineEntry(
                        title = row.title,
                        time = row.relativeTime,
                        subtitle = row.subtitle,
                        icon = glyphVector(row.glyph),
                        accent = toneColor(row.tone),
                    ),
                isLast = index == rows.lastIndex,
                modifier = Modifier.clearAndSetSemantics { contentDescription = row.contentDescription },
            )
        }
    }
}

@Composable
private fun SentryEventLogEmpty(message: String) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        EmptyState(message = message, icon = DataDisplayGlyphs.Shield)
    }
}

@Composable
private fun LoadingChrome() {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            Modifier
                .fillMaxSize()
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    state: UiState<SentryEventLogSnapshot>,
    title: String,
    onRetry: () -> Unit,
) {
    Box(
        modifier = Modifier.fillMaxSize().heightIn(min = BODY_MIN_HEIGHT),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(kind = state.toQueryErrorKind(), resourceName = title, onRetry = onRetry)
    }
}

/**
 * Builds the localized [SentryEventLogStrings] from the i18n catalog (P1/S10): the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip and the feed
 * rows.
 */
@Composable
private fun rememberSentryEventLogStrings(): SentryEventLogStrings {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        SentryEventLogStrings(
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> EM_DASH
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

/** Ticks the wall clock every 30s so relative-time labels (e.g. "5m ago") stay current. */
@Composable
private fun rememberNowMillis(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(NOW_TICK_MS)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/**
 * Approximates the web Lucide icon for a security-event marker from the curated shared glyph set (Android
 * has no bundled Lucide): DoorOpen → an alert triangle (the open-door warning), DoorClosed → a shield (the
 * neutral "security state updated" fallback), Unlock → the lock glyph (there is no open-lock glyph; the
 * critical/red tone distinguishes it from a locked row).
 */
private fun glyphVector(glyph: SecurityEventGlyph): ImageVector =
    when (glyph) {
        SecurityEventGlyph.DoorOpen -> DataDisplayGlyphs.AlertTriangle
        SecurityEventGlyph.DoorClosed -> DataDisplayGlyphs.Shield
        SecurityEventGlyph.Eye -> TeslaGlyphs.Eye
        SecurityEventGlyph.EyeOff -> TeslaGlyphs.EyeOff
        SecurityEventGlyph.Lock -> DataDisplayGlyphs.Lock
        SecurityEventGlyph.Unlock -> DataDisplayGlyphs.Lock
    }

@Composable
private fun toneColor(tone: SecurityEventTone): Color =
    when (tone) {
        SecurityEventTone.Warning -> TeslaTokens.status.warning
        SecurityEventTone.Info -> TeslaTokens.status.info
        SecurityEventTone.Critical -> TeslaTokens.status.danger
        SecurityEventTone.Success -> TeslaTokens.status.success
        SecurityEventTone.Accent -> MaterialTheme.colorScheme.primary
        SecurityEventTone.Muted -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

// ── Previews — one per rendered state (content / wide+subtitle / empty / loading / error) ──────────────

private fun previewEvent(
    id: Long,
    minute: Int,
    locked: Boolean? = null,
    sentryMode: Boolean? = null,
    doorState: String? = null,
): SecurityEvent =
    SecurityEvent(
        id = id,
        vehicleId = 1L,
        ts = "2024-01-15T10:%02d:00Z".format(minute),
        createdAt = "2024-01-15T10:%02d:00Z".format(minute),
        eventType = "security_state",
        doorState = doorState,
        locked = locked,
        sentryMode = sentryMode,
    )

private fun sampleSnapshot(): SentryEventLogSnapshot =
    SentryEventLogSnapshot(
        listOf(
            previewEvent(id = 1, minute = 10, sentryMode = true),
            previewEvent(id = 2, minute = 20, locked = true),
            previewEvent(id = 3, minute = 30, locked = false),
            previewEvent(id = 4, minute = 40, doorState = "Front Left Open, Rear Right Open"),
            previewEvent(id = 5, minute = 50, sentryMode = false),
        ),
    )

private val previewNow: Long = parseEpochMillis("2024-01-15T11:00:00Z") ?: 0L

@Preview(name = "SentryEventLog · content", showBackground = true)
@Composable
private fun SentryEventLogContentPreview() {
    TeslaSyncTheme {
        SentryEventLogWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = previewNow),
            size = SentryEventLogRegistration.defaultSize,
            onRefresh = {},
            nowMillis = previewNow,
        )
    }
}

@Preview(name = "SentryEventLog · wide + subtitle", showBackground = true)
@Composable
private fun SentryEventLogWidePreview() {
    TeslaSyncTheme {
        SentryEventLogWidgetContent(
            state = UiState(phase = UiPhase.Content, data = sampleSnapshot(), fetchedAt = previewNow),
            size = SentryEventLogSize(cols = 4, rows = 6),
            onRefresh = {},
            nowMillis = previewNow,
        )
    }
}

@Preview(name = "SentryEventLog · empty", showBackground = true)
@Composable
private fun SentryEventLogEmptyPreview() {
    TeslaSyncTheme {
        SentryEventLogWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = SentryEventLogSnapshot.EMPTY, fetchedAt = previewNow),
            size = SentryEventLogRegistration.defaultSize,
            onRefresh = {},
            nowMillis = previewNow,
        )
    }
}

@Preview(name = "SentryEventLog · loading", showBackground = true)
@Composable
private fun SentryEventLogLoadingPreview() {
    TeslaSyncTheme {
        SentryEventLogWidgetContent(
            state = UiState.loading(),
            size = SentryEventLogRegistration.defaultSize,
            onRefresh = {},
            nowMillis = previewNow,
        )
    }
}

@Preview(name = "SentryEventLog · error", showBackground = true)
@Composable
private fun SentryEventLogErrorPreview() {
    TeslaSyncTheme {
        SentryEventLogWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = SentryEventLogRegistration.defaultSize,
            onRefresh = {},
            nowMillis = previewNow,
        )
    }
}
