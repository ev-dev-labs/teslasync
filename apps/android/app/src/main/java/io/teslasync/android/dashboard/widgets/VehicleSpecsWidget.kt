package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing

private val COMPACT_MIN_HEIGHT = 96.dp
private val SKELETON_ROW_HEIGHT = 18.dp
private const val SKELETON_ROW_COUNT = 6

/**
 * The native Vehicle Specs dashboard surface — a Jetpack Compose / Material 3 parity port of
 * web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx. It mirrors the web `WidgetShell` (a
 * skeleton while loading, otherwise a title + document glyph + freshness header) wrapping the web
 * `WidgetDetailCard`: a label/value definition list of Model, Trim, Paint Color, Wheels, Interior,
 * Aux Battery, the monospaced Car Version, then up to eight decoded option codes each carrying a
 * neutral "Option" chip; or — at a single column (web `isCompact`) — the centered Model + "Trim: …"
 * mini view; or a friendly "No specs available" empty state when no source resolved. All data flows
 * through the shared [VehicleSpecsViewModel] (P1/S8); the view never performs HTTP. Every string
 * resolves through the i18n catalog and the refresh control carries a screen-reader name.
 */
@Composable
fun VehicleSpecsWidget(
    viewModel: VehicleSpecsViewModel,
    modifier: Modifier = Modifier,
    size: VehicleSpecsSize = VehicleSpecsRegistration.defaultSize,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(viewModel) { viewModel.onAppear() }
    VehicleSpecsWidgetContent(
        state = state,
        size = size,
        onRetry = viewModel::retry,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for the Vehicle Specs surface — every state from the web source is reproduced
 * and none is ever hidden. Split out from [VehicleSpecsWidget] so each state can be rendered in a
 * snapshot/accessibility test without a view-model or network.
 */
@Composable
fun VehicleSpecsWidgetContent(
    state: UiState<VehicleSpecsData>,
    size: VehicleSpecsSize,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberVehicleSpecsStrings()
    val display =
        remember(state.data, size, strings) {
            VehicleSpecsProjection.project(state.data ?: VehicleSpecsData.EMPTY, size, strings)
        }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        when {
            state.isLoading -> VehicleSpecsLoading()
            state.isError -> QueryError(kind = state.toQueryErrorKind(), resourceName = strings.title, onRetry = onRetry)
            state.isEmpty -> {
                VehicleSpecsHeader(state = state, strings = strings, size = size, onRefresh = onRetry)
                EmptyState(message = strings.noData, icon = VehicleSpecsGlyphs.FileText)
            }

            else -> {
                VehicleSpecsHeader(state = state, strings = strings, size = size, onRefresh = onRetry)
                FadeIn {
                    if (display.isCompact) {
                        VehicleSpecsCompact(display = display, strings = strings)
                    } else {
                        VehicleSpecsDetailList(entries = display.entries)
                    }
                }
            }
        }
    }
}

@Composable
private fun VehicleSpecsHeader(
    state: UiState<VehicleSpecsData>,
    strings: VehicleSpecsStrings,
    size: VehicleSpecsSize,
    onRefresh: () -> Unit,
) {
    val showTitle = !size.isCompact
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        horizontalArrangement = if (showTitle) Arrangement.SpaceBetween else Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (showTitle) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    VehicleSpecsGlyphs.FileText,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.primary,
                )
                PanelTitle(strings.title)
            }
        }
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            DataFreshness(
                updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
                isFetching = state.refreshing,
                isStale = state.stale,
                isError = state.hasError,
                compact = true,
            )
            IconButton(
                imageVector = VehicleSpecsGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@Composable
private fun VehicleSpecsDetailList(
    entries: List<SpecEntry>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        entries.forEachIndexed { index, entry ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            VehicleSpecsRow(entry)
        }
    }
}

