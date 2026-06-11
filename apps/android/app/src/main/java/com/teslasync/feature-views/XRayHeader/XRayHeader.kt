// The native Jetpack Compose + Material 3 XRayHeader feature view — a parity port of
// web/src/features/admin/components/ingest-xray/XRayHeader.tsx. The web component is purely
// presentational: its parent (`IngestXRayPage` via `useIngestXRay`) loads the `IngestXRayResponse` and
// passes the aggregate summary down, and the component renders a `<Grid cols={{default:1, sm:3}}>` of
// three `<StatCard>`s — Total samples, Distinct fields, and the selected Window — echoing the window
// label back so the strip reads like a self-explanatory summary.
//
// This port keeps that contract: it performs NO HTTP and binds no data hook of its own (its only web
// hook is `useTranslation`, mapped here to the i18n catalog at the Compose boundary). The host supplies
// the summary through the shared P1/S8 state-holder layer as a [UiState], so this feature view renders
// every lifecycle state that layer can carry — loading (skeleton chrome), hard error with retry, empty
// (zero samples, with a friendly hint), content, and stale/offline (cached "last known" with an
// auto-refresh) — without ever fetching. A web-parity overload that takes the raw `data`/`loading`/
// `windowSel` props is also provided for hosts that already hold the loaded summary.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/XRayHeader — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.xrayheader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Width at/above which the three cards lay out as a single row (web `sm:3`); below it they stack (web `default:1`). */
private val GRID_BREAKPOINT: Dp = 600.dp

/** The strip always shows exactly three cards (samples, fields, window). */
private const val STAT_CARD_COUNT = 3

/** Preview fixture epoch-millis stamp for the stale/offline cached views. */
private const val PREVIEW_FETCHED_AT = 1_700_000_000_000L

/**
 * Stateful entry point for the ingest X-Ray header strip. Records the one-shot PII-safe `view.opened`
 * diagnostic (P1/S11) and renders every lifecycle [state] the shared X-Ray summary feed can carry. The
 * host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`) and the current [window]
 * selection; this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the aggregate summary (web `useIngestXRay` → `data`).
 * @param window the operator's selected observation window (web `windowSel`), echoed back by the strip.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun XRayHeader(
    state: UiState<IngestXRaySummary>,
    window: XRayWindow,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordXRayHeaderOpened(logger) }
    XRayHeaderContent(state = state, window = window, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `{ data, loading, windowSel }` props, for hosts that
 * already hold the fetched summary. Maps the props onto a [UiState]: a first load (`loading` with no
 * data) becomes the skeleton surface; a resolved summary with zero samples becomes the empty surface
 * (web `total_samples ?? 0` → 0); anything else is content. A reload over existing data flags
 * `refreshing` so the freshness chip shows. Records `view.opened` like the stateful entry.
 */
