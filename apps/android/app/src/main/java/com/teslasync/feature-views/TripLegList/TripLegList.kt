// The native Jetpack Compose + Material 3 TripLegList feature view — a parity port of
// web/src/features/driving/components/TripLegList.tsx. The web component is purely presentational: the
// TripPlannerPage computes a plan and passes `legs` + `chargeStops` down, and it renders a "Route Breakdown"
// GlassPanel listing each leg (origin -> destination, distance, duration, energy, start -> arrival SOC) plus, after
// every leg that has one, a charging stop (name, charge time, SOC delta, energy, cost, optional "recommended"
// note). Distance + energy convert from SI at render via `useUnits`, the cost uses `useFormatting`.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web hooks
// are `useTranslation`, mapped to the i18n catalog P1/S10; `useUnits` + `useFormatting`, mapped to the live S8
// SettingsStore for the distance unit, currency symbol, precision and locale). The owning trip-planner page holds
// the plan feed and threads the legs/charge stops in through the shared state-holder layer as a [UiState], so this
// view also renders every lifecycle state that layer can carry — a loading skeleton, a hard error with retry, a
// friendly empty state (web `legItems.length === 0`), content, and stale/offline cached "last known" with a
// freshness chip + auto-refresh — without ever fetching, exactly like the sibling card-grid ports. The content
// branch reproduces the web leg list verbatim, including the per-leg fade-in and the conditional charging stop. A
// web-parity overload taking the raw `(legs, chargeStops)` is provided for hosts that already hold them.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TripLegList — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.tripleglist

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.BodyText
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
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement

/** Diameter of the circular leg-number badge (web `h-6 w-6`). */
private val BADGE_SIZE: Dp = 24.dp

/** Hairline border width for the leg + charge-stop cards (web `border`). */
private val CARD_BORDER_WIDTH: Dp = 1.dp

/** At or above this width the four leg metrics lay out four-per-row (web `sm:grid-cols-4`), else two-per-row. */
private val METRICS_WIDE_MIN: Dp = 480.dp
private const val METRICS_WIDE_COLUMNS = 4
private const val METRICS_COMPACT_COLUMNS = 2

/** Subtle fills/borders mirroring the web translucent leg (`bg-white/[0.02]`) and charge-stop (`bg-blue-500/5`). */
private const val LEG_CARD_FILL_ALPHA = 0.4f
private const val STOP_FILL_ALPHA = 0.08f
private const val STOP_BORDER_ALPHA = 0.4f

/** The leg rows shown as skeletons while the host's plan feed first loads. */
private const val SKELETON_ROW_COUNT = 3
private const val SKELETON_METRIC_COUNT = 4
private val SKELETON_LINE_HEIGHT: Dp = 14.dp
private val SKELETON_VALUE_HEIGHT: Dp = 20.dp
private const val SKELETON_HEADER_FRACTION = 0.6f

/** Web SOC connector `→` (U+2192). */
private const val SOC_ARROW = "\u2192"

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/**
 * Stateful entry point for the route breakdown. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11),
 * reads the live unit + currency + precision + locale preferences from the shared S8 SettingsStore (the native
 * binding of the web `useUnits`/`useFormatting` hooks; metric/`$`/2dp/en-US defaults apply until settings load),
 * and renders every lifecycle [state] the shared plan feed can carry. The host owns the feed (P1/S8) and supplies
 * [onRetry] (the feed's `refetch`); this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [TripRouteBreakdown].
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param settings the shared live `/settings` feed backing the units + currency + locale; defaults to the S8 holder.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TripLegList(
    state: UiState<TripRouteBreakdown>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { TripLegListDiagnostics.recordViewOpened(logger) }
    val settingsResource by settings.collectAsStateWithLifecycle()
    val prefs = remember(settingsResource.cached) { TripLegDisplayPrefs.from(settingsResource.cached) }
    TripLegListContent(state = state, onRetry = onRetry, prefs = prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ legs, chargeStops })` props, for hosts that already hold
 * the computed plan. An empty [legs] list projects onto the empty [UiState] (web `legItems.length === 0`). There
 * is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun TripLegList(
    legs: List<TripLeg>,
    chargeStops: List<TripChargeStop>,
    modifier: Modifier = Modifier,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(legs, chargeStops) {
            TripLegListProjection.projectUiState(TripRouteBreakdown(legs, chargeStops), isLoading = false)
        }
    TripLegList(state = state, onRetry = {}, modifier = modifier, settings = settings, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The "Route Breakdown"
 * panel + title are always rendered (so the surface never blanks); a freshness chip appears in the title row when
 * content is stale/refreshing/offline, and stale (non-error) data auto-refreshes, mirroring the shared
 * cache-then-network freshness contract. Inside it switches between a loading skeleton, a hard-error retry
 * surface, a friendly empty state, and the resolved leg list. [prefs] supplies the SI -> display conversion and
 * the currency formatting.
 */
