// The native Jetpack Compose + Material 3 MaintenanceBanner shared surface — a parity port of
// web/src/components/feedback/MaintenanceBanner.tsx. The web file is a sticky top-of-app banner that polls
// `/api/v1/system/health` and renders when the resolved service `mode` is `degraded` (sky) or `maintenance`
// (amber): a tone-tinted bar with a leading glyph, a title, the operator message (or a per-mode default), a
// live one-second countdown to `maintenance_until`, and a per-snapshot dismiss control.
//
// This surface is the native equivalent. All data flows through the shared [MaintenanceBannerViewModel] over
// the [MaintenanceBannerSource] seam (P1/S8) — the view performs NO HTTP. Every derivation flows through the
// pure [MaintenanceBannerProjection]; the composable is a thin render layer. Faithful mapping of the web
// behaviour:
//   • `!data || mode === 'ok' ? null` → the banner is absent (the stateless content early-returns). The web's
//     data-envelope states are honoured through the ADR-013 freshness contract: a cold load / hard failure
//     with nothing cached keeps the banner absent, while an active window served stale / last-known keeps it
//     visible with an explicit "Stale" chip rather than presenting stale state as live.
//   • `isMaintenance` → the amber Wrench variant; else the sky AlertTriangle (degraded) variant.
//   • the `countdown` ternary → "Ends in {time}" / "Ending now" / "Window has ended…" under the body.
//   • `handleDismiss` + the dismissal-reset effect → the per-snapshot dismiss, re-surfacing on a new snapshot.
//   • `role={alert|status}` + `aria-live="polite"` → a polite live region on the merged banner node, the
//     dismiss control a separately-labelled, focusable button.
// Every UI string resolves from the P1/S10 catalog (no hardcoded English); the one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/MaintenanceBanner) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.maintenancebanner

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.toneColors
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconBox
import io.teslasync.android.components.ui.IconBoxSize
import io.teslasync.android.components.ui.IconBoxTone
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.iconColorFor
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.admin.AdminStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import java.time.Instant

/** Test tag identifying the whole banner container — used by the instrumented per-state + a11y UI tests. */
const val MAINTENANCE_BANNER_TEST_TAG: String = "maintenance-banner"

/** Test tag identifying the countdown line (web `data-testid="maintenance-banner-countdown"`). */
const val MAINTENANCE_BANNER_COUNTDOWN_TAG: String = "maintenance-banner-countdown"

/** Test tag identifying the dismiss control (web `data-testid="maintenance-banner-dismiss"`). */
const val MAINTENANCE_BANNER_DISMISS_TAG: String = "maintenance-banner-dismiss"

/** The countdown refresh cadence — the native mirror of the web `setInterval(…, 1000)`. */
private const val COUNTDOWN_TICK_MS: Long = 1_000L

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog. The "Ends in {time}" template is resolved inline with its duration arg.
 */
data class MaintenanceBannerStrings(
    val maintenanceTitle: String,
    val degradedTitle: String,
    val defaultMaintenance: String,
    val defaultDegraded: String,
    val endingNow: String,
    val ended: String,
    val dismiss: String,
    val stale: String,
)

/**
 * Stateful entry point bound to the shared `/system/health` feed — the faithful port of the web
 * `MaintenanceBanner`. Binds the [MaintenanceBannerViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11), collects the resolved banner render, drives the once-a-second countdown only while it is on-screen,
 * and wires the dismiss control back to the per-snapshot dismissal.
 *
 * @param source the shared Admin `/system/health` seam (an `AdminStore` adapter in production, a fake in tests).
 * @param modifier optional layout modifier for the banner container.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun MaintenanceBanner(
    source: MaintenanceBannerSource,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: MaintenanceBannerViewModel =
        viewModel(
            key = MaintenanceBannerRegistration.ID,
            factory = MaintenanceBannerViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val render by viewModel.render.collectAsStateWithLifecycle()

    // Tick every second only while a countdown is on-screen; otherwise an idle banner never churns the subtree
    // (the web `setInterval` is mounted only when `mode !== 'ok' && untilMs !== null`).
    val ticking = render.visible && render.countdown != null
    LaunchedEffect(ticking) {
        if (ticking) {
            while (isActive) {
                delay(COUNTDOWN_TICK_MS)
                viewModel.tick()
            }
        }
    }

    MaintenanceBannerContent(
        render = render,
        strings = rememberMaintenanceBannerStrings(),
        modifier = modifier,
        onDismiss = { viewModel.dismiss(render.currentKey) },
    )
}

/**
 * Convenience stateful entry that adapts the shared S8 [adminStore] to the surface's [MaintenanceBannerSource]
 * — the seam a host wires with the store from the app data graph (the same pattern the sibling Admin surfaces
 * use). Delegates to the [source]-based entry above.
 */
