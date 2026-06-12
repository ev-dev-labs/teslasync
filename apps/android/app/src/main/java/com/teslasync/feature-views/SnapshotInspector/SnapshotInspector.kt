// The native Jetpack Compose + Material 3 SnapshotInspector feature view — a parity port of
// web/src/features/system/components/state-machine/SnapshotInspector.tsx. The web component is the FSM
// debugger's right-rail inspector: when no transition is selected it shows a "Loading…" hint, an
// "outside the window" hint with a Jump-to-last button, or a "Select a transition…" prompt; when a transition
// is selected it shows the transition header (title + Copy snapshot), a From/To/Trigger/Duration grid, and the
// signal snapshot at the transition — each value annotated with a source-layer badge, with a "Diff vs previous"
// toggle that dims unchanged signals and highlights the deltas (with the previous value struck through).
//
// This native surface keeps that contract end to end. It performs NO HTTP and binds the snapshot only through
// the shared P1/S8 telemetry seam: the host (the debugger page) supplies the snapshot as a
// [UiState]<[SignalSnapshotResponse]> projected from `TelemetryStore.signalSnapshot(...)`, and [onRetry] is
// wired to `refreshSignalSnapshot`. Every derivation flows through the pure [SnapshotInspectorProjection]; this
// composable resolves the i18n labels (P1/S10) and the design-token accents (P1/S9) and draws what the
// projection returns, using the shared component library (ui GlassPanel/Badge/Toggle/CopyButton/typography,
// data-display SourceLayerBadge/DataFreshness, feedback EmptyState/ErrorDisplay/Skeleton, motion FadeIn). It
// renders every state without hiding a surface: the three no-selection messages, the selected snapshot with a
// loading skeleton / hard error+retry / ready signals (or the per-section no-signals empty), and a
// stale/offline/refreshing freshness chip over cached signals. A web-parity overload that takes the raw
// `snapshot`/`loading` props is also provided for hosts that already hold them. The one-shot PII-safe
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/SnapshotInspector) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located helpers.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.snapshotinspector

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.SignalSourceLayer
import io.teslasync.android.components.datadisplay.SourceLayerBadge
import io.teslasync.android.components.datadisplay.parseSourceLayer
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.EmptyStateAction
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.CopyButton
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.Toggle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotEntry
import io.teslasync.shared.core.presentation.telemetry.SignalSnapshotResponse
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.ZoneId
import java.util.Locale

// Entrance delay in milliseconds; FadeIn honours reduce-motion itself (accessibility: reduce-motion respect).
private const val FADE_DELAY_MS = 150

// Opacity of an unchanged signal row in diff mode — the web `opacity-40`.
private const val DIM_ALPHA = 0.4f

// Alpha washes for the changed-row highlight — the web amber border/background.
private const val HIGHLIGHT_BORDER_ALPHA = 0.4f
private const val HIGHLIGHT_FILL_ALPHA = 0.08f

private const val SKELETON_ROW_COUNT = 4
private val SKELETON_ROW_HEIGHT: Dp = 40.dp
private const val SKELETON_ROW_FRACTION = 0.92f
private val ROW_BORDER_WIDTH: Dp = 1.dp
private val NO_SELECTION_MIN_HEIGHT: Dp = 160.dp

/**
 * The already-localized microcopy the surface renders — every string the web component reads via
 * `t('debugger.inspector.*')`, plus the lifecycle chrome's labels (the freshness chip + hard-error surface
 * the snapshot feed implies). They arrive through the P1/S10 i18n facade (`stringResource`) at the Compose
 * boundary and are passed in, keeping the surface free of any English literal; tests pass a deterministic
 * instance. The `outsideWindow` template carries a `%1$s` age arg, so it is resolved with `getString` in the
 * composable.
 */
data class SnapshotInspectorStrings(
    val title: String,
    val copy: String,
    val copied: String,
    val from: String,
    val to: String,
    val trigger: String,
    val duration: String,
    val signalsTitle: String,
    val diffMode: String,
    val noSignals: String,
    val empty: String,
    val jumpToLast: String,
    val loading: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val errorTitle: String,
    val errorMessage: String,
    val retry: String,
)

