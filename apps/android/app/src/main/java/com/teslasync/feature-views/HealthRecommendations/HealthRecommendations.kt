// The native Jetpack Compose + Material 3 HealthRecommendations feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx. The web component takes a
// single `overallHealth` prop (good | warning | critical), `useMemo`s an ordered list of advisory tips from
// it, and fades in a GlassPanel holding a Shield-iconed "Health Recommendations" header above a staggered
// list of priority-accented tip rows. Its only data source is `useTranslation` (the P1/S10 i18n catalog).
//
// This surface keeps that contract exactly: it performs NO HTTP and binds no data hook. As with the sibling
// HighlightCard port, a purely prop-driven surface has no loading / error / stale / offline lifecycle of its
// own — that belongs to the owning drivetrain-health page, and modelling it here would invent behaviour the
// spec does not have. What the web genuinely varies — the recommendation list as a function of
// `overallHealth` — is reproduced via the pure [HealthRecommendationsProjection] and rendered for all three
// health states. The list is never empty (four baseline low-priority tips are always present), so the panel
// is never a blank box and no empty branch can occur. The panel + header chrome render identically in every
// state. Every derivation flows through the pure model; this composable is a thin render layer.
//
// Glyph parity: the web uses lucide `Shield` / `AlertTriangle` / `TrendingUp`. The shared
// [DataDisplayGlyphs] set ships `Shield` and `AlertTriangle` (reused here) but only `TrendingDown`, so the
// low-priority `TrendingUp` is authored locally as a 24×24 stroked vector — the same self-contained approach
// the sibling HighlightCard surface takes.
//
// Color parity: the web neon accents map exactly onto the generated dark status tokens — high → danger
// (#EF4444 neon-red), medium → warning (#F59E0B neon-amber), low + header → info (#00F0FF neon-cyan) — so the
// accent stays correct in every theme (the tokens flip for light/high-contrast). The web `uppercase` header
// styling is a web-only cosmetic; the catalog string is rendered verbatim in the muted caption role (Android
// Material 3 avoids all-caps labels) and marked as a heading for TalkBack.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HealthRecommendations) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — exactly as the sibling HighlightCard / BatteryHealthSection surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthrecommendations

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
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
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.StaggerContainer
import io.teslasync.android.components.motion.StaggerItem
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `<FadeIn delay={0.35}>` — the panel fades in after a 350 ms stagger. */
private const val ENTRY_DELAY_MS: Int = 350

/** Web `border-neon-{red|amber}/20` — accent border opacity for the high/medium tip rows. */
private const val ACCENT_BORDER_ALPHA: Float = 0.35f

/** Web `bg-neon-{red|amber}/5` — accent background tint opacity for the high/medium tip rows. */
private const val ACCENT_TINT_ALPHA: Float = 0.06f

/** Web `bg-white/[0.02]` — the faint neutral tint behind a low-priority tip row (theme-safe). */
private const val NEUTRAL_TINT_ALPHA: Float = 0.03f

/** Web icon `mt-0.5` — nudges the leading glyph down to align with the first text line. */
private val ICON_TOP_OFFSET = 2.dp

/** Tip-row border thickness. */
private val ROW_BORDER_WIDTH = 1.dp

/**
 * The already-localized strings the surface renders, resolved once from the P1/S10 i18n catalog at the
 * Compose boundary so the rest of the surface holds no English literal. [tips] maps every
 * [HealthRecommendation] to the text of its `drivetrain.tips.*` key.
 */
