package io.teslasync.android.dashboard.widgets

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.BuildConfig
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.feedback.SkeletonLines
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.diagnostics.Telemetry
import io.teslasync.shared.core.diagnostics.TelemetryEvent
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/*
 * BatteryDegradationForecastWidget — the native Android (Jetpack Compose + Material 3) port of the
 * web dashboard widget `web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx`.
 *
 * It binds the shared P1/S8 [EnergyStore] (the KMP port of the web `useBatteryDegradation` hook on
 * `useEnergy`) and renders the predictive degradation forecast: the projected date the pack reaches
 * 80% capacity, a health-tier badge with the per-month degradation rate, the current state-of-health
 * stat, the ranked risk factors, and the recommendation tip cards. Every render branch the web source
 * has is reproduced (compact `cols <= 1`, full layout, plus loading / empty / error / stale / offline).
 * No networking lives in the view: the store owns it (ADR-002 / ADR-013). The store yields a raw SI
 * [JsonElement] (no generated energy DTO), so the framework-free [degradationForecast] adapter parses
 * it into a typed projection that the stateless content renders — and that the off-device unit test
 * exercises directly.
 */

// ── Registry metadata (canonical — mirrors web/src/features/dashboard/widgets/registry/battery.ts) ──

/** Stable surface slug emitted to telemetry (the diagnostics screen name). */
private const val SURFACE_SLUG = "BatteryDegradationForecastWidget"

/**
 * The dashboard-widget descriptor for this surface. A dashboard grid host registers it with the
 * canonical [ID] and honours the [minSize] / [maxSize] constraints, exactly like the web registry
 * entry (`battery-degradation-forecast`, default 2×4, min 1×2, max 4×40).
 */
public object BatteryDegradationForecastWidgetDescriptor {
    public const val ID: String = "battery-degradation-forecast"
    public const val CATEGORY: String = "battery"
    public val defaultSize: DashboardWidgetSize = DashboardWidgetSize(cols = 2, rows = 4)
    public val minSize: DashboardWidgetSize = DashboardWidgetSize(cols = 1, rows = 2)
    public val maxSize: DashboardWidgetSize = DashboardWidgetSize(cols = 4, rows = 40)
}

// ── Size chrome (reuses the package [DashboardWidgetSize]; web compact = `size.cols <= 1`) ─────────

/** Compact chrome (web `isCompact = size.cols <= 1`): the single-column tile with just SoH + tier. */
internal fun DashboardWidgetSize.forecastIsCompact(): Boolean = cols <= 1

/** Whether the title/icon header is shown — web hides both only on the compact (1-wide) tile. */
internal fun DashboardWidgetSize.forecastShowsHeader(): Boolean = !forecastIsCompact()

/** Clamps a requested size into this descriptor's [min, max] grid constraints. */
internal fun DashboardWidgetSize.coerceToForecastConstraints(): DashboardWidgetSize {
    val min = BatteryDegradationForecastWidgetDescriptor.minSize
    val max = BatteryDegradationForecastWidgetDescriptor.maxSize
    return DashboardWidgetSize(cols = cols.coerceIn(min.cols, max.cols), rows = rows.coerceIn(min.rows, max.rows))
}

// ── Pure domain projection (cached JSON → projection); unit-tested off-device ─────────────────────

/** The health tier the per-month degradation rate resolves to — the port of the web `healthTier`. */
public enum class DegradationHealthTier { Healthy, Normal, Accelerated }

/**
 * Classifies the per-month degradation [ratePctPerMonth] into a [DegradationHealthTier], matching the
 * web `healthTier` thresholds: ≤ 0.05 %/mo healthy, ≤ 0.12 %/mo normal, otherwise accelerated.
 */
public fun degradationHealthTier(ratePctPerMonth: Double): DegradationHealthTier =
    when {
        ratePctPerMonth <= HEALTHY_RATE_MAX -> DegradationHealthTier.Healthy
        ratePctPerMonth <= NORMAL_RATE_MAX -> DegradationHealthTier.Normal
        else -> DegradationHealthTier.Accelerated
    }

/** The impact lane a risk factor's score resolves to — the port of the web `scoreToImpact`. */
public enum class RiskImpact { High, Medium, Low }

