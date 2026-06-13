// The native Jetpack Compose + Material 3 ServiceStatus shared surface — a parity port of
// web/src/components/data-display/ServiceStatus.tsx. The web file is the app's "service status": a full-width
// OFFLINE banner (`ServiceStatusBanner`, shown while the browser reports no network) plus a small colored
// SYSTEM-HEALTH dot (`SystemHealthDot`, reflecting `GET /system/status`'s `overall`).
//
// This surface is the native equivalent. All data flows through the shared [ServiceStatusViewModel] over the
// [ServiceStatusSource] seam (P1/S8) — the view performs NO HTTP and opens no stream directly. Every derivation
// flows through the pure [ServiceStatusProjection]; the composable is a thin render layer. The faithful mapping
// of the web behaviour onto the wired live pipeline (ADR-009, see [ServiceStatusModel] for the rationale):
//   • `getConnectionStatus()/onStatusChange()` (offline) → a down wire ([SystemHealth.Down]) drives the
//     [ServiceStatusOfflineBanner] with the web's "You're offline … retry automatically" copy + a WifiOff icon.
//   • `SystemHealthDot`'s `overall` colour → [systemHealthColor]: green (healthy) / amber (degraded) /
//     red (down) / neutral (unknown), painted as a labelled dot beside the "System Health" title.
//   • the web `title="System: {overall}"` → a single merged TalkBack content description "System Health: {label}".
//
// States reproduced (every one renders a non-blank region — never the web `if (!data) return null` blank):
// loading (cold-start skeleton dot), content (the green/amber/red dot), empty ("No system health data"),
// error/offline (red dot + offline banner with a reconnect affordance), and stale (amber dot + "Stale" chip).
// The one-shot `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/shared-surfaces)
// cannot form a valid Kotlin package. `MatchingDeclarationName` is suppressed for the co-located stateless
// renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.servicestatus

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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.datadisplay.LiveConnectionStatus
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.BannerAction
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.LocalReducedMotion
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.MetricLabel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the whole surface container — used by the instrumented per-state + a11y UI tests. */
const val SERVICE_STATUS_TEST_TAG: String = "service-status"

/** Test tag identifying the offline banner region. */
const val SERVICE_STATUS_BANNER_TAG: String = "service-status-banner"

/** Test tag identifying the system-health panel (the dot + label container). */
const val SERVICE_STATUS_DOT_TAG: String = "service-status-health"

/** The health-dot diameter — the native mirror of the web `h-2 w-2` (8px) dot. */
private val DOT_SIZE = 8.dp

private const val PULSE_MIN_ALPHA = 0.35f
private const val PULSE_DURATION_MS = 900

/**
 * The localized labels the surface folds into its output. Built from `stringResource` at the render boundary
 * (tests pass a deterministic instance), keeping the projection a pure, locale-stable function. Every string
 * resolves through the P1/S10 catalog.
 */
data class ServiceStatusStrings(
    val title: String,
    val healthy: String,
    val degraded: String,
    val down: String,
    val unknown: String,
    val noData: String,
    val stale: String,
    val loading: String,
    val offlineTitle: String,
    val offlineDetail: String,
    val reconnect: String,
)

/**
 * Stateful entry point bound to the app-scoped live pipeline — the faithful port of the web `ServiceStatusBanner`
 * + `SystemHealthDot`. Binds the [ServiceStatusViewModel], records the one-shot `view.opened` diagnostic (P1/S11),
 * collects the live wire-health snapshot, projects it into the render the stateless surface paints, and wires the
 * offline banner's reconnect to the live layer.
 *
 * @param modifier optional layout modifier for the surface container.
 * @param source the live wire-health seam; defaults to the app-scoped live session store ([asServiceStatusSource]).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun ServiceStatus(
    modifier: Modifier = Modifier,
    source: ServiceStatusSource = LocalDataContainer.current.liveSessionStore.asServiceStatusSource(),
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ServiceStatusViewModel =
        viewModel(
            key = ServiceStatusRegistration.ID,
            factory = ServiceStatusViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    val render = remember(snapshot) { ServiceStatusProjection.render(snapshot) }

    FadeIn(modifier = modifier) {
        ServiceStatusContent(
            render = render,
            strings = rememberServiceStatusStrings(),
            onReconnect = viewModel::reconnect,
        )
    }
}

/**
 * Stateless surface — the unit/UI-test and preview entry point. Stacks the full-width offline banner (only while
 * the wire is down, the web `ServiceStatusBanner` visibility) above the always-present system-health panel, so no
 * region is ever hidden. Hoisted out of the ViewModel so it is preview- and screenshot-testable for each state.
 */
