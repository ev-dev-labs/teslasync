// The native Jetpack Compose + Material 3 AIBatteryHealthForecastNarrative shared surface — a parity port of
// web/src/components/ai/AIBatteryHealthForecastNarrative.tsx and the AIFeatureCard / AiOutputPanel scaffold it
// composes. The web surface is the optional Helix narrator above the Battery Health page's hero metrics: a
// GlassPanel with a cyan Helix badge, a localized title + privacy-grounded description, a Narrate button that
// POSTs to /ai/battery/health/narrate and streams the explanation, and an output panel that shows a thinking
// affordance, the streamed prose, or an error. It never replaces the deterministic charts — it only narrates
// the same numbers. This port reproduces that data, composition, states, and i18n in native primitives — no
// ported Tailwind classes; platform tokens from P1/S9.
//
// All pure derivation (the surface-state classifier, the button-enabled rule, the active-vehicle gate, the
// shared-lifecycle connectivity fold, the accessibility announcement, and the `view.opened` diagnostic) lives
// in AIBatteryHealthForecastNarrativeModel.kt and is unit-tested off-device, so this file stays a thin render
// layer: it resolves the i18n strings (P1/S10), the design-token accent (P1/S9), binds the host-supplied stream
// snapshot (P1/S8 — no HTTP from the view), and lays out the surface.
//
// The web cyan AI badge (border-cyan-300/30, bg-cyan-300/10, icon cyan-300) maps onto the theme-invariant brand
// accent `TeslaTokens.status.info`, tinted with the same border/background alphas so light/dark/high-contrast
// stay consistent. The lucide HelixMark, absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs]
// catalog, is authored locally as a stroked vector — exactly as the sibling AIRestorePanel authors its Sparkles.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIBatteryHealthForecastNarrative) cannot form a valid Kotlin package;
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aibatteryhealthforecastnarrative

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `bg-cyan-300/10` badge background tint, applied to the brand info accent. */
private const val BADGE_BG_ALPHA: Float = 0.10f

/** Web `border-cyan-300/30` badge border tint, applied to the brand info accent. */
private const val BADGE_BORDER_ALPHA: Float = 0.30f

/** The web 1px badge border. */
private val BADGE_BORDER_WIDTH: Dp = 1.dp

/** Web `bg-white/[0.02]` output-panel tint, applied to the surface-variant container. */
private const val OUTPUT_BG_ALPHA: Float = 0.30f

/** The web 1px output-panel border (`border border-[var(--border-subtle)]`). */
private val OUTPUT_BORDER_WIDTH: Dp = 1.dp

/**
 * Stateful entry point — the faithful port of the web `InnerSection({ vehicleId })` wrapped by `withAiFeature`.
 * Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11) and delegates to the
 * stateless renderer. The surface performs no HTTP: the host Battery-Health screen owns the `useAiStream`
 * analogue (a P1/S8 state holder that POSTs the SSE) and hands in the [stream] snapshot plus the [onNarrate]
 * start action, exactly as the sibling AIRestorePanel is handed its `archived` snapshot + callbacks.
 *
 * @param vehicleId the active vehicle id surfaced by the host (web `vehicleId` prop); the Narrate button stays
 *   disabled until it resolves to a positive id, mirroring the handler-side `vehicle_id > 0` validation.
 * @param stream the host stream snapshot (web `useAiStream` result: state / text / error).
 * @param onNarrate invoked when Narrate is tapped (web `stream.start`) — the host opens the SSE.
 * @param online whether connectivity is available (host-reported); gates the Narrate action and the offline
 *   surface. Defaults to `true`; a host deriving it from a shared store passes [onlineFromLifecycle].
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AIBatteryHealthForecastNarrative(
    vehicleId: Long?,
    stream: AiNarrativeStreamState,
    onNarrate: () -> Unit,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAIBatteryHealthForecastNarrativeOpened(logger) }
    AIBatteryHealthForecastNarrativeContent(
        vehicleId = vehicleId,
        stream = stream,
        onNarrate = onNarrate,
        modifier = modifier,
        online = online,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Resolves the four surface strings (P1/S10), classifies
 * the surface via [aiNarrativeSurfaceFor], and draws the GlassPanel card: header (title + Helix badge +
 * description), the Narrate action (disabled while streaming / offline / vehicle-unresolved, with an in-button
 * loading affordance), and the output region that switches per surface state. Every state renders a non-blank
 * surface; the thinking affordance honors [reduceMotion] (P1 a11y).
 */
