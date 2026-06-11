// The native Jetpack Compose + Material 3 Driving Coach dashboard surface — a parity port of
// web/src/features/dashboard/widgets/DrivingCoachWidget.tsx. It mirrors the web `WidgetShell` (skeleton
// while loading, a retry surface on hard error, otherwise a freshness header) wrapping the compact score
// hero (1 col: the overall score plus the potential-savings badge, or the friendly "No tips available"
// empty), or — when wider — the score "/ 100" header above the recommendation tip cards (web
// `WidgetTipCards`, max 3) or that same empty state. All data flows through the shared
// [DrivingCoachWidgetViewModel]; the view never performs HTTP. Every string resolves through the i18n
// catalog and every interactive element / metric carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/DrivingCoachWidget) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.drivingcoach

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.MetricValue
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

private const val LOADING_BAR_COUNT = 3
private const val TILE_FILL_ALPHA = 0.05f
private const val TIP_BORDER_ALPHA = 0.10f
private val COMPACT_MIN_HEIGHT = 44.dp

/**
 * Stateful entry point. Binds the shared Driving coach feed via [source] into a
 * [DrivingCoachWidgetViewModel], records the one-shot `view.opened` diagnostic, and renders the surface
 * for the given [size]. A dashboard host supplies [source] (an adapter over the shared S8 Driving /
 * Vehicles data layer) and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network coach seam (`DrivingStore`/`DrivingRepository` adapter).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingCoachWidget(
    source: DrivingCoachSource,
    modifier: Modifier = Modifier,
    size: DrivingCoachSize = DrivingCoachRegistration.defaultSize,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = DrivingCoachRegistration.ID,
) {
    val viewModel: DrivingCoachWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory = viewModelFactory { initializer { DrivingCoachWidgetViewModel(source, logger) } },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()

    DrivingCoachWidgetContent(
        state = state,
        size = size,
        onRefresh = viewModel::refresh,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise the freshness header
 * over the compact score hero / standard score-header + tip body.
 */
@Composable
fun DrivingCoachWidgetContent(
    state: UiState<DrivingCoachReport>,
    size: DrivingCoachSize,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strings = rememberDrivingCoachStrings()
    when {
        state.isLoading -> LoadingChrome(modifier)
        state.isError -> ErrorChrome(onRefresh, modifier)
        else -> {
            val display =
                remember(state.data, size, strings) {
                    state.data?.takeIf { it.hasData }?.let { DrivingCoachProjection.project(it, size, strings) }
                }
            LoadedChrome(state, size, display, onRefresh, strings, modifier)
        }
    }
}

@Composable
private fun LoadedChrome(
    state: UiState<DrivingCoachReport>,
    size: DrivingCoachSize,
    display: DrivingCoachDisplay?,
    onRefresh: () -> Unit,
    strings: DrivingCoachStrings,
    modifier: Modifier,
) {
    Column(modifier = modifier.fillMaxSize()) {
        WidgetHeader(state = state, size = size, onRefresh = onRefresh, strings = strings)
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = Spacing.md, vertical = Spacing.sm),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            when {
                display == null -> CoachEmpty(strings)
                size.isCompact -> CompactHero(display, strings)
                else -> FullBody(display, strings)
            }
        }
    }
}

@Composable
private fun WidgetHeader(
    state: UiState<DrivingCoachReport>,
    size: DrivingCoachSize,
    onRefresh: () -> Unit,
    strings: DrivingCoachStrings,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(start = Spacing.md, end = Spacing.sm, top = Spacing.sm, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        // Web parity: the compact (1-col) shell renders no title; only the standard layout shows the title.
        if (size.isCompact) {
            Spacer(modifier = Modifier.weight(1f))
        } else {
            Icon(
                CoachGlyphs.Lightbulb,
                contentDescription = null,
                size = IconSize.Sm,
                tint = TeslaTokens.status.warning,
            )
            PanelTitle(strings.title, modifier = Modifier.weight(1f).semantics { heading() })
        }
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = true,
            fetchingLabel = strings.refreshingLabel,
            errorLabel = strings.offlineLabel,
            formatAge = strings.formatRelative,
        )
        IconButton(
            imageVector = FeedbackGlyphs.Refresh,
            contentDescription = strings.refreshLabel,
            onClick = onRefresh,
            enabled = !state.refreshing,
            size = IconSize.Sm,
        )
    }
}

@Composable
private fun CompactHero(
    display: DrivingCoachDisplay,
    strings: DrivingCoachStrings,
) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = COMPACT_MIN_HEIGHT)
                .clearAndSetSemantics { contentDescription = display.compactContentDescription },
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.xs, Alignment.CenterVertically),
    ) {
        MetricValue(display.scoreText)
        if (display.showSavingsBadge) {
            Badge(text = display.savingsBadgeText, variant = BadgeVariant.Success)
        }
        if (display.compactShowsEmptyState) {
            EmptyState(message = strings.noTips, icon = CoachGlyphs.Lightbulb)
        }
    }
}

@Composable
private fun FullBody(
    display: DrivingCoachDisplay,
    strings: DrivingCoachStrings,
) {
    ScoreHeader(display)
    TipCards(display, strings)
}

@Composable
private fun ScoreHeader(display: DrivingCoachDisplay) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            modifier = Modifier.weight(1f),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Text(
                text = display.scoreText,
                style = MaterialTheme.typography.headlineMedium.copy(fontWeight = FontWeight.Bold),
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.alignByBaseline(),
            )
            Caption(display.scoreLabel, modifier = Modifier.alignByBaseline())
        }
        if (display.showSavingsBadge) {
            Badge(text = display.savingsBadgeText, variant = BadgeVariant.Success)
        }
    }
}