@Composable
fun MaintenanceBanner(
    adminStore: AdminStore,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val source = remember(adminStore) { maintenanceBannerSource(adminStore) }
    MaintenanceBanner(source = source, modifier = modifier, logger = logger)
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Renders the tone-tinted banner bar when the
 * [render] is visible, and nothing at all otherwise (web `!data || mode === 'ok' ? null`). Hoisted out of the
 * ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun MaintenanceBannerContent(
    render: MaintenanceBannerRender,
    strings: MaintenanceBannerStrings,
    modifier: Modifier = Modifier,
    onDismiss: () -> Unit = {},
) {
    if (!render.visible) return
    FadeIn(modifier = modifier) {
        MaintenanceBannerBar(render = render, strings = strings, onDismiss = onDismiss)
    }
}

/**
 * The tone-tinted banner bar — the native port of the web banner body. A bordered, tinted [Surface] (amber for
 * maintenance, sky for degraded) carrying a leading glyph in an [IconBox], the title + optional "Stale" chip,
 * the body, the optional countdown line, and a labelled dismiss control. The whole bar is a polite live region
 * (web `aria-live="polite"`); the dismiss button is a separately-labelled, focusable element.
 */
@Composable
private fun MaintenanceBannerBar(
    render: MaintenanceBannerRender,
    strings: MaintenanceBannerStrings,
    onDismiss: () -> Unit,
) {
    val maintenance = render.maintenance
    val tone = if (maintenance) Tone.Warning else Tone.Info
    val colors = toneColors(tone)
    val iconBoxTone = if (maintenance) IconBoxTone.Warning else IconBoxTone.Info
    val glyph: ImageVector = if (maintenance) FeedbackGlyphs.Wrench else TeslaGlyphs.Warning
    val title = if (maintenance) strings.maintenanceTitle else strings.degradedTitle
    val body = render.message ?: if (maintenance) strings.defaultMaintenance else strings.defaultDegraded
    val countdownText = countdownLabel(render.countdown, strings)

    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(MAINTENANCE_BANNER_TEST_TAG)
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(Radius.md),
        color = colors.background,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(Spacing.md),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            IconBox(tone = iconBoxTone, size = IconBoxSize.Sm) {
                Icon(glyph, contentDescription = null, size = IconSize.Sm, tint = iconColorFor(iconBoxTone))
            }
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Subhead(title, modifier = Modifier.weight(1f))
                    if (render.showStaleChip) {
                        StatusPill(text = strings.stale, tone = StatusTone.Warning)
                    }
                }
                BodyText(body, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (countdownText != null) {
                    Caption(countdownText, modifier = Modifier.testTag(MAINTENANCE_BANNER_COUNTDOWN_TAG))
                }
            }
            IconButton(
                imageVector = TeslaGlyphs.Close,
                contentDescription = strings.dismiss,
                onClick = onDismiss,
                modifier = Modifier.testTag(MAINTENANCE_BANNER_DISMISS_TAG),
                size = IconSize.Sm,
                tint = colors.foreground,
            )
        }
    }
}

/**
 * The localized countdown line for the [countdown] branch — "Ends in {time}" (resolved with its duration arg),
 * "Ending now", "Window has ended…", or `null` when there is no parseable end. The duration itself is the pure,
 * locale-stable [Countdown.EndsIn.formatted] from the model.
 */