/** Maps a risk [score] to its [RiskImpact] exactly as web `scoreToImpact`: ≥ 7 high, ≥ 4 medium, else low. */
public fun riskScoreImpact(score: Double): RiskImpact =
    when {
        score >= RISK_HIGH_MIN -> RiskImpact.High
        score >= RISK_MEDIUM_MIN -> RiskImpact.Medium
        else -> RiskImpact.Low
    }

/** The icon family a risk factor maps to — the i18n-free port of the web `riskIcon` name heuristic. */
public enum class RiskIconKind { Thermal, Charge, Battery, Generic }

/**
 * Classifies a risk factor [name] into a [RiskIconKind], mirroring the web `riskIcon` substring rules:
 * temp/heat/thermal ▸ thermal, charge/fast/dc ▸ charge, battery/soc/depth ▸ battery, else generic.
 */
public fun riskFactorIconKind(name: String): RiskIconKind {
    val lower = name.lowercase(Locale.ROOT)
    return when {
        lower.contains("temp") || lower.contains("heat") || lower.contains("thermal") -> RiskIconKind.Thermal
        lower.contains("charge") || lower.contains("fast") || lower.contains("dc") -> RiskIconKind.Charge
        lower.contains("battery") || lower.contains("soc") || lower.contains("depth") -> RiskIconKind.Battery
        else -> RiskIconKind.Generic
    }
}

/** A single ranked degradation risk factor (web `RiskFactorData`). */
public data class DegradationRiskFactor(
    val name: String,
    val score: Double,
    val label: String?,
    val detail: String?,
)

/**
 * The typed forecast projection the content renders — the port of the web `DegradationData` fields the
 * widget actually consumes. [hasData] mirrors the web `hasData` gate (a current SoH or a projected date).
 */
public data class DegradationForecast(
    val currentHealthPct: Double?,
    val degradationRatePctPerMonth: Double,
    val projected80PctDate: String?,
    val riskFactors: List<DegradationRiskFactor>,
    val recommendations: List<String>,
) {
    /** True when there is something to show — web `currentHealthPct != null || projected_80pct_date != null`. */
    val hasData: Boolean get() = currentHealthPct != null || projected80PctDate != null

    /** The health tier derived from the degradation rate. */
    val tier: DegradationHealthTier get() = degradationHealthTier(degradationRatePctPerMonth)
}

/**
 * Parses the raw SI degradation [json] (the `GET /analytics/battery-degradation` body) into a
 * [DegradationForecast]. Total and non-throwing: unknown / malformed fields fall back to `null`/`0`,
 * exactly as the web `??` guards do, so a partial payload still renders rather than crashing. Mirrors
 * web `current_health_pct ?? current_health` for SoH, `degradation_rate_pct_per_month ?? 0` for the
 * rate, `risk_factors`/`recommendations` defaulting to empty lists.
 */
public fun degradationForecast(json: JsonElement?): DegradationForecast {
    val obj = json as? JsonObject
    return DegradationForecast(
        currentHealthPct = obj.doubleOrNull("current_health_pct") ?: obj.doubleOrNull("current_health"),
        degradationRatePctPerMonth = obj.doubleOrNull("degradation_rate_pct_per_month") ?: 0.0,
        projected80PctDate = obj.stringOrNull("projected_80pct_date"),
        riskFactors = obj.riskFactors(),
        recommendations = obj.recommendations(),
    )
}

private fun JsonObject?.riskFactors(): List<DegradationRiskFactor> =
    (this?.get("risk_factors") as? JsonArray).orEmpty().mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val name = row.stringOrNull("name") ?: return@mapNotNull null
        DegradationRiskFactor(
            name = name,
            score = row.doubleOrNull("score") ?: 0.0,
            label = row.stringOrNull("label"),
            detail = row.stringOrNull("detail"),
        )
    }

private fun JsonObject?.recommendations(): List<String> =
    (this?.get("recommendations") as? JsonArray).orEmpty().mapNotNull { element ->
        (element as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }
    }

