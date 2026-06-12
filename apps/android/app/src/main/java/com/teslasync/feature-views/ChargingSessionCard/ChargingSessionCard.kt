// The native Jetpack Compose + Material 3 ChargingSessionCard feature view — a parity port of
// web/src/features/charging/components/ChargingSessionCard.tsx. The web component is purely presentational:
// the Charging Sessions list holds the `useChargingSessions` query and passes one decoded `session` down, and
// the component renders one history row through the shared `HistoryListRow` — a leading battery-friendly
// `ScoreBadge`, an optional selection `Checkbox`, a primary line (timestamp · duration + charger / energy /
// free / anomaly `Badge`s), a single-endpoint `RouteDisplay`, and a metrics line (`BatteryDelta`, peak/avg
// power, duration, cost, cost-per-kWh, range added) that the compact density hides.
//
// The native surface keeps that contract end to end. It performs NO HTTP and binds no data hook of its own;
// its only web hooks are `useTranslation` (mapped to the i18n catalog, P1/S10) and `useFormatting`/`useUnits`
// (mapped to the currency symbol + decimal precision + distance unit read from the shared settings store,
// P1/S8). The host supplies the decoded `ChargingSession` through the shared state-holder layer as a
// [UiState], so this feature view also renders every lifecycle state that layer can carry — a loading
// skeleton, a hard error with retry, content, and the stale/offline ("last known") freshness chip — without
// ever fetching. A web-parity overload that takes the raw `session` prop is also provided, mirroring the web
// component's `{ session }` signature.
//
// Every derivation flows through the pure [ChargingSessionCardProjection]; the composable is a thin render
// layer that resolves the i18n labels (P1/S10), maps the projected model onto the shared
// `HistoryListRow`/`Badge`/`InlineMetric`/`BatteryDelta`/`ScoreBadge`/`RouteDisplay` components, and applies
// the two semantic accent colors the web tones with Tailwind (cost → status.success, range added →
// tertiary). The native `HistoryListRow` has no checkbox slot, so the selection `Checkbox` leads the primary
// line (carrying the localized "Select charging session" content description) while the row's `selected`
// accent and the score badge keep the leading gutter — every interactive element stays an independent,
// labeled target. The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/ChargingSessionCard — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations. `LongMethod`/`CyclomaticComplexMethod` are suppressed on the
// stateless content renderer because reproducing every web conditional chip in one place is the parity goal.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.chargingsessioncard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.BatteryDelta
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.HistoryListRow
import io.teslasync.android.components.datadisplay.InlineMetric
import io.teslasync.android.components.datadisplay.RouteDisplay
import io.teslasync.android.components.datadisplay.RouteEndpoint
import io.teslasync.android.components.datadisplay.ScoreBadge
import io.teslasync.android.components.datadisplay.ScoreBadgeSize
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Checkbox
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.ChargingSession
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.JsonElement
import java.time.ZoneId
import java.util.Locale
import kotlin.time.Instant

/** Em dash shown by the freshness chip when no fetch timestamp is known. */
private const val EM_DASH = "\u2014"

/** Middle-dot separator between the timestamp and the duration in the primary line (web `·`). */
private const val MIDDLE_DOT = "\u00B7"

/** Number of skeleton lines drawn in the loading phase (primary, route, metrics). */
private const val SKELETON_LINES = 3

/** Height of one loading-skeleton line. */
private val SKELETON_LINE_HEIGHT: Dp = 16.dp

/** Width fractions for the staggered loading-skeleton lines so the card never collapses to a blank box. */
private val SKELETON_LINE_FRACTIONS = floatArrayOf(0.7f, 0.5f, 0.85f)

