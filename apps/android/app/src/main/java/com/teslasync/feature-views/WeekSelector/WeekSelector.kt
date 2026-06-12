// The native Jetpack Compose + Material 3 WeekSelector feature view — a parity port of
// web/src/features/analytics/components/weekly-digest/WeekSelector.tsx. The web component is the
// Weekly Digest's week navigator: a `GlassPanel` row with a ghost "Previous" button (ChevronLeft icon) on
// the left, a centered calendar-icon + week-range label that gains a "Current" info badge for the live week,
// and a ghost "Next" button (ChevronRight icon) on the right that is disabled while viewing the current week
// (you can never page into the future). This port keeps that contract exactly: the row always renders, the
// badge appears only for the current week, and Next is disabled for the current week.
//
// WeekSelector is a presentational control — the web component takes its `weekLabel` / `isCurrentWeek` and
// the `onPrevWeek` / `onNextWeek` callbacks as props from the WeeklyDigest page (`useWeeklyDigest`), which
// owns the queries and the `weekOffset` client state and mounts this control only in its resolved, has-data
// branch. So, as the sibling StatusHeader / SummaryStatsRow presentational ports document, the
// loading / empty / error / stale / offline states live on the owning page, not here; the two branches the
// web source defines (current week vs. a past week) are the complete state set this surface renders. The one
// data source the web component binds is `useTranslation`, mapped natively to the generated i18n catalog
// (P1/S10) — every visible string resolves through `analytics.weeklyDigest.*` keys, with no English literal
// in this file. Every derivation flows through the pure [WeekSelectorProjection]; the composable is a thin
// render layer that records the one-shot `view.opened` diagnostic (P1/S11) on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WeekSelector) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.weekselector

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/**
 * Stateful entry point — the faithful 1:1 port of the web `WeekSelector({ weekLabel, isCurrentWeek,
 * onPrevWeek, onNextWeek })` props. Records the one-shot `view.opened` diagnostic on first composition
 * (P1/S11), projects the props onto a [WeekSelectorDisplay] via the pure [WeekSelectorProjection], and
 * renders the stateless content.
 *
 * @param weekLabel the formatted week-range label (web `weekLabel`).
 * @param isCurrentWeek whether the live week is selected — shows the "Current" badge and disables Next.
 * @param onPrevWeek steps one week back (web `onPrevWeek`).
 * @param onNextWeek steps one week forward; never invoked while [isCurrentWeek] (web `onNextWeek`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WeekSelector(
    weekLabel: String,
    isCurrentWeek: Boolean,
    onPrevWeek: () -> Unit,
    onNextWeek: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { WeekSelectorDiagnostics.recordViewOpened(logger) }
    val display = remember(weekLabel, isCurrentWeek) { WeekSelectorProjection.project(weekLabel, isCurrentWeek) }
    WeekSelectorContent(
        display = display,
        onPrevWeek = onPrevWeek,
        onNextWeek = onNextWeek,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test entry point. Reproduces the web `GlassPanel` row: the ghost
 * "Previous" button, the centered calendar-icon + [WeekSelectorDisplay.weekLabel] (with the "Current" badge
 * when [WeekSelectorDisplay.showCurrentBadge]), and the ghost "Next" button, which is enabled only when
 * [WeekSelectorDisplay.nextEnabled]. Each button carries an explicit TalkBack label.
 */
@Composable
fun WeekSelectorContent(
    display: WeekSelectorDisplay,
    onPrevWeek: () -> Unit,
    onNextWeek: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val prevLabel = stringResource(R.string.translation_analytics_weeklyDigest_prevWeek)
    val nextLabel = stringResource(R.string.translation_analytics_weeklyDigest_nextWeek)
    val currentLabel = stringResource(R.string.translation_analytics_weeklyDigest_current)

    GlassPanel(modifier = modifier, padding = PanelPadding.None) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.xl, vertical = Spacing.md),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = prevLabel,
                onClick = onPrevWeek,
                modifier = Modifier.semantics { contentDescription = prevLabel },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                leadingIcon = TeslaGlyphs.ChevronLeft,
            )

            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = WeekSelectorGlyphs.Calendar,
                    contentDescription = null,
                    size = IconSize.Md,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Subhead(text = display.weekLabel)
                if (display.showCurrentBadge) {
                    Badge(text = currentLabel, variant = BadgeVariant.Info)
                }
            }

            Button(
                label = nextLabel,
                onClick = onNextWeek,
                modifier = Modifier.semantics { contentDescription = nextLabel },
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
                enabled = display.nextEnabled,
                leadingIcon = TeslaGlyphs.ChevronRight,
            )
        }
    }
}

/**
 * The one glyph this surface needs that the shared [TeslaGlyphs] set does not carry. The web uses lucide
 * `Calendar` for the center label; Android ships no equivalent without the frozen `material-icons-extended`
 * artifact, so — exactly as the shared glyph sets and the sibling OverviewTab surface do for their lucide
 * ports — it is authored here as a 24×24 stroked vector (a calendar body with a header divider and two top
 * binding ticks). The `ChevronLeft` / `ChevronRight` button glyphs are reused from [TeslaGlyphs].
 */
private object WeekSelectorGlyphs {
    val Calendar: ImageVector =
        stroked("Calendar") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 22f)
            lineTo(3f, 22f)
            close()
            moveTo(3f, 10f)
            lineTo(21f, 10f)
            moveTo(8f, 2f)
            lineTo(8f, 6f)
            moveTo(16f, 2f)
            lineTo(16f, 6f)
        }

    private fun stroked(
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
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

@Preview(name = "Current week", showBackground = true)
@Composable
private fun WeekSelectorCurrentPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekSelectorContent(
            display = WeekSelectorProjection.project(weekLabel = "Jun 9 \u2013 Jun 15", isCurrentWeek = true),
            onPrevWeek = {},
            onNextWeek = {},
        )
    }
}

@Preview(name = "Past week", showBackground = true)
@Composable
private fun WeekSelectorPastPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        WeekSelectorContent(
            display = WeekSelectorProjection.project(weekLabel = "Jun 2 \u2013 Jun 8", isCurrentWeek = false),
            onPrevWeek = {},
            onNextWeek = {},
        )
    }
}