private fun JsonObject?.stringOrNull(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

private fun JsonObject?.doubleOrNull(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull

/**
 * Formats the projected 80%-capacity [iso] timestamp into a localized `MMM yyyy` label (web
 * `Intl.DateTimeFormat(locale, { year:'numeric', month:'short' })`), or `null` when the value is
 * blank/unparseable so the caller substitutes the em-dash. Tolerant of date, date-time, and
 * offset/instant shapes the backend may emit.
 */
internal fun formatForecastProjected(
    iso: String?,
    locale: Locale,
): String? = parseForecastYearMonth(iso)?.format(DateTimeFormatter.ofPattern(MONTH_YEAR_PATTERN, locale))

private fun parseForecastYearMonth(value: String?): YearMonth? {
    val raw = value?.takeIf { it.isNotBlank() } ?: return null
    return runCatching { YearMonth.from(OffsetDateTime.parse(raw)) }
        .recoverCatching { YearMonth.from(Instant.parse(raw).atOffset(ZoneOffset.UTC)) }
        .recoverCatching { YearMonth.from(LocalDateTime.parse(raw)) }
        .recoverCatching { YearMonth.from(LocalDate.parse(raw)) }
        .recoverCatching { YearMonth.parse(raw) }
        .getOrNull()
}

/** Locale-aware fixed-decimal format — the Android analogue of the web `fmtNumber(value, decimals)`. */
internal fun formatForecastNumber(
    value: Double,
    decimals: Int,
    locale: Locale,
): String = String.format(locale, "%.${decimals}f", value)

/** The typed view-opened diagnostics event (P1/S11), surfaced as a pure builder for testability. */
internal fun batteryDegradationForecastViewOpenedEvent(appVersion: String): TelemetryEvent.ScreenView =
    TelemetryEvent.ScreenView(screen = SURFACE_SLUG, platform = "android", appVersion = appVersion)

private fun DegradationHealthTier.toBadgeVariant(): BadgeVariant =
    when (this) {
        DegradationHealthTier.Healthy -> BadgeVariant.Success
        DegradationHealthTier.Normal -> BadgeVariant.Warning
        DegradationHealthTier.Accelerated -> BadgeVariant.Danger
    }

private fun RiskImpact.toBadgeVariant(): BadgeVariant =
    when (this) {
        RiskImpact.High -> BadgeVariant.Danger
        RiskImpact.Medium -> BadgeVariant.Warning
        RiskImpact.Low -> BadgeVariant.Success
    }

private fun RiskIconKind.glyph(): ImageVector =
    when (this) {
        RiskIconKind.Thermal -> ThermometerGlyph
        RiskIconKind.Charge -> DataDisplayGlyphs.Bolt
        RiskIconKind.Battery -> DataDisplayGlyphs.Battery
        RiskIconKind.Generic -> DataDisplayGlyphs.AlertTriangle
    }

/** Maps the Android [UiState] failure classification onto a [QueryErrorKind] for the error surface. */
private fun UiState<*>.toForecastQueryErrorKind(): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/** Transforms a [Resource]'s payload while preserving its loading/success/error shape + freshness. */
private inline fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached = cached?.let(transform), fetchedAt = fetchedAt, stale = stale)
        is Resource.Success -> Resource.Success(data = transform(data), fetchedAt = fetchedAt, stale = stale)
        is Resource.Error ->
            Resource.Error(cached = cached?.let(transform), fetchedAt = fetchedAt, stale = stale, error = error)
    }

// ── Stateful entry — binds the shared P1/S8 store (ADR-002: the view never touches HTTP) ──────────

/**
 * The host entry point: binds the shared [store] to the dashboard surface for [vehicleId], emits the
 * P1/S11 `view.opened` diagnostics on first composition, and renders
 * [BatteryDegradationForecastWidgetContent]. A dashboard grid host supplies the [store], the resolved
 * [vehicleId] (web defaults to the first vehicle via the shared selection — `null` ⇒ the empty state),
 * the [size] it allotted the panel, and the optional [telemetry] / [logger] (ADR-016). Reads stream a
 * cache-then-network resource parsed by [degradationForecast]; this widget has no mutations.
 */
@Composable
public fun BatteryDegradationForecastWidget(
    store: EnergyStore,
    vehicleId: Long?,
    size: DashboardWidgetSize,
    modifier: Modifier = Modifier,
    telemetry: Telemetry? = null,
    logger: Logger? = null,
) {
    LaunchedEffect(store, vehicleId) {
        logger?.info("view.opened", mapOf("surface" to SURFACE_SLUG))
        telemetry?.track(batteryDegradationForecastViewOpenedEvent(BuildConfig.VERSION_NAME))
    }

    if (vehicleId == null) {
        BatteryDegradationForecastWidgetContent(
            state = UiState(phase = UiPhase.Empty),
            size = size,
            modifier = modifier,
        )
    } else {
        BoundForecast(store = store, vehicleId = vehicleId, size = size, modifier = modifier)
    }
}

