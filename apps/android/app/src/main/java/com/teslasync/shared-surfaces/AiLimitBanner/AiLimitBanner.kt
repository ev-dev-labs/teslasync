// The native Jetpack Compose + Material 3 AiLimitBanner shared surface — a parity port of
// web/src/components/ai/AiLimitBanner.tsx and the `@/components/feedback/AlertBanner` it renders. The web
// surface is the user-facing notice shown when the AI rate-limiter or cost-cap rejected a call: a severity-
// tinted alert (info / warning / danger) with a reason-keyed heading + body, a live "try again in Ns"
// countdown, an optional "Use baseline" action, an optional "Retry" action (only once the countdown elapses),
// and an optional dismiss. It is pure presentational — the parent owns the `AiLimitInfo` and the callbacks.
//
// There is no native AlertBanner content-slot (the shared AlertBanner takes a flat message + two fixed action
// slots, which cannot host the web's separate countdown line nor its baseline-then-retry button emphasis), so
// the alert chrome is composed here from the shared atoms (the feedback Tone palette + glyph, Button,
// IconButton, BodyText/Caption) — the same approach the sibling AIDriveCoaching takes for the web card it has
// no 1:1 native atom for. Every visible string resolves through the i18n catalog (P1/S10); the alert carries a
// merged TalkBack announcement and is marked an assertive live region (the web `role="alert"`).
//
// All derivation flows through the pure [classify] / reducers in AiLimitBannerModel.kt; this composable only
// owns the per-second countdown ticker (the web `useState` + `setInterval`) and the one-shot `view.opened`
// diagnostic (P1/S11). It performs NO HTTP.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AiLimitBanner) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.ailimitbanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.feedback.toneGlyph
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.delay

/** Web `border` on the alert — a 1 px hairline tinted to the severity. */
private val ALERT_BORDER_WIDTH: Dp = 1.dp

/** One countdown tick — the web `setInterval(…, 1000)` cadence. */
private const val TICK_INTERVAL_MS: Long = 1_000L

/**
 * Stateful entry point — the faithful port of the web `AiLimitBanner`. Records the one-shot `view.opened`
 * diagnostic, drives the per-second retry countdown (the web `useState` + `setInterval`, reset whenever [info]
 * changes), and renders the alert. Renders nothing while [info] is `null` (web returns `null`). Performs no
 * HTTP; [logger] defaults to the process logger.
 *
 * @param info the structured limit info owned by the parent (web `info` prop); `null` → nothing is rendered.
 * @param onRetry invoked when the user taps "Retry"; when `null` the action is hidden (web `onRetry`).
 * @param onUseBaseline invoked when the user taps "Use baseline"; when `null` (or when the baseline is
 *   unavailable) the action is hidden (web `onUseBaseline`).
 * @param onDismiss invoked when the user dismisses the alert; when `null` no dismiss affordance is shown
 *   (web `onDismiss`).
 */
@Composable
fun AiLimitBanner(
    info: AiLimitInfo?,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onUseBaseline: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AiLimitBannerDiagnostics.recordViewOpened(logger) }

    var secondsLeft by remember(info) { mutableIntStateOf(clampRetrySeconds(info?.retryAfterS ?: 0)) }
    LaunchedEffect(info) {
        var remaining = clampRetrySeconds(info?.retryAfterS ?: 0)
        secondsLeft = remaining
        if (info == null) return@LaunchedEffect
        while (remaining > 0) {
            delay(TICK_INTERVAL_MS)
            remaining = decrementSeconds(remaining)
            secondsLeft = remaining
        }
    }

    AiLimitBannerContent(
        info = info,
        secondsLeft = secondsLeft,
        modifier = modifier,
        onRetry = onRetry,
        onUseBaseline = onUseBaseline,
        onDismiss = onDismiss,
    )
}

