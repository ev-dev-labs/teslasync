// The native Jetpack Compose + Material 3 StatHeroSlide feature view — a parity port of
// web/src/features/analytics/components/review/StatHeroSlide.tsx. The web component is one slide of the
// Year-in-Review carousel: a centered, full-bleed hero (`flex flex-col items-center justify-center h-full`)
// holding a spring-in emoji, a big count-up number (`AnimatedNumber`), a unit line, and a comparison line,
// all staggered in with `motion`. It is purely presentational — `SlideRenderer` passes the fetched
// `YearReview` document + the slide `field`, so the surface performs NO HTTP and binds no data hook of its
// own. Its web hooks map to the i18n catalog (`useTranslation`, P1/S10) and the live unit formatter
// (`useUnits`, P1/S8).
//
// Per-field content (web `getStatConfig`): `distance` → 🛣️ + the distance converted to the user's unit +
// the unit label + an "around the Earth" (or "every kilometer counts") comparison; `energy` → ⚡ + the kWh
// charged + "kWh charged" + a "power a home for N days" comparison; any other field → the 📊 fallback.
// Every branch is reproduced in the content state via the pure [StatHeroSlideProjection].
//
// Although the web slide is presentational, the host supplies its data through the shared state-holder layer
// as a [UiState], so this surface also renders every lifecycle state that layer can carry — a loading
// skeleton, a hard error with retry, a friendly empty state, content, and stale/offline "last known" via a
// freshness chip — without ever fetching. A web-parity overload that takes the raw `data` snapshot (web
// `{ data, field }`) is provided for hosts that already hold the document.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/StatHeroSlide — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package, so the package intentionally diverges from the path — exactly as the sibling feature-view
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statheroslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.units.DistanceUnitPref
import kotlinx.coroutines.flow.StateFlow
import java.util.Locale

/** Web `SlideRenderer` passes `slide.field ?? 'distance'`, so the slide defaults to the distance stat. */
private const val DEFAULT_FIELD = "distance"

/** Web `px-8` horizontal gutter on the centered hero column. */
private val HERO_HORIZONTAL_PADDING = Spacing.xl3

/** Web `max-w-md` (28rem) cap on the comparison sentence so it wraps and centers nicely. */
private val COMPARISON_MAX_WIDTH = 448.dp

/** The decorative emoji glyph size (web `text-6xl md:text-8xl`); an emoji, not typography-role text. */
private val EMOJI_FONT_SIZE: TextUnit = 72.sp

// Emoji entrance — the native analogue of the web `{ type: 'spring', stiffness: 200, damping: 15 }` pop-in
// (scale 0 → 1 with a -20° → 0° unwind). Compose springs parameterize by damping ratio + stiffness.
private const val EMOJI_SPRING_DAMPING = 0.5f
private const val EMOJI_SPRING_STIFFNESS = 300f
private const val EMOJI_START_ROTATION = -20f

// Staggered reveal delays mirroring the web `transition.delay` of the number / unit / comparison (0.3 /
// 0.6 / 0.9 s). [FadeIn] ignores the delay under reduced motion (it snaps to the final state).
private const val VALUE_DELAY_MS = 300
private const val UNIT_DELAY_MS = 600
private const val COMPARISON_DELAY_MS = 900

/** Web `AnimatedNumber duration={1.5}` — 1.5 s count-up. */
private const val COUNT_UP_MS = 1500

// Loading skeleton geometry — four stacked bars standing in for the emoji, number, unit, and comparison.
private val SKELETON_EMOJI_HEIGHT = 64.dp
private val SKELETON_VALUE_HEIGHT = 40.dp
private val SKELETON_UNIT_HEIGHT = 20.dp
private val SKELETON_COMPARISON_HEIGHT = 16.dp
private const val SKELETON_EMOJI_FRACTION = 0.25f
private const val SKELETON_VALUE_FRACTION = 0.5f
private const val SKELETON_UNIT_FRACTION = 0.4f
private const val SKELETON_COMPARISON_FRACTION = 0.7f