/**
 * Stateful entry point — binds the shared P1/S8 telemetry snapshot feed. Records the one-shot PII-safe
 * `view.opened` diagnostic (P1/S11) on first composition and renders every lifecycle state the snapshot
 * [snapshotState] can carry around the web component's branches. The host owns the feed
 * (`TelemetryStore.signalSnapshot(...)`, projected with `toUiState`) and the timeline selection it passes as
 * [transition]/[previousSnapshot]/[lastTransition]/[inWindowCount]/[onJumpToLast]; [onRetry] is wired to the
 * feed's `refreshSignalSnapshot`. This view never performs HTTP.
 *
 * @param fsmType the FSM whose state palette colors the From/To badges (web `getStateColor` key).
 * @param transition the selected transition, or `null` to show the no-selection branches (web `transition`).
 * @param snapshotState the cache-then-network projection of the signal snapshot at the transition.
 * @param previousSnapshot the snapshot at the previous transition, for diff mode (web `previousSnapshot`).
 * @param lastTransition the most recent transition, in or outside the window (web `lastTransition`).
 * @param inWindowCount the number of selectable transitions in the active window (web `inWindowCount`).
 * @param onJumpToLast switches to freeze mode and selects [lastTransition] (web `onJumpToLast`).
 * @param onRetry re-runs the host's snapshot load — wired to the hard-error retry and the stale auto-refresh.
 */
