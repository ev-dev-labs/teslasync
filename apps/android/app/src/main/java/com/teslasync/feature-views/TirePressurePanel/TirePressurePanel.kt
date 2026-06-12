// The native Jetpack Compose + Material 3 TirePressurePanel feature view — a parity port of
// web/src/features/vehicles/components/telemetry-panels/TirePressurePanel.tsx. The web component takes a
// `TirePressureSnapshot` prop and renders a `GlassPanel` titled "Tire Pressure" (gauge icon) containing, when
// the snapshot is present, a 2×2 grid of four per-wheel tiles (FL/FR/RL/RR) whose value + border color reflect
// each wheel's safety band, followed by a single status chip summarizing the four (All Normal / Attention
// Needed / Check Pressure); when the snapshot is null it renders a friendly "No tire pressure data available"
// empty state. This native port keeps that exact composition and additionally surfaces the cache-then-network
// states the P3 contract mandates (loading / empty / error / stale / offline) by binding the shared
// latest-tire-pressure feed (P1/S8) through a [TirePressurePanelViewModel]: the title always renders, a
// skeleton covers the first load, a `QueryError` covers a hard failure with no cache, a freshness chip +
// auto-refresh covers stale/offline, and an absent snapshot still renders the titled panel with the empty
// state (never a blank box). The view performs no HTTP. Pressures are Pa→kPa→display converted at this render
// boundary via the shared [UnitFormatter] (web `useUnits()`); every visible string resolves through the i18n
// catalog (P1/S10); and every tile + the status chip carry a merged TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TirePressurePanel) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tirepressurepanel

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.components.ui.TeslaGlyphs
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

/** The entry stagger (50 ms), matching the sibling telemetry panels' `<FadeIn>`. */
private const val FADE_DELAY_MS: Int = 50

/** Tile border + neutral wash alphas — the web `border-{tone}/30` + `bg-white/[0.02]` translucency. */
private const val TILE_BORDER_ALPHA: Float = 0.30f
private const val TILE_WASH_ALPHA: Float = 0.28f

/** Status-chip wash + border alpha — the web `bg-{tone}/10 border-{tone}/30` translucency. */
private const val CHIP_WASH_ALPHA: Float = 0.12f
private const val CHIP_BORDER_ALPHA: Float = 0.28f

private val SKELETON_TILE_HEIGHT: Dp = 64.dp
private val SKELETON_CHIP_HEIGHT: Dp = 24.dp
private const val SKELETON_CHIP_WIDTH_FRACTION: Float = 0.4f
private const val SKELETON_TILE_ROWS: Int = 2

private const val HTTP_NOT_FOUND: Int = 404
private const val HTTP_UNAUTHORIZED: Int = 401
private const val HTTP_FORBIDDEN: Int = 403
private const val HTTP_SERVER_ERROR_MIN: Int = 500
private const val HTTP_SERVER_ERROR_MAX: Int = 599

/**
 * Stateful entry point — the faithful 1:1 port of the web `TirePressurePanel({ tireData })`. Binds the shared
 * latest-tire-pressure feed via [source] into a [TirePressurePanelViewModel], records the one-shot
 * `view.opened` diagnostic (P1/S11), resolves the live display-[UnitFormatter] (web `useUnits()`, P1/S8) and
 * the localized [TirePressurePanelStrings] (P1/S10), and renders. A host supplies the selected [vehicleId] (the
 * web prop's source); a `null`/non-positive id falls back to the first enrolled vehicle and, when none
 * resolves, renders the empty state.
 */