/**
 * Stateful entry point for the stat-hero slide. Records the one-shot PII-safe `view.opened` diagnostic
 * (P1/S11), reads the live display units (web `useUnits`), and renders every lifecycle [state] the shared
 * year-review feed can carry. The host owns the feed (P1/S8) and supplies [onRetry] (the feed's `refetch`);
 * this view never performs HTTP.
 *
 * @param state the cache-then-network projection of the [StatHeroData] slice the slide reads.
 * @param field which stat to render (web `field`); `distance`/`energy`, else the fallback.
 * @param onRetry re-runs the host's load — wired to the hard-error retry and the stale auto-refresh.
 * @param units the live SI → display unit formatter; defaults to the app's `LocalDataContainer`.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatHeroSlide(
    state: UiState<StatHeroData>,
    field: String,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { StatHeroSlideDiagnostics.recordViewOpened(logger) }
    val formatter by units.collectAsStateWithLifecycle()
    StatHeroSlideContent(
        state = state,
        field = field,
        onRetry = onRetry,
        distanceUnit = formatter.prefs.distance,
        modifier = modifier,
    )
}

/**
 * Web-parity overload mirroring the web component's `({ data, field })` props, for hosts that already hold
 * the year-review document. Projects the [data] slice onto a [UiState] via
 * [StatHeroSlideProjection.projectUiState] (content when present, else the friendly empty state) and
 * delegates to the stateful entry, which records `view.opened`. There is no fetch behind it, so it offers
 * no retry affordance.
 */