data class HealthRecommendationsStrings(
    val title: String,
    val tips: Map<HealthRecommendation, String>,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `HealthRecommendations({ overallHealth })`. Records
 * the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders the panel for the
 * given [overallHealth]. The surface binds no data of its own; [overallHealth] is computed upstream and
 * threaded in, exactly as on the web.
 *
 * @param overallHealth the drivetrain-health classification driving which tips are shown.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun HealthRecommendations(
    overallHealth: HealthStatus,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HealthRecommendationsDiagnostics.recordViewOpened(logger) }
    HealthRecommendationsContent(overallHealth = overallHealth, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout exactly: a
 * [FadeIn] wrapping a [GlassPanel] (web `p-6`) that holds the Shield header (web `mb-4`) above a
 * [StaggerContainer] of priority-accented tip rows (web `space-y-3`). The recommendation list is derived once
 * from [overallHealth] via the pure [HealthRecommendationsProjection], so the same input always renders the
 * same ordered list.
 */
@Composable
fun HealthRecommendationsContent(
    overallHealth: HealthStatus,
    modifier: Modifier = Modifier,
    strings: HealthRecommendationsStrings = rememberHealthRecommendationsStrings(),
) {
    val recommendations = remember(overallHealth) { HealthRecommendationsProjection.recommendationsFor(overallHealth) }
    FadeIn(modifier = modifier, delayMs = ENTRY_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                HealthRecommendationsHeader(title = strings.title)
                StaggerContainer(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    recommendations.forEachIndexed { index, recommendation ->
                        StaggerItem(index = index) {
                            RecommendationRow(
                                text = strings.tips.getValue(recommendation),
                                priority = recommendation.priority,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** The header row — the Shield glyph (web neon-cyan → the info token) and the muted, heading-tagged title. */
@Composable
private fun HealthRecommendationsHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Icon(
            imageVector = DataDisplayGlyphs.Shield,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.info,
        )
        Caption(text = title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * One advisory tip — the native port of the web bordered row (`rounded-lg border px-4 py-3`). The row's
 * border + background tint follow the [priority] (high → danger, medium → warning, low → neutral), the
 * leading glyph is the priority's accent-tinted icon (high/medium → alert triangle, low → trending-up), and
 * the [text] is the readable advisory body. The glyph is decorative — the [text] carries the meaning — so it
 * exposes no screen-reader node.
 */
@Composable
private fun RecommendationRow(
    text: String,
    priority: RecommendationPriority,
) {
    val chrome = recommendationRowChrome(priority)
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = chrome.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ROW_BORDER_WIDTH, chrome.border),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = Spacing.lg, vertical = Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = priorityGlyph(priority),
                contentDescription = null,
                size = IconSize.Md,
                tint = chrome.icon,
                modifier = Modifier.padding(top = ICON_TOP_OFFSET),
            )
            BodyText(text = text, modifier = Modifier.weight(1f))
        }
    }
}

/** Resolved row colors for a [RecommendationPriority] — the [icon] accent plus the [border] + [background] chrome. */
private data class RecommendationRowChrome(
    val icon: Color,
    val border: Color,
    val background: Color,
)

/**
 * Maps a [RecommendationPriority] onto its render colors. The icon always takes the priority's accent
 * (danger / warning / info), matching the web `text-neon-{red|amber|cyan}`. High and medium rows tint their
 * border + background with that accent (web `border-neon-…/20 bg-neon-…/5`); a low row stays neutral (web
 * `border-[var(--border-subtle)] bg-white/[0.02]`) so only its trending-up glyph carries the cyan accent.
 */
@Composable
private fun recommendationRowChrome(priority: RecommendationPriority): RecommendationRowChrome =
    when (priority) {
        RecommendationPriority.High -> accentChrome(TeslaTokens.status.danger)
        RecommendationPriority.Medium -> accentChrome(TeslaTokens.status.warning)
        RecommendationPriority.Low ->
            RecommendationRowChrome(
                icon = TeslaTokens.status.info,
                border = MaterialTheme.colorScheme.outlineVariant,
                background = MaterialTheme.colorScheme.onSurface.copy(alpha = NEUTRAL_TINT_ALPHA),
            )
    }

/** Builds the high/medium chrome: the [accent] tints the icon, the border (web `/20`) and the fill (web `/5`). */
private fun accentChrome(accent: Color): RecommendationRowChrome =
    RecommendationRowChrome(
        icon = accent,
        border = accent.copy(alpha = ACCENT_BORDER_ALPHA),
        background = accent.copy(alpha = ACCENT_TINT_ALPHA),
    )

/** The leading glyph for a [RecommendationPriority] — alert triangle for high/medium, trending-up for low. */
private fun priorityGlyph(priority: RecommendationPriority): ImageVector =
    when (priority) {
        RecommendationPriority.High, RecommendationPriority.Medium -> DataDisplayGlyphs.AlertTriangle
        RecommendationPriority.Low -> TrendingUpGlyph
    }

/**
 * Resolves the localized [HealthRecommendationsStrings] from the i18n catalog (P1/S10): the
 * `drivetrain.recommendations` title plus the nine `drivetrain.tips.*` advisory strings. Resolved once at the
 * Compose boundary so the rest of the surface holds no literal.
 */
@Composable
private fun rememberHealthRecommendationsStrings(): HealthRecommendationsStrings {
    val title = stringResource(R.string.translation_drivetrain_recommendations)
    val criticalStop = stringResource(R.string.translation_drivetrain_tips_criticalStop)
    val serviceUrgent = stringResource(R.string.translation_drivetrain_tips_serviceUrgent)
    val reduceLoad = stringResource(R.string.translation_drivetrain_tips_reduceLoad)
    val checkCoolant = stringResource(R.string.translation_drivetrain_tips_checkCoolant)
    val avoidSupercharging = stringResource(R.string.translation_drivetrain_tips_avoidSupercharging)
    val regularService = stringResource(R.string.translation_drivetrain_tips_regularService)
    val gentleAccel = stringResource(R.string.translation_drivetrain_tips_gentleAccel)
    val precondition = stringResource(R.string.translation_drivetrain_tips_precondition)
    val monitorTemps = stringResource(R.string.translation_drivetrain_tips_monitorTemps)
    return remember(
        title,
        criticalStop,
        serviceUrgent,
        reduceLoad,
        checkCoolant,
        avoidSupercharging,
        regularService,
        gentleAccel,
        precondition,
        monitorTemps,
    ) {
        HealthRecommendationsStrings(
            title = title,
            tips =
                mapOf(
                    HealthRecommendation.CriticalStop to criticalStop,
                    HealthRecommendation.ServiceUrgent to serviceUrgent,
                    HealthRecommendation.ReduceLoad to reduceLoad,
                    HealthRecommendation.CheckCoolant to checkCoolant,
                    HealthRecommendation.AvoidSupercharging to avoidSupercharging,
                    HealthRecommendation.RegularService to regularService,
                    HealthRecommendation.GentleAccel to gentleAccel,
                    HealthRecommendation.Precondition to precondition,
                    HealthRecommendation.MonitorTemps to monitorTemps,
                ),
        )
    }
}

// ── Local trend glyph (lucide TrendingUp), authored as a 24×24 stroked vector ────────────────────────────

/** Web lucide `trending-up`: an upward zig-zag with an arrowhead at the top-right. */
private val TrendingUpGlyph: ImageVector =
    ImageVector
        .Builder(
            name = "TrendingUp",
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
            ) {
                moveTo(4f, 17f)
                lineTo(11f, 10f)
                lineTo(14f, 13f)
                lineTo(20f, 7f)
                moveTo(15f, 7f)
                lineTo(20f, 7f)
                lineTo(20f, 12f)
            }
        }.build()

// ── Previews (tooling-only; each @Preview exercises a health-state branch) ───────────────────────────────

@Preview(name = "Good — baseline tips only", showBackground = true)
@Composable
private fun HealthRecommendationsGoodPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthRecommendationsContent(overallHealth = HealthStatus.Good)
    }
}

@Preview(name = "Warning — medium + baseline tips", showBackground = true)
@Composable
private fun HealthRecommendationsWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthRecommendationsContent(overallHealth = HealthStatus.Warning)
    }
}

@Preview(name = "Critical — high + medium + baseline tips", showBackground = true)
@Composable
private fun HealthRecommendationsCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthRecommendationsContent(overallHealth = HealthStatus.Critical)
    }
}