/**
 * Stateless renderer for every surface state — the unit/UI-test + preview entry point. Classifies [info] +
 * [secondsLeft] into a [BannerSurface] and renders the alert, or renders nothing when the surface is
 * [BannerSurface.Hidden] (web `info == null` → `null`).
 */
@Composable
fun AiLimitBannerContent(
    info: AiLimitInfo?,
    secondsLeft: Int,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onUseBaseline: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val surface = classify(info, secondsLeft, hasRetry = onRetry != null, hasBaseline = onUseBaseline != null)
    if (surface !is BannerSurface.Active) return
    AiLimitAlert(
        surface = surface,
        modifier = modifier,
        onRetry = onRetry,
        onUseBaseline = onUseBaseline,
        onDismiss = onDismiss,
    )
}

/** The web AlertBanner chrome: a severity-tinted, bordered surface with the icon, copy, actions, and dismiss. */
@Composable
private fun AiLimitAlert(
    surface: BannerSurface.Active,
    modifier: Modifier = Modifier,
    onRetry: (() -> Unit)? = null,
    onUseBaseline: (() -> Unit)? = null,
    onDismiss: (() -> Unit)? = null,
) {
    val tone = toneFor(surface.severity)
    val colors = toneColors(tone)
    val title = titleFor(surface.reason)
    val description = descriptionFor(surface.reason)
    val countdown =
        if (surface.actions.showCountdown) {
            stringResource(R.string.translation_ai_limit_retryIn, surface.secondsLeft)
        } else {
            null
        }
    val announcement = bannerAccessibilityLabel(title, description, countdown)

    Surface(
        modifier =
            modifier
                .fillMaxWidth()
                .semantics {
                    liveRegion = LiveRegionMode.Assertive
                    contentDescription = announcement
                },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ALERT_BORDER_WIDTH, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(toneGlyph(tone), contentDescription = null, size = IconSize.Md, tint = colors.foreground)
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Text(title, style = MaterialTheme.typography.titleSmall, color = colors.foreground)
                BodyText(description)
                if (countdown != null) {
                    Caption(countdown)
                }
                AlertActions(
                    actions = surface.actions,
                    onRetry = onRetry,
                    onUseBaseline = onUseBaseline,
                )
            }
            if (onDismiss != null) {
                IconButton(
                    TeslaGlyphs.Close,
                    contentDescription = stringResource(R.string.translation_a11y_dismissNotification),
                    onClick = onDismiss,
                    size = IconSize.Sm,
                    tint = colors.foreground,
                )
            }
        }
    }
}

/**
 * The action row: "Use baseline" (ghost) then "Retry" (primary), each shown only when its precondition holds
 * (web `onUseBaseline && baselineAvailable` / `onRetry && retryReady`). Renders nothing when neither applies.
 */
@Composable
private fun AlertActions(
    actions: BannerActions,
    onRetry: (() -> Unit)?,
    onUseBaseline: (() -> Unit)?,
) {
    if (!actions.showBaseline && !actions.showRetry) return
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (actions.showBaseline && onUseBaseline != null) {
            Button(
                label = stringResource(R.string.translation_ai_limit_useBaseline),
                onClick = onUseBaseline,
                variant = ButtonVariant.Ghost,
                size = ButtonSize.Sm,
            )
        }
        if (actions.showRetry && onRetry != null) {
            Button(
                label = stringResource(R.string.translation_ai_limit_retry),
                onClick = onRetry,
                variant = ButtonVariant.Primary,
                size = ButtonSize.Sm,
            )
        }
    }
}

/** Map the model [BannerSeverity] to the feedback [Tone] palette (web `variant` → AlertBanner tint). */
private fun toneFor(severity: BannerSeverity): Tone =
    when (severity) {
        BannerSeverity.Info -> Tone.Info
        BannerSeverity.Warning -> Tone.Warning
        BannerSeverity.Danger -> Tone.Danger
    }

