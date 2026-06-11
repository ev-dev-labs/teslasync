// The native Jetpack Compose + Material 3 EndpointSidebar feature view — a parity port of
// web/src/features/admin/components/EndpointSidebar.tsx. It reproduces the web composition: a search box
// over a tag-grouped, collapsible list of parsed OpenAPI operations, each row a colored method chip beside
// a truncated mono path, the selected row marked with a left accent bar; a live endpoint count above the
// list; and the friendly "No matching endpoints" empty state when the filter clears the list.
//
// The web component receives its `endpoints` as a prop from the parent (ApiPlaygroundPage), which fetches +
// parses `/system/openapi` and renders a 10-row skeleton while loading + an error on failure. So the
// loading / content / empty / error / stale / offline envelope is REAL end-to-end (the OpenAPI fetch
// lifecycle), not invented — it flows through the shared [EndpointSidebarViewModel] (P1/S8); the view
// performs no HTTP (ADR-002). Every visible string resolves through the i18n boundary
// (`R.string.translation_playground_*` + common/a11y keys from the P1/S10 catalog), and every interactive
// element (search field, group toggles, endpoint rows, refresh control, retry) carries an accessibility
// label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/EndpointSidebar) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless content + helpers + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.endpointsidebar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.Input
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

// Method-chip geometry/typography, matching the web `MethodBadge` (`w-12 px-1.5 py-0.5 rounded
// text-[9px] font-mono font-bold` + `bg-{c}/20 text-{c}`).
private val METHOD_BADGE_WIDTH = 48.dp
private val METHOD_BADGE_H_PADDING = 6.dp
private val METHOD_BADGE_V_PADDING = 2.dp
private val METHOD_BADGE_FONT_SIZE = 9.sp
private const val METHOD_BADGE_BG_ALPHA = 0.20f

// Selected-row affordance (web `!bg-white/[0.07] border-l-2 border-cyan-400`).
private val SELECTED_BAR_WIDTH = 2.dp
private const val SELECTED_BG_ALPHA = 0.10f

// Loading chrome (web parent's `Array.from({length:10})` of `h-6 rounded` skeletons).
private const val LOADING_SKELETON_ROWS = 10
private val SKELETON_ROW_HEIGHT = 24.dp

private val TAG_LETTER_SPACING = 0.5.sp
private const val CHEVRON_OPEN_ROTATION = 180f
private val BODY_END_BORDER_WIDTH = 1.dp
private const val PREVIEW_NOW = 1_780_000_000_000L

/**
 * The colored HTTP-method chip — the web exported `MethodBadge`. A fixed-width, monospace, bold pill with a
 * low-alpha wash of the verb's accent behind the accent-colored verb text (web `METHOD_COLORS`). The verb
 * text is the accessible content; no extra description is attached.
 *
 * @param method the verb to render (its [HttpMethod.wire] spelling is shown).
 */
@Composable
fun MethodBadge(
    method: HttpMethod,
    modifier: Modifier = Modifier,
) {
    val accent = methodColor(method)
    Surface(
        modifier = modifier.width(METHOD_BADGE_WIDTH),
        shape = RoundedCornerShape(Radius.sm),
        color = accent.copy(alpha = METHOD_BADGE_BG_ALPHA),
        contentColor = accent,
    ) {
        Text(
            text = method.wire,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = METHOD_BADGE_H_PADDING, vertical = METHOD_BADGE_V_PADDING),
            style =
                MaterialTheme.typography.labelSmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = METHOD_BADGE_FONT_SIZE,
                ),
            textAlign = TextAlign.Center,
            maxLines = 1,
        )
    }
}

/**
 * Stateful entry point. Collects the shared [EndpointSidebarViewModel] state, records the one-shot
 * `view.opened` diagnostic, hoists the selected-endpoint state (web `selected` prop, owned by the parent),
 * and renders the surface. A host supplies the view-model (wired via [EndpointSidebarViewModel.factory])
 * and is notified of selection via [onEndpointSelected] (web `onSelect`).
 *
 * @param viewModel the state holder bound to the shared OpenAPI-operations feed.
 * @param onEndpointSelected invoked when a row is tapped (the web `onSelect` callback).
 */