@Composable
fun ServiceStatusContent(
    render: ServiceStatusRender,
    strings: ServiceStatusStrings,
    modifier: Modifier = Modifier,
    onReconnect: () -> Unit = {},
) {
    Column(
        modifier = modifier.fillMaxWidth().testTag(SERVICE_STATUS_TEST_TAG),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (render.showOfflineBanner) {
            ServiceStatusOfflineBanner(strings = strings, onReconnect = onReconnect)
        }
        ServiceStatusHealthPanel(render = render, strings = strings)
    }
}

/**
 * The full-width offline banner — the native port of the web `ServiceStatusBanner`. A danger-toned [AlertBanner]
 * with a WifiOff icon, the "You're offline" title, the "we'll retry automatically" detail (the web "Reconnecting
 * automatically…"), and a reconnect affordance forwarding to the live layer.
 */
@Composable
private fun ServiceStatusOfflineBanner(
    strings: ServiceStatusStrings,
    onReconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    AlertBanner(
        message = strings.offlineDetail,
        modifier = modifier.testTag(SERVICE_STATUS_BANNER_TAG),
        tone = Tone.Danger,
        title = strings.offlineTitle,
        icon = DataDisplayGlyphs.WifiOff,
        action = BannerAction(label = strings.reconnect, onClick = onReconnect),
    )
}

/**
 * The system-health panel — the native port of the web `SystemHealthDot`. Renders a tone-colored dot beside the
 * "System Health" title + the resolved health label, an optional "No system health data" caption (the empty
 * surface), and an optional "Stale" chip. The whole panel is one merged accessibility node carrying
 * "System Health: {label}" (the web `title="System: {overall}"`), so it is never a blank or unlabelled box.
 */
@Composable
private fun ServiceStatusHealthPanel(
    render: ServiceStatusRender,
    strings: ServiceStatusStrings,
    modifier: Modifier = Modifier,
) {
    val label = healthLabel(render, strings)
    val spoken = "${strings.title}: $label"
    GlassPanel(
        modifier =
            modifier
                .fillMaxWidth()
                .testTag(SERVICE_STATUS_DOT_TAG)
                .semantics(mergeDescendants = true) { contentDescription = spoken },
        padding = PanelPadding.Md,
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            SystemHealthDot(health = render.health, loading = render.loading)
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                MetricLabel(strings.title)
                BodyText(label)
                if (render.empty) {
                    Caption(strings.noData)
                }
            }
            if (render.showStaleChip) {
                StatusPill(text = strings.stale, tone = StatusTone.Warning)
            }
        }
    }
}

/**
 * The bare health dot — a tone-colored circle (web `SystemHealthDot`). While loading (a cold start that has never
 * connected) the dot is the neutral colour and gently pulses, suppressed under reduced motion (TalkBack "remove
 * animations"). Decorative: the enclosing panel carries the merged content description.
 */
@Composable
private fun SystemHealthDot(
    health: SystemHealth,
    loading: Boolean,
    modifier: Modifier = Modifier,
) {
    val color = systemHealthColor(health)
    val reduceMotion = rememberReducedMotion()
    val alpha =
        if (loading && !reduceMotion) {
            val transition = rememberInfiniteTransition(label = "serviceStatusPulse")
            transition
                .animateFloat(
                    initialValue = PULSE_MIN_ALPHA,
                    targetValue = 1f,
                    animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                    label = "serviceStatusPulseAlpha",
                ).value
        } else {
            1f
        }
    Box(
        modifier =
            modifier
                .size(DOT_SIZE)
                .clip(CircleShape)
                .background(color.copy(alpha = alpha)),
    )
}

