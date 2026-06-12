// The native Jetpack Compose + Material 3 DrivingTips feature view — a parity port of
// web/src/features/driving/components/driving-dynamics/DrivingTips.tsx. The web component fades in a
// `GlassPanel` titled with a yellow Lightbulb icon and "Driving Style Recommendations", then renders an
// ordered list of coaching tips (web `space-y-3`); each tip sits in a faint bordered row (web
// `bg-white/[0.03] border border-white/[0.06]`) led by a glyph chosen from `throttleStyle`
// (`'conservative'` → green ShieldCheck, otherwise yellow AlertTriangle). The tip list itself is derived from
// `motorStats` (its `avgPower` band and `maxMotorTemp`), falling back — when `motorStats` is absent — to a
// single friendly "drive your vehicle to start collecting" row, which is the web's own empty handling and is
// never a blank box.
//
// This surface is purely presentational and prop-driven, so — exactly as the sibling HealthRecommendations
// port reasons — it performs NO HTTP and binds no data hook; loading / error / stale / offline belong to the
// owning Driving Dynamics page, and modelling them here would invent behaviour the spec does not have. What
// the web genuinely varies — the tip list as a function of (`motorStats`, `throttleStyle`) — is reproduced via
// the pure [DrivingTipsProjection] and rendered for every branch. Its two web data sources are
// `useTranslation` (the generated i18n catalog, P1/S10) and the `motorStats` / `throttleStyle` props the page
// threads in (P1/S8 state holders own the upstream query); the one-shot `view.opened` diagnostic (P1/S11) is
// recorded on first composition. The title and every tip resolve through the catalog (`dynamics.*` keys), so
// there is no English UI copy literal in this file. Every derivation flows through the pure model; this
// composable is a thin render layer.
//
// Color parity: the web `text-yellow-400` (lightbulb + alert triangle) maps onto the generated warning token
// and `text-green-400` (shield-check) onto the success token, so the accents stay correct in light / dark /
// high-contrast (the tokens flip per theme). The web `text-lg font-semibold` title renders in the shared
// SectionTitle role and is marked as a heading for TalkBack; the decorative row glyphs expose no screen-reader
// node because the readable tip text already carries the meaning.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingTips — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling HealthRecommendations
// / LiveMotorStatus surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingtips

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
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `<FadeIn delay={0.6}>` — the panel fades in after a 600 ms stagger. */
private const val ENTRY_DELAY_MS: Int = 600

/** Web `bg-white/[0.03]` — the faint neutral tint behind a tip row (theme-safe, applied over `onSurface`). */
private const val ROW_TINT_ALPHA: Float = 0.03f

/** Web `border border-white/[0.06]` — the tip row's hairline border opacity. */
private const val ROW_BORDER_ALPHA: Float = 0.06f

/** Web icon `mt-0.5` — nudges the leading glyph down to align with the first text line. */
private val ICON_TOP_OFFSET = 2.dp

/** Tip-row border thickness. */
private val ROW_BORDER_WIDTH = 1.dp

/**
 * The already-localized strings the surface renders, resolved once from the P1/S10 i18n catalog at the Compose
 * boundary so the rest of the surface holds no English literal. [tips] maps every [DrivingTip] to the text of
 * its `dynamics.*` key.
 */
data class DrivingTipsStrings(
    val title: String,
    val tips: Map<DrivingTip, String>,
)

/**
 * Stateful entry point — the faithful 1:1 port of the web `DrivingTips({ motorStats, throttleStyle })`.
 * Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and renders the panel
 * for the given inputs. The surface binds no data of its own; [motorStats] and [throttleStyle] are computed
 * upstream by the owning Driving Dynamics page and threaded in, exactly as on the web.
 *
 * @param motorStats the consumed slice of the page's `MotorStats`, or `null` when no motor history is cached —
 *   which selects the single friendly no-data tip (the web empty handling).
 * @param throttleStyle the upstream throttle classification, or `null` when unavailable; picks each row's
 *   leading glyph (conservative → shield-check, otherwise alert triangle).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DrivingTips(
    motorStats: MotorStats?,
    throttleStyle: ThrottleStyle?,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { DrivingTipsDiagnostics.recordViewOpened(logger) }
    DrivingTipsContent(motorStats = motorStats, throttleStyle = throttleStyle, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the web layout exactly: a [FadeIn]
 * wrapping a [GlassPanel] (web `p-6`) that holds the Lightbulb header (web `mb-4`) above a [StaggerContainer]
 * of tip rows (web `space-y-3`). The tip list is derived once from [motorStats] via the pure
 * [DrivingTipsProjection], so the same input always renders the same ordered list; [throttleStyle] selects the
 * row glyph. No surface is ever hidden or blank.
 */