@Composable
private fun countdownLabel(
    countdown: Countdown?,
    strings: MaintenanceBannerStrings,
): String? =
    when (countdown) {
        is Countdown.EndsIn -> stringResource(R.string.translation_serviceMode_banner_endsIn, countdown.formatted)
        Countdown.EndingNow -> strings.endingNow
        Countdown.Ended -> strings.ended
        null -> null
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberMaintenanceBannerStrings(): MaintenanceBannerStrings =
    MaintenanceBannerStrings(
        maintenanceTitle = stringResource(R.string.translation_serviceMode_banner_maintenanceTitle),
        degradedTitle = stringResource(R.string.translation_serviceMode_banner_degradedTitle),
        defaultMaintenance = stringResource(R.string.translation_serviceMode_banner_defaultMaintenance),
        defaultDegraded = stringResource(R.string.translation_serviceMode_banner_defaultDegraded),
        endingNow = stringResource(R.string.translation_serviceMode_banner_endingNow),
        ended = stringResource(R.string.translation_serviceMode_banner_ended),
        dismiss = stringResource(R.string.translation_common_dismiss),
        stale = stringResource(R.string.translation_mqtt_stale),
    )

// ── Previews — one per rendered variant (maintenance + countdown / degraded default / ending-now / stale /
// ended-with-message). The strings resolve through the P1/S10 catalog (no hardcoded English), and reduced
// motion keeps the FadeIn from holding the preview clock busy. ───────────────────────────────────────────────

private const val PREVIEW_UNTIL = "2025-01-01T12:30:00Z"
private const val PREVIEW_NOW_FUTURE = "2025-01-01T12:00:00Z"
private const val PREVIEW_NOW_ENDING = "2025-01-01T12:30:00Z"
private const val PREVIEW_NOW_ENDED = "2025-01-01T12:31:00Z"
private const val PREVIEW_UPDATED_AT = "2025-01-01T11:00:00Z"

private fun previewRender(
    rawMode: String,
    untilIso: String = "",
    message: String = "",
    nowIso: String = PREVIEW_NOW_FUTURE,
    stale: Boolean = false,
): MaintenanceBannerRender =
    MaintenanceBannerProjection.render(
        snapshot =
            MaintenanceBannerSnapshot(
                rawMode = rawMode,
                message = message,
                untilIso = untilIso,
                updatedAtIso = PREVIEW_UPDATED_AT,
                present = true,
            ),
        nowMs = Instant.parse(nowIso).toEpochMilli(),
        dismissedKey = null,
        stale = stale,
    )

@Composable
private fun PreviewSurface(render: MaintenanceBannerRender) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            MaintenanceBannerContent(render = render, strings = rememberMaintenanceBannerStrings())
        }
    }
}

@Preview(name = "MaintenanceBanner · maintenance + countdown", showBackground = true)
@Composable
private fun MaintenanceBannerMaintenancePreview() {
    PreviewSurface(previewRender(ServiceMode.RAW_MAINTENANCE, untilIso = PREVIEW_UNTIL, nowIso = PREVIEW_NOW_FUTURE))
}

@Preview(name = "MaintenanceBanner · degraded (default copy)", showBackground = true)
@Composable
private fun MaintenanceBannerDegradedPreview() {
    PreviewSurface(previewRender(ServiceMode.RAW_DEGRADED))
}

@Preview(name = "MaintenanceBanner · ending now", showBackground = true)
@Composable
private fun MaintenanceBannerEndingNowPreview() {
    PreviewSurface(previewRender(ServiceMode.RAW_MAINTENANCE, untilIso = PREVIEW_UNTIL, nowIso = PREVIEW_NOW_ENDING))
}

@Preview(name = "MaintenanceBanner · maintenance + stale (offline)", showBackground = true)
@Composable
private fun MaintenanceBannerStalePreview() {
    PreviewSurface(previewRender(ServiceMode.RAW_MAINTENANCE, untilIso = PREVIEW_UNTIL, nowIso = PREVIEW_NOW_FUTURE, stale = true))
}

@Preview(name = "MaintenanceBanner · ended + operator message", showBackground = true)
@Composable
private fun MaintenanceBannerEndedPreview() {
    PreviewSurface(
        previewRender(
            ServiceMode.RAW_MAINTENANCE,
            untilIso = PREVIEW_UNTIL,
            message = "DB upgrade in progress",
            nowIso = PREVIEW_NOW_ENDED,
        ),
    )
}