/** Resolve the localized heading for a [LimitReasonCopy] bucket (web `titleForReason`). */
@Composable
private fun titleFor(reason: LimitReasonCopy): String =
    stringResource(
        when (reason) {
            LimitReasonCopy.CostCap -> R.string.translation_ai_limit_title_costCap
            LimitReasonCopy.CostCapUnavailable -> R.string.translation_ai_limit_title_costCapUnavailable
            LimitReasonCopy.SettingsUnavailable -> R.string.translation_ai_limit_title_settingsUnavailable
            LimitReasonCopy.Burst -> R.string.translation_ai_limit_title_burst
            LimitReasonCopy.PerMinute -> R.string.translation_ai_limit_title_perMinute
            LimitReasonCopy.PerDay -> R.string.translation_ai_limit_title_perDay
            LimitReasonCopy.Tokens -> R.string.translation_ai_limit_title_tokens
            LimitReasonCopy.ProviderUnavailable -> R.string.translation_ai_limit_title_providerUnavailable
            LimitReasonCopy.FeatureMisconfigured -> R.string.translation_ai_limit_title_featureMisconfigured
            LimitReasonCopy.Generic -> R.string.translation_ai_limit_title_generic
        },
    )

/** Resolve the localized body for a [LimitReasonCopy] bucket (web `descriptionForReason`). */
@Composable
private fun descriptionFor(reason: LimitReasonCopy): String =
    stringResource(
        when (reason) {
            LimitReasonCopy.CostCap -> R.string.translation_ai_limit_desc_costCap
            LimitReasonCopy.CostCapUnavailable -> R.string.translation_ai_limit_desc_costCapUnavailable
            LimitReasonCopy.SettingsUnavailable -> R.string.translation_ai_limit_desc_settingsUnavailable
            LimitReasonCopy.Burst -> R.string.translation_ai_limit_desc_burst
            LimitReasonCopy.PerMinute -> R.string.translation_ai_limit_desc_perMinute
            LimitReasonCopy.PerDay -> R.string.translation_ai_limit_desc_perDay
            LimitReasonCopy.Tokens -> R.string.translation_ai_limit_desc_tokens
            LimitReasonCopy.ProviderUnavailable -> R.string.translation_ai_limit_desc_providerUnavailable
            LimitReasonCopy.FeatureMisconfigured -> R.string.translation_ai_limit_desc_featureMisconfigured
            LimitReasonCopy.Generic -> R.string.translation_ai_limit_desc_generic
        },
    )

// ── Previews (tooling-only) ─────────────────────────────────────────────────────────────────────────────
// Each renders a representative surface: a critical cost-cap with both actions, a warning mid-countdown (Retry
// suppressed), and an informational generic fallback.

@Preview(name = "Critical — cost cap, retry ready", showBackground = true)
@Composable
private fun AiLimitBannerCriticalPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiLimitBannerContent(
            info = AiLimitInfo("cost_cap", retryAfterS = 0, bannerLevel = BannerLevel.Critical, baselineAvailable = true),
            secondsLeft = 0,
            onRetry = {},
            onUseBaseline = {},
            onDismiss = {},
        )
    }
}

@Preview(name = "Warning — per-minute, counting down", showBackground = true)
@Composable
private fun AiLimitBannerCountingDownPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiLimitBannerContent(
            info = AiLimitInfo("per_minute", retryAfterS = 30, bannerLevel = BannerLevel.Warn, baselineAvailable = true),
            secondsLeft = 30,
            onRetry = {},
            onUseBaseline = {},
        )
    }
}

@Preview(name = "Info — generic fallback", showBackground = true)
@Composable
private fun AiLimitBannerGenericPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AiLimitBannerContent(
            info = AiLimitInfo("something_new", retryAfterS = 0, bannerLevel = BannerLevel.None, baselineAvailable = false),
            secondsLeft = 0,
            onRetry = {},
        )
    }
}