@Composable
fun EndpointSidebar(
    viewModel: EndpointSidebarViewModel,
    modifier: Modifier = Modifier,
    onEndpointSelected: (ParsedEndpoint) -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    var selectedKey by rememberSaveable { mutableStateOf<String?>(null) }
    val endpoints = state.data?.endpoints.orEmpty()
    val selected = endpoints.firstOrNull { it.identity == selectedKey }
    EndpointSidebarContent(
        state = state,
        selected = selected,
        onSelect = { endpoint ->
            selectedKey = endpoint.identity
            onEndpointSelected(endpoint)
        },
        modifier = modifier,
        onRefresh = viewModel::refresh,
        onRetry = viewModel::retry,
    )
}

/**
 * Stateless EndpointSidebar surface — every rendered state: the loading skeleton chrome (web parent's
 * 10-row skeleton), a hard error + retry (no cached spec), and the content body (search + count +
 * collapsible tag groups) which itself narrows to the friendly search-empty state. Stale / offline data
 * auto-refreshes once (web TanStack stale refetch) while keeping the cached operations visible. Hoisted out
 * of the ViewModel so each state is preview- and screenshot-testable with hand-built [UiState] inputs.
 */
@Composable
fun EndpointSidebarContent(
    state: UiState<EndpointSidebarSnapshot>,
    selected: ParsedEndpoint?,
    onSelect: (ParsedEndpoint) -> Unit,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val borderColor = MaterialTheme.colorScheme.outlineVariant
    Surface(
        modifier = modifier.fillMaxHeight(),
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(
            modifier =
                Modifier.fillMaxHeight().drawBehind {
                    val strokeWidth = BODY_END_BORDER_WIDTH.toPx()
                    drawRect(
                        color = borderColor,
                        topLeft = Offset(size.width - strokeWidth, 0f),
                        size = Size(strokeWidth, size.height),
                    )
                },
        ) {
            when {
                state.isLoading -> EndpointSidebarLoading()
                state.isError -> EndpointSidebarError(state = state, onRetry = onRetry)
                else -> EndpointSidebarBody(state = state, selected = selected, onSelect = onSelect, onRefresh = onRefresh)
            }
        }
    }
}

/** Content body — the search box, the optional freshness chip, the endpoint count, and the grouped list. */
@Composable
private fun EndpointSidebarBody(
    state: UiState<EndpointSidebarSnapshot>,
    selected: ParsedEndpoint?,
    onSelect: (ParsedEndpoint) -> Unit,
    onRefresh: () -> Unit,
) {
    val endpoints = state.data?.endpoints.orEmpty()
    var search by rememberSaveable { mutableStateOf("") }
    val display = EndpointSidebarProjection.display(endpoints, search)

    val searchLabel = stringResource(R.string.translation_playground_search)
    val endpointsWord = stringResource(R.string.translation_playground_endpoints)
    val noResults = stringResource(R.string.translation_playground_noResults)

    Column(modifier = Modifier.fillMaxHeight()) {
        Input(
            value = search,
            onValueChange = { search = it },
            modifier = Modifier.padding(Spacing.sm),
            label = searchLabel,
            leadingIcon = EndpointSidebarGlyphs.Search,
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        if (state.stale || state.hasError || state.refreshing) {
            EndpointSidebarFreshness(state = state, onRefresh = onRefresh)
        }
        Caption(
            text = "${display.matchCount} $endpointsWord",
            modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs),
        )
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        LazyColumn(modifier = Modifier.fillMaxWidth().weight(1f)) {
            items(items = display.groups, key = { it.tag }) { group ->
                EndpointTagGroupItem(
                    group = group,
                    selected = selected,
                    groupCount = display.groupCount,
                    onSelect = onSelect,
                )
            }
            if (!display.hasResults) {
                item { EndpointSidebarEmpty(message = noResults) }
            }
        }
    }
}

