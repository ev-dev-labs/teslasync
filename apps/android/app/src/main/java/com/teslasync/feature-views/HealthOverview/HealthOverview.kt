// The native Jetpack Compose + Material 3 HealthOverview feature view — a parity port of
// web/src/features/driving/components/drivetrain-health/HealthOverview.tsx. The web component renders a
// drivetrain health summary: when the band is not "good" a temperature AlertBanner appears above a glass
// summary panel; the panel pairs a band-tinted status icon + title + "Motor State: …" line on the left with
// a status Badge and the animated `{healthScore}%` rating on the right. This port keeps that contract —
// every web conditional render branch (the alert gate and the good / warning / critical fork) is reproduced.
//
// Every derivation flows through the pure [HealthOverviewProjection]; the composable is a thin render layer.
// The alert title/body, the panel title, the badge text, and the "Motor State" label all resolve through
// the generated i18n catalog (P1/S10) `drivetrain.*` keys — there is no English literal in this file. The
// one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// Color + composition mapping (P1/S9 tokens, no ported Tailwind): the web `GlassPanel glow` maps to the
// shared panel's semantic accent border (good→Success, warning→Warning, critical→Danger); the
// `STATUS_COLORS`-equivalent emerald/amber/red icon tint maps to `TeslaTokens.status` success/warning/danger;
// the web `healthBadgeVariant` maps 1:1 onto `BadgeVariant`; `getAlertVariant` maps onto `Tone`. The web
// lucide `CheckCircle` / `AlertTriangle` map to the shared `DataDisplayGlyphs`, and the web passes
// AlertTriangle for BOTH alert tones, so the banner glyph is set explicitly. The web `sm:` (640px) flex
// breakpoint maps to a 640dp `BoxWithConstraints` row/column switch. The score uses the shared
// `AnimatedNumber`, whose `MetricValue` is rendered in the neutral on-surface color (the shared metric type
// forces it, and no sibling tints it); the health color the web puts on the number is instead carried — with
// no loss of meaning — by the band-tinted icon, the colored Badge, and the panel accent. Each section keeps
// its own `FadeIn` like the web `<FadeIn>` siblings, honoring reduced motion via the shared primitive.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/HealthOverview) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.healthoverview

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.AnimatedNumber
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.MotionDurations
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

// Web `sm:` breakpoint is 640px: at or above 640dp the identity + score lay out in one space-between row,
// below it they stack — the native expression of the responsive `flex-col` → `sm:flex-row` switch.
private val SUMMARY_ROW_MIN_WIDTH: Dp = 640.dp
private const val MOTOR_STATE_SEPARATOR = ": "
private const val PERCENT_SUFFIX = "%"

/**
 * Stateful entry point — the faithful 1:1 port of the web `HealthOverview({ overallHealth, healthScore,
 * motorStatus })` props. Records the one-shot `view.opened` diagnostic on first composition (P1/S11),
 * projects the props onto a [HealthOverviewDisplay] via the pure [HealthOverviewProjection], and renders.
 *
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun HealthOverview(
    overallHealth: HealthStatus,
    healthScore: Double,
    motorStatus: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { HealthOverviewDiagnostics.recordViewOpened(logger) }
    val display =
        remember(overallHealth, healthScore, motorStatus) {
            HealthOverviewProjection.project(overallHealth, healthScore, motorStatus)
        }
    HealthOverviewContent(display = display, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web fragment exactly: the
 * temperature [AlertBanner] (only when [HealthOverviewDisplay.showAlert]) above the glass summary panel,
 * each wrapped in its own [FadeIn] like the web `<FadeIn>` siblings.
 */
@Composable
fun HealthOverviewContent(
    display: HealthOverviewDisplay,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        if (display.showAlert) {
            FadeIn {
                AlertBanner(
                    message = alertMessage(display.overallHealth),
                    tone = alertTone(display.overallHealth),
                    title = alertTitle(display.overallHealth),
                    // Web passes lucide AlertTriangle for both the warning and critical alerts, overriding
                    // the tone's default glyph (the danger tone would otherwise show an octagon).
                    icon = DataDisplayGlyphs.AlertTriangle,
                )
            }
        }
        FadeIn {
            HealthSummaryPanel(display)
        }
    }
}

