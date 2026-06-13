// The native Jetpack Compose + Material 3 ReloadPrompt shared surface — a parity port of
// web/src/components/feedback/ReloadPrompt.tsx. The web component shows a non-intrusive banner when a new
// build is deployed: a spinning refresh icon, a "New version available" heading, a "Reloading in {{seconds}}s"
// countdown that auto-reloads after three seconds, a "Later" dismiss, and a "Reload Now" action — and renders
// nothing while the running build is current. This native surface keeps that contract end to end and renders
// every state the prompt's matrix mandates without ever hiding a region: loading (the first availability
// check), Available (the banner), an explicit "up to date" empty state (the web's `return null`), a classified
// error with Retry, and a stale/offline freshness chip over a last-known check.
//
// It performs NO HTTP and binds the update-availability signal only through the shared [ReloadPromptSource]
// seam folded through [ReloadPromptViewModel] + the pure [ReloadPromptProjection]; the composable resolves the
// i18n labels (P1/S10) and design tokens (P1/S9) and draws what the projection returns, using the shared
// component library (ui GlassPanel/Button/StatusPill/typography, feedback EmptyState/QueryError/Skeleton,
// motion FadeIn). The one-shot PII-safe `view.opened` diagnostic (P1/S11) is emitted on first composition, and
// the host fulfils the reload via the [onReload] callback (web `updateServiceWorker(true)`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ReloadPrompt) cannot form a valid Kotlin package. `MatchingDeclarationName`
// is suppressed for the co-located stateless content + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.reloadprompt

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.QueryError
import io.teslasync.android.components.feedback.Skeleton
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/** Test tag on the surface root so on-device UI tests can locate the rendered prompt in any state. */
const val RELOAD_PROMPT_TEST_TAG: String = "reload-prompt"

/**
 * Stateful entry point — the parity port of the web `<ReloadPrompt />`. Binds the update-availability feed via
 * [viewModel], records the one-shot `view.opened` diagnostic (P1/S11) on first composition, forwards each
 * one-shot [ReloadRequest] to the host's [onReload] (web `updateServiceWorker(true)`), auto-refreshes a stale
 * check, collects the folded [ReloadPromptDisplay], and renders.
 *
 * @param viewModel the state holder bound to the shared [ReloadPromptSource] update-availability seam.
 * @param onReload invoked when the host should activate the newest build and restart (manual tap or auto-expiry).
 */
@Composable
fun ReloadPrompt(
    viewModel: ReloadPromptViewModel,
    modifier: Modifier = Modifier,
    onReload: () -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    LaunchedEffect(viewModel, onReload) {
        viewModel.reloadRequests.collect { onReload() }
    }
    val strings = rememberReloadPromptStrings()
    val display by viewModel.state.collectAsStateWithLifecycle()

    // Stale TTL → auto-refresh (prompt's stale-state contract). Keyed on the freshness stamp so it fires at
    // most once per distinct cached value, never in a loop.
    LaunchedEffect(display.stale, display.freshnessStamp) {
        if (display.stale) viewModel.refresh()
    }

    FadeIn(modifier = modifier) {
        ReloadPromptContent(
            display = display,
            strings = strings,
            onLater = viewModel::dismiss,
            onReloadNow = viewModel::reloadNow,
            onRetry = viewModel::retry,
        )
    }
}