@Composable
fun XRayHeader(
    data: IngestXRaySummary?,
    loading: Boolean,
    window: XRayWindow,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data, loading) {
            val phase =
                when {
                    data == null && loading -> UiPhase.Loading
                    XRayHeaderProjection.isEmpty(data) -> UiPhase.Empty
                    else -> UiPhase.Content
                }
            UiState(phase = phase, data = data, refreshing = loading && data != null)
        }
    XRayHeader(state = state, window = window, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * component's always-three-cards composition and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton, a hard-error retry surface, a friendly empty hint beneath the zero-valued cards, and
 * a freshness chip that reflects refreshing/stale/offline. Stale (non-error) data auto-refreshes,
 * mirroring the web freshness contract.
 */
@Composable
fun XRayHeaderContent(
    state: UiState<IngestXRaySummary>,
    window: XRayWindow,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    labels: XRayHeaderLabels = rememberXRayHeaderLabels(window),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    when {
        state.isLoading ->
            XRayHeaderLoading(label = stringResource(R.string.translation_common_loading), modifier = modifier)
        state.isError -> XRayHeaderError(onRetry = onRetry, modifier = modifier)
        else -> {
            val stats =
                remember(state.data, labels, locale) {
                    XRayHeaderProjection.project(state.data, labels, locale)
                }
            Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                if (state.stale || state.refreshing || state.hasError) {
                    XRayHeaderFreshnessRow(state = state)
                }
                XRayHeaderStatGrid(stats = stats)
                if (state.isEmpty) {
                    HelperText(
                        text = stringResource(R.string.translation_admin_xray_fields_empty),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

/**
 * The three projected cards in a responsive grid — a single weighted row at/above [GRID_BREAKPOINT]
 * (web `sm:3`), stacked full-width below it (web `default:1`). Each card is paired with its web icon:
 * Activity (samples), Layers (fields), Clock (window).
 */
@Composable
private fun XRayHeaderStatGrid(
    stats: XRayHeaderStats,
    modifier: Modifier = Modifier,
) {
    val cards = stats.asList()
    val icons = listOf(XRayHeaderGlyphs.Activity, XRayHeaderGlyphs.Layers, DataDisplayGlyphs.Clock)
    ResponsiveTriad(modifier = modifier) { index, cell ->
        XRayStatCard(stat = cards[index], icon = icons[index], modifier = cell)
    }
}

/** First-load skeleton — three shimmering [StatCard]s in the responsive grid so the strip is never blank. */
@Composable
private fun XRayHeaderLoading(
    label: String,
    modifier: Modifier = Modifier,
) {
    ResponsiveTriad(modifier = modifier.semantics { contentDescription = label }) { _, cell ->
        StatCard(label = "", value = "", loading = true, modifier = cell)
    }
}

/**
 * Lays out exactly [STAT_CARD_COUNT] cells responsively: a weighted [Row] at/above [GRID_BREAKPOINT],
 * a stacked [Column] below it. [cell] supplies each child the scope-correct width modifier (row weight
 * vs. full width), so the breakpoint logic lives in one place for both the content and loading grids.
 */
@Composable
private fun ResponsiveTriad(
    modifier: Modifier = Modifier,
    cell: @Composable (index: Int, cellModifier: Modifier) -> Unit,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= GRID_BREAKPOINT) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(STAT_CARD_COUNT) { index -> cell(index, Modifier.weight(1f)) }
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                repeat(STAT_CARD_COUNT) { index -> cell(index, Modifier.fillMaxWidth()) }
            }
        }
    }
}

/** A single projected card mapped to the shared [StatCard] with its decorative leading [icon]. */
@Composable
private fun XRayStatCard(
    stat: XRayHeaderStat,
    icon: ImageVector,
    modifier: Modifier = Modifier,
) {
    StatCard(
        label = stat.label,
        value = stat.value,
        sublabel = stat.sublabel,
        icon = icon,
        modifier = modifier,
    )
}

/** Right-aligned freshness chip — refreshing/stale/offline health of the cached summary (ADR-013). */
@Composable
private fun XRayHeaderFreshnessRow(
    state: UiState<IngestXRaySummary>,
    modifier: Modifier = Modifier,
) {
    val formatAge = rememberXRayFreshnessFormatter()
    Row(modifier = modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
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

/** Hard-error surface with a retry affordance — the web `QueryError`/page-level error equivalent. */
@Composable
private fun XRayHeaderError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [XRayHeaderLabels] from the i18n catalog (P1/S10): the six `admin.xray.stats.*`
 * keys the web component reads, plus the resolved window label for the [window] selection (the web
 * `WINDOW_LABEL` fallback, since `admin.xray.windowLabel.*` is not a catalog key).
 */
@Composable
private fun rememberXRayHeaderLabels(window: XRayWindow): XRayHeaderLabels {
    val samplesLabel = stringResource(R.string.translation_admin_xray_stats_samples)
    val samplesSub = stringResource(R.string.translation_admin_xray_stats_samplesSub)
    val fieldsLabel = stringResource(R.string.translation_admin_xray_stats_fields)
    val fieldsSub = stringResource(R.string.translation_admin_xray_stats_fieldsSub)
    val windowLabel = stringResource(R.string.translation_admin_xray_stats_window)
    val windowSub = stringResource(R.string.translation_admin_xray_stats_windowSub)
    return remember(samplesLabel, samplesSub, fieldsLabel, fieldsSub, windowLabel, windowSub, window) {
        XRayHeaderLabels(
            samplesLabel = samplesLabel,
            samplesSublabel = samplesSub,
            fieldsLabel = fieldsLabel,
            fieldsSublabel = fieldsSub,
            windowLabel = windowLabel,
            windowSublabel = windowSub,
            windowValue = window.defaultLabel,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same
 * render-only concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberXRayFreshnessFormatter(): (FreshnessAge) -> String {
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

private val PREVIEW_SUMMARY = IngestXRaySummary(totalSamples = 124_530, uniqueFields = 87)

@Preview(name = "Loading", showBackground = true)
@Composable
private fun XRayHeaderLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(UiState(UiPhase.Loading), XRayWindow.H1, onRetry = {})
    }
}

@Preview(name = "Content", showBackground = true)
@Composable
private fun XRayHeaderContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(UiState(UiPhase.Content, data = PREVIEW_SUMMARY), XRayWindow.H1, onRetry = {})
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun XRayHeaderEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(
            UiState(UiPhase.Empty, data = IngestXRaySummary(totalSamples = 0, uniqueFields = 0)),
            XRayWindow.M15,
            onRetry = {},
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun XRayHeaderErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(UiState(UiPhase.Error, errorKind = ErrorKind.Network), XRayWindow.H1, onRetry = {})
    }
}

@Preview(name = "Stale", showBackground = true)
@Composable
private fun XRayHeaderStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(
            UiState(UiPhase.Content, data = PREVIEW_SUMMARY, stale = true, fetchedAt = PREVIEW_FETCHED_AT),
            XRayWindow.H6,
            onRetry = {},
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun XRayHeaderOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        XRayHeaderContent(
            UiState(
                phase = UiPhase.Content,
                data = PREVIEW_SUMMARY,
                stale = true,
                fetchedAt = PREVIEW_FETCHED_AT,
                errorKind = ErrorKind.Network,
            ),
            XRayWindow.H24,
            onRetry = {},
        )
    }
}
