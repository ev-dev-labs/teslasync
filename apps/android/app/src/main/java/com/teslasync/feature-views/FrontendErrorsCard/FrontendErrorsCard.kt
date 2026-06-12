// The native Jetpack Compose + Material 3 FrontendErrorsCard feature view — a parity port of
// web/src/features/system/components/status/FrontendErrorsCard.tsx. The web component is the last-hour
// rolling summary of browser-reported frontend errors (the data that backed the now-deleted /admin page's
// "Frontend Errors" panel), surfaced inside the /system-status "Recent errors" accordion. It reads
// `/admin/web-errors/summary` via `useWebErrorsSummary()` and renders the total error count plus the top
// offenders (component name + route + count), or a friendly "no errors" line when the last hour was clean.
//
// This port keeps that contract end to end. The host owns the shared `AdminStore.webErrorsSummary()` feed
// (P1/S8) and threads its cache-then-network projection in as a [UiState] via [toWebErrorsSummaryUiState];
// this view performs NO HTTP. Beyond the web's two branches (offenders list / "no errors" line) it renders
// every lifecycle state the shared feed can carry — a first-load skeleton (the web's two loading bars), a
// hard error with a retry affordance (the web `!data` "unable to load" line, plus the P3-mandated retry), and
// a refreshing / stale / offline freshness chip with a soft-stale auto-refresh (the web `refetchInterval`).
// The card chrome (icon + title) is always present so the surface never collapses to a blank box. Every
// figure derivation flows through the pure [FrontendErrorsProjection]; this file is a thin render layer that
// resolves the i18n labels (P1/S10) and draws them. There is no English literal in the shipped code paths.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/FrontendErrorsCard) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.frontenderrorscard

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
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
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.CodeText
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Loading skeleton bar heights — the native analogue of the web's two `h-6` loading bars. */
private val SKELETON_NUMBER_HEIGHT: Dp = 28.dp
private val SKELETON_LINE_HEIGHT: Dp = 16.dp

/** The number skeleton fills less than the full width, hinting at the short metric figure beneath it. */
private const val SKELETON_NUMBER_FRACTION: Float = 0.4f

/**
 * The already-localized strings the card renders. The web component holds them inline; here they arrive
 * through the P1/S10 i18n facade at the Compose boundary and are passed down, keeping the renderer free of
 * any English literal and trivially previewable / unit-testable.
 *
 * @property title the header label (web "Frontend errors (last hour)").
 * @property subtitle the caption beneath the total (web "reported by browser sessions").
 * @property totalLabel the spoken metric label folded into the total's accessibility description.
 * @property topOffendersLabel the offenders list's accessibility (TalkBack) region label.
 * @property noErrors the clean-hour message (web "No frontend errors reported in the last hour.").
 * @property unableToLoad the hard-error message (web `!data` "Unable to load…").
 * @property retryLabel the retry affordance label for the hard-error surface (P1/S10 common key).
 */
data class FrontendErrorsCardStrings(
    val title: String,
    val subtitle: String,
    val totalLabel: String,
    val topOffendersLabel: String,
    val noErrors: String,
    val unableToLoad: String,
    val retryLabel: String,
)

/**
 * Stateful entry point — the faithful port of the web `FrontendErrorsCard()` (which owns
 * `useWebErrorsSummary()`). Records the one-shot PII-safe `view.opened` diagnostic (P1/S11) on first
 * composition and renders every lifecycle [state] the host's shared `AdminStore.webErrorsSummary()` feed can
 * carry. The host maps that feed via [toWebErrorsSummaryUiState] and supplies [onRetry] (its refresh); this
 * view never performs HTTP.
 *
 * @param state the cache-then-network projection of `/admin/web-errors/summary` (web `useWebErrorsSummary()`).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the soft-stale auto-refresh.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun FrontendErrorsCard(
    state: UiState<WebErrorsSummary>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { FrontendErrorsCardDiagnostics.recordViewOpened(logger) }
    FrontendErrorsCardContent(state = state, onRetry = onRetry, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `const { data, isLoading } = useWebErrorsSummary()` for a
 * host that already holds the value. A present payload renders the figures (selecting the empty phase when
 * there are no offenders); a `null` payload renders the loading skeleton while [isLoading], else the
 * "unable to load" surface (web `!data`). Records `view.opened` like the stateful entry; with no fetch behind
 * it there is no retry.
 */