@Composable
fun AIBatteryHealthForecastNarrativeContent(
    vehicleId: Long?,
    stream: AiNarrativeStreamState,
    onNarrate: () -> Unit,
    modifier: Modifier = Modifier,
    online: Boolean = true,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val surface = aiNarrativeSurfaceFor(online, stream.phase, stream.hasText)
    val canStart = canNarrate(vehicleId)
    val actionEnabled = narrativeButtonEnabled(online, canStart, stream.phase)

    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            NarrativeHeader(
                title = stringResource(R.string.translation_battery_aiNarrative_title),
                description = stringResource(R.string.translation_battery_aiNarrative_description),
                badge = stringResource(R.string.translation_battery_aiNarrative_badge),
            )
            NarrativeAction(
                label = stringResource(R.string.translation_battery_aiNarrative_generateButton),
                enabled = actionEnabled,
                streaming = stream.phase == AiStreamPhase.Streaming,
                onNarrate = onNarrate,
            )
            NarrativeOutput(
                surface = surface,
                text = stream.text,
                onRetry = onNarrate,
                retryEnabled = actionEnabled,
                reduceMotion = reduceMotion,
            )
        }
    }
}

/**
 * The card header — the native render of the web AIFeatureCard header: the title (web `h3`) sharing a row with
 * the cyan Helix badge, and the privacy-grounded description beneath. No empty-state hint is shown, matching the
 * web call site (InnerSection passes no `emptyHint`); the disabled Narrate button is the sole "needs a vehicle"
 * signal, exactly as on the web.
 */
@Composable
private fun NarrativeHeader(
    title: String,
    description: String,
    badge: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        ) {
            PanelTitle(title, modifier = Modifier.weight(1f))
            HelixBadge(badge)
        }
        BodyText(description, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The cyan "Helix" badge — the native counterpart of the web AIBadge pill: a rounded info-tinted surface with
 * the locally-authored Helix mark and the label. The whole pill carries a single accessible name so TalkBack
 * announces "Helix" rather than its glyph + text separately. The label uses the chip's inherited content color
 * (the info accent) via a typography-styled label, the same idiom as the shared StatusPill.
 */
@Composable
private fun HelixBadge(label: String) {
    val accent = TeslaTokens.status.info
    Surface(
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = BADGE_BG_ALPHA),
        contentColor = accent,
        border = BorderStroke(BADGE_BORDER_WIDTH, accent.copy(alpha = BADGE_BORDER_ALPHA)),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        ) {
            Icon(AIBatteryHealthForecastNarrativeGlyphs.Helix, contentDescription = null, size = IconSize.Sm, tint = accent)
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

/**
 * The Narrate action row — the native render of the web AIFeatureCard action button (Outline, small, leading
 * Helix mark), right-aligned beneath the header to suit the long description (web `buttonPlacement='below'`).
 * The [streaming] flag drives the in-button loading affordance (web "Helix is thinking…"); the shared [Button]
 * shows an indeterminate ring and disables itself while loading, and [enabled] additionally gates the action on
 * connectivity + a resolved vehicle (web `disabled = !canStart || isStreaming`).
 */
@Composable
private fun NarrativeAction(
    label: String,
    enabled: Boolean,
    streaming: Boolean,
    onNarrate: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = label,
            onClick = onNarrate,
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            loading = streaming,
            leadingIcon = AIBatteryHealthForecastNarrativeGlyphs.Helix,
        )
    }
}

/**
 * The output region — the native AiOutputPanel: it renders nothing in [AiNarrativeSurface.Ready] (web returns
 * null while idle), and otherwise wraps the per-state body in a bordered, polite live-region [OutputShell] whose
 * merged accessible name is the [narrativeOutputAnnouncement] for that state.
 */
@Composable
private fun NarrativeOutput(
    surface: AiNarrativeSurface,
    text: String,
    onRetry: () -> Unit,
    retryEnabled: Boolean,
    reduceMotion: Boolean,
) {
    if (surface == AiNarrativeSurface.Ready) return
    val labels =
        NarrativeOutputLabels(
            loading = stringResource(R.string.translation_common_loading),
            errorTitle = stringResource(R.string.translation_error_serverError_title),
            errorMessage = stringResource(R.string.translation_error_serverError_message),
            offline = stringResource(R.string.translation_common_offline),
            offlineDetail = stringResource(R.string.translation_error_network_offlineDetail),
        )
    OutputShell(narrativeOutputAnnouncement(surface, text, labels)) {
        when (surface) {
            AiNarrativeSurface.Thinking -> ThinkingBody(reduceMotion)
            AiNarrativeSurface.Narrative -> BodyText(text)
            AiNarrativeSurface.Error -> ErrorBody(onRetry, retryEnabled)
            AiNarrativeSurface.Offline -> OfflineBody(text)
            AiNarrativeSurface.Ready -> Unit
        }
    }
}

/**
 * The bordered output container — the native counterpart of the web `rounded-lg border bg-white/[0.02] p-4`
 * panel, marked a polite live region so streamed narrative and lifecycle changes are announced. Content is laid
 * out in a [ColumnScope] and the whole region carries the single merged [announcement] for TalkBack.
 */
