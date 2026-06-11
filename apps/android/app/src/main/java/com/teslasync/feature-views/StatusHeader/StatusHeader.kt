// The native Jetpack Compose + Material 3 StatusHeader feature view — a parity port of
// web/src/features/admin/components/dlq-inspector/StatusHeader.tsx. The web component renders three
// summary StatCards (total entries / replayable / replay mode) above a warning AlertBanner that appears
// only when server-side replay is disabled, so an operator sees at a glance that the replay button below
// will return HTTP 403. This port keeps that contract: the three cards always render (showing zeros, never
// a blank box, when the payload is absent), each card switches to skeleton chrome while the owning query
// loads, and the warning is shown only when the data has resolved with replay disabled.
//
// Every derivation flows through the pure [StatusHeaderProjection]; the composable is a thin render layer.
// The card labels, sublabels, mode values, and the warning title/body all resolve through the generated
// i18n catalog (P1/S10) `admin.dlq.*` keys — there is no English literal in this file. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/StatusHeader) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.statusheader

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
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
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/**
 * The web `Grid cols={{ default: 1, sm: 3 }}` breakpoint: Tailwind `sm` is 640px, so at or above 640dp the
 * three cards lay out in a single row, and below it they stack — the native expression of the responsive
 * one-vs-three column grid.
 */
private val STAT_GRID_ROW_MIN_WIDTH: Dp = 640.dp

/**
 * Stateful entry point — the faithful 1:1 port of the web `StatusHeader({ data, loading })` props. Records
 * the one-shot `view.opened` diagnostic on first composition (P1/S11), projects the props onto a
 * [StatusHeaderDisplay] via the pure [StatusHeaderProjection], and renders.
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun StatusHeader(
    data: DlqListResponse?,
    loading: Boolean,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { StatusHeaderDiagnostics.recordViewOpened(logger) }
    val display = remember(data, loading) { StatusHeaderProjection.project(data, loading) }
    StatusHeaderContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test entry point. The three cards are always present (web grid); each
 * shows skeleton chrome while [StatusHeaderDisplay.loading] is true and its resolved value otherwise, and
 * the warning banner renders only when [StatusHeaderDisplay.showDisabledBanner] is set.
 */
@Composable
fun StatusHeaderContent(
    display: StatusHeaderDisplay,
    modifier: Modifier = Modifier,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val totalLabel = stringResource(R.string.translation_admin_dlq_stats_total)
    val totalSublabel = stringResource(R.string.translation_admin_dlq_stats_totalSub)
    val replayableLabel = stringResource(R.string.translation_admin_dlq_stats_replayable)
    val replayableSublabel = stringResource(R.string.translation_admin_dlq_stats_replayableSub)
    val replayModeLabel = stringResource(R.string.translation_admin_dlq_stats_replayMode)
    val replayModeSublabel = stringResource(R.string.translation_admin_dlq_stats_replayModeSub)
    val enabledValue = stringResource(R.string.translation_admin_dlq_stats_enabled)
    val disabledValue = stringResource(R.string.translation_admin_dlq_stats_disabled)

    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        StatGrid(
            total = { cardModifier ->
                StatCard(
                    label = totalLabel,
                    value = StatusHeaderProjection.formatCount(display.totalEntries, locale),
                    icon = StatusHeaderGlyphs.Inbox,
                    sublabel = totalSublabel,
                    loading = display.loading,
                    modifier = cardModifier,
                )
            },
            replayable = { cardModifier ->
                StatCard(
                    label = replayableLabel,
                    value = StatusHeaderProjection.formatCount(display.replayableEntries, locale),
                    icon = DataDisplayGlyphs.Shield,
                    sublabel = replayableSublabel,
                    loading = display.loading,
                    modifier = cardModifier,
                )
            },
            replayMode = { cardModifier ->
                StatCard(
                    label = replayModeLabel,
                    value = if (display.replayEnabled) enabledValue else disabledValue,
                    icon = DataDisplayGlyphs.AlertOctagon,
                    sublabel = replayModeSublabel,
                    loading = display.loading,
                    modifier = cardModifier,
                )
            },
        )

        if (display.showDisabledBanner) {
            AlertBanner(
                message = stringResource(R.string.translation_admin_dlq_banners_disabledMessage),
                tone = Tone.Warning,
                title = stringResource(R.string.translation_admin_dlq_banners_disabledTitle),
            )
        }
    }
}

/**
 * Lays out the three summary cards as the web responsive grid: a single weighted [Row] at or above
 * [STAT_GRID_ROW_MIN_WIDTH] (`sm: 3`) and a stacked [Column] below it (`default: 1`). Each slot receives
 * the per-orientation [Modifier] so the card fills its column.
 */
@Composable
private fun StatGrid(
    total: @Composable (Modifier) -> Unit,
    replayable: @Composable (Modifier) -> Unit,
    replayMode: @Composable (Modifier) -> Unit,
    modifier: Modifier = Modifier,
) {
    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        if (maxWidth >= STAT_GRID_ROW_MIN_WIDTH) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                total(Modifier.weight(1f))
                replayable(Modifier.weight(1f))
                replayMode(Modifier.weight(1f))
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                total(Modifier.fillMaxWidth())
                replayable(Modifier.fillMaxWidth())
                replayMode(Modifier.fillMaxWidth())
            }
        }
    }
}

/**
 * The one glyph this surface needs that the shared sets do not carry. The web uses lucide `Inbox` for the
 * total-entries card; Android ships no equivalent without the frozen `material-icons-extended` artifact, so
 * — exactly as the shared `DataDisplayGlyphs` do for their lucide ports — it is authored here as a 24×24
 * stroked vector (a tray with the inbox slot dipping in the middle). The `Shield` (replayable) and
 * `AlertOctagon` (replay mode) glyphs are reused from `DataDisplayGlyphs`.
 */
private object StatusHeaderGlyphs {
    val Inbox: ImageVector =
        stroked("Inbox") {
            moveTo(4f, 5f)
            lineTo(20f, 5f)
            lineTo(20f, 19f)
            lineTo(4f, 19f)
            close()
            moveTo(4f, 13f)
            lineTo(8f, 13f)
            lineTo(10f, 16f)
            lineTo(14f, 16f)
            lineTo(16f, 13f)
            lineTo(20f, 13f)
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

private val PREVIEW_DATA =
    DlqListResponse(
        count = 1234,
        replayEnabled = false,
        entries =
            listOf(
                DlqEntrySummary(replayable = true),
                DlqEntrySummary(replayable = true),
                DlqEntrySummary(replayable = false),
            ),
    )

@Preview(name = "Loading", showBackground = true)
@Composable
private fun StatusHeaderLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusHeaderContent(StatusHeaderProjection.project(data = null, loading = true))
    }
}

@Preview(name = "Resolved — replay disabled", showBackground = true)
@Composable
private fun StatusHeaderDisabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusHeaderContent(StatusHeaderProjection.project(PREVIEW_DATA, loading = false))
    }
}

@Preview(name = "Resolved — replay enabled", showBackground = true)
@Composable
private fun StatusHeaderEnabledPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusHeaderContent(StatusHeaderProjection.project(PREVIEW_DATA.copy(replayEnabled = true), loading = false))
    }
}

@Preview(name = "Resolved — empty (no payload)", showBackground = true)
@Composable
private fun StatusHeaderEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        StatusHeaderContent(StatusHeaderProjection.project(data = null, loading = false))
    }
}