/**
 * Stateless ReloadPrompt card — renders every branch the web source draws plus the availability signal's
 * lifecycle: the loading skeleton, the Available banner (icon + heading + countdown + actions), the explicit
 * "up to date" empty state, and the classified error with retry, with a stale/offline freshness chip over a
 * last-known check. The whole panel is a polite live region (web `aria-live="polite"`). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun ReloadPromptContent(
    display: ReloadPromptDisplay,
    strings: ReloadPromptStrings,
    modifier: Modifier = Modifier,
    onLater: () -> Unit = {},
    onReloadNow: () -> Unit = {},
    onRetry: () -> Unit = {},
) {
    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(RELOAD_PROMPT_TEST_TAG)
                .semantics { liveRegion = LiveRegionMode.Polite },
        padding = PanelPadding.Md,
        accent = PanelAccent.Info,
    ) {
        when (display.phase) {
            ReloadPromptPhase.Loading -> ReloadPromptLoading(strings = strings)
            ReloadPromptPhase.Available ->
                ReloadPromptBanner(display = display, strings = strings, onLater = onLater, onReloadNow = onReloadNow)
            ReloadPromptPhase.UpToDate -> ReloadPromptUpToDate(strings = strings)
            ReloadPromptPhase.Error ->
                QueryError(
                    kind = ReloadPromptProjection.queryErrorKind(display),
                    resourceName = strings.title,
                    onRetry = onRetry,
                )
        }
        if (display.showFreshnessChip) {
            ReloadPromptFreshnessChip(display = display, strings = strings)
        }
    }
}

@Composable
private fun ReloadPromptBanner(
    display: ReloadPromptDisplay,
    strings: ReloadPromptStrings,
    onLater: () -> Unit,
    onReloadNow: () -> Unit,
) {
    val countdownText = stringResource(R.string.translation_pwa_reloadingIn, display.countdownSeconds.toString())
    val spoken = ReloadPromptProjection.contentDescription(display, strings, countdownText)
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ReloadIconBadge()
        Column(
            modifier =
                Modifier
                    .weight(1f, fill = false)
                    .clearAndSetSemantics { contentDescription = spoken },
            verticalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            PanelTitle(strings.title)
            if (display.showCountdown) {
                Caption(countdownText)
            }
        }
        ReloadPromptActions(display = display, strings = strings, onLater = onLater, onReloadNow = onReloadNow)
    }
}

@Composable
private fun ReloadPromptActions(
    display: ReloadPromptDisplay,
    strings: ReloadPromptStrings,
    onLater: () -> Unit,
    onReloadNow: () -> Unit,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (display.showLater) {
            Button(strings.later, onClick = onLater, variant = ButtonVariant.Ghost, size = ButtonSize.Sm)
        }
        Button(strings.reloadNow, onClick = onReloadNow, variant = ButtonVariant.Primary, size = ButtonSize.Sm)
    }
}

/**
 * The web `bg-neon-cyan/10` rounded box with the spinning `RefreshCw` icon. The spin honors reduced motion:
 * when motion is reduced the target angle is zero so the icon sits still (no infinite animation).
 */
@Composable
private fun ReloadIconBadge() {
    val reduce = rememberReducedMotion()
    val rotation = if (reduce) 0f else reloadSpinRotation()
    Box(
        modifier =
            Modifier
                .clip(MaterialTheme.shapes.medium)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = ICON_BADGE_ALPHA))
                .padding(Spacing.xs),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            FeedbackGlyphs.Refresh,
            contentDescription = null,
            size = IconSize.Lg,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.graphicsLayer { rotationZ = rotation },
        )
    }
}

/** The continuously-rotating angle for the refresh glyph; only composed when motion is not reduced. */
@Composable
private fun reloadSpinRotation(): Float {
    val transition = rememberInfiniteTransition(label = "reload-spin")
    val rotation by transition.animateFloat(
        initialValue = 0f,
        targetValue = FULL_TURN_DEGREES,
        animationSpec = infiniteRepeatable(tween(SPIN_DURATION_MS, easing = LinearEasing), RepeatMode.Restart),
        label = "reload-spin-degrees",
    )
    return rotation
}

@Composable
private fun ReloadPromptUpToDate(strings: ReloadPromptStrings) {
    EmptyState(
        message = strings.upToDate,
        icon = TeslaGlyphs.Check,
        title = strings.upToDate,
    )
}

@Composable
private fun ReloadPromptLoading(strings: ReloadPromptStrings) {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .clearAndSetSemantics { contentDescription = strings.loadingLabel },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Skeleton(widthFraction = TITLE_SKELETON_FRACTION, height = TITLE_SKELETON_HEIGHT)
        Skeleton(widthFraction = SUBTITLE_SKELETON_FRACTION, height = SUBTITLE_SKELETON_HEIGHT)
    }
}

