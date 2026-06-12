// The native Jetpack Compose + Material 3 FSMStateDiagram feature view — a parity port of
// web/src/features/system/components/FSMStateDiagram.tsx. The web component is purely presentational: its
// parent (the FSM state-machine debugger page) owns the `useFSMTransitions` query and passes the
// `transitions` array + the selected `fsmType` down; the component's only hook is `useTranslation`. It
// renders an always-visible `<h2>` heading followed by either a friendly `EmptyState` ("select a specific
// FSM type" — the `!states || !edges` branch) or the state diagram: a wrapping row of state nodes (a colored
// dot, the state name, a transition count, a pulsing "current state" marker, dimmed when the state has no
// transitions) joined by arrows carrying per-edge counts, then a summary chip row of the busiest transitions.
//
// The native surface keeps that contract — it binds no data hook of its own. The host supplies the
// transitions through the shared P1/S8 state-holder layer (the FsmStore feed) as a [UiState], so this
// feature view also renders every lifecycle state that layer can carry — loading skeleton, hard error with
// retry, content, empty, and stale/offline ("last known") — without ever fetching. The heading, empty, and
// diagram branches reproduce the web component exactly; the lifecycle chrome mirrors the sibling surfaces. A
// web-parity overload that takes the raw `transitions` list is also provided for hosts that already hold it.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FSMStateDiagram — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.fsmstatediagram

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

// Web `<FadeIn delay={0.2}>` — the section entrance delay in milliseconds. FadeIn honours reduce-motion.
private const val FADE_DELAY_MS = 200
private const val SKELETON_NODE_COUNT = 5
private const val DIMMED_ALPHA = 0.5f
private const val PULSE_MIN_ALPHA = 0.35f
private const val PULSE_PERIOD_MS = 1_200
private val NODE_MIN_WIDTH: Dp = 76.dp
private val STATUS_DOT: Dp = 8.dp
private val CURRENT_DOT: Dp = 8.dp
private val ARROW_WIDTH: Dp = 18.dp
private val SKELETON_NODE_WIDTH: Dp = 72.dp
private val SKELETON_NODE_HEIGHT: Dp = 44.dp

/**
 * Stateful entry point. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and renders every
 * lifecycle [state] the shared FSM-transitions feed can carry for the selected [fsmType]. The host owns the
 * feed (P1/S8 FsmStore) and supplies [onRetry] (the feed's refetch); this view never performs HTTP.
 *
 * @param fsmType the web-parent's selected FSM filter (e.g. `vehicle`, `telemetry_connection`); an unknown
 *   value such as `all` renders the "select a specific FSM type" empty state.
 * @param state the cache-then-network projection of the parsed `transitions` array (web `useFSMTransitions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FSMStateDiagram(
    fsmType: String,
    state: UiState<List<FsmTransitionRow>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) {
        logger.info("view.opened", mapOf("surface" to FSM_STATE_DIAGRAM_SLUG))
    }
    FSMStateDiagramContent(fsmType = fsmType, state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `fsmType` + `transitions: FSMTransition[]` props, for
 * hosts that already hold the parsed list. Like the web component it has no loading/error surface of its own
 * (it always renders content); a `null`/empty list still renders — the diagram with dimmed nodes for a known
 * [fsmType], or the empty state for an unknown one. Records `view.opened` like the stateful entry; with no
 * fetch behind it there is no retry affordance.
 */
@Composable
fun FSMStateDiagram(
    fsmType: String,
    transitions: List<FsmTransitionRow>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(transitions) {
            UiState(phase = UiPhase.Content, data = transitions ?: emptyList())
        }
    FSMStateDiagram(fsmType = fsmType, state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web component's
 * always-on heading and its diagram/empty branches, and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton, a hard-error retry surface, and a freshness chip that reflects refreshing/stale/offline.
 * Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 */
@Composable
fun FSMStateDiagramContent(
    fsmType: String,
    state: UiState<List<FsmTransitionRow>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    strings: FsmStateDiagramStrings = rememberFsmStateDiagramStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val palette = rememberFsmTonePalette()

    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Md) {
            // Web `<h2>` — always visible, above every state.
            SectionTitle(strings.title)
            Spacer(Modifier.height(Spacing.md))
            when (fsmStateDiagramSurfaceFor(state.isLoading, state.isError)) {
                FsmStateDiagramSurface.Loading ->
                    FsmStateDiagramLoading(label = stringResource(R.string.translation_common_loading))
                FsmStateDiagramSurface.Error -> FsmStateDiagramError(onRetry = onRetry)
                FsmStateDiagramSurface.Ready ->
                    FsmStateDiagramReady(
                        fsmType = fsmType,
                        state = state,
                        strings = strings,
                        palette = palette,
                    )
            }
        }
    }
}

