// The native Jetpack Compose + Material 3 WhyEndedPanel feature view — a parity port of
// web/src/features/driving/components/drive-detail/WhyEndedPanel.tsx. The web component is the drive-detail
// "Why did this drive end?" diagnostic: a collapsible GlassPanel whose header is a ghost toggle (chevron +
// PanelTitle) plus a window Select (30s/60s/5m/15m), and whose expanded body shows a Spinner while loading,
// an EmptyState (title + message + Retry) on error, or two sections — the FSM transition Timeline and the
// raw signal-window DataTable — each with its own empty state. It is lazy: the query fires only on expand.
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the diagnostic read only
// through the shared S8/S7 Driving state-holder seam ([WhyEndedPanelSource], wired by the owning drive-detail
// page to DrivingStore.driveWhyEnded), folding the cache-then-network lifecycle through the shared
// [WhyEndedPanelViewModel] + the pure [WhyEndedPanelProjection]; the composable is a thin render layer that
// resolves the i18n labels (P1/S10) and design-token accents (P1/S9) and draws what the projection returns,
// using the shared component library (ui GlassPanel/Button/Select/DataTable/typography, feedback
// Spinner/EmptyState, data-display Timeline/DataFreshness, local GitBranch/Radio glyphs). It renders every
// state the prompt's matrix mandates without ever hiding a surface: collapsed (header only), loading, a hard
// error with Retry, the two ready sections (each with its own empty state), and a stale/offline/refreshing
// freshness chip over cached rows. The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on
// first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WhyEndedPanel) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.whyendedpanel

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.Timeline
import io.teslasync.android.components.datadisplay.TimelineEntry
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.DataTable
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Pagination
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Select
import io.teslasync.android.components.ui.SelectOption
import io.teslasync.android.components.ui.TableColumn
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import java.time.ZoneId
import java.util.Locale

/** Web `w-40` window-selector width — fixed so the header reads as "title … selector". */
private val WINDOW_SELECT_WIDTH = 140.dp

/** The signal-window timestamp column is a touch wider than the field/value columns (web layout). */
private const val SIGNAL_TS_WEIGHT = 1.3f

/**
 * Stateful entry point — the faithful 1:1 port of the web `WhyEndedPanel({ driveId })` prop. Binds the shared
 * Driving feed via [source] into a [WhyEndedPanelViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11) on first composition, collects the projected [WhyEndedFeedState], and renders. The owning
 * drive-detail page supplies the [source] (an adapter over the shared S7/S8 Driving layer) and the [driveId].
 *
 * @param source the cache-then-network Driving seam (`DrivingStore`/`DrivingRepository` adapter).
 * @param driveId the drive to diagnose (web `driveId` prop). A blank/`"0"` id holds the empty sections.
 * @param locale the locale used to format the absolute timestamps (web `toLocaleString` browser locale).
 * @param zoneId the zone used to render the UTC timestamps as wall-clock time (web browser timezone).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 * @param instanceKey the ViewModel key; defaults per drive so two panels never share a holder.
 */
