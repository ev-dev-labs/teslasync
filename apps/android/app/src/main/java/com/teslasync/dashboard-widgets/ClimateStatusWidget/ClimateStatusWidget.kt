// The native Jetpack Compose + Material 3 Climate Status dashboard surface — a parity port of
// web/src/features/dashboard/widgets/ClimateStatusWidget.tsx. It mirrors the web `WidgetShell`
// (a skeleton while the first load is in flight, otherwise a thermometer-iconed title + freshness header)
// wrapping either the Cabin / Outside / HVAC reading rows plus the Defrost / Heater status chips, or a
// friendly empty state when no climate snapshot is present. All data flows through the shared
// [ClimateStatusWidgetViewModel] (P1/S8); the view never performs HTTP. Temperatures are SI→display
// converted at this render boundary via the shared [UnitFormatter] (web `useUnits()`), every string
// resolves through the i18n catalog (P1/S10), and every interactive element carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/ClimateStatusWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.climatestatus

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Stateful entry point. Binds the shared vehicles + latest-climate feeds via [source] into a
 * [ClimateStatusWidgetViewModel], resolves the live display-[UnitFormatter] from the app container
 * ([LocalDataContainer]; web `useUnits()`), records the one-shot `view.opened` diagnostic, and renders the
 * surface. A dashboard host supplies [source] (an adapter over the shared S8 vehicles data layer) and a
 * unique [instanceKey] per placement; an explicit [vehicleId] pins the surface to one vehicle (web
 * `WidgetProps.vehicleId`), otherwise the first enrolled vehicle is used.
 */
