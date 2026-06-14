// The native Jetpack Compose + Material 3 CarAnimation shared surface — a parity port of the web brand-motion
// illustrations file web/src/components/motion/CarAnimation.tsx. The web file exports four illustrations:
// CarAnimation (a Tesla silhouette that draws + scales in, then holds), ChargingBolt (a charging bolt that
// fades + pulses in), WheelSpin (a continuous wheel loader) and BatteryFillAnimation (a battery gauge whose
// fill animates to a level and is colored by it). Each honors `prefers-reduced-motion` via useMotionPreference()
// — under reduced motion every illustration renders its final frame with no entry, draw-in or loop. This port
// reproduces that composition, animation and the surface's genuine states in native primitives; the actual
// Canvas drawing + reduced-motion plumbing live in the tested motion atom (ADR-005,
// io.teslasync.android.components.motion.CarAnimation), and this surface composes that atom so the surface and
// the atom can never drift on what an illustration looks like.
//
// What a shared surface owes over the bare atom (and what this file adds): it binds the three i18n labels the
// web file reads (useTranslation → carAnimation.tesla / .charging / .loading) through the P1/S10 string catalog
// rather than hard-coding English, and it emits the one-shot PII-safe `view.opened` diagnostic (P1/S11)
// carrying only the surface slug on first composition. It performs NO HTTP (web parity — the size + level are
// parameters), reads only the always-available motion preference over the shared motion layer (P1/S8, the
// native useMotionPreference), and never invents the generic loading / empty / error / stale / offline states
// the web source does not have (honesty covenant: no scope narrowing — the rationale + the real reproduced
// states are documented in CarAnimationModel.kt). The battery's fill fraction + good/warn/bad color band is the
// one genuine data-driven branch; it is projected by the pure [batteryFillPlan] (mirroring the atom's internal
// banding) so it is asserted off-device.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/CarAnimation) cannot form a valid Kotlin package;
// `MatchingDeclarationName` is suppressed for the four co-located illustration entry points + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.caranimation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.R
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.android.components.motion.BatteryFillAnimation as MotionBatteryFillAnimation
import io.teslasync.android.components.motion.CarAnimation as MotionCarAnimation
import io.teslasync.android.components.motion.ChargingBolt as MotionChargingBolt
import io.teslasync.android.components.motion.WheelSpin as MotionWheelSpin

private const val DEFAULT_CAR_SIZE_DP = 120
private const val DEFAULT_BOLT_SIZE_DP = 32
private const val DEFAULT_WHEEL_SIZE_DP = 24
private const val DEFAULT_BATTERY_SIZE_DP = 48

