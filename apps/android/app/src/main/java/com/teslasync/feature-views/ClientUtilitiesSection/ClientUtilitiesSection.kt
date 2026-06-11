// The native Jetpack Compose + Material 3 Client Utilities feature view — a parity port of
// web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx. It reproduces the web composition:
// a search box over a list of expandable tool cards (each an icon chip + name + description + chevron that
// toggles open to host the tool's own surface), narrowing to the "No tools match your search" empty state
// when the filter clears the list. All data flows through the shared [ClientUtilitiesSectionViewModel]
// (P1/S8); the view performs no HTTP. Every string resolves through the i18n catalog (P1/S10) — the four
// catalog-backed keys via `R.string`, the remaining tool labels via the web i18next key-as-fallback — and
// every interactive element carries an accessibility label. The interactive body of each tool is a
// separate surface (the per-tool `*Tool` prompts), supplied by the host via the [toolContent] slot (the
// native equivalent of the web `<tool.Component />`), so this surface stays decoupled from them.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ClientUtilitiesSection) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.feature.views.clientutilities

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.MotionDefaults
import io.teslasync.android.components.motion.rememberMotionDurationMs
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private val BODY_MIN_HEIGHT = 120.dp
private val SEARCH_MAX_WIDTH = 420.dp
private val SEARCH_SKELETON_HEIGHT = 48.dp
private val CHIP_SIZE = 40.dp
private val CHIP_CORNER = Radius.md
private const val CHEVRON_COLLAPSED = 0f
private const val CHEVRON_EXPANDED = 180f
private const val CHIP_BG_ALPHA = 0.12f
private const val CHIP_BORDER_ALPHA = 0.28f
private const val SKELETON_CARD_COUNT = 4
private const val SKELETON_TITLE_FRACTION = 0.45f
private const val SKELETON_DESC_FRACTION = 0.75f
private val SKELETON_TITLE_HEIGHT = 14.dp
private val SKELETON_DESC_HEIGHT = 12.dp

/**
 * Stateful entry point. Collects the shared [ClientUtilitiesSectionViewModel] state, records the one-shot
 * `view.opened` diagnostic, and renders the surface. A host supplies the view-model (wired via
 * [ClientUtilitiesSectionViewModel.factory]) and the [toolContent] slot that maps each tool id to its own
 * surface composable (the per-tool `*Tool` prompts) — the native equivalent of the web `<tool.Component />`.
 *
 * @param viewModel the state holder bound to the shared tool-registry feed.
 * @param toolContent renders the interactive body for an expanded tool (host-provided; out of this scope).
 */
@Composable
fun ClientUtilitiesSection(
    viewModel: ClientUtilitiesSectionViewModel,
    modifier: Modifier = Modifier,
    toolContent: @Composable (ClientUtilityToolId) -> Unit,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    ClientUtilitiesSectionContent(
        state = state,
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
        toolContent = toolContent,
    )
}

/**
 * Stateless Client Utilities surface — renders every state: loading skeleton chrome, a hard error +
 * retry, the data-empty state, and the content body (search + expandable cards), plus the stale / offline
 * freshness chip over the cached registry. Stale (non-error) data auto-refreshes once (web TanStack stale
 * refetch). Hoisted out of the ViewModel so each state is preview- and screenshot-testable with hand-built
 * [UiState] inputs. The search query and the expanded card are local UI state (web `useState`).
 */
@Composable
fun ClientUtilitiesSectionContent(
    state: UiState<ClientUtilitiesSnapshot>,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
    toolContent: @Composable (ClientUtilityToolId) -> Unit,
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    when {
        state.isLoading -> ClientUtilitiesLoading(modifier)
        state.isError -> ClientUtilitiesError(state = state, onRetry = onRetry, modifier = modifier)
        else -> ClientUtilitiesBody(state = state, onRefresh = onRefresh, toolContent = toolContent, modifier = modifier)
    }
}

