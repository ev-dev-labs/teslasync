// The native Jetpack Compose + Material 3 TimeToChargeSection feature view — a parity port of
// web/src/features/charging/components/charging-curve/TimeToChargeSection.tsx. The web component is purely
// presentational: its parent passes a `ChargingSession[]`, it derives a `timeToCharge` document via
// `useMemo`, and it fades in a title + description followed by a four-card grid (the 10%→80% and 20%→80%
// average DC durations, and the fastest + slowest sessions by charge rate) and a yearly-trend chart.
//
// This port keeps that contract end to end. It performs NO HTTP and binds no data hook of its own (its only
// web hook is `useTranslation`, mapped here to the i18n catalog, P1/S10; values use the locale-aware number
// formatter). The host supplies the sessions through the shared P1/S8 state-holder layer as a [UiState], so
// this feature view renders every lifecycle state that layer can carry — loading skeletons, a hard error
// with retry, content, and stale/offline cached "last known" — without ever fetching. The four cards always
// render with the web's "—" fallback when a metric is absent, so an empty feed shows the labeled cards (the
// web component's own empty affordance) rather than a blank box. A web-parity overload that takes the raw
// `sessions` list is also provided for hosts that already hold it.
//
// The yearly-trend chart the web renders after the cards is a separate surface (the YearlyTrendChart feature
// view has its own prompt); this surface exposes a [trailingContent] slot where the host composes it, while
// the projection still derives `yearlyTrend` (see the model) so the data contract stays faithful.
//
// Spacing comes from the generated design-token scale (P1/S9, never raw dp gaps) and type from the shared
// typography roles (never ad-hoc text styles): the title is a [SectionTitle], the description a muted
// [BodyText], the card label a [Caption], the value a [MetricValue] (the web `text-2xl font-semibold`), the
// unit a [Caption] shown only beside a present value (web `{unit && value}`), and the subtitle a [MetricLabel].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/TimeToChargeSection — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timetochargesection

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Web `<FadeIn delay={0.25}>` — the section fades in after a 250 ms stagger. */
private const val ENTRY_DELAY_MS: Int = 250

/** Web `grid-cols-2` — the four cards lay out two-per-row below the `lg` breakpoint. */
private const val NARROW_COLUMNS: Int = 2

/** Web `lg:grid-cols-4` — the four cards lay out four-per-row at or above the `lg` breakpoint. */
private const val WIDE_COLUMNS: Int = 4

/** Number of metric cards the section always renders (web's four `TimeToChargeCard`s). */
private const val CARD_COUNT: Int = 4

/** Web Tailwind `lg` breakpoint (1024px): at or above this width the grid expands to four columns. */
private val GRID_WIDE_MIN_WIDTH: Dp = 1024.dp

/** Loading skeleton tile height for the card grid. */
private val SKELETON_TILE_HEIGHT: Dp = 84.dp

/** The web `value ?? '—'` fallback rendered when a metric is absent. */
private const val EM_DASH: String = "\u2014"

/**
 * The already-localized strings the section renders — every `charging.curve.*` key the web component
 * resolves through `useTranslation`. They arrive through the P1/S10 i18n facade at the Compose boundary and
 * are threaded down so the rest of the surface holds no English literal. [sessionIdTemplate] is the
 * positional "Session #%1$s" pattern formatted per session id at the render boundary.
 */
data class TimeToChargeSectionStrings(
    val title: String,
    val description: String,
    val avg10to80Label: String,
    val avg20to80Label: String,
    val avgDurationLabel: String,
    val fastestLabel: String,
    val slowestLabel: String,
    val sessionIdTemplate: String,
)

/**
 * Stateful entry point for the section. Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) and
 * renders every lifecycle [state] the shared charging feed can carry. The host owns the feed (P1/S8) and
 * supplies [onRetry] (the feed's `refetch`); this view never performs HTTP. [trailingContent] is the slot
 * where the host composes the separate YearlyTrendChart surface (web renders it after the cards).
 *
 * @param state the cache-then-network projection of the `ChargingSession[]` (web `sessions`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun TimeToChargeSection(
    state: UiState<List<TimeToChargeSession>>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    trailingContent: @Composable () -> Unit = {},
) {
    LaunchedEffect(Unit) { recordTimeToChargeSectionOpened(logger) }
    TimeToChargeSectionContent(
        state = state,
        onRetry = onRetry,
        modifier = modifier,
        trailingContent = trailingContent,
    )
}

/**
 * Web-parity overload mirroring the web component's `sessions: ChargingSession[]` prop, for hosts that
 * already hold the loaded list. The list (empty or not) renders as content — the cards show the web "—"
 * fallback for absent metrics, matching the web component, which has no separate empty surface. Records
 * `view.opened` like the stateful entry; there is no fetch behind it, so it offers no retry affordance.
 */