@Composable
private fun FsmStateDiagramReady(
    fsmType: String,
    state: UiState<List<FsmTransitionRow>>,
    strings: FsmStateDiagramStrings,
    palette: FsmTonePalette,
) {
    val formatAge = rememberFsmFreshnessFormatter()
    if (state.stale || state.refreshing || state.hasError) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
            horizontalArrangement = Arrangement.End,
        ) {
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
    val content =
        remember(fsmType, state.data) {
            FsmStateDiagramProjection.project(fsmType, state.data ?: emptyList())
        }
    if (content == null) {
        // Web `if (!states || !edges)` — unknown fsmType (e.g. `all`): the select-a-type empty state.
        EmptyState(message = strings.selectFsmType, modifier = Modifier.fillMaxWidth())
    } else {
        FsmDiagram(content = content, title = strings.title, palette = palette)
    }
}

/** The diagram body — the wrapping node row (with arrows + counts) and the busiest-edge summary chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FsmDiagram(
    content: FsmDiagramContent,
    title: String,
    palette: FsmTonePalette,
) {
    val currentLabel = stringResource(R.string.translation_fsm_currentState)
    FlowRow(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = title },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        content.nodes.forEach { node ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                StateNode(node = node, palette = palette, currentLabel = currentLabel)
                if (node.hasArrow) {
                    EdgeArrow(count = node.arrowCountToNext)
                }
            }
        }
    }
    if (content.edgeSummary.isNotEmpty()) {
        Spacer(Modifier.height(Spacing.md))
        EdgeSummary(edges = content.edgeSummary, palette = palette)
    }
}

/**
 * One state node — a bordered chip with a tone dot, the state name, an optional transition count, and a
 * pulsing "current" marker. Inactive states (no transitions) render dimmed, never hidden (web `opacity-50`).
 */
@Composable
private fun StateNode(
    node: FsmStateNodeVm,
    palette: FsmTonePalette,
    currentLabel: String,
) {
    val toneColor = palette.colorFor(node.tone)
    val border = nodeBorderColor(node)
    val nodeAlpha = if (!node.isActive && !node.isCurrent) DIMMED_ALPHA else 1f
    val background =
        if (node.isCurrent) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent
    Box(modifier = Modifier.alpha(nodeAlpha)) {
        Column(
            modifier =
                Modifier
                    .widthIn(min = NODE_MIN_WIDTH)
                    .clip(RoundedCornerShape(Radius.sm))
                    .background(background)
                    .border(width = if (node.isCurrent) 1.5.dp else 1.dp, color = border, shape = RoundedCornerShape(Radius.sm))
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm)
                    .semantics(mergeDescendants = true) {},
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(modifier = Modifier.size(STATUS_DOT).clip(CircleShape).background(toneColor))
            Text(
                text = node.name,
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
                color = toneColor,
            )
            if (node.count > 0) {
                Caption(node.count.toString())
            }
        }
        if (node.isCurrent) {
            CurrentPulse(
                modifier = Modifier.align(Alignment.TopEnd),
                label = currentLabel,
            )
        }
    }
}

/** The pulsing "current state" indicator (web `bg-green-400 animate-pulse`); static when motion is reduced. */
@Composable
private fun CurrentPulse(
    modifier: Modifier = Modifier,
    label: String,
) {
    val reduce = rememberReducedMotion()
    val pulseAlpha =
        if (reduce) {
            1f
        } else {
            val transition = rememberInfiniteTransition(label = "fsm-current-pulse")
            val animated by transition.animateFloat(
                initialValue = 1f,
                targetValue = PULSE_MIN_ALPHA,
                animationSpec =
                    infiniteRepeatable(
                        animation = tween(PULSE_PERIOD_MS),
                        repeatMode = RepeatMode.Reverse,
                    ),
                label = "fsm-current-pulse-alpha",
            )
            animated
        }
    Box(
        modifier =
            modifier
                .size(CURRENT_DOT)
                .alpha(pulseAlpha)
                .clip(CircleShape)
                .background(TeslaTokens.status.success)
                .semantics { contentDescription = label },
    )
}

/** A transition arrow between two consecutive nodes, with the edge's transition count above it when present. */
@Composable
private fun EdgeArrow(count: Int?) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (count != null) {
            Caption(count.toString())
        }
        Icon(
            imageVector = FeedbackGlyphs.ArrowRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.widthIn(min = ARROW_WIDTH),
        )
    }
}

