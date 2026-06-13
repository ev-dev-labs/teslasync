// The native Jetpack Compose + Material 3 ConnectionSegment shared surface — a parity port of
// web/src/components/layout/status-bar/ConnectionSegment.tsx. The web component is the footer status-bar's
// API-connection-health segment, derived from `useApiHealth` (a 15s poll of the backend root `/healthz`): a
// colored dot + an icon + a short "API" label (+ a latency / offline suffix), wrapped in a deep link to the
// System Status screen, with a tooltip + aria-label. Colour is paired with an icon so the state stays legible
// to users with colour-vision differences.
//
// This surface is the native equivalent. All data flows through the shared [ConnectionSegmentViewModel] over the
// [ConnectionSegmentSource] seam (P1/S8) — the view performs NO HTTP and runs no poll directly. Every derivation
// flows through the pure [ConnectionSegmentProjection]; the composable is a thin render layer. The faithful
// mapping of the web behaviour:
//   • `useApiHealth()` (status + latencyMs) → the injected [source] (the shared `ApiHealthStore` adapter),
//     re-shared by the ViewModel into the [ConnectionSegmentViewModel.snapshot] flow (never HTTP from the view);
//   • the web `cfg[status]` colour + icon + label → [connectionStatusColor] + [statusIcon] + the per-tier state
//     label, one per [ApiHealthStatus] (ok / degraded / offline / unknown);
//   • the web `· {latencyMs}ms` / `· Offline` suffix → the Full variant's localized suffix;
//   • the web `iconOnly` prop → [ConnectionSegmentVariant.IconOnly] (drops the label + suffix);
//   • the web `<Link to="/system-status">` → the host-routed [onNavigate] callback (the `useNavigate` seam), so
//     the surface never touches a NavHostController and stays unit-testable;
//   • the web `<Tooltip>` + `aria-label` → a Material 3 tooltip + a single merged `Role.Button` semantics node
//     carrying the spoken label.
//
// States reproduced (every one renders a non-blank segment): the online pill ("API · 142ms"), degraded, the
// offline error surface ("API · Offline"), the cold-start loading / empty surface ("API · Connecting…"), and an
// aged up-tier shown with a "· Stale" hint (derived from the probe freshness). The one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/ConnectionSegment) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer + previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.connectionsegment

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.apihealth.ApiHealthStatus
import kotlinx.coroutines.delay

/** Test tag identifying the whole segment container — used by the instrumented per-state + a11y UI tests. */
const val CONNECTION_SEGMENT_TEST_TAG: String = "connection-segment"

/** The status dot diameter — the native mirror of the web `h-1.5 w-1.5` (6px) dot. */
private val DOT_SIZE = 6.dp

/** Re-render cadence keeping staleness accurate as the up-tier probe ages while the poll is suspended. */
private const val STALE_TICK_MS = 15_000L

/** The "· " separator the web prepends to the latency / offline / stale suffix (a middle dot, not text). */
private const val SUFFIX_BULLET = "\u00b7 "

/**
 * Stateful entry point bound to the shared API-health poll — the faithful port of the web `ConnectionSegment`
 * reading `useApiHealth`. Binds the [ConnectionSegmentViewModel], records the one-shot `view.opened` diagnostic
 * (P1/S11), collects the API-health snapshot, re-renders on a cadence so staleness stays accurate, projects it
 * into the render the stateless segment paints, and routes the deep-link tap to the host.
 *
 * @param source the API-health seam; bind the app's shared [io.teslasync.shared.core.presentation.apihealth.ApiHealthStore]
 *   with `apiHealthStore.asConnectionSegmentSource()`. Required (no container default) because the shared
 *   poll holder is host-owned — exactly like the sibling `AchievementUnlockedToast` surface.
 * @param modifier optional layout modifier for the segment container (e.g. status-bar alignment).
 * @param variant the visual variant (web `iconOnly`): [ConnectionSegmentVariant.Full] (default) or
 *   [ConnectionSegmentVariant.IconOnly].
 * @param onNavigate the deep-link action run on tap (web `<Link to="/system-status">`); the host wires the
 *   System Status route. Defaults to a no-op so the segment is inert until wired.
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun ConnectionSegment(
    source: ConnectionSegmentSource,
    modifier: Modifier = Modifier,
    variant: ConnectionSegmentVariant = ConnectionSegmentVariant.Full,
    onNavigate: () -> Unit = {},
    logger: Logger = LocalDataContainer.current.logger,
) {
    val viewModel: ConnectionSegmentViewModel =
        viewModel(
            key = ConnectionSegmentRegistration.ID,
            factory = ConnectionSegmentViewModel.factory(source, logger),
        )
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }
    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()

    // Re-render periodically so an up-tier probe that stops refreshing (the poll suspended off-screen) crosses
    // into the stale surface; it only changes on the staleness boundary, so the poll cadence is plenty.
    val nowMs by produceState(initialValue = System.currentTimeMillis(), snapshot.lastCheckedAtMillis) {
        while (true) {
            value = System.currentTimeMillis()
            delay(STALE_TICK_MS)
        }
    }

    val render = remember(snapshot, variant, nowMs) { ConnectionSegmentProjection.render(snapshot, variant, nowMs) }
    ConnectionSegmentContent(render = render, strings = rememberConnectionSegmentStrings(), modifier = modifier, onNavigate = onNavigate)
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Paints the API-health segment from a fully
 * resolved [render]: the tone-colored dot + status icon (web Activity / AlertTriangle / CircleSlash /
 * HelpCircle) and, for the Full variant, the "API" label plus the "· {latency}ms" / "· Offline" / "· Stale"
 * suffix. The whole segment is one tappable `Role.Button` node carrying the spoken aria label (web
 * `aria-label`) and wrapped in a Material 3 tooltip (web `<Tooltip>`); the icon-only variant is the bare dot +
 * icon, also labelled — never blank.
 */