@Composable
private fun OutputShell(
    announcement: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Surface(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) {
                    contentDescription = announcement
                    liveRegion = LiveRegionMode.Polite
                },
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = OUTPUT_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(OUTPUT_BORDER_WIDTH, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

/**
 * The thinking affordance — the native AIThinkingIndicator: the SSE is open but no token has arrived. Honors
 * reduced motion (a static Helix mark when motion is reduced, an animated [Spinner] otherwise) and shows the
 * localized loading label beside it.
 */
@Composable
private fun ThinkingBody(reduceMotion: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (reduceMotion) {
            Icon(
                AIBatteryHealthForecastNarrativeGlyphs.Helix,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.status.info,
            )
        } else {
            Spinner(size = SpinnerSize.Sm)
        }
        BodyText(stringResource(R.string.translation_common_loading))
    }
}

/**
 * The error body — the native AiOutputPanel error branch. The raw `stream.error` is a technical code, so the
 * surface shows the localized server-error copy with a retry affordance (web "fall back + retry"), enabled only
 * when the action is otherwise available (an active vehicle, online).
 */
@Composable
private fun ErrorBody(
    onRetry: () -> Unit,
    retryEnabled: Boolean,
) {
    ErrorDisplay(
        message = stringResource(R.string.translation_error_serverError_message),
        title = stringResource(R.string.translation_error_serverError_title),
        onRetry = if (retryEnabled) onRetry else null,
        retryLabel = stringResource(R.string.translation_common_retry),
    )
}

/**
 * The offline body — no connectivity: an offline chip, the "we'll retry when your connection returns" detail,
 * and any cached narrative kept visible beneath (the web "cached value + offline chip" lifecycle). The Narrate
 * button is already disabled by [narrativeButtonEnabled].
 */
@Composable
private fun ColumnScope.OfflineBody(text: String) {
    StatusPill(text = stringResource(R.string.translation_common_offline), tone = StatusTone.Warning)
    if (text.isNotBlank()) {
        BodyText(text)
    }
    HelperText(stringResource(R.string.translation_error_network_offlineDetail))
}

/**
 * Locally authored lucide HelixMark glyph, absent from the shared
 * [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside this surface's allowed-files scope, drawn
 * as a 24×24 stroked [ImageVector] recolored at render time by the [Icon] tint: a four-point concave star with a
 * small accent sparkle — the same authoring idiom the sibling AIRestorePanel uses for its Sparkles glyph.
 */
private object AIBatteryHealthForecastNarrativeGlyphs {
    val Helix: ImageVector =
        stroked("AIBatteryHealthForecastNarrativeHelix") {
            // Main four-point concave star centered at (12, 12).
            moveTo(12f, 3f)
            lineTo(13.6f, 10.4f)
            lineTo(21f, 12f)
            lineTo(13.6f, 13.6f)
            lineTo(12f, 21f)
            lineTo(10.4f, 13.6f)
            lineTo(3f, 12f)
            lineTo(10.4f, 10.4f)
            close()
            // Small accent sparkle (cross) at the upper-right.
            moveTo(19f, 3f)
            lineTo(19f, 7f)
            moveTo(21f, 5f)
            lineTo(17f, 5f)
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

private const val SAMPLE_NARRATIVE: String =
    "Your battery is at 94% state of health, tracking a gentle ~2.1% annual degradation slope. The dominant " +
        "driver is frequent DC fast-charging above 80%; shifting most sessions to overnight Level 2 below 80% " +
        "would flatten the curve. No acute risk factors stand out in the recent window."

@Preview(name = "Ready — idle", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeReadyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = 1L,
            stream = AiNarrativeStreamState(),
            onNarrate = {},
        )
    }
}

@Preview(name = "Thinking — streaming, no token yet", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeThinkingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = 1L,
            stream = AiNarrativeStreamState(phase = AiStreamPhase.Streaming),
            onNarrate = {},
            reduceMotion = false,
        )
    }
}

@Preview(name = "Narrative — streamed text", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeNarrativePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = 1L,
            stream = AiNarrativeStreamState(phase = AiStreamPhase.Done, text = SAMPLE_NARRATIVE),
            onNarrate = {},
        )
    }
}

@Preview(name = "Error — stream failed", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = 1L,
            stream = AiNarrativeStreamState(phase = AiStreamPhase.Error, error = "stream_http_500"),
            onNarrate = {},
        )
    }
}

@Preview(name = "Offline — cached + chip", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeOfflinePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = 1L,
            stream = AiNarrativeStreamState(phase = AiStreamPhase.Done, text = SAMPLE_NARRATIVE),
            onNarrate = {},
            online = false,
        )
    }
}

@Preview(name = "Ready — no vehicle (Narrate disabled)", showBackground = true)
@Composable
private fun AIBatteryHealthForecastNarrativeNoVehiclePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIBatteryHealthForecastNarrativeContent(
            vehicleId = null,
            stream = AiNarrativeStreamState(),
            onNarrate = {},
        )
    }
}