@Composable
fun SnapshotInspector(
    fsmType: String,
    transition: SnapshotTransition?,
    snapshotState: UiState<SignalSnapshotResponse>,
    modifier: Modifier = Modifier,
    previousSnapshot: SignalSnapshotResponse? = null,
    lastTransition: SnapshotTransition? = null,
    inWindowCount: Int = 0,
    onJumpToLast: (() -> Unit)? = null,
    onRetry: () -> Unit = {},
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SnapshotInspectorDiagnostics.recordViewOpened(logger) }
    SnapshotInspectorContent(
        fsmType = fsmType,
        transition = transition,
        snapshotState = snapshotState,
        onJumpToLast = onJumpToLast,
        onRetry = onRetry,
        modifier = modifier,
        noSelectionLoading = snapshotState.refreshing,
        previousSnapshot = previousSnapshot,
        lastTransition = lastTransition,
        inWindowCount = inWindowCount,
        locale = locale,
        zoneId = zoneId,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ snapshot, loading }` props, for hosts that already hold
 * the resolved snapshot. Maps the props onto a [UiState] (a present snapshot is content, otherwise a first
 * load while `loading` else empty) and threads the web `loading` flag to the no-selection loading branch.
 * Records `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun SnapshotInspector(
    fsmType: String,
    transition: SnapshotTransition?,
    snapshot: SignalSnapshotResponse?,
    modifier: Modifier = Modifier,
    previousSnapshot: SignalSnapshotResponse? = null,
    loading: Boolean = false,
    lastTransition: SnapshotTransition? = null,
    inWindowCount: Int = 0,
    onJumpToLast: (() -> Unit)? = null,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { SnapshotInspectorDiagnostics.recordViewOpened(logger) }
    val state =
        remember(snapshot, loading) {
            when {
                snapshot != null -> UiState(phase = UiPhase.Content, data = snapshot)
                loading -> UiState.loading()
                else -> UiState(phase = UiPhase.Empty)
            }
        }
    SnapshotInspectorContent(
        fsmType = fsmType,
        transition = transition,
        snapshotState = state,
        onJumpToLast = onJumpToLast,
        onRetry = {},
        modifier = modifier,
        noSelectionLoading = loading,
        previousSnapshot = previousSnapshot,
        lastTransition = lastTransition,
        inWindowCount = inWindowCount,
        locale = locale,
        zoneId = zoneId,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. Holds the
 * "Diff vs previous" toggle (web `useState(false)`), auto-refreshes stale (non-error) snapshots over a
 * selected transition (the freshness contract), classifies the surface via [SnapshotInspectorProjection], and
 * draws the matching branch inside the always-present [GlassPanel].
 */
@Composable
fun SnapshotInspectorContent(
    fsmType: String,
    transition: SnapshotTransition?,
    snapshotState: UiState<SignalSnapshotResponse>,
    onJumpToLast: (() -> Unit)?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    noSelectionLoading: Boolean = false,
    previousSnapshot: SignalSnapshotResponse? = null,
    lastTransition: SnapshotTransition? = null,
    inWindowCount: Int = 0,
    locale: Locale = Locale.getDefault(),
    zoneId: ZoneId = ZoneId.systemDefault(),
    strings: SnapshotInspectorStrings = rememberSnapshotInspectorStrings(),
) {
    var diffMode by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(transition, snapshotState.stale, snapshotState.refreshing, snapshotState.hasError) {
        val staleNeedsRefresh = snapshotState.stale && !snapshotState.refreshing && !snapshotState.hasError
        if (transition != null && staleNeedsRefresh) {
            onRetry()
        }
    }

    val canJumpToLast = lastTransition != null && onJumpToLast != null
    val surface =
        SnapshotInspectorProjection.surfaceFor(
            hasTransition = transition != null,
            noSelectionLoading = noSelectionLoading,
            inWindowCount = inWindowCount,
            canJumpToLast = canJumpToLast,
            snapshotLoading = snapshotState.isLoading,
            snapshotError = snapshotState.isError,
        )

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            when (surface) {
                SnapshotSurface.NoSelectionLoading ->
                    NoSelectionMessage(message = strings.loading, testTag = "snapshot-inspector-loading")
                SnapshotSurface.NoSelectionOutsideWindow ->
                    OutsideWindow(
                        strings = strings,
                        lastTransition = lastTransition,
                        onJumpToLast = onJumpToLast,
                        zoneId = zoneId,
                        locale = locale,
                    )
                SnapshotSurface.NoSelectionPrompt ->
                    NoSelectionMessage(message = strings.empty, testTag = "snapshot-inspector-empty")
                else ->
                    SelectedSnapshot(
                        surface = surface,
                        fsmType = fsmType,
                        transition = transition ?: SnapshotTransition(),
                        snapshotState = snapshotState,
                        previousSnapshot = previousSnapshot,
                        diffMode = diffMode,
                        onDiffModeChange = { diffMode = it },
                        onRetry = onRetry,
                        strings = strings,
                        locale = locale,
                    )
            }
        }
    }
}