@Composable
private fun VehicleSpecsRow(
    entry: SpecEntry,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = Spacing.sm),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MetricLabel(entry.label, modifier = Modifier.weight(1f))
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (entry.mono) {
                CodeText(entry.value)
            } else {
                BodyText(entry.value, maxLines = 1)
            }
            if (entry.badge != null) {
                Badge(text = entry.badge, variant = BadgeVariant.Neutral)
            }
        }
    }
}

@Composable
private fun VehicleSpecsCompact(
    display: VehicleSpecsDisplay,
    strings: VehicleSpecsStrings,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().heightIn(min = COMPACT_MIN_HEIGHT),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        Icon(
            VehicleSpecsGlyphs.FileText,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(
            text = display.compactModel,
            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
        Text(
            text = "${strings.trim}: ${display.compactTrim}",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun VehicleSpecsLoading(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_ROW_COUNT) {
            Skeleton(height = SKELETON_ROW_HEIGHT, rounded = true)
        }
    }
}

/** Resolves the source strings through the i18n facade (P1/S10); keys mirror the web `t()` calls. */
@Composable
private fun rememberVehicleSpecsStrings(): VehicleSpecsStrings =
    VehicleSpecsStrings(
        title = stringResource(R.string.translation_widget_vehicleSpecs),
        model = stringResource(R.string.translation_widget_specs_model),
        trim = stringResource(R.string.translation_widget_specs_trim),
        paint = stringResource(R.string.translation_widget_specs_paint),
        wheels = stringResource(R.string.translation_widget_specs_wheels),
        interior = stringResource(R.string.translation_widget_specs_interior),
        auxBattery = stringResource(R.string.translation_widget_specs_auxBattery),
        carVersion = stringResource(R.string.translation_widget_specs_carVersion),
        option = stringResource(R.string.translation_widget_specs_option),
        noData = stringResource(R.string.translation_widget_specs_noData),
    )

/** Maps the [UiState] failure classification onto the shared [QueryErrorKind] recovery copy. */
private fun UiState<*>.toQueryErrorKind(): QueryErrorKind =
    when (errorKind) {
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Network, ErrorKind.Timeout -> QueryErrorKind.Network
        ErrorKind.Http -> classifyQueryError(status = httpStatus, online = true, transientWaiting = false)
        ErrorKind.Decode -> QueryErrorKind.ServerError
        null, ErrorKind.Unknown -> QueryErrorKind.Network
    }

/**
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library
 * leans on lucide-react, which has no bundled Android equivalent). Each is monochrome and recoloured
 * at render time by the [Icon] tint.
 */
private object VehicleSpecsGlyphs {
    /** Document with a folded corner + text lines — header, compact, empty state (web `FileText`). */
    val FileText: ImageVector =
        specsVector("VehicleSpecsFileText") {
            moveTo(6f, 3f)
            lineTo(14f, 3f)
            lineTo(20f, 9f)
            lineTo(20f, 21f)
            lineTo(6f, 21f)
            close()
            moveTo(14f, 3f)
            lineTo(14f, 9f)
            lineTo(20f, 9f)
            moveTo(9f, 13f)
            lineTo(16f, 13f)
            moveTo(9f, 17f)
            lineTo(16f, 17f)
            moveTo(9f, 9f)
            lineTo(11f, 9f)
        }

    /** Circular double-arrow — the header refresh affordance. */
    val Refresh: ImageVector =
        specsVector("VehicleSpecsRefresh") {
            moveTo(20f, 9f)
            curveTo(18.5f, 6f, 15.5f, 4f, 12f, 4f)
            curveTo(8f, 4f, 4.7f, 6.8f, 4f, 11f)
            moveTo(4f, 15f)
            curveTo(5.5f, 18f, 8.5f, 20f, 12f, 20f)
            curveTo(16f, 20f, 19.3f, 17.2f, 20f, 13f)
            moveTo(20f, 5f)
            lineTo(20f, 9f)
            lineTo(16f, 9f)
            moveTo(4f, 19f)
            lineTo(4f, 15f)
            lineTo(8f, 15f)
        }
}

private fun specsVector(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()
