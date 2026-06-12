// The native Jetpack Compose + Material 3 PatternsSlide feature view — a parity port of
// web/src/features/analytics/components/review/PatternsSlide.tsx. The web component is purely
// presentational: its parent (the Year in Review carousel) passes the fetched `YearReview` document down as
// `data`, and the component renders a centered column — a 📊 glyph, the "Your driving patterns" subtitle,
// two icon cards (favorite driving day, peak driving hour), and a three-up stat row (drives/week, avg
// distance/drive, avg efficiency) — each formatted to the user's display units via `useUnits`.
//
// The native surface keeps that contract — it performs NO HTTP and binds no data hook of its own (its web
// hooks are `useTranslation`, mapped to the i18n catalog P1/S10, and `useUnits`, mapped to the live
// [UnitFormatter] P1/S8). The host supplies the year-review snapshot through the shared state-holder layer
// as a [UiState], so this feature view also renders every lifecycle state that layer can carry — a loading
// skeleton, a hard error with retry, a friendly empty state, content, and stale/offline cached "last known"
// (a freshness chip) — without ever fetching. A web-parity overload that takes the raw snapshot (web
// `{ data }`) is provided for hosts that already hold the document.
//
// Web Tailwind classes are intentionally NOT ported; the surface uses the platform design tokens (P1/S9) —
// the shared [GlassPanel] cards, the typography roles, the [ChartPalette] accents, and the motion
// primitives ([StaggerContainer] / [StaggerItem]) that mirror the web `motion` staggered entrance.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/PatternsSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.patternsslide

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.UnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/** The web `📊` headline glyph (U+1F4CA), rendered above the subtitle. */
private const val PATTERNS_EMOJI = "\uD83D\uDCCA"

/** Em dash shown for an unknown freshness age — mirrors the sibling surfaces' freshness fallback. */
private const val EM_DASH = "\u2014"

/** Max content width mirroring the web `max-w-sm` (384 px) so the centered column never sprawls on tablets. */
private val CONTENT_MAX_WIDTH = 384.dp

private val SKELETON_EMOJI_SIZE = 48.dp
private val SKELETON_SUBTITLE_HEIGHT = 20.dp
private val SKELETON_CARD_HEIGHT = 64.dp
private val SKELETON_STAT_VALUE_HEIGHT = 28.dp
private val SKELETON_STAT_LABEL_HEIGHT = 12.dp
private const val SKELETON_SUBTITLE_FRACTION = 0.6f
private const val SKELETON_EMOJI_FRACTION = 0.18f
private const val SKELETON_STAT_LABEL_FRACTION = 0.7f
private const val STAT_COLUMN_COUNT = 3

/**
 * The already-localized strings the slide renders. The web component is anonymous — it resolves every label
 * through `useTranslation` — so these arrive through the P1/S10 i18n facade at the Compose boundary and are
 * passed down, keeping the body free of any English literal.
 */
data class PatternsSlideStrings(
    val drivingPatterns: String,
    val favoriteDay: String,
    val peakHour: String,
    val drivesWeek: String,
    val avg: String,
    val noData: String,
)

/**
 * Stateful entry point for the patterns slide. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live display units (web `useUnits`), and renders every lifecycle [state] the shared
 * year-review feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`);
 * this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [PatternsSnapshot] (the five patterns fields).
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun PatternsSlide(
    state: UiState<PatternsSnapshot>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordPatternsSlideOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    PatternsSlideContent(state = state, onRetry = onRetry, prefs = formatter.prefs, modifier = modifier)
}

/**
 * Web-parity overload mirroring the web component's `({ data })` prop, for hosts that already hold the
 * year-review document. Projects the [data] snapshot onto a [UiState] via
 * [PatternsSlideProjection.projectUiState] (content when present, else the friendly empty state) and
 * delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it offers no
 * retry affordance.
 */