@Composable
fun TirePressurePanel(
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    source: TirePressurePanelSource = LocalDataContainer.current.vehiclesStore.asTirePressurePanelSource(),
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = TIRE_PRESSURE_PANEL_SLUG,
) {
    val viewModel: TirePressurePanelViewModel =
        viewModel(key = instanceKey, factory = TirePressurePanelViewModel.factory(source, logger, vehicleId))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    val strings = rememberTirePressurePanelStrings()

    TirePressurePanelContent(
        state = state,
        formatter = formatter,
        strings = strings,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Resolves the surface's localized labels from the generated catalog (P1/S10). The title / wheel abbreviations
 * / "All Normal" / "Check Pressure" / full wheel names / empty message resolve at compile time; "Attention
 * Needed" is resolved by-name with the web English fallback, since the catalog defines no key for it (the web
 * source uses a raw literal).
 */
@Composable
fun rememberTirePressurePanelStrings(): TirePressurePanelStrings {
    val context = LocalContext.current
    val title = stringResource(R.string.translation_common_tirePressure)
    val flLabel = stringResource(R.string.translation_widget_tireFL)
    val frLabel = stringResource(R.string.translation_widget_tireFR)
    val rlLabel = stringResource(R.string.translation_widget_tireRL)
    val rrLabel = stringResource(R.string.translation_widget_tireRR)
    val frontLeft = stringResource(R.string.translation_driveDetail_frontLeft)
    val frontRight = stringResource(R.string.translation_driveDetail_frontRight)
    val rearLeft = stringResource(R.string.translation_driveDetail_rearLeft)
    val rearRight = stringResource(R.string.translation_driveDetail_rearRight)
    val allNormal = stringResource(R.string.translation_telemetry_allNormal)
    val checkPressure = stringResource(R.string.translation_widget_tireWarning)
    val noData = stringResource(R.string.translation_vehicles_detail_noTireData)
    val attentionNeeded =
        resolveOptional({ context.optionalString(it) }, KEY_ATTENTION_NEEDED, TirePressurePanelDefaults.ATTENTION_NEEDED)
    return remember(
        title,
        flLabel,
        frLabel,
        rlLabel,
        rrLabel,
        frontLeft,
        frontRight,
        rearLeft,
        rearRight,
        allNormal,
        attentionNeeded,
        checkPressure,
        noData,
    ) {
        TirePressurePanelStrings(
            title = title,
            flLabel = flLabel,
            frLabel = frLabel,
            rlLabel = rlLabel,
            rrLabel = rrLabel,
            frontLeft = frontLeft,
            frontRight = frontRight,
            rearLeft = rearLeft,
            rearRight = rearRight,
            allNormal = allNormal,
            attentionNeeded = attentionNeeded,
            checkPressure = checkPressure,
            noData = noData,
        )
    }
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The `GlassPanel` +
 * gauge "Tire Pressure" title always render; then the skeleton body while the first load is in flight, a
 * `QueryError` with retry on a hard failure with no cache, the full tile grid + status chip when a snapshot is
 * present (web `tireData` truthy), or the friendly empty state otherwise. A stale/offline cached snapshot keeps
 * its body visible with a freshness chip flagged and auto-refreshes. No surface is ever blank.
 */
@Composable
fun TirePressurePanelContent(
    state: UiState<JsonElement>,
    formatter: UnitFormatter,
    strings: TirePressurePanelStrings,
    modifier: Modifier = Modifier,
    onRefresh: () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.isError) {
        if (state.stale && !state.refreshing && !state.isError) onRefresh()
    }
    FadeIn(modifier = modifier, delayMs = FADE_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            TirePressureHeader(title = strings.title, state = state)
            Spacer(modifier = Modifier.height(Spacing.lg))
            when {
                state.isLoading -> TirePressureLoadingBody()
                state.isError && !state.hasData ->
                    QueryError(
                        kind = queryErrorKindOf(state),
                        resourceName = strings.snapshotLabel,
                        onRetry = onRefresh,
                        modifier = Modifier.fillMaxWidth(),
                    )

                else -> TirePressurePanelLoaded(snapshot = state.data, formatter = formatter, strings = strings)
            }
        }
    }
}

/** The web header `<h3 className="section-title">` — gauge glyph + title, with a freshness chip once a fetch has run. */
@Composable
private fun TirePressureHeader(
    title: String,
    state: UiState<*>,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Gauge,
            contentDescription = null,
            size = IconSize.Sm,
            tint = TeslaTokens.status.info,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
        Spacer(modifier = Modifier.weight(1f))
        if ((state.fetchedAt ?: 0L) > 0L || state.refreshing || state.hasError) {
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
        }
    }
}