@Composable
fun TimeToChargeSection(
    sessions: List<TimeToChargeSession>?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
    trailingContent: @Composable () -> Unit = {},
) {
    val state = remember(sessions) { UiState(phase = UiPhase.Content, data = sessions ?: emptyList()) }
    TimeToChargeSection(
        state = state,
        onRetry = {},
        modifier = modifier,
        logger = logger,
        trailingContent = trailingContent,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test and preview entry point. The title +
 * description chrome stays visible in every branch; the body switches between a loading skeleton grid, a
 * hard-error retry surface, and the web content (a freshness chip when stale/refreshing/offline, then the
 * four metric cards). Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [trailingContent] (the host's YearlyTrendChart surface) is composed after the body, as in the web.
 */
@Composable
fun TimeToChargeSectionContent(
    state: UiState<List<TimeToChargeSession>>,
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
    locale: Locale = Locale.getDefault(),
    strings: TimeToChargeSectionStrings = rememberTimeToChargeSectionStrings(),
    trailingContent: @Composable () -> Unit = {},
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    FadeIn(modifier = modifier, delayMs = ENTRY_DELAY_MS) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            SectionTitle(text = strings.title, modifier = Modifier.semantics { heading() })
            BodyText(text = strings.description, color = MaterialTheme.colorScheme.onSurfaceVariant)
            when {
                state.isLoading -> TimeToChargeLoadingBody()
                state.isError -> TimeToChargeErrorBody(onRetry = onRetry)
                else -> TimeToChargeCardsBody(state = state, strings = strings, locale = locale)
            }
            trailingContent()
        }
    }
}

/**
 * The content branch — an optional freshness chip (only when refreshing/stale/offline) above the four metric
 * cards. The cards are projected once for the active [locale] (web `fmtNumber`) so a locale change
 * re-projects; absent metrics render the web "—" fallback rather than hiding the card.
 */
@Composable
private fun TimeToChargeCardsBody(
    state: UiState<List<TimeToChargeSession>>,
    strings: TimeToChargeSectionStrings,
    locale: Locale,
) {
    val formatters =
        remember(strings, locale) {
            TimeToChargeFormatters(
                number = { value -> ChartFormat.number(value, VALUE_DECIMALS, locale) },
                sessionId = { id -> String.format(locale, strings.sessionIdTemplate, id) },
                avgDurationLabel = strings.avgDurationLabel,
            )
        }
    val cards = remember(state.data, formatters) { TimeToChargeProjection.projectCards(state.data ?: emptyList(), formatters) }
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (state.stale || state.refreshing || state.hasError) {
            TimeToChargeFreshnessRow(state = state)
        }
        ResponsiveGrid(items = cards, gap = Spacing.md) { card ->
            TimeToChargeMetricCard(
                label = strings.cardLabel(card.kind),
                card = card,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/**
 * One metric card — the native port of the web `TimeToChargeCard`: a glass card with a [Caption] label, a
 * prominent [MetricValue] (or the "—" fallback) with the unit symbol shown only beside a present value, and
 * an optional [MetricLabel] subtitle. Label, value, unit and subtitle are individually announced to TalkBack.
 */
@Composable
private fun TimeToChargeMetricCard(
    label: String,
    card: TimeToChargeCard,
    modifier: Modifier = Modifier,
) {
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Caption(text = label)
            Row(
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                MetricValue(text = card.value ?: EM_DASH)
                if (card.value != null) {
                    Caption(text = card.unit)
                }
            }
            if (card.subtitle != null) {
                MetricLabel(text = card.subtitle)
            }
        }
    }
}

/** The loading branch — a skeleton tile per card in the same responsive grid as the content. */
@Composable
private fun TimeToChargeLoadingBody() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    ResponsiveGrid(
        items = List(CARD_COUNT) { it },
        gap = Spacing.md,
        modifier = Modifier.semantics { contentDescription = loadingLabel },
    ) {
        Skeleton(modifier = Modifier.weight(1f), height = SKELETON_TILE_HEIGHT, rounded = true)
    }
}

/** The hard-error branch — a retry affordance (the web `QueryError` equivalent). */
@Composable
private fun TimeToChargeErrorBody(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The freshness chip, right-aligned — surfaces refreshing / stale / offline over the cached cards. */
@Composable
private fun TimeToChargeFreshnessRow(state: UiState<List<TimeToChargeSession>>) {
    val formatAge = rememberTimeToChargeFreshnessFormatter()
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
 * A responsive grid of equal-width cells — the native analogue of the web `grid-cols-2 lg:grid-cols-4`.
 * Below [GRID_WIDE_MIN_WIDTH] the [items] lay out [NARROW_COLUMNS] per row; at or above it, [WIDE_COLUMNS]
 * per row. Each cell fills its column via [Modifier.weight]; a partial trailing row is padded with weighted
 * spacers so every tile keeps a uniform width. Rows and columns are both spaced by [gap].
 */
@Composable
private fun <T> ResponsiveGrid(
    items: List<T>,
    gap: Dp,
    modifier: Modifier = Modifier,
    cell: @Composable RowScope.(T) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= GRID_WIDE_MIN_WIDTH) WIDE_COLUMNS else NARROW_COLUMNS
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(gap),
        ) {
            items.chunked(columns).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(gap),
                ) {
                    rowItems.forEach { item -> cell(item) }
                    repeat(columns - rowItems.size) { Spacer(modifier = Modifier.weight(1f)) }
                }
            }
        }
    }
}