@Composable
private fun BoundForecast(
    store: EnergyStore,
    vehicleId: Long,
    size: DashboardWidgetSize,
    modifier: Modifier,
) {
    val feed = remember(store, vehicleId) { store.batteryDegradation(vehicleId.toString()) }
    val resource by feed.collectAsStateWithLifecycle()
    val state =
        remember(resource) {
            resource.mapData { degradationForecast(it) }.toUiState(isEmpty = { !it.hasData })
        }
    val locale = LocalConfiguration.current.locales[0] ?: Locale.getDefault()

    BatteryDegradationForecastWidgetContent(state = state, size = size, modifier = modifier, locale = locale)
}

// ── Stateless content — every state renders; preview- and UI-test-friendly ────────────────────────

/**
 * The stateless surface: renders the [state] for the given [size]. Loading shows skeleton chrome, a
 * hard error shows a [QueryError] with retry, an absent/empty forecast shows a friendly empty state,
 * and content shows the compact tile or the full forecast. Stale / offline data stays visible with a
 * freshness chip rather than blanking (ADR-013). [onRetry] re-runs a failed fetch.
 */
@Composable
public fun BatteryDegradationForecastWidgetContent(
    state: UiState<DegradationForecast>,
    size: DashboardWidgetSize,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    onRetry: () -> Unit = {},
) {
    val clamped = remember(size) { size.coerceToForecastConstraints() }
    val title = if (clamped.forecastShowsHeader()) stringResource(R.string.translation_widget_forecast_title) else null

    ForecastShell(title = title, state = state, onRetry = onRetry, modifier = modifier) {
        val data = state.data
        if (data == null || !data.hasData) {
            EmptyState(
                message = stringResource(R.string.translation_widget_forecast_noData),
                icon = DataDisplayGlyphs.TrendingDown,
            )
        } else {
            FadeIn {
                if (clamped.forecastIsCompact()) {
                    CompactForecast(data = data, locale = locale)
                } else {
                    StandardForecast(data = data, locale = locale)
                }
            }
        }
    }
}

/**
 * Panel chrome reproducing the web `WidgetShell`: a loading skeleton, a hard-error [QueryError]
 * surface, or the titled body with a freshness chip carrying the ADR-013 stale / offline / refreshing
 * state so a cached value is never shown as live.
 */
@Composable
private fun ForecastShell(
    title: String?,
    state: UiState<DegradationForecast>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    when {
        state.isLoading ->
            Column(modifier = modifier.fillMaxSize().padding(PANEL_PADDING)) {
                Skeleton(widthFraction = SKELETON_TITLE_FRACTION, height = SKELETON_TITLE_HEIGHT)
                SkeletonLines(modifier = Modifier.padding(top = GAP_SM), lines = SKELETON_BODY_LINES)
            }

        state.isError ->
            Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                QueryError(kind = state.toForecastQueryErrorKind(), onRetry = onRetry)
            }

        else ->
            Column(modifier = modifier.fillMaxSize().padding(PANEL_PADDING)) {
                ShellHeader(title = title, state = state)
                Column(modifier = Modifier.weight(1f, fill = true), content = content)
            }
    }
}

@Composable
private fun ShellHeader(
    title: String?,
    state: UiState<DegradationForecast>,
) {
    val freshness: @Composable () -> Unit = {
        DataFreshness(
            updatedAtMillis = state.fetchedAt,
            isFetching = state.refreshing,
            isStale = state.stale && !state.hasError,
            isError = state.hasError,
            compact = title == null,
        )
    }
    if (title == null) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { freshness() }
    } else {
        Row(
            modifier = Modifier.fillMaxWidth().padding(bottom = GAP_SM),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(GAP_XS)) {
                Icon(
                    DataDisplayGlyphs.TrendingDown,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = TeslaTokens.status.warning,
                )
                Caption(title)
            }
            freshness()
        }
    }
}

/** Compact 1-wide tile: the current SoH percentage and the health-tier badge (web `CompactView`). */
@Composable
private fun CompactForecast(
    data: DegradationForecast,
    locale: Locale,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        val soh = data.currentHealthPct
        MetricValue(if (soh != null) "${formatForecastNumber(soh, SOH_DECIMALS, locale)}%" else EM_DASH)
        Badge(
            text = tierLabel(data.tier),
            variant = data.tier.toBadgeVariant(),
            modifier = Modifier.padding(top = GAP_XS),
        )
    }
}