@Composable
fun FrontendErrorsCard(
    data: WebErrorsSummary?,
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state =
        remember(data, isLoading) {
            when {
                data != null -> UiState(if (data.isEmpty) UiPhase.Empty else UiPhase.Content, data = data)
                isLoading -> UiState.loading()
                else -> UiState(UiPhase.Error)
            }
        }
    FrontendErrorsCard(state = state, onRetry = {}, modifier = modifier, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. The card chrome
 * (icon + title) is always present; beneath it the body renders the metric + offenders list / "no errors"
 * line whenever a payload is available (cached or fresh, including offline "last known"), the hard-error
 * "unable to load" surface with a retry when a first load failed with no cache, or the loading skeleton
 * otherwise. A soft-stale (non-error) value auto-refreshes, mirroring the web `refetchInterval`. [locale]
 * drives the grouped integer formatting (web `fmtInt`).
 */
@Composable
fun FrontendErrorsCardContent(
    state: UiState<WebErrorsSummary>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
    strings: FrontendErrorsCardStrings = rememberFrontendErrorsCardStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val display = remember(state.data, locale) { state.data?.let { FrontendErrorsProjection.project(it, locale) } }
    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FrontendErrorsHeader(state = state, strings = strings)
            when {
                display != null -> {
                    FrontendErrorsMetric(display = display, strings = strings)
                    if (display.hasOffenders) {
                        FrontendErrorsOffenders(rows = display.rows, label = strings.topOffendersLabel)
                    } else {
                        Caption(strings.noErrors)
                    }
                }

                state.isError -> FrontendErrorsError(strings = strings, onRetry = onRetry)
                else -> FrontendErrorsLoading()
            }
        }
    }
}

/**
 * The card header — the web `<Bug/> Frontend errors (last hour)` row (an alert glyph stands in for the web
 * lucide `Bug`, mapped to the closest existing shared glyph), with the honest freshness chip rendered at the
 * trailing edge when the feed is not in a settled-fresh state. The title is marked as a heading for TalkBack.
 */
@Composable
private fun FrontendErrorsHeader(
    state: UiState<*>,
    strings: FrontendErrorsCardStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(DataDisplayGlyphs.AlertTriangle, contentDescription = null, size = IconSize.Sm)
        Caption(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        if (shouldShowFreshness(state)) {
            FrontendErrorsFreshnessChip(state = state)
        }
    }
}

/** True whenever the feed is loading, refreshing over cache, stale, or offline — i.e. not settled-fresh. */
private fun shouldShowFreshness(state: UiState<*>): Boolean = state.isLoading || state.refreshing || state.stale || state.hasError

/**
 * The total figure + caption — the web `fmtInt(total)` over "reported by browser sessions". The figure
 * carries a richer TalkBack description (the count plus the localized "errors in last hour" label) so an
 * assistive-tech user hears what the number means, not just the digits.
 */
@Composable
private fun FrontendErrorsMetric(
    display: FrontendErrorsDisplay,
    strings: FrontendErrorsCardStrings,
) {
    val spoken = "${display.totalText}, ${strings.totalLabel}"
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        MetricValue(display.totalText, modifier = Modifier.semantics { contentDescription = spoken })
        Caption(strings.subtitle)
    }
}

/**
 * The top-offenders list — the web `<ul>` of `<li>` rows, each a neutral [Badge] of the component name, the
 * monospace route, and the right-aligned count. The column carries the offenders' accessibility label so the
 * region is announced as a group. A blank name/route already folded to the em dash in the projection.
 */
@Composable
private fun FrontendErrorsOffenders(
    rows: List<WebErrorRow>,
    label: String,
) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        rows.forEach { row -> FrontendErrorsOffenderRow(row = row) }
    }
}

/** One offender row: `Badge(name)` + monospace route on the left, the count on the right (web `<li>`). */
@Composable
private fun FrontendErrorsOffenderRow(row: WebErrorRow) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Badge(text = row.name, variant = BadgeVariant.Neutral)
            CodeText(row.route, modifier = Modifier.weight(1f, fill = false))
        }
        Caption(row.count)
    }
}

/**
 * Hard-error surface — the web `!data` "Unable to load frontend error summary." line, kept understated to
 * match the card's lightweight design, with the P3-mandated retry affordance beneath it.
 */