@Composable
fun ClimateStatusWidget(
    source: ClimateStatusSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = ClimateStatusRegistration.ID,
) {
    val viewModel: ClimateStatusWidgetViewModel =
        viewModel(key = instanceKey, factory = ClimateStatusWidgetViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()

    ClimateStatusWidgetContent(
        state = state,
        formatter = formatter,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuit (a first load → full skeleton) and otherwise the thermometer title +
 * freshness header over the reading rows / chips, or the empty state. The web climate widget does not
 * pass `WidgetShell`'s `error` prop, so a hard failure is surfaced honestly through the header freshness
 * chip (offline) + the refresh control (the retry affordance) above the empty body — never a blanked panel
 * — and a stale/offline cached snapshot keeps its rows visible with the freshness chip flagged.
 */
@Composable
fun ClimateStatusWidgetContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    when {
        state.isLoading -> ClimateLoading(modifier)
        else -> ClimateLoaded(state = state, formatter = formatter, onRefresh = onRefresh, modifier = modifier)
    }
}

@Composable
private fun ClimateLoaded(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    onRefresh: () -> Unit,
    modifier: Modifier,
) {
    val display = remember(state.data, formatter) { ClimateStatusProjection.project(state.data, formatter) }
    Column(modifier = modifier.fillMaxSize()) {
        ClimateHeader(state = state, onRefresh = onRefresh)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            if (display.hasData) {
                ClimateRow(label = stringResource(R.string.translation_widget_cabin), value = display.cabinTempText)
                ClimateRow(label = stringResource(R.string.translation_widget_outside), value = display.outsideTempText)
                ClimateRow(label = stringResource(R.string.translation_widget_hvac), value = display.hvacPowerText)
                if (display.chips.isNotEmpty()) ClimateChipRow(display.chips)
            } else {
                ClimateEmpty()
            }
        }
    }
}

@Composable
private fun ClimateHeader(
    state: UiState<*>,
    onRefresh: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = ClimateThermometerGlyph,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        PanelTitle(
            stringResource(R.string.translation_widget_climate),
            modifier = Modifier.weight(1f).semantics { heading() },
        )
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = stringResource(R.string.translation_common_loading),
            errorLabel = stringResource(R.string.translation_common_offline),
            formatAge = rememberRelativeAgeFormatter(),
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
private fun ClimateRow(
    label: String,
    value: String,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Caption(label)
        BodyText(value, maxLines = 1)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ClimateChipRow(chips: List<ClimateChipKind>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        chips.forEach { kind -> ClimateChip(kind) }
    }
}

@Composable
private fun ClimateChip(kind: ClimateChipKind) {
    val icon = chipIcon(kind)
    val tone = chipTone(kind)
    val label = chipLabel(kind)
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = tone.copy(alpha = CHIP_WASH_ALPHA),
        contentColor = tone,
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = tone)
            Text(text = label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable
private fun ClimateEmpty() {
    EmptyState(
        message = stringResource(R.string.translation_widget_noClimate),
        icon = ClimateThermometerGlyph,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun ClimateLoading(modifier: Modifier) {
    val label = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = LOADING_BAR_HEIGHT, rounded = true)
        }
    }
}

private fun chipIcon(kind: ClimateChipKind): ImageVector =
    when (kind) {
        ClimateChipKind.Defrost -> DataDisplayGlyphs.Snowflake
        ClimateChipKind.Heater -> DataDisplayGlyphs.Bolt
    }

@Composable
private fun chipTone(kind: ClimateChipKind): Color =
    when (kind) {
        ClimateChipKind.Defrost -> TeslaTokens.status.info
        ClimateChipKind.Heater -> TeslaTokens.status.warning
    }

@Composable
private fun chipLabel(kind: ClimateChipKind): String =
    stringResource(
        when (kind) {
            ClimateChipKind.Defrost -> R.string.translation_widget_defrost
            ClimateChipKind.Heater -> R.string.translation_widget_batHeater
        },
    )

/**
 * Builds the localized relative-age formatter the header freshness chip folds [FreshnessAge] buckets
 * through (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
 */
@Composable
private fun rememberRelativeAgeFormatter(): (FreshnessAge) -> String {
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

// ── Local glyph — the web `Thermometer` (lucide), authored as a 24×24 stroked vector. The data-display
// layer ships no thermometer glyph and this surface's allowed files cannot extend that catalog, so the
// climate icon is hand-authored here, mirroring the approach in components/datadisplay/DataDisplayGlyphs. ──

private fun climateStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

private val ClimateThermometerGlyph: ImageVector =
    climateStroked("ClimateThermometer") {
        // Mercury column (stem) running down into the bulb.
        moveTo(12f, 13f)
        lineTo(12f, 5.5f)
        // Bulb — a circle at the base, approximated with two semicircular arcs.
        moveTo(9f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 15f, 16.5f)
        arcTo(3f, 3f, 0f, false, true, 9f, 16.5f)
        close()
        // Two scale ticks on the right of the stem.
        moveTo(14f, 8f)
        lineTo(15.5f, 8f)
        moveTo(14f, 11f)
        lineTo(15.5f, 11f)
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val CHIP_WASH_ALPHA = 0.12f
private const val LOADING_BAR_COUNT = 4
private val LOADING_BAR_HEIGHT = 16.dp

// ── Previews — one per rendered state (content / empty / loading / error / offline). ──────────────────

private fun previewClimate(): JsonElement =
    buildJsonObject {
        put("inside_temp", 21.0)
        put("outside_temp", 14.0)
        put("hvac_power", 2.4)
        put("defrost_mode", "Front")
        put("battery_heater_on", true)
    }

@Preview(name = "Climate · content", showBackground = true)
@Composable
private fun ClimateContentPreview() {
    TeslaSyncTheme {
        ClimateStatusWidgetContent(
            state = UiState(phase = UiPhase.Content, data = previewClimate(), fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Climate · empty", showBackground = true)
@Composable
private fun ClimateEmptyPreview() {
    TeslaSyncTheme {
        ClimateStatusWidgetContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = System.currentTimeMillis()),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Climate · loading", showBackground = true)
@Composable
private fun ClimateLoadingPreview() {
    TeslaSyncTheme {
        ClimateStatusWidgetContent(state = UiState.loading(), formatter = UnitFormatter.default())
    }
}

@Preview(name = "Climate · error", showBackground = true)
@Composable
private fun ClimateErrorPreview() {
    TeslaSyncTheme {
        ClimateStatusWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
        )
    }
}

@Preview(name = "Climate · offline (cached)", showBackground = true)
@Composable
private fun ClimateOfflinePreview() {
    TeslaSyncTheme {
        ClimateStatusWidgetContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewClimate(),
                    fetchedAt = System.currentTimeMillis(),
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
        )
    }
}