/** Full 2×2+ view: projected-date hero, current-health stat, risk factors, and recommendations. */
@Composable
private fun StandardForecast(
    data: DegradationForecast,
    locale: Locale,
) {
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(GAP_MD),
    ) {
        ProjectedHero(data = data, locale = locale)
        data.currentHealthPct?.let { soh ->
            StatCard(
                label = stringResource(R.string.translation_widget_forecast_currentHealth),
                value = "${formatForecastNumber(soh, SOH_DECIMALS, locale)}%",
            )
        }
        if (data.riskFactors.isNotEmpty()) {
            RiskFactorsSection(riskFactors = data.riskFactors, locale = locale)
        }
        if (data.recommendations.isNotEmpty()) {
            RecommendationsSection(recommendations = data.recommendations)
        }
    }
}

@Composable
private fun ProjectedHero(
    data: DegradationForecast,
    locale: Locale,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(GAP_XS),
    ) {
        MetricLabel(stringResource(R.string.translation_widget_forecast_projected80))
        MetricValue(formatForecastProjected(data.projected80PctDate, locale) ?: EM_DASH)
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(GAP_SM),
        ) {
            Badge(text = tierLabel(data.tier), variant = data.tier.toBadgeVariant())
            if (data.degradationRatePctPerMonth > 0.0) {
                val rate = formatForecastNumber(data.degradationRatePctPerMonth, RATE_DECIMALS, locale)
                Caption("$MINUS_SIGN$rate%/${stringResource(R.string.translation_widget_mo)}")
            }
        }
    }
}

@Composable
private fun RiskFactorsSection(
    riskFactors: List<DegradationRiskFactor>,
    locale: Locale,
) {
    Column(verticalArrangement = Arrangement.spacedBy(GAP_XS)) {
        MetricLabel(stringResource(R.string.translation_widget_forecast_riskFactors))
        riskFactors.take(MAX_RISK_FACTORS).forEach { factor ->
            RiskFactorRow(factor = factor, locale = locale)
        }
    }
}

@Composable
private fun RiskFactorRow(
    factor: DegradationRiskFactor,
    locale: Locale,
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(GAP_SM),
        ) {
            Icon(
                riskFactorIconKind(factor.name).glyph(),
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            Column(modifier = Modifier.weight(1f)) {
                Caption(factor.label ?: factor.name)
                HelperText(factor.detail ?: EM_DASH)
            }
            Badge(
                text = formatForecastNumber(factor.score, SCORE_DECIMALS, locale),
                variant = riskScoreImpact(factor.score).toBadgeVariant(),
            )
        }
    }
}

@Composable
private fun RecommendationsSection(recommendations: List<String>) {
    Column(verticalArrangement = Arrangement.spacedBy(GAP_XS)) {
        MetricLabel(stringResource(R.string.translation_widget_forecast_recommendations))
        recommendations.take(MAX_TIPS).forEach { recommendation ->
            RecommendationCard(recommendation = recommendation)
        }
    }
}

@Composable
private fun RecommendationCard(recommendation: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(horizontalArrangement = Arrangement.spacedBy(GAP_SM)) {
            Icon(
                LightbulbGlyph,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.info,
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(GAP_TINY)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Caption(stringResource(R.string.translation_widget_forecast_tip))
                    Badge(
                        text = stringResource(R.string.translation_widget_forecast_recommendation),
                        variant = BadgeVariant.Warning,
                    )
                }
                HelperText(recommendation)
            }
        }
    }
}

@Composable
private fun tierLabel(tier: DegradationHealthTier): String =
    when (tier) {
        DegradationHealthTier.Healthy -> stringResource(R.string.translation_widget_forecast_healthy)
        DegradationHealthTier.Normal -> stringResource(R.string.translation_widget_forecast_normal)
        DegradationHealthTier.Accelerated -> stringResource(R.string.translation_widget_forecast_accelerated)
    }

// ── Local glyphs (the two lucide icons with no shared-set equivalent) ─────────────────────────────

/** A thermometer glyph (lucide `Thermometer`) — the thermal risk-factor indicator. */
private val ThermometerGlyph: ImageVector =
    strokedGlyph("Thermometer") {
        moveTo(12f, 4f)
        lineTo(12f, 14f)
        glyphCircle(12f, 17f, 3f)
    }