/**
 * The glass summary panel — the web `GlassPanel` with a band-accented border. Lays the identity group and
 * the score group as the web responsive flex: a single space-between [Row] at or above
 * [SUMMARY_ROW_MIN_WIDTH] (`sm:flex-row sm:justify-between`) and a stacked [Column] below it (`flex-col`).
 */
@Composable
private fun HealthSummaryPanel(display: HealthOverviewDisplay) {
    GlassPanel(padding = PanelPadding.Lg, accent = healthAccent(display.overallHealth)) {
        BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
            if (maxWidth >= SUMMARY_ROW_MIN_WIDTH) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    HealthIdentity(display, modifier = Modifier.weight(1f))
                    HealthScore(display)
                }
            } else {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.lg),
                ) {
                    HealthIdentity(display)
                    HealthScore(display)
                }
            }
        }
    }
}

/**
 * The left identity group — the band-tinted status icon (web `CheckCircle` when healthy, else
 * `AlertTriangle`) beside the heading title and the "Motor State: …" caption. The icon is decorative
 * (its meaning is carried by the title + badge), the title is exposed as an accessibility heading, and the
 * motor line never dangles (the projection collapses a blank status to an em dash).
 */
@Composable
private fun HealthIdentity(
    display: HealthOverviewDisplay,
    modifier: Modifier = Modifier,
) {
    val motorLabel = stringResource(R.string.translation_drivetrain_motorState)
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.lg),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector =
                if (display.overallHealth == HealthStatus.Good) {
                    DataDisplayGlyphs.CheckCircle
                } else {
                    DataDisplayGlyphs.AlertTriangle
                },
            contentDescription = null,
            size = IconSize.Xl,
            tint = healthColor(display.overallHealth),
        )
        Column {
            SectionTitle(
                text = statusTitle(display.overallHealth),
                modifier = Modifier.semantics { heading() },
            )
            Caption("$motorLabel$MOTOR_STATE_SEPARATOR${display.motorStatusLabel}")
        }
    }
}

/**
 * The right score group — the status [Badge] beside the animated `{healthScore}%` rating. The score region
 * carries a stable accessibility label (the settled `${score}%`) so TalkBack announces the final value
 * rather than the count-up; the value itself still animates visually.
 */
@Composable
private fun HealthScore(
    display: HealthOverviewDisplay,
    modifier: Modifier = Modifier,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    val reduceMotion = rememberReducedMotion()
    val scoreLabel =
        remember(display.healthScore, locale) {
            HealthOverviewProjection.scorePercentLabel(display.healthScore, locale)
        }
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Badge(
            text = statusBadgeText(display.overallHealth),
            variant = badgeVariant(display.overallHealth),
            dot = true,
        )
        Box(modifier = Modifier.clearAndSetSemantics { contentDescription = scoreLabel }) {
            AnimatedNumber(
                value = display.healthScore,
                suffix = PERCENT_SUFFIX,
                // Reduced-motion preference snaps the count-up to its final value (the FadeIn entry honors
                // the same preference); the stable score label above keeps TalkBack unaffected either way.
                durationMillis = if (reduceMotion) 0 else MotionDurations.slow,
                locale = locale,
            )
        }
    }
}

/** Band → P1/S9 status color, the web emerald/amber/red `healthTextClass` for the icon tint. */
@Composable
private fun healthColor(status: HealthStatus): Color =
    when (status) {
        HealthStatus.Good -> TeslaTokens.status.success
        HealthStatus.Warning -> TeslaTokens.status.warning
        HealthStatus.Critical -> TeslaTokens.status.danger
    }