@Composable
fun PatternsSlide(
    data: PatternsSnapshot?,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { PatternsSlideProjection.projectUiState(data, isLoading = false) }
    PatternsSlide(state = state, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the preview / UI-test entry point. Reproduces the web
 * component's centered column and adds the lifecycle chrome the host's feed implies: a loading skeleton, a
 * hard-error retry surface, a friendly empty state, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [prefs] supplies the SI → display unit conversion + formatting and the user's [Locale].
 */
@Composable
fun PatternsSlideContent(
    state: UiState<PatternsSnapshot>,
    onRetry: () -> Unit,
    prefs: UnitPref,
    modifier: Modifier = Modifier,
    strings: PatternsSlideStrings = rememberPatternsSlideStrings(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    Column(
        modifier = modifier.fillMaxWidth().padding(horizontal = Spacing.xl3, vertical = Spacing.xl2),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        when (patternsSlideSurface(state)) {
            PatternsSlideSurface.Loading -> PatternsSkeleton()
            PatternsSlideSurface.Error -> PatternsError(onRetry = onRetry)
            PatternsSlideSurface.Empty -> PatternsEmpty(message = strings.noData)
            PatternsSlideSurface.Content ->
                PatternsLoaded(
                    snapshot = requireNotNull(state.data),
                    state = state,
                    prefs = prefs,
                    strings = strings,
                )
        }
    }
}

/**
 * The content branch: an optional freshness chip (only when refreshing/stale/offline) above the centered
 * staggered body — the 📊 glyph, the subtitle, the two icon cards, and the three-up stat row.
 */
@Composable
private fun PatternsLoaded(
    snapshot: PatternsSnapshot,
    state: UiState<PatternsSnapshot>,
    prefs: UnitPref,
    strings: PatternsSlideStrings,
) {
    val locale = remember(prefs.locale) { Locale.forLanguageTag(prefs.locale ?: Locale.US.toLanguageTag()) }
    val display = remember(snapshot, prefs, locale) { PatternsSlideProjection.project(snapshot, prefs, locale) }
    if (state.stale || state.refreshing || state.hasError) {
        PatternsFreshnessRow(state = state)
    }
    StaggerContainer(
        modifier = Modifier.fillMaxWidth().widthIn(max = CONTENT_MAX_WIDTH),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        StaggerItem(index = 0) {
            Text(
                text = PATTERNS_EMOJI,
                modifier = Modifier.fillMaxWidth().clearAndSetSemantics {},
                style = MaterialTheme.typography.displayMedium,
                textAlign = TextAlign.Center,
            )
        }
        StaggerItem(index = 1) {
            Text(
                text = strings.drivingPatterns,
                modifier = Modifier.fillMaxWidth(),
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        StaggerItem(index = 2) {
            PatternIconCard(
                icon = PatternsGlyphs.Calendar,
                accent = TeslaTokens.chart.speed,
                label = strings.favoriteDay,
                value = display.favoriteDay,
            )
        }
        StaggerItem(index = 3) {
            PatternIconCard(
                icon = PatternsGlyphs.Clock,
                accent = TeslaTokens.chart.regen,
                label = strings.peakHour,
                value = display.hourLabel,
            )
        }
        StaggerItem(index = 4) {
            PatternsStatsRow(display = display, strings = strings)
        }
    }
}

/**
 * One web card (`bg-white/[0.05] rounded-xl p-5 border …`) as a [GlassPanel] holding a leading tinted [icon]
 * and the stacked [label] + [value]. The card merges its descendants into a single accessible node so
 * TalkBack announces it as "label, value" rather than two disconnected texts.
 */
@Composable
private fun PatternIconCard(
    icon: ImageVector,
    accent: Color,
    label: String,
    value: String,
) {
    GlassPanel(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = "$label, $value" },
        padding = PanelPadding.Lg,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            Icon(icon, contentDescription = null, size = IconSize.Xl, tint = accent)
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Caption(label)
                MetricValue(value)
            }
        }
    }
}

/** The web three-up stat row: drives/week, avg distance/drive, and avg efficiency, each centered. */
@Composable
private fun PatternsStatsRow(
    display: PatternsDisplay,
    strings: PatternsSlideStrings,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        PatternStat(
            value = display.drivesPerWeekValue,
            caption = strings.drivesWeek,
            modifier = Modifier.weight(1f),
        )
        PatternStat(
            value = display.distancePerDriveValue,
            caption = stringResource(R.string.translation_yearReview_distancePerDrive, display.distanceUnitLabel),
            modifier = Modifier.weight(1f),
        )
        PatternStat(
            value = display.efficiencyValue,
            caption = "${display.efficiencyUnit} ${strings.avg}",
            modifier = Modifier.weight(1f),
        )
    }
}

/** A single centered stat tile (big value + muted caption), announced as one accessible node. */
@Composable
private fun PatternStat(
    value: String,
    caption: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.semantics(mergeDescendants = true) { contentDescription = "$value $caption" },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        MetricValue(value)
        MetricLabel(caption)
    }
}

/** The web loading branch: skeleton chrome shaped like the slide (glyph, subtitle, two cards, stat row). */
@Composable
private fun PatternsSkeleton() {
    val loadingLabel = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .widthIn(max = CONTENT_MAX_WIDTH)
                .semantics { contentDescription = loadingLabel },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xl2),
    ) {
        Skeleton(widthFraction = SKELETON_EMOJI_FRACTION, height = SKELETON_EMOJI_SIZE, rounded = true)
        Skeleton(widthFraction = SKELETON_SUBTITLE_FRACTION, height = SKELETON_SUBTITLE_HEIGHT)
        Skeleton(height = SKELETON_CARD_HEIGHT, rounded = true)
        Skeleton(height = SKELETON_CARD_HEIGHT, rounded = true)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            repeat(STAT_COLUMN_COUNT) {
                Column(
                    modifier = Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    Skeleton(height = SKELETON_STAT_VALUE_HEIGHT)
                    Skeleton(widthFraction = SKELETON_STAT_LABEL_FRACTION, height = SKELETON_STAT_LABEL_HEIGHT)
                }
            }
        }
    }
}

/**
 * Empty state — the `common.noData` message with the chart glyph, so the slide never collapses to a blank
 * box. [EmptyState] exposes the message as its accessibility label, so the surface is still announced.
 */