@Composable
fun ConnectionSegmentContent(
    render: ConnectionRender,
    strings: ConnectionSegmentStrings,
    modifier: Modifier = Modifier,
    onNavigate: () -> Unit = {},
) {
    val tooltip = ConnectionSegmentProjection.tooltipText(render, strings)
    val spoken = ConnectionSegmentProjection.spokenLabel(render, strings)
    val color = connectionStatusColor(render.status)

    Tooltip(text = tooltip, modifier = modifier) {
        Row(
            modifier =
                Modifier
                    .testTag(CONNECTION_SEGMENT_TEST_TAG)
                    .clip(RoundedCornerShape(Radius.sm))
                    .clickable(role = Role.Button, onClick = onNavigate)
                    .semantics(mergeDescendants = true) { contentDescription = spoken }
                    .padding(horizontal = Spacing.xs, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Box(modifier = Modifier.size(DOT_SIZE).clip(CircleShape).background(color))
            Icon(imageVector = statusIcon(render.status), contentDescription = null, size = IconSize.Xs, tint = color)
            if (render.variant == ConnectionSegmentVariant.Full) {
                Text(
                    text = strings.short,
                    style = MaterialTheme.typography.labelSmall,
                    color = color,
                    fontWeight = FontWeight.Medium,
                )
                segmentSuffix(render, strings)?.let { suffix ->
                    Text(
                        text = SUFFIX_BULLET + suffix,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * The localized suffix shown after the "API" label in the Full variant: the latency for a fresh up tier (web
 * "· {latencyMs}ms"), the "Stale" hint when that tier's probe has aged, the "Offline" label for a down tier
 * (web "· Offline"), or nothing for the cold-start unknown tier (web shows just the dot + icon + "API").
 */
private fun segmentSuffix(
    render: ConnectionRender,
    strings: ConnectionSegmentStrings,
): String? =
    when {
        render.showLatencySuffix -> ConnectionSegmentProjection.latencyLabel(render.latencyMs)
        render.showStaleSuffix -> strings.stale
        render.showOfflineSuffix -> strings.offline
        else -> null
    }

/** The dot + icon + label tone colour for a tier (web `cfg[status]` emerald / amber / rose / muted). */
@Composable
private fun connectionStatusColor(status: ApiHealthStatus): Color =
    when (status) {
        ApiHealthStatus.OK -> TeslaTokens.status.success
        ApiHealthStatus.DEGRADED -> TeslaTokens.status.warning
        ApiHealthStatus.OFFLINE -> TeslaTokens.status.danger
        ApiHealthStatus.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * The icon for a tier — the native mirror of the web lucide glyphs: an Activity pulse when ok, an AlertTriangle
 * when degraded, a CircleSlash when offline, and a HelpCircle for the cold-start unknown tier. Pairing a
 * distinct glyph with each colour keeps the state legible to users with colour-vision differences (the web
 * file's stated intent).
 */
private fun statusIcon(status: ApiHealthStatus): ImageVector =
    when (status) {
        ApiHealthStatus.OK -> ConnectionSegmentGlyphs.Activity
        ApiHealthStatus.DEGRADED -> DataDisplayGlyphs.AlertTriangle
        ApiHealthStatus.OFFLINE -> ConnectionSegmentGlyphs.CircleSlash
        ApiHealthStatus.UNKNOWN -> TeslaGlyphs.Help
    }

/** Builds the localized labels from the P1/S10 catalog; tests pass a deterministic instance. */
@Composable
private fun rememberConnectionSegmentStrings(): ConnectionSegmentStrings =
    ConnectionSegmentStrings(
        short = stringResource(R.string.translation_statusBar_connection_short),
        online = stringResource(R.string.translation_statusBar_connection_ok),
        degraded = stringResource(R.string.translation_statusBar_connection_degraded),
        offline = stringResource(R.string.translation_statusBar_connection_offline),
        connecting = stringResource(R.string.translation_statusBar_connection_unknown),
        tooltip = stringResource(R.string.translation_statusBar_connection_tooltip),
        aria = stringResource(R.string.translation_statusBar_connection_aria),
        stale = stringResource(R.string.translation_mqtt_stale),
    )

/**
 * The two web lucide glyphs with no native catalog equivalent, authored as 24×24 stroked vectors mirroring the
 * `DataDisplayGlyphs` approach (the catalog already provides `AlertTriangle`; `TeslaGlyphs` provides `Help`).
 * Each is monochrome and recolored at render time by the `Icon` composable's tint.
 */
private object ConnectionSegmentGlyphs {
    /** Lucide `activity` — the latency pulse line shown for the ok tier. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** Lucide `circle-slash` — the "blocked / unreachable" glyph shown for the offline tier. */
    val CircleSlash: ImageVector =
        stroked("CircleSlash") {
            circle(12f, 12f, 9f)
            moveTo(5.6f, 5.6f)
            lineTo(18.4f, 18.4f)
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

    /** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs (the catalog pattern). */
    private fun PathBuilder.circle(
        cx: Float,
        cy: Float,
        r: Float,
    ) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, false, true, cx + r, cy)
        arcTo(r, r, 0f, false, true, cx - r, cy)
        close()
    }
}

// ── Previews — one per rendered state (online + latency / degraded / offline / connecting (loading) / stale /
// icon-only). Strings resolve through the P1/S10 catalog (no hardcoded English). ────────────────────────────

private const val PREVIEW_LATENCY_MS = 142L

private fun previewRender(
    status: ApiHealthStatus,
    latencyMs: Long? = null,
    stale: Boolean = false,
    variant: ConnectionSegmentVariant = ConnectionSegmentVariant.Full,
): ConnectionRender = ConnectionRender(status = status, variant = variant, latencyMs = latencyMs, stale = stale)

@Composable
private fun PreviewSurface(render: ConnectionRender) {
    TeslaSyncTheme(dynamicColor = false) {
        ConnectionSegmentContent(render = render, strings = rememberConnectionSegmentStrings())
    }
}

@Preview(name = "ConnectionSegment · online", showBackground = true)
@Composable
private fun ConnectionSegmentOnlinePreview() {
    PreviewSurface(previewRender(ApiHealthStatus.OK, latencyMs = PREVIEW_LATENCY_MS))
}

@Preview(name = "ConnectionSegment · degraded", showBackground = true)
@Composable
private fun ConnectionSegmentDegradedPreview() {
    PreviewSurface(previewRender(ApiHealthStatus.DEGRADED, latencyMs = 740L))
}

@Preview(name = "ConnectionSegment · offline (error)", showBackground = true)
@Composable
private fun ConnectionSegmentOfflinePreview() {
    PreviewSurface(previewRender(ApiHealthStatus.OFFLINE, latencyMs = 5_000L))
}

@Preview(name = "ConnectionSegment · connecting (loading/empty)", showBackground = true)
@Composable
private fun ConnectionSegmentUnknownPreview() {
    PreviewSurface(previewRender(ApiHealthStatus.UNKNOWN))
}

@Preview(name = "ConnectionSegment · stale", showBackground = true)
@Composable
private fun ConnectionSegmentStalePreview() {
    PreviewSurface(previewRender(ApiHealthStatus.OK, latencyMs = PREVIEW_LATENCY_MS, stale = true))
}

@Preview(name = "ConnectionSegment · icon-only", showBackground = true)
@Composable
private fun ConnectionSegmentIconOnlyPreview() {
    PreviewSurface(previewRender(ApiHealthStatus.OK, latencyMs = PREVIEW_LATENCY_MS, variant = ConnectionSegmentVariant.IconOnly))
}