/** The busiest-edge summary — a wrapping row of `from -> to xcount` chips (web edge summary section). */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EdgeSummary(
    edges: List<FsmEdgeSummaryVm>,
    palette: FsmTonePalette,
) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        edges.forEach { edge ->
            Row(
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(Radius.sm))
                        .background(MaterialTheme.colorScheme.surfaceVariant)
                        .padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(
                    text = edge.from,
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.colorFor(edge.fromTone),
                )
                Caption(EDGE_ARROW_GLYPH)
                Text(
                    text = edge.to,
                    style = MaterialTheme.typography.labelSmall,
                    color = palette.colorFor(edge.toTone),
                )
                Caption(EDGE_COUNT_PREFIX + edge.count)
            }
        }
    }
}

/** First-load skeleton — shimmering node skeletons so the panel is never blank while loading. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FsmStateDiagramLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_NODE_COUNT) {
            Box(modifier = Modifier.widthIn(min = SKELETON_NODE_WIDTH)) {
                Skeleton(height = SKELETON_NODE_HEIGHT, rounded = true)
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun FsmStateDiagramError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** Resolved per-theme tone palette, mapping each semantic [FsmStateTone] to a design token (never raw hex). */
private class FsmTonePalette(
    private val success: Color,
    private val warning: Color,
    private val danger: Color,
    private val info: Color,
    private val neutral: Color,
) {
    fun colorFor(tone: FsmStateTone): Color =
        when (tone) {
            FsmStateTone.Success -> success
            FsmStateTone.Warning -> warning
            FsmStateTone.Danger -> danger
            FsmStateTone.Info -> info
            FsmStateTone.Neutral -> neutral
        }
}

@Composable
private fun rememberFsmTonePalette(): FsmTonePalette {
    val success = TeslaTokens.status.success
    val warning = TeslaTokens.status.warning
    val danger = TeslaTokens.status.danger
    val info = TeslaTokens.status.info
    val neutral = MaterialTheme.colorScheme.onSurfaceVariant
    return remember(success, warning, danger, info, neutral) {
        FsmTonePalette(success = success, warning = warning, danger = danger, info = info, neutral = neutral)
    }
}

@Composable
private fun nodeBorderColor(node: FsmStateNodeVm): Color =
    when {
        node.isCurrent -> MaterialTheme.colorScheme.onSurface.copy(alpha = NODE_BORDER_CURRENT_ALPHA)
        node.isActive -> MaterialTheme.colorScheme.outlineVariant
        else -> MaterialTheme.colorScheme.outlineVariant.copy(alpha = NODE_BORDER_INACTIVE_ALPHA)
    }

/**
 * Resolves the localized [FsmStateDiagramStrings] from the i18n catalog (P1/S10) — the `fsm.*` keys the web
 * component reads via `t(...)`. Both already exist in the shared catalog.
 */
@Composable
private fun rememberFsmStateDiagramStrings(): FsmStateDiagramStrings {
    val title = stringResource(R.string.translation_fsm_stateDiagram)
    val selectFsmType = stringResource(R.string.translation_fsm_selectFsmType)
    return remember(title, selectFsmType) {
        FsmStateDiagramStrings(title = title, selectFsmType = selectFsmType)
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFsmFreshnessFormatter(): (FreshnessAge) -> String {
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

private const val NODE_BORDER_CURRENT_ALPHA = 0.7f
private const val NODE_BORDER_INACTIVE_ALPHA = 0.4f
private const val EM_DASH = "\u2014"
private const val EDGE_ARROW_GLYPH = "\u2192"
private const val EDGE_COUNT_PREFIX = "\u00D7"

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_STRINGS =
    FsmStateDiagramStrings(
        title = "State Diagram",
        selectFsmType = "Select a specific FSM type to view its state diagram",
    )

private fun previewTransitions(): List<FsmTransitionRow> =
    listOf(
        FsmTransitionRow("vehicle", "online", "driving", "2026-06-11T10:00:00Z"),
        FsmTransitionRow("vehicle", "driving", "parked", "2026-06-11T10:30:00Z"),
        FsmTransitionRow("vehicle", "parked", "charging", "2026-06-11T11:00:00Z"),
        FsmTransitionRow("vehicle", "charging", "parked", "2026-06-11T12:00:00Z"),
        FsmTransitionRow("vehicle", "parked", "asleep", "2026-06-11T12:30:00Z"),
    )

@Preview(name = "Diagram", showBackground = true)
@Composable
private fun FsmStateDiagramDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMStateDiagramContent(
            fsmType = "vehicle",
            state = UiState(phase = UiPhase.Content, data = previewTransitions()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty (unknown type)", showBackground = true)
@Composable
private fun FsmStateDiagramEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMStateDiagramContent(
            fsmType = "all",
            state = UiState(phase = UiPhase.Content, data = emptyList()),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun FsmStateDiagramLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMStateDiagramContent(
            fsmType = "vehicle",
            state = UiState.loading(),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun FsmStateDiagramErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FSMStateDiagramContent(
            fsmType = "vehicle",
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            strings = PREVIEW_STRINGS,
        )
    }
}