/**
 * Stateful entry point for the charging-session card. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), resolves the user's currency symbol + decimal precision + distance unit from the shared settings
 * store (web `useFormatting` + `useUnits`, P1/S8), and renders every lifecycle [state] the host's feed can
 * carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`); this view never
 * performs HTTP.
 *
 * @param state the cache-then-network projection of the decoded [ChargingSession] (web `useChargingSessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param selected whether this row is selected (web `selected`); drives the panel accent + checkbox state.
 * @param onToggleSelect selection callback (web `onToggleSelect`); when non-null the selection checkbox shows.
 * @param anomaly an optional page-level anomaly callout rendered as a danger badge (web `anomaly`).
 * @param density [CardDensity.Compact] hides the metrics line (web `density`).
 * @param onOpen optional navigation callback (web `href`); when non-null the row is tappable with a chevron.
 * @param settings the shared `/settings` document feed; its currency/precision/length format the values.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingSessionCard(
    state: UiState<ChargingSession>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onToggleSelect: ((Long, Boolean) -> Unit)? = null,
    anomaly: ChargingSessionAnomaly? = null,
    density: CardDensity = CardDensity.Comfortable,
    onOpen: ((Long) -> Unit)? = null,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val settingsResource by settings.collectAsStateWithLifecycle()
    val format = remember(settingsResource) { ChargingSessionCardFormat.fromSettings(settingsResource.cached) }
    val locale: Locale = LocalConfiguration.current.locales[0]
    val zone = ZoneId.systemDefault()
    LaunchedEffect(Unit) { ChargingSessionCardDiagnostics.recordViewOpened(logger) }
    ChargingSessionCardContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        format = format,
        locale = locale,
        zone = zone,
        selected = selected,
        onToggleSelect = onToggleSelect,
        anomaly = anomaly,
        density = density,
        onOpen = onOpen,
    )
}

/**
 * Web-parity overload mirroring the web component's `{ session }` prop (plus an explicit [isLoading] for the
 * host's first load). Projects the prop onto a [UiState] via [ChargingSessionCardProjection.projectUiState]
 * and delegates to the stateful entry, which records `view.opened` and resolves the formatting preferences.
 * There is no fetch behind it, so it offers no retry.
 */