@Composable
fun StatHeroSlide(
    data: StatHeroData?,
    modifier: Modifier = Modifier,
    field: String = DEFAULT_FIELD,
    units: StateFlow<UnitFormatter> = LocalDataContainer.current.unitFormatter,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val state = remember(data) { StatHeroSlideProjection.projectUiState(data, isLoading = false) }
    StatHeroSlide(state = state, field = field, onRetry = {}, modifier = modifier, units = units, logger = logger)
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Reproduces the web
 * centered hero (with its per-field branches) and adds the lifecycle chrome the host's feed implies: a
 * loading skeleton, a hard-error retry surface, a friendly empty state, and a freshness chip that reflects
 * refreshing/stale/offline. Stale (non-error) data auto-refreshes, mirroring the web freshness contract.
 * [distanceUnit] supplies the SI → display distance conversion; [locale] drives number grouping.
 */
@Composable
fun StatHeroSlideContent(
    state: UiState<StatHeroData>,
    field: String,
    onRetry: () -> Unit,
    distanceUnit: DistanceUnitPref,
    modifier: Modifier = Modifier,
    locale: Locale = Locale.getDefault(),
) {
    LaunchedEffect(state.stale, state.refreshing, state.hasError) {
        if (state.stale && !state.refreshing && !state.hasError) onRetry()
    }
    val data = state.data
    Box(modifier = modifier.fillMaxSize()) {
        when {
            state.isLoading -> StatHeroLoading(modifier = Modifier.align(Alignment.Center))
            state.isError -> StatHeroError(onRetry = onRetry, modifier = Modifier.align(Alignment.Center))
            state.isEmpty || data == null -> StatHeroEmpty(modifier = Modifier.align(Alignment.Center))
            else -> {
                val config =
                    remember(data, field, distanceUnit) {
                        StatHeroSlideProjection.project(data, StatHeroField.fromRaw(field), distanceUnit)
                    }
                StatHero(config = config, locale = locale, modifier = Modifier.align(Alignment.Center))
                if (state.stale || state.refreshing || state.hasError) {
                    StatHeroFreshness(
                        state = state,
                        modifier = Modifier.align(Alignment.TopEnd).padding(Spacing.md),
                    )
                }
            }
        }
    }
}

/**
 * The centered hero column — the native analogue of the web slide body: the spring-in emoji, the count-up
 * number, the unit line, and the comparison line, each revealed on its own stagger. The unit and comparison
 * are omitted when empty (web `default` branch renders empty `<p>`s), so the fallback shows just 📊 + 0.
 */
@Composable
private fun StatHero(
    config: StatHeroConfig,
    locale: Locale,
    modifier: Modifier = Modifier,
) {
    val reduceMotion = rememberReducedMotion()
    Column(
        modifier = modifier.padding(horizontal = HERO_HORIZONTAL_PADDING),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        StatHeroEmoji(emoji = config.emoji, reduceMotion = reduceMotion)
        Spacer(modifier = Modifier.height(Spacing.xl2))
        FadeIn(delayMs = VALUE_DELAY_MS) {
            StatHeroValue(
                value = config.value,
                decimals = config.decimals,
                reduceMotion = reduceMotion,
                locale = locale,
            )
        }
        val unit = statHeroUnitText(config.unit)
        if (unit.isNotEmpty()) {
            Spacer(modifier = Modifier.height(Spacing.md))
            FadeIn(delayMs = UNIT_DELAY_MS) {
                Text(
                    text = unit,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
        val comparison = statHeroComparisonText(config.comparison, locale)
        if (comparison.isNotEmpty()) {
            Spacer(modifier = Modifier.height(Spacing.xl2))
            FadeIn(delayMs = COMPARISON_DELAY_MS) {
                Text(
                    text = comparison,
                    modifier = Modifier.widthIn(max = COMPARISON_MAX_WIDTH),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/**
 * The hero emoji with the web spring pop-in (scale 0 → 1, -20° → 0°). The glyph is decorative — its
 * semantics are cleared so TalkBack skips the raw emoji and announces the meaningful number / unit /
 * comparison instead (the web emoji carries no `aria-label`). Honors reduced motion by snapping to rest.
 */
@Composable
private fun StatHeroEmoji(
    emoji: String,
    reduceMotion: Boolean,
) {
    val enter = remember { Animatable(if (reduceMotion) 1f else 0f) }
    LaunchedEffect(reduceMotion) {
        if (reduceMotion) {
            enter.snapTo(1f)
        } else {
            enter.snapTo(0f)
            enter.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = EMOJI_SPRING_DAMPING, stiffness = EMOJI_SPRING_STIFFNESS),
            )
        }
    }
    Text(
        text = emoji,
        fontSize = EMOJI_FONT_SIZE,
        textAlign = TextAlign.Center,
        modifier =
            Modifier
                .graphicsLayer {
                    scaleX = enter.value
                    scaleY = enter.value
                    rotationZ = (1f - enter.value) * EMOJI_START_ROTATION
                }.clearAndSetSemantics {},
    )
}

/**
 * The headline figure: the shared count-up [AnimatedNumber] (web `AnimatedNumber`), or a static
 * [MetricValue] when reduced motion is requested — the same reduced-motion contract the sibling
 * YearReviewWidget hero uses.
 */
@Composable
private fun StatHeroValue(
    value: Double,
    decimals: Int,
    reduceMotion: Boolean,
    locale: Locale,
) {
    if (reduceMotion) {
        MetricValue(ChartFormat.number(value, decimals, locale))
    } else {
        AnimatedNumber(value = value, decimals = decimals, durationMillis = COUNT_UP_MS, locale = locale)
    }
}

/** Top-end freshness chip shown only while refreshing/stale/offline — the honest "last known" affordance. */
@Composable
private fun StatHeroFreshness(
    state: UiState<StatHeroData>,
    modifier: Modifier = Modifier,
) {
    DataFreshness(
        updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
        isFetching = state.refreshing,
        isStale = state.stale,
        isError = state.hasError,
        modifier = modifier,
        compact = true,
        fetchingLabel = stringResource(R.string.translation_common_loading),
        errorLabel = stringResource(R.string.translation_common_offline),
    )
}

/** Loading branch: four centered shimmer bars standing in for the emoji, number, unit, and comparison. */
@Composable
private fun StatHeroLoading(modifier: Modifier = Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = HERO_HORIZONTAL_PADDING)
                .semantics { contentDescription = label },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = SKELETON_EMOJI_FRACTION, height = SKELETON_EMOJI_HEIGHT, rounded = true)
        Skeleton(widthFraction = SKELETON_VALUE_FRACTION, height = SKELETON_VALUE_HEIGHT, rounded = true)
        Skeleton(widthFraction = SKELETON_UNIT_FRACTION, height = SKELETON_UNIT_HEIGHT, rounded = true)
        Skeleton(widthFraction = SKELETON_COMPARISON_FRACTION, height = SKELETON_COMPARISON_HEIGHT, rounded = true)
    }
}

/**
 * Empty state — the `common.noData` message with a gauge glyph (the 📊 spirit of the web fallback), so
 * the slide never collapses to a blank box. [EmptyState] exposes the message as its accessibility label.
 */
@Composable
private fun StatHeroEmpty(modifier: Modifier = Modifier) {
    EmptyState(
        message = stringResource(R.string.translation_common_noData),
        modifier = modifier,
        icon = DataDisplayGlyphs.Gauge,
    )
}

/** Hard-error surface with a retry affordance — the web `QueryError` equivalent. */
@Composable
private fun StatHeroError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        modifier = modifier,
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * Resolves the unit line from the i18n catalog (P1/S10): the distance unit label is literal, `EnergyCharged`
 * resolves `yearReview.energyUnit`, and `None` (the fallback) renders nothing — mirroring the web
 * `config.unit`.
 */
@Composable
private fun statHeroUnitText(unit: StatHeroUnit): String =
    when (unit) {
        is StatHeroUnit.Label -> unit.text
        StatHeroUnit.EnergyCharged -> stringResource(R.string.translation_yearReview_energyUnit)
        StatHeroUnit.None -> ""
    }

/**
 * Resolves the comparison line from the i18n catalog (P1/S10) with its computed argument: the around-the-
 * Earth percentage (web `fmtNumber(earthLaps * 100, 1)`), the "every kilometer counts" encouragement, the
 * home-days estimate, or nothing — mirroring the web `config.comparison`.
 */
@Composable
private fun statHeroComparisonText(
    comparison: StatHeroComparison,
    locale: Locale,
): String =
    when (comparison) {
        is StatHeroComparison.EarthLaps ->
            stringResource(
                R.string.translation_yearReview_distanceComparison,
                ChartFormat.number(comparison.percent, StatHeroSlideProjection.EARTH_PERCENT_DECIMALS, locale),
            )

        StatHeroComparison.EveryKilometerCounts ->
            stringResource(R.string.translation_yearReview_distanceSmall)

        is StatHeroComparison.EnergyDays ->
            stringResource(R.string.translation_yearReview_energyComparison, comparison.days.toString())

        StatHeroComparison.None -> ""
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────────

private val PREVIEW_DATA = StatHeroData(totalDistanceKm = 12_345.0, totalEnergyKwh = 2_890.0)

@Preview(name = "Distance", showBackground = true)
@Composable
private fun StatHeroDistancePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            field = "distance",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}

@Preview(name = "Energy", showBackground = true)
@Composable
private fun StatHeroEnergyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            field = "energy",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}

@Preview(name = "Unknown field", showBackground = true)
@Composable
private fun StatHeroUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState(phase = UiPhase.Content, data = PREVIEW_DATA),
            field = "co2",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}

@Preview(name = "Empty", showBackground = true)
@Composable
private fun StatHeroEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState(phase = UiPhase.Empty),
            field = "distance",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}

@Preview(name = "Loading", showBackground = true)
@Composable
private fun StatHeroLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState.loading(),
            field = "distance",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}

@Preview(name = "Error", showBackground = true)
@Composable
private fun StatHeroErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatHeroSlideContent(
            state = UiState(phase = UiPhase.Error),
            field = "distance",
            onRetry = {},
            distanceUnit = DistanceUnitPref.KM,
        )
    }
}