/**
 * Animated Tesla silhouette for hero / loading sections — the faithful port of the web `CarAnimation`. Records
 * the one-shot `view.opened` diagnostic (P1/S11) on first composition, then composes the tested motion atom,
 * which draws the silhouette and fades + scales it in once (its final frame immediately under reduced motion).
 * The accessible name is the localized `carAnimation.tesla` label (web `aria-label`).
 *
 * @param modifier optional layout modifier for the illustration.
 * @param sizeDp the illustration width in dp (web `size`); the height is 40% of it, as in the web aspect.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun CarAnimation(
    modifier: Modifier = Modifier,
    sizeDp: Int = DEFAULT_CAR_SIZE_DP,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CarAnimationDiagnostics.recordViewOpened(logger) }
    MotionCarAnimation(
        modifier = modifier,
        sizeDp = sizeDp,
        contentDescription = stringResource(R.string.translation_carAnimation_tesla),
    )
}

/**
 * Charging-bolt accent for charging-related surfaces — the faithful port of the web `ChargingBolt`. Records the
 * one-shot `view.opened` diagnostic on first composition, then composes the motion atom, which fades + scales
 * the bolt in once (its final frame immediately under reduced motion). The accessible name is the localized
 * `carAnimation.charging` label.
 *
 * @param modifier optional layout modifier for the illustration.
 * @param sizeDp the bolt edge in dp (web `size`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun ChargingBolt(
    modifier: Modifier = Modifier,
    sizeDp: Int = DEFAULT_BOLT_SIZE_DP,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CarAnimationDiagnostics.recordViewOpened(logger) }
    MotionChargingBolt(
        modifier = modifier,
        sizeDp = sizeDp,
        contentDescription = stringResource(R.string.translation_carAnimation_charging),
    )
}

/**
 * Continuous wheel loader for drive-related loading states — the faithful port of the web `WheelSpin`. Records
 * the one-shot `view.opened` diagnostic on first composition, then composes the motion atom, which spins the
 * wheel while shown (a static wheel under reduced motion, like Material's progress indicator). The accessible
 * name is the localized `carAnimation.loading` label.
 *
 * @param modifier optional layout modifier for the illustration.
 * @param sizeDp the wheel edge in dp (web `size`).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun WheelSpin(
    modifier: Modifier = Modifier,
    sizeDp: Int = DEFAULT_WHEEL_SIZE_DP,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CarAnimationDiagnostics.recordViewOpened(logger) }
    MotionWheelSpin(
        modifier = modifier,
        sizeDp = sizeDp,
        contentDescription = stringResource(R.string.translation_carAnimation_loading),
    )
}

/**
 * Battery gauge whose fill animates to [levelPercent] once and is colored by the band [batteryFillPlan] resolves
 * (good / warn / bad) — the faithful port of the web `BatteryFillAnimation`. Records the one-shot `view.opened`
 * diagnostic on first composition, then composes the motion atom (its final frame immediately under reduced
 * motion).
 *
 * The web gauge is purely decorative (it carries no `aria-label`), so by default the illustration is hidden from
 * TalkBack to mirror that exactly; pass a non-null [contentDescription] (e.g. the level read aloud) to announce
 * it. Callers that need the resolved band/fill — to label or color surrounding chrome — read [batteryFillPlan].
 *
 * @param levelPercent the charge level 0..100 (clamped); also picks the fill color band.
 * @param modifier optional layout modifier for the illustration.
 * @param sizeDp the gauge width in dp (web `size`); the height is half of it.
 * @param contentDescription the accessible name; `null` (web parity) leaves the gauge decorative.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun BatteryFillAnimation(
    levelPercent: Int,
    modifier: Modifier = Modifier,
    sizeDp: Int = DEFAULT_BATTERY_SIZE_DP,
    contentDescription: String? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { CarAnimationDiagnostics.recordViewOpened(logger) }
    if (contentDescription == null) {
        MotionBatteryFillAnimation(
            levelPercent = levelPercent,
            modifier = modifier.clearAndSetSemantics {},
            sizeDp = sizeDp,
        )
    } else {
        MotionBatteryFillAnimation(
            levelPercent = levelPercent,
            modifier = modifier,
            sizeDp = sizeDp,
            contentDescription = contentDescription,
        )
    }
}

// ── Previews (tooling-only; each @Preview exercises a render branch the web source plays) ──────────────────

private const val PREVIEW_CAR_SIZE_DP = 96
private const val PREVIEW_WHEEL_SIZE_DP = 28
private const val PREVIEW_BATTERY_GOOD = 82
private const val PREVIEW_BATTERY_WARN = 45
private const val PREVIEW_BATTERY_BAD = 12

/** A no-op logger so previews render without the app's [LocalDataContainer] (tooling has no data container). */
private val PreviewLogger =
    object : Logger {
        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) = Unit
    }

@Preview(name = "CarAnimation · animated illustrations", showBackground = true)
@Composable
private fun CarAnimationAnimatedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides false) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
                CarAnimation(logger = PreviewLogger)
                Row(
                    horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    WheelSpin(logger = PreviewLogger)
                    ChargingBolt(logger = PreviewLogger)
                    BatteryFillAnimation(levelPercent = PREVIEW_BATTERY_GOOD, logger = PreviewLogger)
                }
            }
        }
    }
}

@Preview(name = "CarAnimation · reduced motion (final frame)", showBackground = true)
@Composable
private fun CarAnimationReducedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.md),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                CarAnimation(sizeDp = PREVIEW_CAR_SIZE_DP, logger = PreviewLogger)
                WheelSpin(sizeDp = PREVIEW_WHEEL_SIZE_DP, logger = PreviewLogger)
            }
        }
    }
}

@Preview(name = "CarAnimation · battery fill buckets (good / warn / bad)", showBackground = true)
@Composable
private fun CarAnimationBatteryBucketsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BatteryFillAnimation(levelPercent = PREVIEW_BATTERY_GOOD, logger = PreviewLogger)
            BatteryFillAnimation(levelPercent = PREVIEW_BATTERY_WARN, logger = PreviewLogger)
            BatteryFillAnimation(levelPercent = PREVIEW_BATTERY_BAD, logger = PreviewLogger)
        }
    }
}