/**
 * Builds the localized [TimeToChargeSectionStrings] from the i18n catalog (P1/S10): the `charging.curve.*`
 * microcopy the web component reads through `useTranslation`. Remembered against the resolved strings so a
 * locale change re-projects.
 */
@Composable
private fun rememberTimeToChargeSectionStrings(): TimeToChargeSectionStrings {
    val title = stringResource(R.string.translation_charging_curve_timeToCharge)
    val description = stringResource(R.string.translation_charging_curve_timeToChargeDesc)
    val avg10to80 = stringResource(R.string.translation_charging_curve_avg10to80)
    val avg20to80 = stringResource(R.string.translation_charging_curve_avg20to80)
    val avgDuration = stringResource(R.string.translation_charging_curve_avgDuration)
    val fastest = stringResource(R.string.translation_charging_curve_fastest)
    val slowest = stringResource(R.string.translation_charging_curve_slowest)
    val sessionId = stringResource(R.string.translation_charging_curve_sessionId)
    return remember(title, description, avg10to80, avg20to80, avgDuration, fastest, slowest, sessionId) {
        TimeToChargeSectionStrings(
            title = title,
            description = description,
            avg10to80Label = avg10to80,
            avg20to80Label = avg20to80,
            avgDurationLabel = avgDuration,
            fastestLabel = fastest,
            slowestLabel = slowest,
            sessionIdTemplate = sessionId,
        )
    }
}

/** Resolves a card's already-localized label from the bundled strings. */
private fun TimeToChargeSectionStrings.cardLabel(kind: TimeToChargeCardKind): String =
    when (kind) {
        TimeToChargeCardKind.Avg10To80 -> avg10to80Label
        TimeToChargeCardKind.Avg20To80 -> avg20to80Label
        TimeToChargeCardKind.Fastest -> fastestLabel
        TimeToChargeCardKind.Slowest -> slowestLabel
    }

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberTimeToChargeFreshnessFormatter(): (FreshnessAge) -> String {
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

// ── Previews — one per rendered state (content / empty-dashes / stale-offline / loading / error) ────────

private val PREVIEW_STRINGS =
    TimeToChargeSectionStrings(
        title = "Time-to-Charge Analysis",
        description = "How long DC sessions take to reach key SOC thresholds",
        avg10to80Label = "10% → 80%",
        avg20to80Label = "20% → 80%",
        avgDurationLabel = "Avg duration",
        fastestLabel = "Fastest Session",
        slowestLabel = "Slowest Session",
        sessionIdTemplate = "Session #%1\$s",
    )

private val PREVIEW_SESSIONS =
    listOf(
        TimeToChargeSession(101, "Tesla", 150_000.0, 48_000.0, 8.0, 82.0, "2025-04-04T10:00:00Z", "2025-04-04T10:35:00Z"),
        TimeToChargeSession(102, "Tesla", 120_000.0, 36_000.0, 18.0, 84.0, "2025-04-05T09:00:00Z", "2025-04-05T09:40:00Z"),
        TimeToChargeSession(103, "ChargePoint", 50_000.0, 22_000.0, 9.0, 81.0, "2024-12-06T12:00:00Z", "2024-12-06T13:05:00Z"),
    )

private const val PREVIEW_FETCHED_AT: Long = 1_700_000_000_000L

@Preview(name = "TimeToChargeSection · content", showBackground = true)
@Composable
private fun TimeToChargeSectionContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeToChargeSectionContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SESSIONS, fetchedAt = PREVIEW_FETCHED_AT),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "TimeToChargeSection · empty (dashes)", showBackground = true)
@Composable
private fun TimeToChargeSectionEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeToChargeSectionContent(
            state = UiState(phase = UiPhase.Empty, data = emptyList()),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "TimeToChargeSection · stale + offline", showBackground = true)
@Composable
private fun TimeToChargeSectionStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeToChargeSectionContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SESSIONS,
                    fetchedAt = PREVIEW_FETCHED_AT,
                    stale = true,
                    errorKind = ErrorKind.Network,
                ),
            locale = Locale.US,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "TimeToChargeSection · loading", showBackground = true)
@Composable
private fun TimeToChargeSectionLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeToChargeSectionContent(state = UiState.loading(), strings = PREVIEW_STRINGS)
    }
}

@Preview(name = "TimeToChargeSection · error", showBackground = true)
@Composable
private fun TimeToChargeSectionErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        TimeToChargeSectionContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            strings = PREVIEW_STRINGS,
        )
    }
}
