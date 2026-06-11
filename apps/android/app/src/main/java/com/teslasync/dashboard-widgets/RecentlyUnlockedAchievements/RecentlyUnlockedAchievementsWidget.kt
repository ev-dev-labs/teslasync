// The native Jetpack Compose + Material 3 Recently Unlocked Achievements dashboard surface — a parity port
// of web/src/features/dashboard/widgets/RecentlyUnlockedAchievements.tsx. It mirrors the web `WidgetShell`
// (skeleton while loading, a retry surface on hard error, otherwise a freshness header) wrapping one of the
// bodies the web renders: the opt-out empty state when `showOnDashboard` is off (so the dashboard slot
// never disappears), the wrap-flow strip of most-recently-unlocked achievement badges (each a deep-link
// button into Lifetime Stats), or the friendly "none yet" empty state. All data flows through the shared
// [RecentlyUnlockedAchievementsWidgetViewModel]; the view never performs HTTP. Every string resolves
// through the i18n catalog, each badge carries its "View achievement: {name}" TalkBack label, and the
// refresh control carries a TalkBack label.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/dashboard-widgets/RecentlyUnlockedAchievements) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.recentlyunlockedachievements

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataFreshness
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Heading
import io.teslasync.android.components.ui.HeadingLevel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UiState
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement

private val BADGE_MIN_WIDTH = 88.dp
private val BADGE_MAX_WIDTH = 132.dp
private val LOADING_TITLE_HEIGHT = 14.dp
private val LOADING_ROW_HEIGHT = 56.dp
private const val LOADING_TITLE_FRACTION = 0.4f
private const val BADGE_NAME_MAX_LINES = 2
private const val BADGE_BORDER_ALPHA = 0.3f