/** Content body — the freshness chip (stale/offline only), the search box, and the filtered tool grid. */
@Composable
private fun ClientUtilitiesBody(
    state: UiState<ClientUtilitiesSnapshot>,
    onRefresh: () -> Unit,
    toolContent: @Composable (ClientUtilityToolId) -> Unit,
    modifier: Modifier = Modifier,
) {
    val searchHint = stringResource(R.string.translation_devtools_searchTools)
    val noResults = stringResource(R.string.translation_devtools_noToolsFound)
    val resolved = resolveTools(state.data?.tools ?: emptyList())
    var search by rememberSaveable { mutableStateOf("") }
    var expandedSlug by rememberSaveable { mutableStateOf<String?>(null) }
    val display = ClientUtilitiesProjection.filter(resolved, search)

    Column(
        modifier = modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (state.stale || state.hasError || state.refreshing) {
            ClientUtilitiesFreshness(state = state, onRefresh = onRefresh)
        }
        Input(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.widthIn(max = SEARCH_MAX_WIDTH),
            label = searchHint,
        )
        if (!display.hasResults) {
            ClientUtilitiesEmpty(message = noResults)
        } else {
            display.tools.forEach { tool ->
                ExpandableToolCard(
                    tool = tool,
                    expanded = expandedSlug == tool.id.slug,
                    onToggle = { expandedSlug = if (expandedSlug == tool.id.slug) null else tool.id.slug },
                    toolContent = toolContent,
                )
            }
        }
    }
}

/** One expandable tool card — icon chip + name + description + chevron; expands to host [toolContent]. */
@Composable
private fun ExpandableToolCard(
    tool: ResolvedClientUtility,
    expanded: Boolean,
    onToggle: () -> Unit,
    toolContent: @Composable (ClientUtilityToolId) -> Unit,
) {
    val durationMs = rememberMotionDurationMs(MotionDefaults.TRANSITION_MS)
    val chevronRotation by animateFloatAsState(
        targetValue = if (expanded) CHEVRON_EXPANDED else CHEVRON_COLLAPSED,
        animationSpec = tween(durationMs),
        label = "clientUtilityChevron",
    )
    GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.None) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button, onClick = onToggle)
                    .padding(Spacing.md)
                    .semantics(mergeDescendants = true) {},
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ToolIconChip(icon = tool.icon, accent = tool.accent)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                PanelTitle(tool.name)
                Caption(tool.description)
            }
            Icon(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Sm,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(chevronRotation),
            )
        }
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn(tween(durationMs)) + expandVertically(tween(durationMs)),
            exit = fadeOut(tween(durationMs)) + shrinkVertically(tween(durationMs)),
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = CHIP_BG_ALPHA))
                Box(modifier = Modifier.fillMaxWidth().padding(Spacing.md)) {
                    toolContent(tool.id)
                }
            }
        }
    }
}

/** The colored, rounded icon chip behind a tool's glyph (web neon `ICON_COLOR_MAP` chip). */
@Composable
private fun ToolIconChip(
    icon: ImageVector,
    accent: ClientUtilityAccent,
) {
    val color = accentColor(accent)
    Box(
        modifier =
            Modifier
                .size(CHIP_SIZE)
                .clip(RoundedCornerShape(CHIP_CORNER))
                .background(color.copy(alpha = CHIP_BG_ALPHA))
                .border(1.dp, color.copy(alpha = CHIP_BORDER_ALPHA), RoundedCornerShape(CHIP_CORNER)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(imageVector = icon, contentDescription = null, size = IconSize.Lg, tint = color)
    }
}

/** The stale / offline freshness chip + refresh control, shown only over a degraded cached registry. */
@Composable
private fun ClientUtilitiesFreshness(
    state: UiState<ClientUtilitiesSnapshot>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
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

/** The empty surface — the web "No tools match your search" branch (search-empty or empty registry). */
@Composable
private fun ClientUtilitiesEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = message,
        icon = ClientUtilitiesGlyphs.BookOpen,
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT),
    )
}

/** Loading skeleton chrome — a shimmering search bar over a few shimmering tool-card rows. */
@Composable
private fun ClientUtilitiesLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_DESC_FRACTION, height = SEARCH_SKELETON_HEIGHT, rounded = true)
        repeat(SKELETON_CARD_COUNT) {
            GlassPanel(modifier = Modifier.fillMaxWidth()) {
                Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                Skeleton(
                    widthFraction = SKELETON_DESC_FRACTION,
                    height = SKELETON_DESC_HEIGHT,
                    modifier = Modifier.padding(top = Spacing.sm),
                )
            }
        }
    }
}

/** Hard-error surface — the [QueryError] retry affordance (web `QueryError` equivalent). */
@Composable
private fun ClientUtilitiesError(
    state: UiState<ClientUtilitiesSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().heightIn(min = BODY_MIN_HEIGHT).padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_devtools_title),
            onRetry = onRetry,
        )
    }
}