@Composable
private fun PatternsEmpty(message: String) {
    EmptyState(message = message, icon = PatternsGlyphs.Chart, modifier = Modifier.fillMaxWidth())
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun PatternsError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/** The freshness chip shown over cached content while refreshing/stale/offline — right-aligned in a row. */
@Composable
private fun PatternsFreshnessRow(state: UiState<PatternsSnapshot>) {
    val formatAge = rememberPatternsFreshnessFormatter()
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
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
 * Builds the localized [PatternsSlideStrings] from the i18n catalog (P1/S10): the `yearReview.*` keys the
 * web component reads through `useTranslation`, plus `common.noData`. Resolved once at the Compose boundary
 * so the rest of the surface stays free of any English literal.
 */
@Composable
private fun rememberPatternsSlideStrings(): PatternsSlideStrings {
    val drivingPatterns = stringResource(R.string.translation_yearReview_drivingPatterns)
    val favoriteDay = stringResource(R.string.translation_yearReview_favoriteDay)
    val peakHour = stringResource(R.string.translation_yearReview_peakHour)
    val drivesWeek = stringResource(R.string.translation_yearReview_drivesWeek)
    val avg = stringResource(R.string.translation_yearReview_avg)
    val noData = stringResource(R.string.translation_common_noData)
    return remember(drivingPatterns, favoriteDay, peakHour, drivesWeek, avg, noData) {
        PatternsSlideStrings(
            drivingPatterns = drivingPatterns,
            favoriteDay = favoriteDay,
            peakHour = peakHour,
            drivesWeek = drivesWeek,
            avg = avg,
            noData = noData,
        )
    }
}

/**
 * Localized relative-age formatter for the freshness chip (`translation_freshness_*`) — the same render-only
 * concern the sibling surfaces resolve, kept out of the pure projection.
 */
@Composable
private fun rememberPatternsFreshnessFormatter(): (FreshnessAge) -> String {
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
 * Self-contained line glyphs for the surface, authored as 24×24 stroked vectors (the web library leans on
 * lucide-react, which has no bundled Android equivalent). Each is monochrome and recolored at render time by
 * the icon tint — the same approach as the sibling feature-view glyphs.
 */
private object PatternsGlyphs {
    /** lucide `calendar` — a bound page with the header divider and two binding rings (favorite-day card). */
    val Calendar: ImageVector =
        patternsVector("PatternsCalendar") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            close()
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(8f, 3f)
            lineTo(8f, 6f)
            moveTo(16f, 3f)
            lineTo(16f, 6f)
        }

    /** lucide `clock` — a circle with hour + minute hands (peak-hour card). */
    val Clock: ImageVector =
        patternsVector("PatternsClock") {
            moveTo(12f, 3f)
            curveTo(16.97f, 3f, 21f, 7.03f, 21f, 12f)
            curveTo(21f, 16.97f, 16.97f, 21f, 12f, 21f)
            curveTo(7.03f, 21f, 3f, 16.97f, 3f, 12f)
            curveTo(3f, 7.03f, 7.03f, 3f, 12f, 3f)
            close()
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** lucide `bar-chart` — axes with three bars (empty-state glyph, echoing the 📊 headline). */
    val Chart: ImageVector =
        patternsVector("PatternsChart") {
            moveTo(3f, 3f)
            lineTo(3f, 21f)
            lineTo(21f, 21f)
            moveTo(7f, 17f)
            lineTo(7f, 12f)
            moveTo(12f, 17f)
            lineTo(12f, 8f)
            moveTo(17f, 17f)
            lineTo(17f, 5f)
        }
}

private fun patternsVector(
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

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_STRINGS =
    PatternsSlideStrings(
        drivingPatterns = "Your driving patterns",
        favoriteDay = "Favorite driving day",
        peakHour = "Peak driving hour",
        drivesWeek = "drives/week",
        avg = "avg",
        noData = "No data available",
    )

private val PREVIEW_SNAPSHOT =
    PatternsSnapshot(
        mostActiveDayOfWeek = "Saturday",
        mostActiveHour = 17,
        avgDrivesPerWeek = 5.4,
        avgDistancePerDriveKm = 41.8,
        avgEfficiencyWhKm = 168.0,
    )

@Preview(name = "Content", showBackground = true)
@Composable
private fun PatternsSlideContentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PatternsSlideContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_SNAPSHOT),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Offline", showBackground = true)
@Composable
private fun PatternsSlideOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PatternsSlideContent(
            state =
                UiState(
                    phase = UiPhase.Content,
                    data = PREVIEW_SNAPSHOT,
                    stale = true,
                    fetchedAt = 1_700_000_000_000L,
                    errorKind = ErrorKind.Network,
                ),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun PatternsSlideLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PatternsSlideContent(
            state = UiState.loading(),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun PatternsSlideEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PatternsSlideContent(
            state = UiState(phase = UiPhase.Empty),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun PatternsSlideErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PatternsSlideContent(
            state = UiState(phase = UiPhase.Error, errorKind = ErrorKind.Network),
            onRetry = {},
            prefs = UnitFormatter.default().prefs,
            strings = PREVIEW_STRINGS,
        )
    }
}