/** The dot's tone colour for a [SystemHealth] tier (web `SystemHealthDot` green / amber / red / neutral). */
@Composable
private fun systemHealthColor(health: SystemHealth): Color =
    when (health) {
        SystemHealth.Healthy -> TeslaTokens.status.success
        SystemHealth.Degraded -> TeslaTokens.status.warning
        SystemHealth.Down -> TeslaTokens.status.danger
        SystemHealth.Unknown -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/** The localized health label for the panel; "Loading" while cold-starting, else the [SystemHealth] tier label. */
private fun healthLabel(
    render: ServiceStatusRender,
    strings: ServiceStatusStrings,
): String =
    when {
        render.loading -> strings.loading
        else ->
            when (render.health) {
                SystemHealth.Healthy -> strings.healthy
                SystemHealth.Degraded -> strings.degraded
                SystemHealth.Down -> strings.down
                SystemHealth.Unknown -> strings.unknown
            }
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberServiceStatusStrings(): ServiceStatusStrings =
    ServiceStatusStrings(
        title = stringResource(R.string.translation_widget_systemHealth_title),
        healthy = stringResource(R.string.translation_widget_systemHealth_healthy),
        degraded = stringResource(R.string.translation_widget_systemHealth_degraded),
        down = stringResource(R.string.translation_widget_systemHealth_down),
        unknown = stringResource(R.string.translation_common_unknown),
        noData = stringResource(R.string.translation_widget_systemHealth_noData),
        stale = stringResource(R.string.translation_mqtt_stale),
        loading = stringResource(R.string.translation_a11y_loading),
        offlineTitle = stringResource(R.string.translation_error_network_offlineTitle),
        offlineDetail = stringResource(R.string.translation_error_network_offlineDetail),
        reconnect = stringResource(R.string.translation_error_network_retryWhenOnline),
    )

// ── Previews — one per rendered state (loading / healthy / reconnecting / stale / offline / empty). The strings
// resolve through the P1/S10 catalog (no hardcoded English), and reduced motion keeps the loading pulse from
// holding the preview clock busy. ────────────────────────────────────────────────────────────────────────────

private const val PREVIEW_STAMP = 1_700_000_000_000L

private fun previewRender(
    status: LiveConnectionStatus,
    lastMessageAtMillis: Long? = PREVIEW_STAMP,
    stale: Boolean = false,
): ServiceStatusRender = ServiceStatusProjection.render(ServiceStatusSnapshot(status, lastMessageAtMillis, stale))

@Composable
private fun PreviewSurface(render: ServiceStatusRender) {
    TeslaSyncTheme(dynamicColor = false) {
        CompositionLocalProvider(LocalReducedMotion provides true) {
            ServiceStatusContent(render = render, strings = rememberServiceStatusStrings())
        }
    }
}

@Preview(name = "ServiceStatus · loading", showBackground = true)
@Composable
private fun ServiceStatusLoadingPreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Unknown, lastMessageAtMillis = null))
}

@Preview(name = "ServiceStatus · healthy", showBackground = true)
@Composable
private fun ServiceStatusHealthyPreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Connected))
}

@Preview(name = "ServiceStatus · degraded (reconnecting)", showBackground = true)
@Composable
private fun ServiceStatusReconnectingPreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Reconnecting, lastMessageAtMillis = null))
}

@Preview(name = "ServiceStatus · stale", showBackground = true)
@Composable
private fun ServiceStatusStalePreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Connected, stale = true))
}

@Preview(name = "ServiceStatus · offline (down) + banner", showBackground = true)
@Composable
private fun ServiceStatusOfflinePreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Disconnected, lastMessageAtMillis = null))
}

@Preview(name = "ServiceStatus · empty", showBackground = true)
@Composable
private fun ServiceStatusEmptyPreview() {
    PreviewSurface(previewRender(LiveConnectionStatus.Connected, lastMessageAtMillis = null))
}