@Composable
private fun FrontendErrorsError(
    strings: FrontendErrorsCardStrings,
    onRetry: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        Caption(strings.unableToLoad)
        Button(strings.retryLabel, onClick = onRetry, variant = ButtonVariant.Outline, size = ButtonSize.Sm)
    }
}

/**
 * First-load skeleton — the native analogue of the web's two loading bars, with an accessibility label so the
 * region is announced as loading rather than as an empty box.
 */
@Composable
private fun FrontendErrorsLoading() {
    val loadingLabel = stringResource(R.string.translation_a11y_loading)
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = SKELETON_NUMBER_FRACTION, height = SKELETON_NUMBER_HEIGHT)
        Skeleton(height = SKELETON_LINE_HEIGHT)
        Skeleton(height = SKELETON_LINE_HEIGHT)
    }
}

/** The header freshness chip — the honest "refreshing / stale / offline" affordance over the figures. */
@Composable
private fun FrontendErrorsFreshnessChip(state: UiState<*>) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing || state.isLoading,
        isStale = state.stale,
        isError = state.hasError,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
        formatAge = rememberFreshnessFormatter(),
    )
}

/**
 * Resolves the localized [FrontendErrorsCardStrings] from the P1/S10 catalog. The `admin.errors.*` family
 * predates this surface (it backed the same now-deleted /admin panel the web card replaced); the common
 * `retry` key supplies the P3 retry affordance label.
 */
@Composable
fun rememberFrontendErrorsCardStrings(): FrontendErrorsCardStrings {
    val title = stringResource(R.string.translation_admin_errors_title)
    val subtitle = stringResource(R.string.translation_admin_errors_subtitle)
    val totalLabel = stringResource(R.string.translation_admin_errors_totalLastHour)
    val topOffenders = stringResource(R.string.translation_admin_errors_topOffenders)
    val noErrors = stringResource(R.string.translation_admin_errors_noErrors)
    val unableToLoad = stringResource(R.string.translation_admin_errors_unableToLoad)
    val retry = stringResource(R.string.translation_common_retry)
    return remember(title, subtitle, totalLabel, topOffenders, noErrors, unableToLoad, retry) {
        FrontendErrorsCardStrings(
            title = title,
            subtitle = subtitle,
            totalLabel = totalLabel,
            topOffendersLabel = topOffenders,
            noErrors = noErrors,
            unableToLoad = unableToLoad,
            retryLabel = retry,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberFreshnessFormatter(): (FreshnessAge) -> String {
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(justNow, seconds, minutes, hours, days, weeks) {
        { age ->
            when (age) {
                FreshnessAge.Unknown -> FRONTEND_ERRORS_EM_DASH
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

private val PREVIEW_SUMMARY =
    WebErrorsSummary(
        total = 42.0,
        top =
            listOf(
                WebErrorEntry(name = "ChargingChart", route = "/charging", count = 18.0),
                WebErrorEntry(name = "DriveMap", route = "/drives/123", count = 12.0),
                WebErrorEntry(name = "", route = "", count = 5.0),
            ),
    )

@Preview(name = "Content — offenders", showBackground = true, widthDp = 420)
@Composable
private fun FrontendErrorsContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FrontendErrorsCardContent(state = UiState(UiPhase.Content, data = PREVIEW_SUMMARY), onRetry = {})
    }
}

@Preview(name = "Empty — clean hour", showBackground = true, widthDp = 420)
@Composable
private fun FrontendErrorsEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FrontendErrorsCardContent(state = UiState(UiPhase.Empty, data = WebErrorsSummary.EMPTY), onRetry = {})
    }
}

@Preview(name = "Loading — first fetch", showBackground = true, widthDp = 420)
@Composable
private fun FrontendErrorsLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FrontendErrorsCardContent(state = UiState(UiPhase.Loading), onRetry = {})
    }
}

@Preview(name = "Error — no cache", showBackground = true, widthDp = 420)
@Composable
private fun FrontendErrorsErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FrontendErrorsCardContent(state = UiState(UiPhase.Error, errorKind = ErrorKind.Network), onRetry = {})
    }
}

@Preview(name = "Offline — cached last known", showBackground = true, widthDp = 420)
@Composable
private fun FrontendErrorsOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        FrontendErrorsCardContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SUMMARY,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
        )
    }
}