@Composable
fun WhyEndedPanel(
    source: WhyEndedPanelSource,
    driveId: String,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = "$WHY_ENDED_PANEL_SLUG:$driveId",
) {
    val viewModel: WhyEndedPanelViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { WhyEndedPanelViewModel(source, logger, driveId) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val strings = rememberWhyEndedPanelStrings()

    WhyEndedPanelContent(
        state = state,
        strings = strings,
        onToggleExpand = viewModel::toggleExpanded,
        onSelectWindow = viewModel::selectWindow,
        onRetry = viewModel::refresh,
        modifier = modifier,
        locale = locale,
        zoneId = zoneId,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Projects [state] for the given
 * [locale]/[zoneId] and renders the web layout: the [GlassPanel] holding the always-present header (toggle +
 * window Select) above the expanded body (Spinner / error EmptyState / the two sections). [locale]/[zoneId]
 * default to the device settings for cold-start and previews.
 */
@Composable
fun WhyEndedPanelContent(
    state: WhyEndedFeedState,
    strings: WhyEndedPanelStrings,
    onToggleExpand: () -> Unit,
    onSelectWindow: (WhyEndedWindow) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
) {
    val display =
        remember(state, locale, zoneId) {
            WhyEndedPanelProjection.project(state.expanded, state.resource, zoneId, locale)
        }
    GlassPanel(modifier = modifier, padding = PanelPadding.Lg) {
        WhyEndedHeader(
            expanded = state.expanded,
            window = state.window,
            strings = strings,
            onToggleExpand = onToggleExpand,
            onSelectWindow = onSelectWindow,
        )
        WhyEndedBody(display = display, strings = strings, onRetry = onRetry)
    }
}

/**
 * The header row (web `flex items-center justify-between`): a ghost toggle button (chevron + the panel
 * title — its merged text is the button's TalkBack name) and, while expanded, the window [Select] carrying
 * the localized "Diagnostic window" accessible name (web `aria-label`).
 */
@Composable
private fun WhyEndedHeader(
    expanded: Boolean,
    window: WhyEndedWindow,
    strings: WhyEndedPanelStrings,
    onToggleExpand: () -> Unit,
    onSelectWindow: (WhyEndedWindow) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            onClick = onToggleExpand,
            modifier = Modifier.weight(1f),
            variant = ButtonVariant.Ghost,
            size = ButtonSize.Sm,
        ) {
            Icon(
                imageVector = if (expanded) TeslaGlyphs.ChevronDown else TeslaGlyphs.ChevronRight,
                contentDescription = null,
                size = IconSize.Sm,
            )
            Spacer(Modifier.width(Spacing.sm))
            PanelTitle(strings.title)
        }
        if (expanded) {
            Select(
                options = WhyEndedWindow.entries.map { SelectOption(it.wire, it.wire) },
                selectedValue = window.wire,
                onSelect = { onSelectWindow(WhyEndedWindow.fromWire(it)) },
                modifier =
                    Modifier
                        .width(WINDOW_SELECT_WIDTH)
                        .semantics { contentDescription = strings.windowAria },
            )
        }
    }
}

/**
 * The expanded body, switching on the projected [WhyEndedDisplay.status] exactly as the web ternary does:
 * collapsed renders nothing (header only); loading a centered [Spinner]; a hard error the web `EmptyState`
 * with a Retry CTA; ready the two sections (freshness chip + FSM timeline + signal table).
 */
@Composable
private fun WhyEndedBody(
    display: WhyEndedDisplay,
    strings: WhyEndedPanelStrings,
    onRetry: () -> Unit,
) {
    when (display.status) {
        WhyEndedStatus.Collapsed -> Unit
        WhyEndedStatus.Loading ->
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(top = Spacing.md, bottom = Spacing.xl2),
                contentAlignment = Alignment.Center,
            ) {
                Spinner(accessibleLabel = stringResource(R.string.translation_common_loading))
            }
        WhyEndedStatus.Error ->
            EmptyState(
                message = strings.errorMessage,
                modifier = Modifier.padding(top = Spacing.md),
                title = strings.errorTitle,
                action = EmptyStateAction(label = strings.retry, onClick = onRetry),
            )
        WhyEndedStatus.Ready ->
            Column(
                modifier = Modifier.fillMaxWidth().padding(top = Spacing.md),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                WhyEndedFreshness(display = display, strings = strings, onRetry = onRetry)
                FsmSection(transitions = display.transitions, strings = strings)
                SignalSection(signals = display.signals, strings = strings)
            }
    }
}

/**
 * An honest-freshness chip over cached rows (ADR-013): an amber "Offline" row (with a Retry affordance when a
 * failed refresh left the rows stale) when last-known rows are shown, or a muted "updating…" hint while a
 * refresh runs over them. Nothing renders when the rows are fresh — the web has no chip because React Query
 * refetches silently, but the native contract never paints stale rows as live.
 */
@Composable
private fun WhyEndedFreshness(
    display: WhyEndedDisplay,
    strings: WhyEndedPanelStrings,
    onRetry: () -> Unit,
) {
    val offline = display.offline
    val refreshing = display.refreshing && !offline
    when {
        offline ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = WhyEndedPanelGlyphs.Radio,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.warning,
                )
                BodyText(
                    text = stringResource(R.string.translation_common_offline),
                    modifier = Modifier.weight(1f),
                    color = TeslaTokens.status.warning,
                )
                if (display.canRetry) {
                    Button(strings.retry, onClick = onRetry, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
                }
            }
        refreshing ->
            DataFreshness(
                updatedAtMillis = display.fetchedAtMillis?.takeIf { it > 0 },
                isFetching = true,
                isStale = false,
                isError = false,
                fetchingLabel = stringResource(R.string.translation_freshness_updating),
            )
        else -> Unit
    }
}

/**
 * The FSM-transition section (web `GitBranch` heading + `Timeline`). Empty transitions render the localized
 * "No transitions in window" empty state (never a blank region); otherwise each transition becomes a Timeline
 * row titled `{fsm}: {from} → {to}`, subtitled with the localized `trigger: {{trigger}}`, accented with the
 * brand primary (web `var(--accent-primary)`), and stamped with its absolute time.
 */
