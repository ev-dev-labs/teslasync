// The native Jetpack Compose + Material 3 KpiOverviewCard shared surface — a parity port of
// web/src/components/data-display/KpiOverviewCard.tsx. It composes a ComparisonHeader, a responsive grid of KPI
// tiles (the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`), an optional muted secondary summary line, and an
// optional footer slot, inside the shared GlassPanel — the consistent shell every overview surface (Drives,
// Charging, Trips) reads as. All projection logic lives in the pure model (KpiOverviewCardModel.kt) so this file
// is a thin renderer.
//
// [KpiOverviewCard] is the stateless primitive: a faithful 1:1 port of the web component's props, the reusable
// shell and the per-state preview entry. [KpiOverviewCardSurface] is the holder-backed entry the prompt mandates:
// it binds the [KpiOverviewCardSource] overview seam (P1/S8) through [KpiOverviewCardViewModel], records the
// one-shot `view.opened` diagnostic (P1/S11), collects the live overview (so a period change re-renders the grid)
// and renders it — the same primitive/consumer split as the accepted Avatar / VisuallyHidden siblings.
//
// The web card composes only shared atoms it is handed; this surface reuses the existing native counterparts
// (GlassPanel, ComparisonHeader, MetricCard, Delta, HelperText, EmptyState) rather than re-authoring them — they
// are the out-of-scope component-library bundle. The card is anonymous (it resolves no static copy of its own:
// every label is caller-supplied); the only string this surface owns is the empty-state message, resolved from
// the P1/S10 catalog key `translation_common_noData`, never an English literal. The whole overview also exposes a
// merged TalkBack summary built by the pure [kpiOverviewAccessibilityLabel].
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/KpiOverviewCard) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:OptIn(ExperimentalLayoutApi::class)
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.kpioverviewcard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.FlowRowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ComparisonHeader
import io.teslasync.android.components.datadisplay.Delta
import io.teslasync.android.components.datadisplay.MetricCard
import io.teslasync.android.components.datadisplay.resolveSemantic
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * The stateless KpiOverviewCard primitive — the faithful port of the web `KpiOverviewCard`. Composes the
 * [header] (through a `ComparisonHeader`, with an optional [headlineDelta] chip), the [kpis] slot laid out in a
 * responsive grid, the optional muted [secondary] summary line, and the optional [footer] — all inside the
 * shared GlassPanel. The reusable shell and the per-state preview entry; it performs no work beyond rendering
 * its inputs. The [kpis] slot is a [FlowRowScope] so callers give each tile `Modifier.weight(1f)` for equal
 * columns; [columns] overrides the responsive count (web `gridClassName`) and [testTag] is the web `testId`.
 */
@Composable
fun KpiOverviewCard(
    header: KpiHeaderModel,
    modifier: Modifier = Modifier,
    columns: Int? = null,
    secondary: String? = null,
    testTag: String? = null,
    footer: (@Composable () -> Unit)? = null,
    headlineDelta: (@Composable () -> Unit)? = null,
    kpis: @Composable FlowRowScope.() -> Unit,
) {
    KpiOverviewShell(
        header = header,
        secondary = secondary,
        footer = footer,
        testTag = testTag,
        modifier = modifier,
        headlineDelta = headlineDelta,
    ) {
        KpiGrid(columns = columns, testTag = testTag, content = kpis)
    }
}

/**
 * The holder-backed KpiOverviewCard surface — binds the [source] overview seam (P1/S8) through a
 * [KpiOverviewCardViewModel], records the one-shot `view.opened` diagnostic (P1/S11), collects the live
 * [KpiOverviewData] (so a period change or a new drive re-renders the grid) and renders it: the content state
 * when there are tiles, a friendly [emptyMessage] empty state when there are none — never a blank box. Mount
 * this where the overview comes from the shared layer; use [KpiOverviewCard] directly when the values are
 * already in hand. [logger] defaults to the process logger and [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun KpiOverviewCardSurface(
    source: KpiOverviewCardSource,
    modifier: Modifier = Modifier,
    columns: Int? = null,
    testTag: String? = null,
    emptyMessage: String = stringResource(R.string.translation_common_noData),
    footer: (@Composable () -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = KPI_OVERVIEW_CARD_SLUG,
) {
    val viewModel: KpiOverviewCardViewModel =
        viewModel(key = instanceKey, factory = KpiOverviewCardViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val data by viewModel.state.collectAsStateWithLifecycle()
    KpiOverviewCardContent(
        data = data,
        columns = columns,
        testTag = testTag,
        emptyMessage = emptyMessage,
        footer = footer,
        modifier = modifier,
    )
}

/**
 * Renders a resolved [data] projection: the header, the KPI grid (or the [emptyMessage] empty state when there
 * are no tiles), the secondary line and the footer. Shared by the holder-backed surface and the per-state
 * previews so they render identically, and carries the merged TalkBack summary for the whole card.
 */