/** A lightbulb glyph (lucide `Lightbulb`) — the recommendation tip indicator. */
private val LightbulbGlyph: ImageVector =
    strokedGlyph("Lightbulb") {
        glyphCircle(12f, 9f, 5f)
        moveTo(9.5f, 18f)
        lineTo(14.5f, 18f)
        moveTo(10.5f, 21f)
        lineTo(13.5f, 21f)
    }

private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_VIEWPORT.dp,
            defaultHeight = GLYPH_VIEWPORT.dp,
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

private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Dimensions / constants ────────────────────────────────────────────────────────────────────────

private const val HEALTHY_RATE_MAX = 0.05
private const val NORMAL_RATE_MAX = 0.12
private const val RISK_HIGH_MIN = 7.0
private const val RISK_MEDIUM_MIN = 4.0
private const val MAX_RISK_FACTORS = 5
private const val MAX_TIPS = 3
private const val SOH_DECIMALS = 1
private const val RATE_DECIMALS = 2
private const val SCORE_DECIMALS = 0
private const val SKELETON_BODY_LINES = 3
private const val SKELETON_TITLE_FRACTION = 0.5f
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val EM_DASH = "\u2014"
private const val MINUS_SIGN = "\u2212"
private const val MONTH_YEAR_PATTERN = "MMM yyyy"

private val PANEL_PADDING = 12.dp
private val GAP_TINY = 2.dp
private val GAP_XS = 4.dp
private val GAP_SM = 8.dp
private val GAP_MD = 12.dp
private val SKELETON_TITLE_HEIGHT = 12.dp

// ── Previews (tooling-only; exercised visually + by the per-state UI tests) ─────────────────────────

private fun sampleForecast(): DegradationForecast =
    DegradationForecast(
        currentHealthPct = 92.4,
        degradationRatePctPerMonth = 0.08,
        projected80PctDate = "2031-07-01T00:00:00Z",
        riskFactors =
            listOf(
                DegradationRiskFactor(
                    name = "high_temp",
                    score = 8.0,
                    label = "High temperatures",
                    detail = "Frequent heat exposure",
                ),
                DegradationRiskFactor(
                    name = "fast_charging",
                    score = 5.0,
                    label = "Fast charging",
                    detail = "42% DC sessions",
                ),
                DegradationRiskFactor(
                    name = "deep_soc",
                    score = 2.0,
                    label = "Deep discharges",
                    detail = "Rarely below 10%",
                ),
            ),
        recommendations =
            listOf(
                "Keep the daily charge limit at 80% for longevity.",
                "Precondition before Supercharging to reduce heat stress.",
            ),
    )

private fun contentState(data: DegradationForecast): UiState<DegradationForecast> =
    UiState(phase = if (data.hasData) UiPhase.Content else UiPhase.Empty, data = data, fetchedAt = 1L)

@Preview(name = "Full", widthDp = 360, heightDp = 420)
@Composable
private fun BatteryDegradationForecastFullPreview() {
    TeslaSyncTheme {
        BatteryDegradationForecastWidgetContent(
            state = contentState(sampleForecast()),
            size = DashboardWidgetSize(cols = 2, rows = 4),
            locale = Locale.US,
        )
    }
}

@Preview(name = "Compact", widthDp = 160, heightDp = 160)
@Composable
private fun BatteryDegradationForecastCompactPreview() {
    TeslaSyncTheme {
        BatteryDegradationForecastWidgetContent(
            state = contentState(sampleForecast()),
            size = DashboardWidgetSize(cols = 1, rows = 2),
            locale = Locale.US,
        )
    }
}

@Preview(name = "Empty", widthDp = 360, heightDp = 200)
@Composable
private fun BatteryDegradationForecastEmptyPreview() {
    TeslaSyncTheme {
        BatteryDegradationForecastWidgetContent(
            state = UiState(phase = UiPhase.Empty),
            size = DashboardWidgetSize(cols = 2, rows = 4),
        )
    }
}

@Preview(name = "Error", widthDp = 360, heightDp = 200)
@Composable
private fun BatteryDegradationForecastErrorPreview() {
    TeslaSyncTheme {
        BatteryDegradationForecastWidgetContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            size = DashboardWidgetSize(cols = 2, rows = 4),
        )
    }
}