@Composable
private fun FsmSection(
    transitions: List<WhyEndedTransitionRow>,
    strings: WhyEndedPanelStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = WhyEndedPanelGlyphs.GitBranch, title = strings.fsmTitle)
        if (transitions.isEmpty()) {
            EmptyState(message = strings.fsmEmptyMessage, title = strings.fsmEmptyTitle)
        } else {
            val accent = MaterialTheme.colorScheme.primary
            val context = LocalContext.current
            val items =
                transitions.map { row ->
                    TimelineEntry(
                        title = row.title,
                        time = row.timeLabel,
                        subtitle = context.getString(R.string.translation_driveDetail_whyEnded_trigger, row.trigger),
                        accent = accent,
                    )
                }
            Timeline(items = items)
        }
    }
}

/**
 * The signal-window section (web `Radio` heading + paginated `DataTable`). The table paginates the raw signal
 * rows at [WHY_ENDED_SIGNAL_PAGE_SIZE] and shows the localized whitelist-empty message when there are none.
 */
@Composable
private fun SignalSection(
    signals: List<WhyEndedSignalRow>,
    strings: WhyEndedPanelStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionHeader(icon = WhyEndedPanelGlyphs.Radio, title = strings.signalTitle)
        SignalTable(signals = signals, strings = strings)
    }
}

/** A section heading: a muted leading glyph + the localized [title] (web `text-[var(--text-muted)]` icon). */
@Composable
private fun SectionHeader(
    icon: ImageVector,
    title: String,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            size = IconSize.Md,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        PanelTitle(title)
    }
}

/**
 * The three-column signal table (web `columns` ts/field/value) with a [Pagination] footer. The absolute
 * timestamp renders as a muted caption (web `<TimeStamp>`); the field + value render monospace (web
 * `font-mono`). The footer carries the localized first/previous/next/last + "showing X–Y of Z" labels.
 */
@Composable
private fun SignalTable(
    signals: List<WhyEndedSignalRow>,
    strings: WhyEndedPanelStrings,
) {
    val total = signals.size
    val pageCount = maxOf(1, (total + WHY_ENDED_SIGNAL_PAGE_SIZE - 1) / WHY_ENDED_SIGNAL_PAGE_SIZE)
    var page by remember(total) { mutableIntStateOf(1) }
    val current = page.coerceIn(1, pageCount)
    val from = (current - 1) * WHY_ENDED_SIGNAL_PAGE_SIZE
    val visible = if (total == 0) emptyList() else signals.subList(from, minOf(from + WHY_ENDED_SIGNAL_PAGE_SIZE, total))

    val firstLabel = stringResource(R.string.translation_pagination_first)
    val previousLabel = stringResource(R.string.translation_pagination_previous)
    val nextLabel = stringResource(R.string.translation_pagination_next)
    val lastLabel = stringResource(R.string.translation_pagination_last)
    val context = LocalContext.current

    val footer: (@Composable () -> Unit)? =
        if (total > 0) {
            {
                Pagination(
                    page = current,
                    pageSize = WHY_ENDED_SIGNAL_PAGE_SIZE,
                    total = total,
                    onPageChange = { page = it },
                    firstLabel = firstLabel,
                    previousLabel = previousLabel,
                    nextLabel = nextLabel,
                    lastLabel = lastLabel,
                    showingText = { start, end, count ->
                        context.getString(R.string.translation_pagination_showing, start, end, count)
                    },
                )
            }
        } else {
            null
        }

    DataTable(
        columns = signalColumns(strings),
        rows = visible,
        keyOf = { it.key },
        emptyText = strings.signalEmpty,
        footer = footer,
    )
}

/** The web ts/field/value columns: a muted-caption timestamp + monospace field + monospace value. */
private fun signalColumns(strings: WhyEndedPanelStrings): List<TableColumn<WhyEndedSignalRow>> =
    listOf(
        TableColumn(key = "ts", header = strings.signalColTs, weight = SIGNAL_TS_WEIGHT) { Caption(it.timeLabel) },
        TableColumn(key = "field", header = strings.signalColField) { CodeText(it.field) },
        TableColumn(key = "value", header = strings.signalColValue) { CodeText(it.value) },
    )

/**
 * Resolves the localized [WhyEndedPanelStrings] from the i18n catalog (P1/S10) — the `driveDetail.whyEnded.*`
 * + `common.retry` keys the web component reads via `t(...)`. Remembered against the resolved strings so a
 * locale change re-projects the surface.
 */