// Authored glyph geometry (the curated icon sets ship no trophy analogue; see [RecentlyUnlockedGlyphs]).
private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * Stateful entry point. Binds the shared feeds via [source] into a [RecentlyUnlockedAchievementsWidgetViewModel],
 * records the one-shot `view.opened` diagnostic, and renders the surface for the given [size]. A dashboard
 * host supplies [source] (an adapter over the shared S7/S8 data layer), an optional [vehicleId] (web
 * `WidgetProps.vehicleId`), the [onOpenAchievement] deep-link callback (web `navigate('/lifetime?achievement=…')`),
 * and a unique [instanceKey] per placement.
 *
 * @param source the cache-then-network seam (vehicles + analytics + showOnDashboard adapter).
 * @param vehicleId the configured vehicle, or `null`/non-positive to use the first enrolled vehicle (and
 *   the fleet-wide totals when there is none).
 * @param onOpenAchievement invoked with an achievement id when its badge is tapped; the host routes it to
 *   the Lifetime Stats deep link. Defaults to a no-op so the surface is safe to host before nav is wired.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun RecentlyUnlockedAchievementsWidget(
    source: RecentlyUnlockedAchievementsSource,
    modifier: Modifier = Modifier,
    vehicleId: Long? = null,
    size: RecentlyUnlockedSize = RecentlyUnlockedAchievementsRegistration.defaultSize,
    onOpenAchievement: (String) -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = RecentlyUnlockedAchievementsRegistration.ID,
) {
    val viewModel: RecentlyUnlockedAchievementsWidgetViewModel =
        viewModel(
            key = instanceKey,
            factory =
                viewModelFactory {
                    initializer { RecentlyUnlockedAchievementsWidgetViewModel(source, logger, vehicleId) }
                },
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val showOnDashboard by viewModel.showOnDashboard.collectAsStateWithLifecycle()

    RecentlyUnlockedAchievementsWidgetContent(
        state = state,
        showOnDashboard = showOnDashboard,
        size = size,
        onRefresh = viewModel::refresh,
        onOpenAchievement = onOpenAchievement,
        modifier = modifier,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test entry point. Reproduces the web
 * `WidgetShell` short-circuits (loading → skeleton, hard error → retry) and otherwise a freshness header
 * over the badge strip / "none yet" empty state, with the `showOnDashboard` opt-out taking precedence so
 * the dashboard slot never collapses. Stale (non-error) data auto-refreshes while shown, mirroring the web
 * freshness contract.
 */
@Composable
fun RecentlyUnlockedAchievementsWidgetContent(
    state: UiState<JsonElement>,
    showOnDashboard: Boolean,
    size: RecentlyUnlockedSize,
    onRefresh: () -> Unit,
    onOpenAchievement: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LaunchedEffect(showOnDashboard, state.stale, state.refreshing, state.hasError) {
        if (!showOnDashboard) return@LaunchedEffect
        if (state.stale && !state.refreshing && !state.hasError) onRefresh()
    }
    val strings = rememberRecentlyUnlockedStrings()

    GlassPanel(modifier = modifier, padding = PanelPadding.Md) {
        if (!showOnDashboard) {
            RecentlyUnlockedHeader(title = strings.title, state = state, onRefresh = onRefresh, showRefresh = false)
            RecentlyUnlockedEmptyState(message = strings.disabled)
        } else {
            when {
                state.isLoading ->
                    RecentlyUnlockedLoading(label = stringResource(R.string.translation_common_loading))
                state.isError -> RecentlyUnlockedError(onRetry = onRefresh)
                else -> {
                    RecentlyUnlockedHeader(title = strings.title, state = state, onRefresh = onRefresh, showRefresh = true)
                    val display =
                        remember(state.data, size, strings) {
                            RecentlyUnlockedProjection.project(parseAchievements(state.data), size, strings)
                        }
                    if (display.hasItems) {
                        RecentlyUnlockedBadgeStrip(badges = display.badges, onOpenAchievement = onOpenAchievement)
                    } else {
                        RecentlyUnlockedEmptyState(message = display.emptyMessage)
                    }
                }
            }
        }
    }
}

@Composable
private fun RecentlyUnlockedHeader(
    title: String,
    state: UiState<*>,
    onRefresh: () -> Unit,
    showRefresh: Boolean,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(bottom = Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Icon(
            RecentlyUnlockedGlyphs.Trophy,
            contentDescription = null,
            size = IconSize.Sm,
            tint = MaterialTheme.colorScheme.tertiary,
        )
        PanelTitle(title, modifier = Modifier.weight(1f).semantics { heading() })
        DataFreshness(
            updatedAtMillis = state.fetchedAt?.takeIf { it > 0 },
            isFetching = state.refreshing,
            isStale = state.stale,
            isError = state.hasError,
            compact = false,
        )
        if (showRefresh) {
            IconButton(
                imageVector = FeedbackGlyphs.Refresh,
                contentDescription = stringResource(R.string.translation_common_refresh),
                onClick = onRefresh,
                enabled = !state.refreshing,
                size = IconSize.Sm,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun RecentlyUnlockedBadgeStrip(
    badges: List<RecentlyUnlockedBadge>,
    onOpenAchievement: (String) -> Unit,
) {
    // FlowRow reproduces the web `flex flex-wrap gap-3`: badges sit on one line when the widget is wide and
    // wrap onto further lines when it is narrow.
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        badges.forEach { badge ->
            RecentlyUnlockedBadgeCard(badge = badge, onClick = { onOpenAchievement(badge.id) })
        }
    }
}

@Composable
private fun RecentlyUnlockedBadgeCard(
    badge: RecentlyUnlockedBadge,
    onClick: () -> Unit,
) {
    // The whole card is the deep-link button (web `<button aria-label=…>`): Surface(onClick) contributes the
    // Button role + click action, the merged contentDescription supplies the announced label, and the inner
    // column's semantics are cleared so TalkBack reads the single label instead of the emoji + name + status.
    Surface(
        onClick = onClick,
        modifier =
            Modifier
                .widthIn(min = BADGE_MIN_WIDTH, max = BADGE_MAX_WIDTH)
                .semantics { contentDescription = badge.contentDescription },
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceVariant,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = BADGE_BORDER_ALPHA)),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.sm).clearAndSetSemantics {},
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Heading(badge.icon, level = HeadingLevel.Section)
            Heading(
                badge.name,
                level = HeadingLevel.Sub,
                color = MaterialTheme.colorScheme.tertiary,
                maxLines = BADGE_NAME_MAX_LINES,
            )
            Caption(badge.unlockedLabel)
        }
    }
}

@Composable
private fun RecentlyUnlockedEmptyState(message: String) {
    EmptyState(
        message = message,
        icon = RecentlyUnlockedGlyphs.Trophy,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RecentlyUnlockedLoading(label: String) {
    Column(
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Skeleton(widthFraction = LOADING_TITLE_FRACTION, height = LOADING_TITLE_HEIGHT)
        Skeleton(height = LOADING_ROW_HEIGHT, rounded = true)
    }
}

@Composable
private fun RecentlyUnlockedError(onRetry: () -> Unit) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = onRetry,
        retryLabel = stringResource(R.string.translation_common_retry),
        modifier = Modifier.fillMaxWidth(),
    )
}

/**
 * Builds the localized [RecentlyUnlockedStrings] from the i18n catalog (P1/S10) — the keys the web component
 * reads via `t('…')`. The `viewNamed` lambda formats the `%1$s` template (web `{ name }` interpolation).
 * Remembered against the resolved strings so a locale change re-projects the surface.
 */
@Composable
private fun rememberRecentlyUnlockedStrings(): RecentlyUnlockedStrings {
    val title = stringResource(R.string.translation_widget_recentlyUnlocked_title)
    val disabled = stringResource(R.string.translation_widget_recentlyUnlocked_disabled)
    val noneYet = stringResource(R.string.translation_achievements_noneYet)
    val unlocked = stringResource(R.string.translation_lifetime_unlocked)
    val viewNamedTemplate = stringResource(R.string.translation_achievements_viewNamed)
    return remember(title, disabled, noneYet, unlocked, viewNamedTemplate) {
        RecentlyUnlockedStrings(
            title = title,
            disabled = disabled,
            noneYet = noneYet,
            unlocked = unlocked,
            viewNamed = { name -> String.format(viewNamedTemplate, name) },
        )
    }
}

/**
 * The single stroked vector this surface needs that the shared icon sets do not provide: the [Trophy] (the
 * widget's signature glyph — web `Trophy`, used in the header and both empty states). Authored as a 24×24
 * monochrome vector recolored at render time by `Icon`'s tint — the same approach the bundled glyph sets
 * use, since Android ships no lucide equivalent without the frozen `material-icons-extended` artifact.
 */
private object RecentlyUnlockedGlyphs {
    val Trophy: ImageVector =
        glyph("Trophy") {
            moveTo(7f, 4f)
            lineTo(17f, 4f)
            lineTo(17f, 9f)
            curveTo(17f, 12.3f, 14.8f, 14f, 12f, 14f)
            curveTo(9.2f, 14f, 7f, 12.3f, 7f, 9f)
            close()
            moveTo(7f, 5f)
            lineTo(4.5f, 5f)
            curveTo(2.8f, 5f, 2.8f, 8.5f, 5f, 8.5f)
            lineTo(7f, 8.5f)
            moveTo(17f, 5f)
            lineTo(19.5f, 5f)
            curveTo(21.2f, 5f, 21.2f, 8.5f, 19f, 8.5f)
            lineTo(17f, 8.5f)
            moveTo(12f, 14f)
            lineTo(12f, 18f)
            moveTo(8.5f, 20f)
            lineTo(15.5f, 20f)
            moveTo(10f, 18f)
            lineTo(14f, 18f)
        }
}

private fun glyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
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