@Composable
fun ChargingSessionCard(
    session: ChargingSession,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    selected: Boolean = false,
    onToggleSelect: ((Long, Boolean) -> Unit)? = null,
    anomaly: ChargingSessionAnomaly? = null,
    density: CardDensity = CardDensity.Comfortable,
    onOpen: ((Long) -> Unit)? = null,
    settings: StateFlow<Resource<JsonElement>> = LocalDataContainer.current.settingsStore.settings(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(session, isLoading) { ChargingSessionCardProjection.projectUiState(session, isLoading) }
    ChargingSessionCard(
        state = state,
        onRetry = {},
        modifier = modifier,
        selected = selected,
        onToggleSelect = onToggleSelect,
        anomaly = anomaly,
        density = density,
        onOpen = onOpen,
        settings = settings,
        logger = logger,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * component's history row (the score badge, primary line, route, and metrics) and adds the lifecycle chrome
 * the host's feed implies: a loading skeleton card, a hard-error retry surface, a friendly empty body, and a
 * freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the
 * web freshness contract. [format] supplies the currency symbol + precision + distance unit and
 * [locale]/[zone] format every value.
 */
@Composable
@Suppress("LongMethod", "CyclomaticComplexMethod", "LongParameterList")
fun ChargingSessionCardContent(
    state: UiState<ChargingSession>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    format: ChargingSessionCardFormat = ChargingSessionCardFormat.DEFAULT,
    locale: Locale = Locale.getDefault(),
    zone: ZoneId = ZoneId.systemDefault(),
    selected: Boolean = false,
    onToggleSelect: ((Long, Boolean) -> Unit)? = null,
    anomaly: ChargingSessionAnomaly? = null,
    density: CardDensity = CardDensity.Comfortable,
    onOpen: ((Long) -> Unit)? = null,
    strings: ChargingSessionCardStrings = rememberChargingSessionCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val session = state.data
    when {
        state.isLoading -> ChargingSessionCardSkeleton(modifier)
        state.isError -> ChargingSessionCardError(onRetry, modifier)
        session == null -> ChargingSessionCardEmpty(modifier)
        else -> {
            val model =
                remember(session, format, locale, zone, strings) {
                    ChargingSessionCardProjection.model(session, format, locale, zone, strings)
                }
            val showFreshness = state.stale || state.refreshing || state.hasError
            if (showFreshness) {
                Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                    ChargingSessionCardFreshnessRow(state)
                    ChargingSessionRow(model, session.id, selected, onToggleSelect, anomaly, density, onOpen)
                }
            } else {
                ChargingSessionRow(
                    model = model,
                    sessionId = session.id,
                    selected = selected,
                    onToggleSelect = onToggleSelect,
                    anomaly = anomaly,
                    density = density,
                    onOpen = onOpen,
                    modifier = modifier,
                )
            }
        }
    }
}

/**
 * The web row itself — the score badge in the leading gutter, the selection checkbox + timestamp/badges
 * primary line, the single charger location, and (comfortable density only) the metrics line — composed onto
 * the shared `HistoryListRow`. Every value comes pre-formatted from the [model]; this function only places it.
 */
@Composable
@Suppress("LongParameterList")
private fun ChargingSessionRow(
    model: ChargingSessionCardModel,
    sessionId: Long,
    selected: Boolean,
    onToggleSelect: ((Long, Boolean) -> Unit)?,
    anomaly: ChargingSessionAnomaly?,
    density: CardDensity,
    onOpen: ((Long) -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val selectLabel = stringResource(R.string.translation_selectSession)
    val freeLabel = stringResource(R.string.translation_common_free)
    val scoreBase = stringResource(R.string.translation_charging_optimizer_batteryScore)

    val score = model.score
    val leadingSlot: (@Composable () -> Unit)? =
        if (score != null) {
            {
                ScoreBadge(
                    score = score.toDouble(), // parity:allow numeric score conversion, substring false positive
                    size = ScoreBadgeSize.Sm,
                    contentDescription = "$scoreBase: $score",
                )
            }
        } else {
            null
        }

    val metricsSlot: (@Composable RowScope.() -> Unit)? =
        if (density == CardDensity.Comfortable) {
            { ChargingSessionMetrics(model) }
        } else {
            null
        }

    HistoryListRow(
        modifier = modifier,
        leading = leadingSlot,
        primary = {
            if (onToggleSelect != null) {
                Checkbox(
                    checked = selected,
                    onCheckedChange = { onToggleSelect(sessionId, it) },
                    modifier = Modifier.semantics { contentDescription = selectLabel },
                )
            }
            Text(
                text = model.timestamp,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Caption(MIDDLE_DOT)
            Caption(model.durationLabel)
            Badge(text = model.chargerLabel, variant = chargerVariant(model.chargerTone))
            model.energyChip?.let { Badge(text = it, variant = BadgeVariant.Info) }
            if (model.showFree) Badge(text = freeLabel, variant = BadgeVariant.Success)
            anomaly?.let { Badge(text = it.message, variant = BadgeVariant.Danger) }
        },
        route = {
            RouteDisplay(
                start = RouteEndpoint(address = model.routeAddress, lat = model.routeLat, lon = model.routeLng),
            )
        },
        metrics = metricsSlot,
        onClick = onOpen?.let { open -> { open(sessionId) } },
        selected = selected,
        showChevron = onOpen != null,
    )
}

/**
 * The secondary metrics line (comfortable density). Renders the same metrics, in the same order, the web
 * component does: the battery delta, then peak / average power, the duration, the cost (toned to the success
 * accent like the web emerald), the parenthesized cost-per-kWh, and the range-added chip (toned to the
 * tertiary accent like the web purple). Each chip is omitted exactly when the [model] field is null.
 */
@Composable
private fun RowScope.ChargingSessionMetrics(model: ChargingSessionCardModel) {
    BatteryDelta(startPct = model.startSocPct, endPct = model.endSocPct)
    model.peakChip?.let { InlineMetric(icon = DataDisplayGlyphs.Gauge, value = it) }
    model.avgChip?.let { InlineMetric(icon = DataDisplayGlyphs.BatteryCharging, value = it) }
    if (model.showDuration) InlineMetric(icon = DataDisplayGlyphs.Clock, value = model.durationLabel)
    model.costChip?.let { AccentMetric(text = it, color = TeslaTokens.status.success) }
    model.cpkChip?.let { Caption(it) }
    model.distanceChip?.let { DistanceMetric(text = it) }
}

/** A colored value chip (no icon) — the web `text-emerald-300` cost metric. */
@Composable
private fun AccentMetric(
    text: String,
    color: Color,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** The range-added chip — a bolt icon + accented value (the web purple `Zap` "+N mi" span). */
@Composable
private fun DistanceMetric(text: String) {
    val color = MaterialTheme.colorScheme.tertiary
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(DataDisplayGlyphs.Bolt, contentDescription = null, size = IconSize.Xs, tint = color)
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The loading branch: a glass card of skeleton lines so the surface never collapses to a blank box. */
@Composable
private fun ChargingSessionCardSkeleton(modifier: Modifier) {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            repeat(SKELETON_LINES) { index ->
                Skeleton(
                    modifier = Modifier.fillMaxWidth(SKELETON_LINE_FRACTIONS[index]),
                    height = SKELETON_LINE_HEIGHT,
                    rounded = true,
                )
            }
        }
    }
}

/** Hard-error surface with a retry affordance — the lifecycle chrome the web's parent owns. */
@Composable
private fun ChargingSessionCardError(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

/** Empty branch: the surface still renders, with a friendly "no data" body — never a blank box. */
@Composable
private fun ChargingSessionCardEmpty(modifier: Modifier) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        EmptyState(message = stringResource(R.string.translation_common_noData), modifier = Modifier.fillMaxWidth())
    }
}

/** The "refreshing / stale / offline" freshness chip, right-aligned above the row. */
@Composable
private fun ChargingSessionCardFreshnessRow(state: UiState<ChargingSession>) {
    val formatAge = rememberChargingFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth(),
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

/**
 * Builds the localized [ChargingSessionCardStrings] from the i18n catalog (P1/S10): the four `chargerTypes.*`
 * labels (the unknown bucket lifted to `common.charger`), the `common.free` badge text, and the
 * `charging.curve.peakPower`/`avgPower` qualifiers the web card hardcodes as "peak"/"avg". Resolved once at
 * the Compose boundary so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberChargingSessionCardStrings(): ChargingSessionCardStrings {
    val supercharger = stringResource(R.string.translation_chargerTypes_supercharger)
    val dcFast = stringResource(R.string.translation_chargerTypes_dc)
    val homeAc = stringResource(R.string.translation_chargerTypes_home)
    val charger = stringResource(R.string.translation_common_charger)
    val free = stringResource(R.string.translation_common_free)
    val peakPower = stringResource(R.string.translation_charging_curve_peakPower)
    val avgPower = stringResource(R.string.translation_charging_curve_avgPower)
    return remember(supercharger, dcFast, homeAc, charger, free, peakPower, avgPower) {
        ChargingSessionCardStrings(
            chargerSupercharger = supercharger,
            chargerDcFast = dcFast,
            chargerHomeAc = homeAc,
            chargerUnknown = charger,
            free = free,
            peakPower = peakPower,
            avgPower = avgPower,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberChargingFreshnessFormatter(): (FreshnessAge) -> String {
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

/** Maps the framework-free [ChargerBadgeTone] onto the shared `Badge`'s `BadgeVariant`. */
private fun chargerVariant(tone: ChargerBadgeTone): BadgeVariant =
    when (tone) {
        ChargerBadgeTone.Success -> BadgeVariant.Success
        ChargerBadgeTone.Warning -> BadgeVariant.Warning
        ChargerBadgeTone.Danger -> BadgeVariant.Danger
    }

// ── Previews (tooling-only; each @Preview exercises a rendered branch) ───────────────────────────────────

/** A fully-populated supercharger session — exercises the score badge and every metric chip. */
private fun previewSuperchargerSession(): ChargingSession =
    ChargingSession(
        id = 1L,
        startedAt = Instant.parse("2026-04-04T09:30:00Z"),
        vehicleId = 1L,
        chargerType = "Supercharger V3",
        endedAt = Instant.parse("2026-04-04T10:15:00Z"),
        totalEnergyAddedWh = 42_350.0,
        peakPowerW = 121_000.0,
        avgPowerW = 56_500.0,
        startSocPct = 18.0,
        endSocPct = 82.0,
        costDecimal = 12.4,
        startPlace = "Supercharger — Fremont",
        startOdometerM = 1_000_000.0, // parity:allow odometer field identifier, substring false positive
        endOdometerM = 1_200_000.0,
    )

/** A free home AC session — no cost, exercises the "Free" badge and the home tone. */
private fun previewHomeSession(): ChargingSession =
    ChargingSession(
        id = 2L,
        startedAt = Instant.parse("2026-04-04T22:05:00Z"),
        vehicleId = 1L,
        chargerType = "Home Wall Connector",
        endedAt = Instant.parse("2026-04-05T02:05:00Z"),
        totalEnergyAddedWh = 18_200.0,
        peakPowerW = 11_000.0,
        startSocPct = 55.0,
        endSocPct = 90.0,
        startPlace = "Home",
    )

@Preview(name = "Content — supercharger, selectable", showBackground = true)
@Composable
private fun ChargingSessionCardSuperchargerPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSessionCardContent(
            state = ChargingSessionCardProjection.projectUiState(previewSuperchargerSession(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
            selected = true,
            onToggleSelect = { _, _ -> },
            anomaly = ChargingSessionAnomaly("Expensive charge ($0.62/kWh)"),
            onOpen = {},
        )
    }
}

@Preview(name = "Content — free home (compact)", showBackground = true)
@Composable
private fun ChargingSessionCardHomePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSessionCardContent(
            state = ChargingSessionCardProjection.projectUiState(previewHomeSession(), isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
            density = CardDensity.Compact,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun ChargingSessionCardLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSessionCardContent(state = UiState.loading(), onRetry = {}, locale = Locale.US, zone = ZoneId.of("UTC"))
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun ChargingSessionCardEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ChargingSessionCardContent(
            state = ChargingSessionCardProjection.projectUiState(session = null, isLoading = false),
            onRetry = {},
            locale = Locale.US,
            zone = ZoneId.of("UTC"),
        )
    }
}