@Composable
private fun KpiOverviewCardContent(
    data: KpiOverviewData,
    columns: Int?,
    testTag: String?,
    emptyMessage: String,
    footer: (@Composable () -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val description = kpiOverviewAccessibilityLabel(data)
    val shellModifier =
        if (description.isNotEmpty()) {
            modifier.semantics { contentDescription = description }
        } else {
            modifier
        }
    KpiOverviewShell(
        header = data.header,
        secondary = data.secondary,
        footer = footer,
        testTag = testTag,
        modifier = shellModifier,
    ) {
        if (hasKpiTiles(data)) {
            KpiGrid(columns = columns, testTag = testTag) {
                data.tiles.forEach { tile -> KpiTileCard(tile = tile, modifier = Modifier.weight(1f)) }
            }
        } else {
            EmptyState(message = emptyMessage)
        }
    }
}

/**
 * The consistent card shell every overview reads as: the shared GlassPanel wrapping a vertically-spaced column
 * of the [ComparisonHeader] (with the optional [headlineDelta]), the [body] (the grid or the empty state), the
 * optional muted [secondary] line and the optional [footer]. [testTag] tags the panel (web `testId`).
 */
@Composable
private fun KpiOverviewShell(
    header: KpiHeaderModel,
    secondary: String?,
    footer: (@Composable () -> Unit)?,
    testTag: String?,
    modifier: Modifier = Modifier,
    headlineDelta: (@Composable () -> Unit)? = null,
    body: @Composable () -> Unit,
) {
    val panelModifier = if (testTag != null) modifier.testTag(testTag) else modifier
    GlassPanel(modifier = panelModifier) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            ComparisonHeader(
                title = header.title,
                currentLabel = header.currentLabel,
                comparisonLabel = header.comparisonLabel,
                delta = headlineDelta,
            )
            body()
            if (secondary != null) HelperText(secondary)
            if (footer != null) footer()
        }
    }
}

/**
 * Lays the KPI tiles in a responsive grid mirroring the web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-6`. The
 * column count is [columns] when given, otherwise [kpiColumnsForWidth] resolved from the live container width;
 * each caller tile takes `Modifier.weight(1f)` so the columns are equal. [testTag] tags the grid (web
 * `${testId}-kpis`).
 */
@Composable
private fun KpiGrid(
    columns: Int?,
    testTag: String?,
    content: @Composable FlowRowScope.() -> Unit,
) {
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val resolved = (columns ?: kpiColumnsForWidth(maxWidth.value.toInt())).coerceAtLeast(1)
        val gridModifier =
            if (testTag != null) {
                Modifier.fillMaxWidth().testTag("$testTag-kpis")
            } else {
                Modifier.fillMaxWidth()
            }
        FlowRow(
            modifier = gridModifier,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            maxItemsInEachRow = resolved,
            content = content,
        )
    }
}

/**
 * One KPI tile rendered as the shared `MetricCard`: the [tile]'s label, formatted value and optional subtitle,
 * with the optional change rendered through the shared direction-aware `Delta` (its good-direction semantics
 * resolved from the tile's metric key).
 */
@Composable
private fun KpiTileCard(
    tile: KpiTile,
    modifier: Modifier = Modifier,
) {
    val delta = tile.delta
    val deltaSlot: (@Composable () -> Unit)? =
        if (delta != null) {
            @Composable {
                Delta(
                    current = delta.current,
                    previous = delta.previous,
                    metric = resolveSemantic(delta.metricKey),
                    unitSuffix = delta.unitSuffix,
                )
            }
        } else {
            null
        }
    MetricCard(
        label = tile.label,
        value = tile.value,
        modifier = modifier,
        subtitle = tile.subtitle,
        delta = deltaSlot,
    )
}

// ── Previews (tooling-only; sample copy is never shipped UI) ──────────────────────────────────────────────

private val PREVIEW_OVERVIEW =
    KpiOverviewData(
        header = KpiHeaderModel(title = "Overview", currentLabel = "Last 30 days", comparisonLabel = "vs prior 30 days"),
        tiles =
            listOf(
                KpiTile(label = "Drives", value = "42"),
                KpiTile(label = "Distance", value = "1,204", subtitle = "mi"),
                KpiTile(label = "Efficiency", value = "248", delta = KpiTileDelta(248.0, 250.0, "efficiency", "Wh/mi")),
            ),
        secondary = "Top speed 152 mph \u00b7 Longest 29.1 mi \u00b7 Avg trip 11.5 mi",
    )

@Preview(name = "Overview — content", showBackground = true)
@Composable
private fun KpiOverviewCardContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KpiOverviewCardContent(
            data = PREVIEW_OVERVIEW,
            columns = null,
            testTag = null,
            emptyMessage = "No data available",
            footer = null,
        )
    }
}

@Preview(name = "Overview — empty", showBackground = true)
@Composable
private fun KpiOverviewCardEmptyPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        KpiOverviewCardContent(
            data = KpiOverviewData(KpiHeaderModel(title = "Overview", currentLabel = "Last 30 days"), emptyList()),
            columns = null,
            testTag = null,
            emptyMessage = "No data available",
            footer = null,
        )
    }
}

@Preview(name = "Overview — primitive slot", showBackground = true)
@Composable
private fun KpiOverviewCardPrimitivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        KpiOverviewCard(
            header = KpiHeaderModel(title = "Drives", currentLabel = "This week", comparisonLabel = "vs last week"),
            secondary = "3 anomalies flagged",
        ) {
            KpiTileCard(tile = KpiTile(label = "Trips", value = "18"), modifier = Modifier.weight(1f))
            KpiTileCard(tile = KpiTile(label = "Energy", value = "412 kWh"), modifier = Modifier.weight(1f))
        }
    }
}