@Composable
private fun TipCards(
    display: DrivingCoachDisplay,
    strings: DrivingCoachStrings,
) {
    val visible = display.tips.take(display.maxTips)
    if (visible.isEmpty()) {
        EmptyState(
            message = strings.noTips,
            icon = CoachGlyphs.Lightbulb,
            modifier = Modifier.fillMaxWidth(),
        )
    } else {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            visible.forEach { tip -> TipCard(tip) }
        }
    }
}

@Composable
private fun TipCard(tip: DrivingCoachTip) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(Radius.md))
                .background(MaterialTheme.colorScheme.onSurface.copy(alpha = TILE_FILL_ALPHA))
                .border(1.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = TIP_BORDER_ALPHA), RoundedCornerShape(Radius.md))
                .padding(Spacing.sm)
                .clearAndSetSemantics { contentDescription = tip.contentDescription },
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            CoachGlyphs.Lightbulb,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            ) {
                Text(
                    text = tip.title,
                    style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                if (tip.hasImpact) {
                    Badge(text = tip.impactLabel, variant = badgeVariant(tip.impactTone))
                }
            }
            HelperText(tip.description)
        }
    }
}

@Composable
private fun CoachEmpty(strings: DrivingCoachStrings) {
    EmptyState(
        message = strings.noTips,
        icon = CoachGlyphs.Lightbulb,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun LoadingChrome(modifier: Modifier) {
    val label = stringResource(R.string.translation_common_loading)
    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(Spacing.md)
                .semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        repeat(LOADING_BAR_COUNT) {
            Skeleton(height = Spacing.lg, rounded = true)
        }
    }
}

@Composable
private fun ErrorChrome(
    onRetry: () -> Unit,
    modifier: Modifier,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = modifier.fillMaxSize().padding(Spacing.md),
    )
}

private fun badgeVariant(tone: CoachBadgeTone): BadgeVariant =
    when (tone) {
        CoachBadgeTone.Success -> BadgeVariant.Success
        CoachBadgeTone.Warning -> BadgeVariant.Warning
        CoachBadgeTone.Neutral -> BadgeVariant.Neutral
    }

/**
 * Builds the localized [DrivingCoachStrings] from the i18n catalog (P1/S10): the title, the score-suffix
 * label, the templated potential-savings string, the empty-state copy, and the
 * `translation_freshness_*`-backed relative-time formatter shared with the freshness chip. The
 * `potentialSavings` resource carries a single `%1$s` slot the projection fills.
 */
@Composable
private fun rememberDrivingCoachStrings(): DrivingCoachStrings {
    val title = stringResource(R.string.translation_widget_drivingCoach_title)
    val scoreLabel = stringResource(R.string.translation_widget_drivingCoach_scoreLabel)
    val potentialSavings = stringResource(R.string.translation_widget_drivingCoach_potentialSavings)
    val noTips = stringResource(R.string.translation_widget_drivingCoach_noTips)
    val refresh = stringResource(R.string.translation_common_refresh)
    val refreshing = stringResource(R.string.translation_common_loading)
    val offline = stringResource(R.string.translation_common_offline)
    val justNow = stringResource(R.string.translation_freshness_justNow)
    val seconds = stringResource(R.string.translation_freshness_seconds)
    val minutes = stringResource(R.string.translation_freshness_minutes)
    val hours = stringResource(R.string.translation_freshness_hours)
    val days = stringResource(R.string.translation_freshness_days)
    val weeks = stringResource(R.string.translation_freshness_weeks)
    return remember(
        title,
        scoreLabel,
        potentialSavings,
        noTips,
        refresh,
        refreshing,
        offline,
        justNow,
        seconds,
        minutes,
        hours,
        days,
        weeks,
    ) {
        DrivingCoachStrings(
            title = title,
            scoreLabel = scoreLabel,
            potentialSavingsTemplate = potentialSavings,
            noTips = noTips,
            refreshLabel = refresh,
            refreshingLabel = refreshing,
            offlineLabel = offline,
            formatRelative = { age ->
                when (age) {
                    FreshnessAge.Unknown -> "\u2014"
                    FreshnessAge.JustNow -> justNow
                    is FreshnessAge.Seconds -> seconds.format(age.value)
                    is FreshnessAge.Minutes -> minutes.format(age.value)
                    is FreshnessAge.Hours -> hours.format(age.value)
                    is FreshnessAge.Days -> days.format(age.value)
                    is FreshnessAge.Weeks -> weeks.format(age.value)
                }
            },
        )
    }
}

/**
 * Self-contained line-style glyph the web component uses (lucide `Lightbulb`) that is not already in the
 * shared `DataDisplayGlyphs` / `FeedbackGlyphs` catalogs. Authored here as a 24×24 stroked vector (the
 * same approach as `components/ui/TeslaGlyphs`) and recolored at render time by [Icon]'s `tint`, so it
 * inherits every theme/state color automatically.
 */
private object CoachGlyphs {
    /** Lucide `Lightbulb` — the header, tip, and empty-state icon (web `<Lightbulb />`). */
    val Lightbulb: ImageVector =
        coachGlyph("Lightbulb") {
            moveTo(12f, 2f)
            curveTo(8.7f, 2f, 6f, 4.7f, 6f, 8f)
            curveTo(6f, 10.5f, 7.5f, 12.5f, 9f, 14f)
            lineTo(9f, 16f)
            lineTo(15f, 16f)
            lineTo(15f, 14f)
            curveTo(16.5f, 12.5f, 18f, 10.5f, 18f, 8f)
            curveTo(18f, 4.7f, 15.3f, 2f, 12f, 2f)
            close()
            moveTo(9.5f, 19f)
            lineTo(14.5f, 19f)
            moveTo(10f, 22f)
            lineTo(14f, 22f)
        }
}

private fun coachGlyph(
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