/** A centered muted message — the web no-selection `loading` / `empty` states (never a blank box). */
@Composable
private fun NoSelectionMessage(
    message: String,
    testTag: String,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .heightIn(min = NO_SELECTION_MIN_HEIGHT)
                .semantics { contentDescription = "$testTag:$message" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The "nothing in the current window" state — the web `emptyOutsideWindow` hint with the relative last-seen
 * time plus the "Jump to last transition" button. The age resolves through the localized `freshness.*` keys.
 */
@Composable
private fun OutsideWindow(
    strings: SnapshotInspectorStrings,
    lastTransition: SnapshotTransition?,
    onJumpToLast: (() -> Unit)?,
    zoneId: ZoneId,
    locale: Locale,
) {
    val context = LocalContext.current
    val formatAge = rememberRelativeAgeFormatter(zoneId = zoneId, locale = locale)
    val age =
        remember(lastTransition?.ts) {
            SnapshotInspectorProjection.relativeAge(lastTransition?.ts.orEmpty(), System.currentTimeMillis())
        }
    val message = context.getString(R.string.translation_debugger_inspector_emptyOutsideWindow, formatAge(age))
    EmptyState(
        message = message,
        modifier = Modifier.fillMaxWidth(),
        action = onJumpToLast?.let { EmptyStateAction(label = strings.jumpToLast, onClick = it) },
    )
}

/**
 * The selected-transition body — the always-on header (title + Copy) and From/To/Trigger/Duration grid above
 * the signals section. The signals body switches on [surface]: a loading skeleton, a hard error with retry, or
 * the ready rows (with a freshness chip over stale/offline/refreshing data and the no-signals empty state).
 */
@Composable
private fun SelectedSnapshot(
    surface: SnapshotSurface,
    fsmType: String,
    transition: SnapshotTransition,
    snapshotState: UiState<SignalSnapshotResponse>,
    previousSnapshot: SignalSnapshotResponse?,
    diffMode: Boolean,
    onDiffModeChange: (Boolean) -> Unit,
    onRetry: () -> Unit,
    strings: SnapshotInspectorStrings,
    locale: Locale,
) {
    val view = remember(transition, fsmType, locale) { SnapshotInspectorProjection.transitionView(transition, fsmType, locale) }
    val payload = remember(transition, snapshotState.data) { SnapshotInspectorProjection.copyPayload(transition, snapshotState.data) }
    val rows =
        remember(snapshotState.data, previousSnapshot) {
            SnapshotInspectorProjection.rows(snapshotState.data, previousSnapshot)
        }

    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        SnapshotHeader(title = strings.title, copyPayload = payload, strings = strings)
        TransitionGrid(view = view, strings = strings)
        SignalsHeader(strings = strings, diffMode = diffMode, onDiffModeChange = onDiffModeChange)
        when (surface) {
            SnapshotSurface.SelectedLoading -> SignalsSkeleton()
            SnapshotSurface.SelectedError -> SignalsError(strings = strings, onRetry = onRetry)
            else -> SignalsReady(rows = rows, diffMode = diffMode, snapshotState = snapshotState, strings = strings)
        }
    }
}

/** Header row — the web `PanelTitle` + the Copy-snapshot button, shown only when a payload exists. */
@Composable
private fun SnapshotHeader(
    title: String,
    copyPayload: String,
    strings: SnapshotInspectorStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PanelTitle(title, modifier = Modifier.weight(1f))
        if (copyPayload.isNotEmpty()) {
            CopyButton(text = copyPayload, copyLabel = strings.copy, copiedLabel = strings.copied)
        }
    }
}

/** The From/To/Trigger/Duration grid — the web `grid-cols-2 sm:grid-cols-4`, laid out as a 2×2 grid. */
@Composable
private fun TransitionGrid(
    view: SnapshotTransitionView,
    strings: SnapshotInspectorStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GridCell(label = strings.from, modifier = Modifier.weight(1f)) {
                StateBadgeChip(state = view.fromState, variant = view.fromVariant)
            }
            GridCell(label = strings.to, modifier = Modifier.weight(1f)) {
                StateBadgeChip(state = view.toState, variant = view.toVariant)
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            GridCell(label = strings.trigger, modifier = Modifier.weight(1f)) {
                BodyText(view.trigger)
            }
            GridCell(label = strings.duration, modifier = Modifier.weight(1f)) {
                BodyText(view.durationLabel)
            }
        }
    }
}

/** One labeled grid cell — the muted [label] caption above its [content]. */
@Composable
private fun GridCell(
    label: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(modifier = modifier) {
        Caption(label)
        Spacer(Modifier.height(Spacing.xs))
        content()
    }
}

/** A state pill — the web `StateBadge` (a colored dot + the state text), tinted by its FSM variant. */
@Composable
private fun StateBadgeChip(
    state: String,
    variant: FsmBadgeVariant,
) {
    Badge(text = state, variant = badgeVariantFor(variant), dot = true)
}

/** Signals section header — the web `PanelTitle` + the "Diff vs previous" toggle. */
@Composable
private fun SignalsHeader(
    strings: SnapshotInspectorStrings,
    diffMode: Boolean,
    onDiffModeChange: (Boolean) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PanelTitle(strings.signalsTitle, modifier = Modifier.weight(1f))
        Caption(strings.diffMode)
        Spacer(Modifier.width(Spacing.sm))
        Toggle(
            checked = diffMode,
            onCheckedChange = onDiffModeChange,
            modifier = Modifier.semantics { contentDescription = strings.diffMode },
        )
    }
}