/** Band → shared `BadgeVariant`, the web `healthBadgeVariant` (good→success, warning→warning, else danger). */
private fun badgeVariant(status: HealthStatus): BadgeVariant =
    when (status) {
        HealthStatus.Good -> BadgeVariant.Success
        HealthStatus.Warning -> BadgeVariant.Warning
        HealthStatus.Critical -> BadgeVariant.Danger
    }

/** Band → panel accent border, the native expression of the web `GlassPanel glow={HEALTH_GLOW[…]}`. */
private fun healthAccent(status: HealthStatus): PanelAccent =
    when (status) {
        HealthStatus.Good -> PanelAccent.Success
        HealthStatus.Warning -> PanelAccent.Warning
        HealthStatus.Critical -> PanelAccent.Danger
    }

/** Band → banner [Tone], the web `getAlertVariant` (warning→warning, critical→danger). */
private fun alertTone(status: HealthStatus): Tone = if (status == HealthStatus.Critical) Tone.Danger else Tone.Warning

/** The panel title — web `healthGood` / `healthWarn` / `healthCrit`. */
@Composable
private fun statusTitle(status: HealthStatus): String =
    stringResource(
        when (status) {
            HealthStatus.Good -> R.string.translation_drivetrain_healthGood
            HealthStatus.Warning -> R.string.translation_drivetrain_healthWarn
            HealthStatus.Critical -> R.string.translation_drivetrain_healthCrit
        },
    )

/** The status badge text — web `drivetrain.health.{band}` (the upper-cased band). */
@Composable
private fun statusBadgeText(status: HealthStatus): String =
    stringResource(
        when (status) {
            HealthStatus.Good -> R.string.translation_drivetrain_health_good
            HealthStatus.Warning -> R.string.translation_drivetrain_health_warning
            HealthStatus.Critical -> R.string.translation_drivetrain_health_critical
        },
    )

/** The alert title — web `criticalTitle` for the critical band, else `warningTitle`. */
@Composable
private fun alertTitle(status: HealthStatus): String =
    stringResource(
        if (status == HealthStatus.Critical) {
            R.string.translation_drivetrain_alert_criticalTitle
        } else {
            R.string.translation_drivetrain_alert_warningTitle
        },
    )

/** The alert body — web `criticalMsg` for the critical band, else `warningMsg`. */
@Composable
private fun alertMessage(status: HealthStatus): String =
    stringResource(
        if (status == HealthStatus.Critical) {
            R.string.translation_drivetrain_alert_criticalMsg
        } else {
            R.string.translation_drivetrain_alert_warningMsg
        },
    )

// ── Previews (tooling-only; @Preview entry points exercise each render branch + the empty-motor edge) ────

private const val PREVIEW_SCORE_GOOD = 95.0
private const val PREVIEW_SCORE_WARNING = 60.0
private const val PREVIEW_SCORE_CRITICAL = 25.0
private const val PREVIEW_MOTOR = "Drive"

@Preview(name = "Good — healthy (no alert)", showBackground = true)
@Composable
private fun HealthOverviewGoodPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthOverviewContent(
            HealthOverviewProjection.project(HealthStatus.Good, PREVIEW_SCORE_GOOD, PREVIEW_MOTOR),
        )
    }
}

@Preview(name = "Warning — running warm", showBackground = true)
@Composable
private fun HealthOverviewWarningPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthOverviewContent(
            HealthOverviewProjection.project(HealthStatus.Warning, PREVIEW_SCORE_WARNING, PREVIEW_MOTOR),
        )
    }
}

@Preview(name = "Critical — overheating", showBackground = true)
@Composable
private fun HealthOverviewCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthOverviewContent(
            HealthOverviewProjection.project(HealthStatus.Critical, PREVIEW_SCORE_CRITICAL, PREVIEW_MOTOR),
        )
    }
}

@Preview(name = "Critical — blank motor status (em dash)", showBackground = true)
@Composable
private fun HealthOverviewBlankMotorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        HealthOverviewContent(
            HealthOverviewProjection.project(HealthStatus.Critical, PREVIEW_SCORE_CRITICAL, ""),
        )
    }
}