@Composable
private fun rememberWhyEndedPanelStrings(): WhyEndedPanelStrings {
    val title = stringResource(R.string.translation_driveDetail_whyEnded_title)
    val windowAria = stringResource(R.string.translation_driveDetail_whyEnded_windowAria)
    val errorTitle = stringResource(R.string.translation_driveDetail_whyEnded_error_title)
    val errorMessage = stringResource(R.string.translation_driveDetail_whyEnded_error_message)
    val retry = stringResource(R.string.translation_common_retry)
    val fsmTitle = stringResource(R.string.translation_driveDetail_whyEnded_fsmTitle)
    val fsmEmptyTitle = stringResource(R.string.translation_driveDetail_whyEnded_fsmEmpty_title)
    val fsmEmptyMessage = stringResource(R.string.translation_driveDetail_whyEnded_fsmEmpty_message)
    val signalTitle = stringResource(R.string.translation_driveDetail_whyEnded_signalTitle)
    val signalColTs = stringResource(R.string.translation_driveDetail_whyEnded_signal_cols_ts)
    val signalColField = stringResource(R.string.translation_driveDetail_whyEnded_signal_cols_field)
    val signalColValue = stringResource(R.string.translation_driveDetail_whyEnded_signal_cols_value)
    val signalEmpty = stringResource(R.string.translation_driveDetail_whyEnded_signalEmpty)
    return remember(
        title,
        windowAria,
        errorTitle,
        errorMessage,
        retry,
        fsmTitle,
        fsmEmptyTitle,
        fsmEmptyMessage,
        signalTitle,
        signalColTs,
        signalColField,
        signalColValue,
        signalEmpty,
    ) {
        WhyEndedPanelStrings(
            title = title,
            windowAria = windowAria,
            errorTitle = errorTitle,
            errorMessage = errorMessage,
            retry = retry,
            fsmTitle = fsmTitle,
            fsmEmptyTitle = fsmEmptyTitle,
            fsmEmptyMessage = fsmEmptyMessage,
            signalTitle = signalTitle,
            signalColTs = signalColTs,
            signalColField = signalColField,
            signalColValue = signalColValue,
            signalEmpty = signalEmpty,
        )
    }
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    WhyEndedPanelStrings(
        title = "Why did this drive end?",
        windowAria = "Diagnostic window",
        errorTitle = "Could not load diagnostic",
        errorMessage = "Try a different window or reload the page.",
        retry = "Retry",
        fsmTitle = "FSM transitions",
        fsmEmptyTitle = "No transitions in window",
        fsmEmptyMessage = "No FSM state changes recorded near the drive end. Try a wider window.",
        signalTitle = "Signal window",
        signalColTs = "Timestamp",
        signalColField = "Field",
        signalColValue = "Value",
        signalEmpty = "No signals in this window for the default whitelist.",
    )

private fun previewJson(): JsonElement =
    buildJsonObject {
        putJsonArray("fsm_transitions") {
            addJsonObject {
                put("id", 2)
                put("ts", "2026-03-14T11:45:00Z")
                put("fsm_name", "drive")
                put("from_state", "driving")
                put("to_state", "parked")
                put("trigger", "shift_to_park")
            }
            addJsonObject {
                put("id", 1)
                put("ts", "2026-03-14T11:44:50Z")
                put("fsm_name", "drive")
                put("from_state", "active")
                put("to_state", "driving")
                put("trigger", "")
            }
        }
        putJsonArray("signal_window") {
            addJsonObject {
                put("ts", "2026-03-14T11:45:00Z")
                put("field", "Gear")
                put("value", "P")
            }
            addJsonObject {
                put("ts", "2026-03-14T11:44:55Z")
                put("field", "VehicleSpeed")
                put("value", "0")
            }
        }
    }

private fun previewEmptyJson(): JsonElement =
    buildJsonObject {
        putJsonArray("fsm_transitions") {}
        putJsonArray("signal_window") {}
    }

private fun previewState(
    expanded: Boolean,
    resource: Resource<JsonElement>?,
): WhyEndedFeedState = WhyEndedFeedState(expanded = expanded, window = WhyEndedWindow.Sec60, resource = resource)

@Preview(name = "Collapsed", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedCollapsedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state = previewState(expanded = false, resource = null),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Loading", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state = previewState(expanded = true, resource = Resource.Loading(cached = null, fetchedAt = null, stale = false)),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Ready — data", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state = previewState(expanded = true, resource = Resource.Success(previewJson(), fetchedAt = 1L, stale = false)),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Ready — empty sections", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state = previewState(expanded = true, resource = Resource.Success(previewEmptyJson(), fetchedAt = 1L, stale = false)),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Error", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state =
                previewState(
                    expanded = true,
                    resource = Resource.Error(cached = null, fetchedAt = null, stale = false, error = ApiError.Network()),
                ),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}

@Preview(name = "Offline — cached", showBackground = true, widthDp = 360)
@Composable
private fun WhyEndedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WhyEndedPanelContent(
            state =
                previewState(
                    expanded = true,
                    resource = Resource.Error(cached = previewJson(), fetchedAt = 1L, stale = true, error = ApiError.Timeout()),
                ),
            strings = PREVIEW_STRINGS,
            onToggleExpand = {},
            onSelectWindow = {},
            onRetry = {},
            zoneId = ZoneId.of("UTC"),
        )
    }
}