/** The loaded branch: the full tire body (web `tireData` truthy) or the friendly empty state. */
@Composable
private fun TirePressurePanelLoaded(
    snapshot: JsonElement?,
    formatter: UnitFormatter,
    strings: TirePressurePanelStrings,
    modifier: Modifier = Modifier,
) {
    val display =
        remember(snapshot, formatter, strings) {
            TirePressurePanelProjection.project(snapshot, formatter, strings)
        }
    if (!display.hasData) {
        EmptyState(message = strings.noData, icon = DataDisplayGlyphs.Gauge, modifier = modifier.fillMaxWidth())
        return
    }
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        TirePressureTileGrid(wheels = display.wheels)
        TireStatusChip(display = display)
    }
}

/** Web "grid grid-cols-2" — the four per-wheel tiles laid out as two rows of two. */
@Composable
private fun TirePressureTileGrid(
    wheels: List<TireWheelDisplay>,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            wheels.getOrNull(0)?.let { TireTile(tile = it, modifier = Modifier.weight(1f)) }
            wheels.getOrNull(1)?.let { TireTile(tile = it, modifier = Modifier.weight(1f)) }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            wheels.getOrNull(2)?.let { TireTile(tile = it, modifier = Modifier.weight(1f)) }
            wheels.getOrNull(3)?.let { TireTile(tile = it, modifier = Modifier.weight(1f)) }
        }
    }
}

/** A single wheel tile: the web `rounded-xl border bg-white/[0.02] text-center` cell with a muted label and a bold colored value. */
@Composable
private fun TireTile(
    tile: TireWheelDisplay,
    modifier: Modifier = Modifier,
) {
    val color = wheelVariantColor(tile.variant)
    Surface(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = tile.contentDescription },
        shape = RoundedCornerShape(Radius.lg),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = TILE_WASH_ALPHA),
        border = BorderStroke(1.dp, color.copy(alpha = TILE_BORDER_ALPHA)),
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            MetricLabel(tile.label)
            Heading(text = tile.valueText, level = HeadingLevel.Sub, color = color)
        }
    }
}

/** Web "status chip" — a centered pill, washed in the aggregate-status tone, with its glyph + localized label. */
@Composable
private fun TireStatusChip(
    display: TirePressurePanelDisplay,
    modifier: Modifier = Modifier,
) {
    val tone = statusColor(display.status)
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
        Surface(
            shape = RoundedCornerShape(Radius.pill),
            color = tone.copy(alpha = CHIP_WASH_ALPHA),
            contentColor = tone,
            border = BorderStroke(1.dp, tone.copy(alpha = CHIP_BORDER_ALPHA)),
            modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = display.statusContentDescription },
        ) {
            Row(
                modifier = Modifier.padding(horizontal = Spacing.md, vertical = Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Icon(imageVector = statusIcon(display.status), contentDescription = null, size = IconSize.Xs, tint = tone)
                Text(text = display.statusLabel, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

/** The first-load skeleton body — two rows of two tile blocks plus a centered status-chip bar. */
@Composable
private fun TirePressureLoadingBody(modifier: Modifier = Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(SKELETON_TILE_ROWS) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
                Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
            }
        }
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
            Box(modifier = Modifier.fillMaxWidth(SKELETON_CHIP_WIDTH_FRACTION)) {
                Skeleton(height = SKELETON_CHIP_HEIGHT, rounded = true)
            }
        }
    }
}