@Composable
fun DrivingTipsContent(
    motorStats: MotorStats?,
    throttleStyle: ThrottleStyle?,
    modifier: Modifier = Modifier,
    strings: DrivingTipsStrings = rememberDrivingTipsStrings(),
) {
    val tips = remember(motorStats) { DrivingTipsProjection.tipsFor(motorStats) }
    val conservative = throttleStyle == ThrottleStyle.Conservative
    FadeIn(modifier = modifier, delayMs = ENTRY_DELAY_MS) {
        GlassPanel(modifier = Modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(Spacing.lg),
            ) {
                DrivingTipsHeader(title = strings.title)
                StaggerContainer(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(Spacing.md),
                ) {
                    tips.forEachIndexed { index, tip ->
                        StaggerItem(index = index) {
                            TipRow(text = strings.tips.getValue(tip), conservative = conservative)
                        }
                    }
                }
            }
        }
    }
}

/** The header row — the yellow Lightbulb glyph (web `text-yellow-400` → the warning token) and the title. */
@Composable
private fun DrivingTipsHeader(title: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        Icon(
            imageVector = DrivingTipsGlyphs.Lightbulb,
            contentDescription = null,
            size = IconSize.Lg,
            tint = TeslaTokens.status.warning,
        )
        SectionTitle(title, modifier = Modifier.semantics { heading() })
    }
}

/**
 * One coaching tip — the native port of the web bordered row (`flex items-start gap-3 rounded-lg p-3` with
 * `bg-white/[0.03] border border-white/[0.06]`). The leading glyph follows [conservative] (shield-check tinted
 * with the success token when the style is conservative, else an alert triangle tinted with the warning
 * token), and [text] is the readable advisory body in the muted secondary color (web `text-[var(
 * --text-secondary)]`). The glyph is decorative — the [text] carries the meaning — so it exposes no
 * screen-reader node.
 */
@Composable
private fun TipRow(
    text: String,
    conservative: Boolean,
) {
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.small,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_TINT_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ROW_BORDER_WIDTH, MaterialTheme.colorScheme.onSurface.copy(alpha = ROW_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = if (conservative) DrivingTipsGlyphs.ShieldCheck else DataDisplayGlyphs.AlertTriangle,
                contentDescription = null,
                size = IconSize.Md,
                tint = if (conservative) TeslaTokens.status.success else TeslaTokens.status.warning,
                modifier = Modifier.padding(top = ICON_TOP_OFFSET),
            )
            BodyText(
                text = text,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

/**
 * Resolves the localized [DrivingTipsStrings] from the i18n catalog (P1/S10): the `dynamics.recommendations`
 * title plus the eight `dynamics.tip*` advisory strings. Resolved once at the Compose boundary so the rest of
 * the surface holds no literal.
 */
@Composable
private fun rememberDrivingTipsStrings(): DrivingTipsStrings {
    val title = stringResource(R.string.translation_dynamics_recommendations)
    val noData = stringResource(R.string.translation_dynamics_tipNoData)
    val easeAccel = stringResource(R.string.translation_dynamics_tipEaseAccel)
    val brakeEarly = stringResource(R.string.translation_dynamics_tipBrakeEarly)
    val smoothThrottle = stringResource(R.string.translation_dynamics_tipSmoothThrottle)
    val coast = stringResource(R.string.translation_dynamics_tipCoast)
    val great = stringResource(R.string.translation_dynamics_tipGreat)
    val keep = stringResource(R.string.translation_dynamics_tipKeep)
    val thermal = stringResource(R.string.translation_dynamics_tipThermal)
    return remember(title, noData, easeAccel, brakeEarly, smoothThrottle, coast, great, keep, thermal) {
        DrivingTipsStrings(
            title = title,
            tips =
                mapOf(
                    DrivingTip.NoData to noData,
                    DrivingTip.EaseAccel to easeAccel,
                    DrivingTip.BrakeEarly to brakeEarly,
                    DrivingTip.SmoothThrottle to smoothThrottle,
                    DrivingTip.Coast to coast,
                    DrivingTip.Great to great,
                    DrivingTip.Keep to keep,
                    DrivingTip.Thermal to thermal,
                ),
        )
    }
}

// ── Previews (tooling-only; each @Preview exercises a distinct projection branch) ─────────────────────────

@Preview(name = "Efficient — great/keep tips, conservative shield", showBackground = true)
@Composable
private fun DrivingTipsEfficientPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTipsContent(
            motorStats = MotorStats(avgPower = 12.0, maxMotorTemp = 64.0),
            throttleStyle = ThrottleStyle.Conservative,
        )
    }
}

@Preview(name = "Aggressive — high-power pair + thermal, alert glyph", showBackground = true)
@Composable
private fun DrivingTipsAggressivePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTipsContent(
            motorStats = MotorStats(avgPower = 142.0, maxMotorTemp = 128.0),
            throttleStyle = ThrottleStyle.Aggressive,
        )
    }
}

@Preview(name = "No data — single friendly tip", showBackground = true)
@Composable
private fun DrivingTipsNoDataPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DrivingTipsContent(motorStats = null, throttleStyle = null)
    }
}