@Composable
private fun ReloadPromptFreshnessChip(
    display: ReloadPromptDisplay,
    strings: ReloadPromptStrings,
) {
    Row(modifier = Modifier.padding(top = Spacing.sm)) {
        if (display.offline) {
            StatusPill(text = strings.offlineLabel, tone = StatusTone.Danger)
        } else {
            StatusPill(text = strings.staleLabel, tone = StatusTone.Warning)
        }
    }
}

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberReloadPromptStrings(): ReloadPromptStrings =
    ReloadPromptStrings(
        title = stringResource(R.string.translation_pwa_newVersion),
        later = stringResource(R.string.translation_pwa_later),
        reloadNow = stringResource(R.string.translation_pwa_reloadNow),
        upToDate = stringResource(R.string.translation_widget_upToDate),
        loadingLabel = stringResource(R.string.translation_a11y_loading),
        staleLabel = stringResource(R.string.translation_mqtt_stale),
        offlineLabel = stringResource(R.string.translation_common_offline),
    )

private const val FULL_TURN_DEGREES = 360f
private const val SPIN_DURATION_MS = 1_000
private const val ICON_BADGE_ALPHA = 0.12f
private const val TITLE_SKELETON_FRACTION = 0.55f
private const val SUBTITLE_SKELETON_FRACTION = 0.4f
private val TITLE_SKELETON_HEIGHT = 14.dp
private val SUBTITLE_SKELETON_HEIGHT = 10.dp

// ── Previews — one per rendered state (loading / available / available dismissed / up-to-date / stale /
// offline / error). ─────────────────────────────────────────────────────────────────────────────────────

private fun previewReloadPromptStrings(): ReloadPromptStrings =
    ReloadPromptStrings(
        title = "New version available",
        later = "Later",
        reloadNow = "Reload Now",
        upToDate = "Up to date",
        loadingLabel = "Loading",
        staleLabel = "Stale",
        offlineLabel = "Offline",
    )

@Preview(name = "ReloadPrompt · loading", showBackground = true)
@Composable
private fun ReloadPromptLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display = ReloadPromptDisplay(phase = ReloadPromptPhase.Loading),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · available", showBackground = true)
@Composable
private fun ReloadPromptAvailablePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display =
                ReloadPromptDisplay(
                    phase = ReloadPromptPhase.Available,
                    version = "0.2.0",
                    countdownSeconds = 3,
                    autoReloadArmed = true,
                ),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · available (dismissed)", showBackground = true)
@Composable
private fun ReloadPromptDismissedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display =
                ReloadPromptDisplay(
                    phase = ReloadPromptPhase.Available,
                    version = "0.2.0",
                    autoReloadArmed = false,
                    dismissed = true,
                ),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · up to date", showBackground = true)
@Composable
private fun ReloadPromptUpToDatePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display = ReloadPromptDisplay(phase = ReloadPromptPhase.UpToDate),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · stale", showBackground = true)
@Composable
private fun ReloadPromptStalePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display =
                ReloadPromptDisplay(
                    phase = ReloadPromptPhase.Available,
                    version = "0.2.0",
                    autoReloadArmed = true,
                    stale = true,
                    refreshing = true,
                ),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · offline", showBackground = true)
@Composable
private fun ReloadPromptOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display =
                ReloadPromptDisplay(
                    phase = ReloadPromptPhase.UpToDate,
                    offline = true,
                    errorKind = ErrorKind.Network,
                ),
            strings = previewReloadPromptStrings(),
        )
    }
}

@Preview(name = "ReloadPrompt · error", showBackground = true)
@Composable
private fun ReloadPromptErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        ReloadPromptContent(
            display =
                ReloadPromptDisplay(
                    phase = ReloadPromptPhase.Error,
                    errorKind = ErrorKind.Http,
                    httpStatus = HTTP_SERVER_ERROR,
                ),
            strings = previewReloadPromptStrings(),
        )
    }
}

private const val HTTP_SERVER_ERROR = 503