/** The accent tone each wheel band carries — the web green / amber / red value+border colors; muted when unknown. */
@Composable
private fun wheelVariantColor(variant: TirePressureVariant): Color =
    when (variant) {
        TirePressureVariant.Normal -> TeslaTokens.status.success
        TirePressureVariant.Warning -> TeslaTokens.status.warning
        TirePressureVariant.Critical -> TeslaTokens.status.danger
        TirePressureVariant.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The aggregate-status chip tone — the web green / red / amber chip colors. */
@Composable
private fun statusColor(status: TireOverallStatus): Color =
    when (status) {
        TireOverallStatus.AllNormal -> TeslaTokens.status.success
        TireOverallStatus.AttentionNeeded -> TeslaTokens.status.danger
        TireOverallStatus.CheckPressure -> TeslaTokens.status.warning
    }

/** The glyph each status chip carries — the web `✓` / `✗` / `⚠` symbols. */
private fun statusIcon(status: TireOverallStatus): ImageVector =
    when (status) {
        TireOverallStatus.AllNormal -> DataDisplayGlyphs.CheckCircle
        TireOverallStatus.AttentionNeeded -> DataDisplayGlyphs.AlertOctagon
        TireOverallStatus.CheckPressure -> TeslaGlyphs.Warning
    }

/** Classify a [UiState] failure into the recovery copy the `QueryError` branch shows. */
private fun queryErrorKindOf(state: UiState<*>): QueryErrorKind =
    when (state.errorKind) {
        ErrorKind.Http ->
            when (state.httpStatus) {
                HTTP_NOT_FOUND -> QueryErrorKind.NotFound
                HTTP_UNAUTHORIZED, HTTP_FORBIDDEN -> QueryErrorKind.Unauthorized
                in HTTP_SERVER_ERROR_MIN..HTTP_SERVER_ERROR_MAX -> QueryErrorKind.ServerError
                else -> QueryErrorKind.Network
            }
        ErrorKind.CircuitOpen -> QueryErrorKind.Waiting
        ErrorKind.Decode -> QueryErrorKind.ServerError
        else -> QueryErrorKind.Network
    }

/**
 * Builds the localized relative-age formatter the freshness chip folds [FreshnessAge] buckets through
 * (P1/S10 `translation_freshness_*`), so the pure freshness logic carries no English microcopy.
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

/**
 * Optional by-name read from the Android string catalog — the seam [resolveOptional] uses to reproduce web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is suppressed.
 * Release builds keep resource names (resource shrinking is off), so the lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

// ── Previews — one per rendered state (content / attention / empty / loading / error / offline). ───────────

private val PREVIEW_STRINGS =
    TirePressurePanelStrings(
        title = "Tire Pressure",
        flLabel = "FL",
        frLabel = "FR",
        rlLabel = "RL",
        rrLabel = "RR",
        frontLeft = "Front Left",
        frontRight = "Front Right",
        rearLeft = "Rear Left",
        rearRight = "Rear Right",
        allNormal = "All Normal",
        attentionNeeded = "Attention Needed",
        checkPressure = "Check Pressure",
        noData = "No tire pressure data available",
    )

/** A within-band snapshot (all four wheels ≈ 250 kPa) → the All-Normal chip. */
private fun previewNormalTires(): JsonElement =
    buildJsonObject {
        put("front_left", 250_000.0)
        put("front_right", 251_000.0)
        put("rear_left", 249_000.0)
        put("rear_right", 252_000.0)
    }

/** A snapshot with a critically-low front-left tire → the Attention-Needed chip. */
private fun previewAttentionTires(): JsonElement =
    buildJsonObject {
        put("front_left", 180_000.0)
        put("front_right", 251_000.0)
        put("rear_left", 249_000.0)
        put("rear_right", 252_000.0)
    }

@Preview(name = "Tire · all normal", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelNormalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state = UiState(phase = UiPhase.Content, data = previewNormalTires(), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire · attention", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelAttentionPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state = UiState(phase = UiPhase.Content, data = previewAttentionTires(), fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire · empty", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state = UiState(phase = UiPhase.Empty, data = JsonNull, fetchedAt = 1L),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire · loading", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state = UiState.loading(),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire · error", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Tire · offline (cached)", showBackground = true, widthDp = 420)
@Composable
private fun TirePressurePanelOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TirePressurePanelContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = previewNormalTires(),
                    fetchedAt = 1L,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            formatter = UnitFormatter.default(),
            strings = PREVIEW_STRINGS,
        )
    }
}