@Composable
fun TripLegListContent(
    state: UiState<TripRouteBreakdown>,
    onRetry: () -> Unit,
    prefs: TripLegDisplayPrefs,
    modifier: Modifier = Modifier,
    strings: TripLegListStrings = rememberTripLegListStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val snapshot = state.data
    val degraded = snapshot != null && (state.stale || state.refreshing || state.hasError)
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            SectionTitle(strings.title, modifier = Modifier.weight(1f))
            if (degraded) TripLegFreshness(state)
        }
        Spacer(modifier = Modifier.height(Spacing.md))
        when {
            state.isLoading -> TripLegSkeleton()
            state.isError -> TripLegError(onRetry = onRetry)
            snapshot == null || snapshot.legs.isEmpty() ->
                EmptyState(
                    message = strings.empty,
                    icon = DataDisplayGlyphs.MapPin,
                    modifier = Modifier.fillMaxWidth(),
                )
            else -> TripLegLoaded(snapshot = snapshot, prefs = prefs, strings = strings)
        }
    }
}

/**
 * A freshness chip reflecting refreshing/stale/offline over still-shown content, the native expression of the
 * shared [DataFreshness] contract (the web page's poll/`refetch`). Lives in the panel's title row.
 */
@Composable
private fun TripLegFreshness(state: UiState<TripRouteBreakdown>) {
    val formatAge = rememberTripLegFreshnessFormatter()
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

/**
 * The content branch: each leg fades in through a [StaggerItem] (web `<FadeIn delay={idx * 0.03}>`), followed by
 * its charging stop when one exists. Derives the render-ready rows once via the pure [TripLegListProjection.rows].
 */
@Composable
private fun TripLegLoaded(
    snapshot: TripRouteBreakdown,
    prefs: TripLegDisplayPrefs,
    strings: TripLegListStrings,
) {
    val rows = remember(snapshot, prefs, strings) { TripLegListProjection.rows(snapshot, prefs, strings) }
    StaggerContainer(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        rows.forEachIndexed { idx, row ->
            StaggerItem(index = idx) {
                Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    TripLegCard(row = row, strings = strings)
                    if (row.chargeStop != null) {
                        ChargeStopCard(
                            stop = row.chargeStop,
                            strings = strings,
                            modifier = Modifier.padding(start = Spacing.md),
                        )
                    }
                }
            }
        }
    }
}

/**
 * One leg block — the native analogue of a single web leg `<div>`, built on a subtle bordered card. Centers the
 * origin/destination header above the four-metric grid. The whole card is one accessibility node reading the
 * leg summary so TalkBack announces it once.
 */
@Composable
private fun TripLegCard(
    row: TripLegRow,
    strings: TripLegListStrings,
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = LEG_CARD_FILL_ALPHA))
                .border(CARD_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium)
                .padding(Spacing.md)
                .clearAndSetSemantics { contentDescription = row.announce },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            TripLegHeader(row)
            TripLegMetrics(row = row, strings = strings)
        }
    }
}