/** One collapsible tag group — the web `TagGroup` (chevron + UPPER tag + count header over its rows). */
@Composable
private fun EndpointTagGroupItem(
    group: EndpointTagGroup,
    selected: ParsedEndpoint?,
    groupCount: Int,
    onSelect: (ParsedEndpoint) -> Unit,
) {
    val defaultOpen = EndpointSidebarProjection.isDefaultOpen(group.tag, selected, groupCount)
    var open by rememberSaveable(group.tag) { mutableStateOf(defaultOpen) }
    val rotation by animateFloatAsState(
        targetValue = if (open) CHEVRON_OPEN_ROTATION else 0f,
        label = "endpoint-tag-chevron",
    )
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .clickable(role = Role.Button) { open = !open }
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            Icon(
                imageVector = TeslaGlyphs.ChevronDown,
                contentDescription = null,
                size = IconSize.Xs,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.rotate(rotation),
            )
            Text(
                text = group.tag.uppercase(),
                modifier = Modifier.weight(1f),
                style =
                    MaterialTheme.typography.labelMedium.copy(
                        fontWeight = FontWeight.SemiBold,
                        letterSpacing = TAG_LETTER_SPACING,
                    ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = group.count.toString(),
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = FontFamily.Monospace),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        AnimatedVisibility(visible = open) {
            Column(modifier = Modifier.fillMaxWidth()) {
                group.endpoints.forEach { endpoint ->
                    EndpointRow(
                        endpoint = endpoint,
                        isSelected = selected?.identity == endpoint.identity,
                        onSelect = onSelect,
                    )
                }
            }
        }
    }
}

/** One endpoint row — the web row button: a [MethodBadge] beside a truncated mono path, selected-aware. */
@Composable
private fun EndpointRow(
    endpoint: ParsedEndpoint,
    isSelected: Boolean,
    onSelect: (ParsedEndpoint) -> Unit,
) {
    val accent = MaterialTheme.colorScheme.primary
    val rowLabel = endpointRowLabel(endpoint)
    val selectionModifier =
        if (isSelected) {
            Modifier
                .background(accent.copy(alpha = SELECTED_BG_ALPHA))
                .drawBehind { drawRect(color = accent, size = Size(SELECTED_BAR_WIDTH.toPx(), size.height)) }
        } else {
            Modifier
        }
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button) { onSelect(endpoint) }
                .then(selectionModifier)
                .padding(horizontal = Spacing.md, vertical = Spacing.xs)
                .semantics {
                    contentDescription = rowLabel
                    selected = isSelected
                },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        MethodBadge(endpoint.method)
        Text(
            text = endpoint.path,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The stale / offline freshness chip + refresh control, shown only over a degraded cached catalog. */
@Composable
private fun EndpointSidebarFreshness(
    state: UiState<EndpointSidebarSnapshot>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = Spacing.md, vertical = Spacing.xs),
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

/** The friendly search-empty / data-empty surface — the web "No matching endpoints" branch. */
@Composable
private fun EndpointSidebarEmpty(
    message: String,
    modifier: Modifier = Modifier,
) {
    EmptyState(
        message = message,
        icon = EndpointSidebarGlyphs.Search,
        modifier = modifier.fillMaxWidth(),
    )
}

/** Loading skeleton chrome — ten shimmering rounded rows (web parent's 10-row sidebar skeleton). */
@Composable
private fun EndpointSidebarLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().padding(Spacing.lg).semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_SKELETON_ROWS) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Hard-error surface — the [QueryError] retry affordance (web parent's spec-fetch error). */
@Composable
private fun EndpointSidebarError(
    state: UiState<EndpointSidebarSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier.fillMaxWidth().padding(Spacing.md),
        contentAlignment = Alignment.Center,
    ) {
        QueryError(
            kind = queryErrorKindFor(state),
            resourceName = stringResource(R.string.translation_playground_title),
            onRetry = onRetry,
        )
    }
}