/** Resolves each registry entry's display strings at the boundary (catalog key → `R.string`, else key). */
@Composable
private fun resolveTools(tools: List<ClientUtilityTool>): List<ResolvedClientUtility> {
    val resolved = ArrayList<ResolvedClientUtility>(tools.size)
    for (tool in tools) {
        resolved +=
            ResolvedClientUtility(
                id = tool.id,
                name = labelFor(tool.nameKey, tool.nameRes),
                description = labelFor(tool.descKey, tool.descRes),
                icon = tool.icon,
                accent = tool.accent,
            )
    }
    return resolved
}

/**
 * Resolves a web i18n key: the shared-catalog (P1/S10) string when [res] is present, otherwise the key
 * text itself — reproducing i18next's key-as-fallback (the web's behavior for the tool keys absent from the
 * locale files). Routed through this one helper so no display string is ever an unrouted literal.
 */
@Composable
private fun labelFor(
    key: String,
    res: Int?,
): String = if (res != null) stringResource(res) else key

/** Maps a tool's accent to a concrete per-theme color from the design tokens (P1/S9). */
@Composable
private fun accentColor(accent: ClientUtilityAccent): Color =
    when (accent) {
        ClientUtilityAccent.Cyan -> TeslaTokens.status.info
        ClientUtilityAccent.Green -> TeslaTokens.status.success
        ClientUtilityAccent.Purple -> TeslaTokens.chart.power
        ClientUtilityAccent.Amber -> TeslaTokens.status.warning
        ClientUtilityAccent.Red -> TeslaTokens.status.danger
    }

/** Folds a hard failure onto a [QueryErrorKind] (network/timeout → offline, circuit-open → waiting). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content / expanded / empty / loading / error / offline) ───────────

/** A representative expanded-tool body for previews (the host wires the real per-tool surface). */
@Composable
private fun PreviewToolBody() {
    BodyText(stringResource(R.string.translation_devtools_subtitle))
}

@Preview(name = "ClientUtilities · content", showBackground = true)
@Composable
private fun ClientUtilitiesContentPreview() {
    TeslaSyncTheme {
        ClientUtilitiesSectionContent(
            state = UiState(phase = UiPhase.Content, data = ClientUtilitiesCatalog.snapshot, fetchedAt = PREVIEW_NOW),
            toolContent = { PreviewToolBody() },
        )
    }
}

@Preview(name = "ClientUtilities · expanded card", showBackground = true)
@Composable
private fun ClientUtilitiesExpandedCardPreview() {
    TeslaSyncTheme {
        ExpandableToolCard(
            tool = previewResolvedTool(),
            expanded = true,
            onToggle = {},
            toolContent = { PreviewToolBody() },
        )
    }
}

@Preview(name = "ClientUtilities · empty", showBackground = true)
@Composable
private fun ClientUtilitiesEmptyPreview() {
    TeslaSyncTheme {
        ClientUtilitiesSectionContent(
            state = UiState(phase = UiPhase.Empty, data = ClientUtilitiesSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
            toolContent = { PreviewToolBody() },
        )
    }
}

@Preview(name = "ClientUtilities · loading", showBackground = true)
@Composable
private fun ClientUtilitiesLoadingPreview() {
    TeslaSyncTheme {
        ClientUtilitiesSectionContent(
            state = UiState.loading(),
            toolContent = { PreviewToolBody() },
        )
    }
}

@Preview(name = "ClientUtilities · error", showBackground = true)
@Composable
private fun ClientUtilitiesErrorPreview() {
    TeslaSyncTheme {
        ClientUtilitiesSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            toolContent = { PreviewToolBody() },
        )
    }
}

@Preview(name = "ClientUtilities · offline", showBackground = true)
@Composable
private fun ClientUtilitiesOfflinePreview() {
    TeslaSyncTheme {
        ClientUtilitiesSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = ClientUtilitiesCatalog.snapshot,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            toolContent = { PreviewToolBody() },
        )
    }
}

private fun previewResolvedTool(): ResolvedClientUtility =
    ResolvedClientUtility(
        id = ClientUtilityToolId.Vin,
        name = "VIN Decoder",
        description = "Decode a Tesla VIN",
        icon = ClientUtilitiesGlyphs.Car,
        accent = ClientUtilityAccent.Cyan,
    )

private const val PREVIEW_NOW = 1_780_000_000_000L