/** The leg header: the numbered badge, then the origin and destination joined by a directional arrow. */
@Composable
private fun TripLegHeader(row: TripLegRow) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        LegBadge(row.index)
        Icon(DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.success)
        BodyText(
            row.fromText,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
        Icon(
            DataDisplayGlyphs.ArrowRight,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Icon(DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
        BodyText(
            row.toText,
            modifier = Modifier.weight(1f),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 1,
        )
    }
}

/** The circular leg-number badge (web `rounded-full bg-[var(--surface-2)] text-xs font-bold`). */
@Composable
private fun LegBadge(index: Int) {
    Box(
        modifier = Modifier.size(BADGE_SIZE).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = index.toString(),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold),
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * The four leg metrics (web `grid-cols-2 sm:grid-cols-4`): Distance, Duration, Energy, and the start -> arrival
 * SOC. Lays out four-per-row at or above [METRICS_WIDE_MIN], else two-per-row, padding a partial trailing row
 * with weighted spacers so the columns stay aligned.
 */
@Composable
private fun TripLegMetrics(
    row: TripLegRow,
    strings: TripLegListStrings,
) {
    val cells: List<@Composable () -> Unit> =
        listOf(
            { MetricCell(strings.distance, row.distanceText) },
            { MetricCell(strings.duration, row.durationText) },
            { MetricCell(strings.energy, row.energyText) },
            { BatteryCell(strings.battery, row.startSocText, row.arrivalSocText, row.arrivalLow) },
        )
    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= METRICS_WIDE_MIN) METRICS_WIDE_COLUMNS else METRICS_COMPACT_COLUMNS
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            cells.chunked(columns).forEach { group ->
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    group.forEach { cell -> Box(modifier = Modifier.weight(1f)) { cell() } }
                    repeat(columns - group.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/** A single labeled metric (muted label above the value). */
@Composable
private fun MetricCell(
    label: String,
    value: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        BodyText(value)
    }
}

/** The SOC metric: start (healthy) -> arrival (danger when below the threshold, else caution). */
@Composable
private fun BatteryCell(
    label: String,
    startText: String,
    arrivalText: String,
    arrivalLow: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        Row(verticalAlignment = Alignment.CenterVertically) {
            BodyText(startText, color = TeslaTokens.status.success)
            Text(
                text = SOC_ARROW,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Spacing.xs),
            )
            BodyText(
                arrivalText,
                color = if (arrivalLow) TeslaTokens.status.danger else TeslaTokens.status.warning,
            )
        }
    }
}

/**
 * The charging stop rendered after a leg (web blue-accented `<div>`): a bolt glyph, the charger name, a wrapping
 * row of charge time / SOC delta / energy / cost, and the optional "recommended" note. One accessibility node.
 */
@Composable
private fun ChargeStopCard(
    stop: TripChargeStopRow,
    strings: TripLegListStrings,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(TeslaTokens.status.info.copy(alpha = STOP_FILL_ALPHA))
                .border(CARD_BORDER_WIDTH, TeslaTokens.status.info.copy(alpha = STOP_BORDER_ALPHA), MaterialTheme.shapes.medium)
                .padding(Spacing.md)
                .clearAndSetSemantics { contentDescription = stop.announce },
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Icon(DataDisplayGlyphs.Bolt, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                BodyText(stop.name, color = TeslaTokens.status.info)
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        Icon(
                            DataDisplayGlyphs.Clock,
                            contentDescription = null,
                            size = IconSize.Xs,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        DetailText(stop.durationText)
                    }
                    DetailText(stop.socText)
                    DetailText(stop.energyText)
                    DetailText(stop.costText, color = TeslaTokens.status.success)
                }
                if (stop.isRecommended) {
                    Caption(strings.recommended)
                }
            }
        }
    }
}

/** A single inline charge-stop detail; defaults to the muted secondary color, overridden for the cost accent. */
@Composable
private fun DetailText(
    text: String,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    Text(text = text, style = MaterialTheme.typography.labelMedium, color = color)
}