/** The ready signals body — the freshness chip over stale/offline data, then the rows or the empty state. */
@Composable
private fun SignalsReady(
    rows: List<SnapshotSignalRow>,
    diffMode: Boolean,
    snapshotState: UiState<SignalSnapshotResponse>,
    strings: SnapshotInspectorStrings,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        if (snapshotState.stale || snapshotState.refreshing || snapshotState.hasError) {
            SignalsFreshnessRow(snapshotState = snapshotState, strings = strings)
        }
        if (rows.isEmpty()) {
            NoSignals(message = strings.noSignals)
        } else {
            rows.forEach { row -> SignalRowItem(row = row, diffMode = diffMode) }
        }
    }
}

/** The refreshing / stale / offline freshness chip — the honest "last known + auto-refresh" affordance. */
@Composable
private fun SignalsFreshnessRow(
    snapshotState: UiState<SignalSnapshotResponse>,
    strings: SnapshotInspectorStrings,
) {
    val formatAge = rememberFreshnessAgeFormatter()
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
        DataFreshness(
            updatedAtMillis = snapshotState.fetchedAt?.takeIf { it > 0 },
            isFetching = snapshotState.refreshing,
            isStale = snapshotState.stale,
            isError = snapshotState.hasError,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = formatAge,
        )
    }
}

/** One signal row — the name + value (and struck-through previous value in diff mode) plus a source badge. */
@Composable
private fun SignalRowItem(
    row: SnapshotSignalRow,
    diffMode: Boolean,
) {
    val dim = diffMode && !row.changed
    val highlight = diffMode && row.changed
    val rowModifier = if (dim) Modifier.fillMaxWidth().alpha(DIM_ALPHA) else Modifier.fillMaxWidth()
    Surface(
        modifier = rowModifier.semantics { contentDescription = "${row.name}: ${row.value}" },
        shape = RoundedCornerShape(Radius.sm),
        color = if (highlight) TeslaTokens.status.warning.copy(alpha = HIGHLIGHT_FILL_ALPHA) else MaterialTheme.colorScheme.surface,
        border = BorderStroke(ROW_BORDER_WIDTH, rowBorderColor(highlight)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                CodeText(row.name)
                Spacer(Modifier.height(Spacing.xs))
                BodyText(row.value)
                if (diffMode && row.changed && row.previous != null) {
                    Spacer(Modifier.height(Spacing.xs))
                    StruckPreviousValue(row.previous)
                }
            }
            SourceLayerBadge(source = row.source, ageMs = row.ageMs, description = sourceDescription(row.source))
        }
    }
}