/**
 * Maps a verb to its accent [Color] — the native port of the web `METHOD_COLORS` map: GET → success green,
 * POST → chart speed blue, PUT → warning amber, DELETE → danger red, PATCH → chart power purple. The dark
 * tokens equal the web's Tailwind accents closely and stay theme-correct in light / high-contrast.
 */
@Composable
private fun methodColor(method: HttpMethod): Color =
    when (method) {
        HttpMethod.Get -> TeslaTokens.status.success
        HttpMethod.Post -> TeslaTokens.chart.speed
        HttpMethod.Put -> TeslaTokens.status.warning
        HttpMethod.Delete -> TeslaTokens.status.danger
        HttpMethod.Patch -> TeslaTokens.chart.power
    }

/** The TalkBack label for a row — the verb + path, plus the web `title={summary}` when present. */
private fun endpointRowLabel(endpoint: ParsedEndpoint): String =
    if (endpoint.summary.isBlank()) {
        "${endpoint.method.wire} ${endpoint.path}"
    } else {
        "${endpoint.method.wire} ${endpoint.path}, ${endpoint.summary}"
    }

/** Folds a hard failure onto a [QueryErrorKind] (network/timeout → offline, circuit-open → waiting). */
private fun queryErrorKindFor(state: UiState<*>): QueryErrorKind =
    classifyQueryError(
        status = state.httpStatus,
        online = state.errorKind != ErrorKind.Network && state.errorKind != ErrorKind.Timeout,
        transientWaiting = state.errorKind == ErrorKind.CircuitOpen,
    )

// ── Previews — one per rendered state (content / selected / empty / loading / error / offline) ──────────

/** A small fixed catalog used only by the @Preview entry points below (never shipped as runtime data). */
private val previewEndpoints: List<ParsedEndpoint> =
    listOf(
        ParsedEndpoint(HttpMethod.Get, "/vehicles", "Vehicles", "List vehicles", operationId = "listVehicles"),
        ParsedEndpoint(HttpMethod.Get, "/vehicles/{vehicleID}/state", "Vehicles", "Vehicle state", operationId = "vehicleState"),
        ParsedEndpoint(HttpMethod.Post, "/vehicles/{vehicleID}/command", "Vehicles", "Send command", operationId = "sendCommand"),
        ParsedEndpoint(HttpMethod.Get, "/charging", "Charging", "List sessions", operationId = "listCharging"),
        ParsedEndpoint(HttpMethod.Delete, "/alerts/rules/{ruleID}", "Alerts", "Delete rule", operationId = "deleteRule"),
    )

private val previewSnapshot = EndpointSidebarSnapshot(previewEndpoints)

@Preview(name = "EndpointSidebar · content", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarContentPreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot, fetchedAt = PREVIEW_NOW),
            selected = null,
            onSelect = {},
        )
    }
}

@Preview(name = "EndpointSidebar · selected", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarSelectedPreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(
            state = UiState(phase = UiPhase.Content, data = previewSnapshot, fetchedAt = PREVIEW_NOW),
            selected = previewEndpoints.first(),
            onSelect = {},
        )
    }
}

@Preview(name = "EndpointSidebar · empty", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarEmptyPreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(
            state = UiState(phase = UiPhase.Empty, data = EndpointSidebarSnapshot.EMPTY, fetchedAt = PREVIEW_NOW),
            selected = null,
            onSelect = {},
        )
    }
}

@Preview(name = "EndpointSidebar · loading", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarLoadingPreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(state = UiState.loading(), selected = null, onSelect = {})
    }
}

@Preview(name = "EndpointSidebar · error", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarErrorPreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            selected = null,
            onSelect = {},
        )
    }
}

@Preview(name = "EndpointSidebar · offline", showBackground = true, widthDp = 300, heightDp = 640)
@Composable
private fun EndpointSidebarOfflinePreview() {
    TeslaSyncTheme {
        EndpointSidebarContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewSnapshot,
                    fetchedAt = PREVIEW_NOW,
                    stale = true,
                    errorKind = ErrorKind.Timeout,
                ),
            selected = null,
            onSelect = {},
        )
    }
}