/** The loading branch: bordered skeleton rows in the same card shape, announced as "Loading" to TalkBack. */
@Composable
private fun TripLegSkeleton() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier = Modifier.fillMaxWidth().clearAndSetSemantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        repeat(SKELETON_ROW_COUNT) { TripLegSkeletonRow() }
    }
}

/** A single loading row — a header bar over a row of metric-value bars (the leg-card skeleton shape). */
@Composable
private fun TripLegSkeletonRow() {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = LEG_CARD_FILL_ALPHA))
                .padding(Spacing.md),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Skeleton(widthFraction = SKELETON_HEADER_FRACTION, height = SKELETON_LINE_HEIGHT)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                repeat(SKELETON_METRIC_COUNT) {
                    Box(modifier = Modifier.weight(1f)) { Skeleton(height = SKELETON_VALUE_HEIGHT) }
                }
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun TripLegError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [TripLegListStrings] from the i18n catalog (P1/S10): the `tripPlanner.legs.*` labels and
 * `common.min` the web component reads through `useTranslation`. Resolved once at the Compose boundary so the
 * rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberTripLegListStrings(): TripLegListStrings {
    val title = stringResource(R.string.translation_tripPlanner_legs_title)
    val empty = stringResource(R.string.translation_tripPlanner_legs_empty)
    val distance = stringResource(R.string.translation_tripPlanner_legs_distance)
    val duration = stringResource(R.string.translation_tripPlanner_legs_duration)
    val energy = stringResource(R.string.translation_tripPlanner_legs_energy)
    val battery = stringResource(R.string.translation_tripPlanner_legs_soc)
    val recommended = stringResource(R.string.translation_tripPlanner_legs_recommended)
    val min = stringResource(R.string.translation_common_min)
    return remember(title, empty, distance, duration, energy, battery, recommended, min) {
        TripLegListStrings(
            title = title,
            empty = empty,
            distance = distance,
            duration = duration,
            energy = energy,
            battery = battery,
            recommended = recommended,
            min = min,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTripLegFreshnessFormatter(): (FreshnessAge) -> String {
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

private val PREVIEW_STRINGS =
    TripLegListStrings(
        title = "Route Breakdown",
        empty = "Plan a trip to see the route breakdown",
        distance = "Distance",
        duration = "Duration",
        energy = "Energy",
        battery = "Battery",
        recommended = "Recommended stop point \u2014 actual charger locations may vary",
        min = "min",
    )

private val PREVIEW_SNAPSHOT =
    TripRouteBreakdown(
        legs =
            listOf(
                TripLeg(
                    from = TripWaypoint(name = "Home", lat = 37.42, lng = -122.08),
                    to = TripWaypoint(name = "Harris Ranch Supercharger", lat = 36.25, lng = -120.24),
                    distanceM = 210_000.0,
                    durationS = 7_200.0,
                    energyWh = 42_000.0,
                    startSoc = 90.0,
                    arrivalSoc = 35.0,
                ),
                TripLeg(
                    from = TripWaypoint(name = "Harris Ranch Supercharger", lat = 36.25, lng = -120.24),
                    to = TripWaypoint(name = "Los Angeles", lat = 34.05, lng = -118.24),
                    distanceM = 330_000.0,
                    durationS = 11_400.0,
                    energyWh = 61_000.0,
                    startSoc = 80.0,
                    arrivalSoc = 18.0,
                ),
            ),
        chargeStops =
            listOf(
                TripChargeStop(
                    name = "Harris Ranch Supercharger",
                    chargeFromSoc = 35.0,
                    chargeToSoc = 80.0,
                    chargeDurationS = 1_500.0,
                    energyWh = 27_000.0,
                    cost = 12.5,
                    isRecommended = true,
                ),
            ),
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun TripLegListContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripLegListContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = TripLegDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun TripLegListEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripLegListContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = TripLegDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun TripLegListLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripLegListContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = TripLegDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun TripLegListErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripLegListContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = TripLegDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun TripLegListOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TripLegListContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = TripLegDisplayPrefs.DEFAULT,
            strings = PREVIEW_STRINGS,
        )
    }
}