/** The previous value in diff mode — struck through, muted (the web `line-through text-[var(--text-muted)]`). */
@Composable
private fun StruckPreviousValue(previous: String) {
    Text(
        text = previous,
        style =
            MaterialTheme.typography.labelSmall.copy(
                fontFamily = FontFamily.Monospace,
                textDecoration = TextDecoration.LineThrough,
            ),
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** First-load skeleton for the signals list — shimmering rows so the section is never blank while loading. */
@Composable
private fun SignalsSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(widthFraction = SKELETON_ROW_FRACTION, height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface for the signals feed with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun SignalsError(
    strings: SnapshotInspectorStrings,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = strings.errorMessage,
        title = strings.errorTitle,
        onRetry = onRetry,
        retryLabel = strings.retry,
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The "no signals captured" empty state — a bordered, centered muted message (never a blank box). */
@Composable
private fun NoSignals(message: String) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.sm),
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(ROW_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(vertical = Spacing.lg, horizontal = Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BodyText(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** Maps the projected [FsmBadgeVariant] to the shared [BadgeVariant] — web `getStateColor` variant. */
private fun badgeVariantFor(variant: FsmBadgeVariant): BadgeVariant =
    when (variant) {
        FsmBadgeVariant.Success -> BadgeVariant.Success
        FsmBadgeVariant.Warning -> BadgeVariant.Warning
        FsmBadgeVariant.Danger -> BadgeVariant.Danger
        FsmBadgeVariant.Info -> BadgeVariant.Info
        FsmBadgeVariant.Neutral -> BadgeVariant.Neutral
    }

@Composable
private fun rowBorderColor(highlight: Boolean): Color =
    if (highlight) {
        TeslaTokens.status.warning.copy(alpha = HIGHLIGHT_BORDER_ALPHA)
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }

/** Localized TalkBack description for a source-layer badge — the web `sourceLayer.{layer}.desc`. */
@Composable
private fun sourceDescription(source: String?): String =
    when (parseSourceLayer(source)) {
        SignalSourceLayer.L1 -> stringResource(R.string.translation_sourceLayer_l1_desc)
        SignalSourceLayer.L2 -> stringResource(R.string.translation_sourceLayer_l2_desc)
        SignalSourceLayer.Log -> stringResource(R.string.translation_sourceLayer_log_desc)
        SignalSourceLayer.Stale -> stringResource(R.string.translation_sourceLayer_stale_desc)
        SignalSourceLayer.Unknown -> stringResource(R.string.translation_sourceLayer_unknown_desc)
    }

/**
 * Builds the localized [SnapshotInspectorStrings] from the i18n catalog (P1/S10) — the `debugger.inspector.*`
 * keys plus the error/freshness commons the lifecycle chrome reads.
 */
@Composable
private fun rememberSnapshotInspectorStrings(): SnapshotInspectorStrings =
    SnapshotInspectorStrings(
        title = stringResource(R.string.translation_debugger_inspector_title),
        copy = stringResource(R.string.translation_debugger_inspector_copy),
        copied = stringResource(R.string.translation_common_copyButton_copied),
        from = stringResource(R.string.translation_debugger_inspector_from),
        to = stringResource(R.string.translation_debugger_inspector_to),
        trigger = stringResource(R.string.translation_debugger_inspector_trigger),
        duration = stringResource(R.string.translation_debugger_inspector_duration),
        signalsTitle = stringResource(R.string.translation_debugger_inspector_signalsTitle),
        diffMode = stringResource(R.string.translation_debugger_inspector_diffMode),
        noSignals = stringResource(R.string.translation_debugger_inspector_noSignals),
        empty = stringResource(R.string.translation_debugger_inspector_empty),
        jumpToLast = stringResource(R.string.translation_debugger_inspector_jumpToLast),
        loading = stringResource(R.string.translation_debugger_inspector_loading),
        refreshingLabel = stringResource(R.string.translation_common_loading),
        offlineLabel = stringResource(R.string.translation_common_offline),
        errorTitle = stringResource(R.string.translation_error_serverError_title),
        errorMessage = stringResource(R.string.translation_error_serverError_message),
        retry = stringResource(R.string.translation_common_retry),
    )

/**
 * Localized relative-age formatter for the outside-window hint — maps a [SnapshotRelativeAge] to the
 * `freshness.*` catalog strings (the web `formatRelative` phrasing), falling back to an absolute date.
 */
@Composable
private fun rememberRelativeAgeFormatter(
    zoneId: ZoneId,
    locale: Locale,
): (SnapshotRelativeAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    return remember(justNow, minutes, hours, days, zoneId, locale) {
        { age ->
            when (age) {
                SnapshotRelativeAge.Unknown -> EM_DASH
                SnapshotRelativeAge.JustNow -> justNow
                is SnapshotRelativeAge.Minutes -> minutes.format(age.value)
                is SnapshotRelativeAge.Hours -> hours.format(age.value)
                is SnapshotRelativeAge.Days -> days.format(age.value)
                is SnapshotRelativeAge.Absolute -> SnapshotInspectorProjection.formatAbsolute(age.epochMillis, zoneId, locale)
            }
        }
    }
}

/** Localized relative-age formatter for the freshness chip — the `freshness.*` keys (sibling-surface parity). */
@Composable
private fun rememberFreshnessAgeFormatter(): (FreshnessAge) -> String {
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_TRANSITION =
    SnapshotTransition(
        id = 9,
        vehicleId = 7,
        ts = "2026-03-14T11:45:00Z",
        fsmName = "vehicle",
        fromState = "driving",
        toState = "parked",
        trigger = "shift_to_park",
        details = buildJsonObject { put(DURATION_KEY, 1_834_567) },
    )

private val PREVIEW_SNAPSHOT =
    SignalSnapshotResponse(
        vehicleId = 7,
        at = "2026-03-14T11:45:00Z",
        count = 3,
        signals =
            mapOf(
                "battery_level" to SignalSnapshotEntry(value = JsonPrimitive(82), source = "l1", ageMs = 1_200),
                "charging_state" to SignalSnapshotEntry(value = JsonPrimitive("Charging"), source = "l2", ageMs = 45_000),
                "shift_state" to SignalSnapshotEntry(value = JsonPrimitive("P"), source = "log"),
            ),
    )

private val PREVIEW_PREVIOUS =
    SignalSnapshotResponse(
        vehicleId = 7,
        at = "2026-03-14T11:44:50Z",
        count = 3,
        signals =
            mapOf(
                "battery_level" to SignalSnapshotEntry(value = JsonPrimitive(80), source = "log"),
                "charging_state" to SignalSnapshotEntry(value = JsonPrimitive("Charging"), source = "log"),
                "shift_state" to SignalSnapshotEntry(value = JsonPrimitive("D"), source = "log"),
            ),
    )

@Preview(name = "Selected — signals", showBackground = true, widthDp = 420)
@Composable
private fun SelectedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = PREVIEW_TRANSITION,
            snapshot = PREVIEW_SNAPSHOT,
            previousSnapshot = PREVIEW_PREVIOUS,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Selected — no signals", showBackground = true, widthDp = 420)
@Composable
private fun SelectedEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = PREVIEW_TRANSITION,
            snapshot = SignalSnapshotResponse(vehicleId = 7, at = "2026-03-14T11:45:00Z", count = 0),
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Selected — loading", showBackground = true, widthDp = 420)
@Composable
private fun SelectedLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = PREVIEW_TRANSITION,
            snapshot = null,
            loading = true,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Selected — error", showBackground = true, widthDp = 420)
@Composable
private fun SelectedErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = PREVIEW_TRANSITION,
            snapshotState = UiState(phase = UiPhase.Error, errorKind = io.teslasync.android.data.ErrorKind.Network),
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "Selected — offline (last known)", showBackground = true, widthDp = 420)
@Composable
private fun SelectedOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = PREVIEW_TRANSITION,
            snapshotState =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    errorKind = io.teslasync.android.data.ErrorKind.Network,
                    fetchedAt = 1L,
                ),
            previousSnapshot = PREVIEW_PREVIOUS,
            logger = PreviewLogger,
        )
    }
}

@Preview(name = "No selection — prompt", showBackground = true, widthDp = 420)
@Composable
private fun PromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(fsmType = "vehicle", transition = null, snapshot = null, logger = PreviewLogger)
    }
}

@Preview(name = "No selection — outside window", showBackground = true, widthDp = 420)
@Composable
private fun OutsideWindowPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        SnapshotInspector(
            fsmType = "vehicle",
            transition = null,
            snapshot = null,
            lastTransition = PREVIEW_TRANSITION,
            inWindowCount = 0,
            onJumpToLast = {},
            logger = PreviewLogger,
        )
    }
}

private object PreviewLogger : Logger {
    override fun log(
        level: io.teslasync.shared.core.diagnostics.LogLevel,
        event: String,
        fields: Map<String, String>,
    ) = Unit
}
