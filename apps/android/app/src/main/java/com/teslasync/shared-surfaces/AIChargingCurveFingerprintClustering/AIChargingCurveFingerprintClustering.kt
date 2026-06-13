// The native Jetpack Compose + Material 3 AIChargingCurveFingerprintClustering shared surface — a parity
// port of web/src/components/ai/AIChargingCurveFingerprintClustering.tsx and the shared AIFeatureCard /
// AiOutputPanel / AIThinkingIndicator scaffold it renders through. The web surface is the opt-in AI
// feature card on the Charging Curves page: it drives `useAiStream` against
// /ai/charging/curves/clusters/explain and renders a GlassPanel with a header (title + cyan Helix badge +
// description + empty hint), an "Ask Helix" action, and a streaming output panel (animated thinking
// indicator → accumulated narrative → inline Helix error). This port reproduces that composition, data,
// states, and i18n in native primitives — no ported Tailwind classes; platform tokens from P1/S9.
//
// All pure derivation (the stream-phase lifecycle, the canStart gate, the request body, the output-panel
// branch classifier, the visibility gate, the accessibility fold, the SSE frame parser, and the
// view.opened diagnostic) lives in the Model + Source + ViewModel files and is unit-tested off-device, so
// this file stays a thin render layer: it binds the ViewModel to the [ProcessAiExplainStream] seam + the
// app's [SelectedVehicleStore], resolves the i18n strings (P1/S10) and the design-token cyan accent
// (P1/S9), and lays out the surface — collecting state and calling [explain], never touching HTTP.
//
// The web Tailwind cyan AI accent (border-cyan-300/30, bg-cyan-300/10, text-cyan-300 — the Helix brand
// hue) maps onto the theme-aware semantic info token `TeslaTokens.status.info` (#00f0ff neon cyan in dark,
// cyan-600 in light, accessible cyan in high-contrast), tinted with the same border/background alphas so
// every theme stays consistent. The lucide-style `HelixMark` brand glyph, absent from the shared
// [io.teslasync.android.components.ui.TeslaGlyphs] catalog, is authored locally as a stroked vector —
// exactly as the sibling AIRestorePanel authors its lucide `Sparkles` glyph.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/AIChargingCurveFingerprintClustering) cannot form a valid Kotlin package;
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.aichargingcurvefingerprintclustering

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `bg-cyan-300/10` badge / accent background tint, applied to the brand cyan token. */
private const val ACCENT_BG_ALPHA: Float = 0.10f

/** Web `border-cyan-300/30` badge / accent border tint, applied to the brand cyan token. */
private const val ACCENT_BORDER_ALPHA: Float = 0.30f

/** Web `bg-white/[0.02]` output-panel wash, applied to the surface foreground. */
private const val OUTPUT_BG_ALPHA: Float = 0.03f

/** The 1 px accent / panel border (web `border`). */
private val HAIRLINE: Dp = 1.dp

/** Each shimmering thinking-skeleton bar's height (web `h-3`). */
private val SKELETON_BAR_HEIGHT: Dp = 12.dp

/** The static thinking-skeleton opacity under reduced motion (no shimmer, still visible). */
private const val SKELETON_STATIC_ALPHA: Float = 0.40f

/** The shimmer pulse's low / high opacity (web `animate-shimmer`); collapses to [SKELETON_STATIC_ALPHA] when reduced. */
private const val SKELETON_PULSE_LOW: Float = 0.20f
private const val SKELETON_PULSE_HIGH: Float = 0.55f

/** One full shimmer cycle, ms. */
private const val SKELETON_PULSE_MS: Int = 900

/** The thinning skeleton-bar widths (web `w-full`, `w-11/12`, `w-9/12`) that mimic prose. */
private val SKELETON_WIDTHS: List<Float> = listOf(1f, 0.92f, 0.75f)

/** The web aria-label separator between the universal CTA and the per-feature verb ("Ask Helix · Explain clusters"). */
private const val ARIA_SEPARATOR: String = " \u00B7 "

/**
 * The resolved, localized copy the surface renders. Bundled so the stateless renderer takes one strings
 * holder rather than nine parameters; the four surface keys come from the catalog, the shared-card chrome
 * strings from the by-name optional-catalog fallback (web `t(key, default)`).
 */
@Suppress("LongParameterList") // One field per web `t()` call the card renders.
data class ClusteringStrings(
    val title: String,
    val description: String,
    val buttonLabel: String,
    val badge: String,
    val askHelix: String,
    val thinking: String,
    val errorLabel: String,
    val errorUnknown: String,
    val emptyHint: String,
)

/**
 * Stateful entry point — the faithful port of the web `AIChargingCurveFingerprintClustering` (the
 * withAiFeature-wrapped InnerSection). Honors the visibility gate ([shouldRender]; the web HOC renders
 * nothing when the feature is off), binds the ViewModel to the process [AiExplainStream] seam + the app's
 * [SelectedVehicleStore], records the one-shot `view.opened` diagnostic, resolves the i18n strings, and
 * renders. The surface performs no HTTP; the explain stream flows through the seam (ADR-002).
 *
 * @param featureEnabled the withAiFeature gate (the host's `useAiEnabled('charging-curve-fingerprint-clustering')`).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AIChargingCurveFingerprintClustering(
    modifier: Modifier = Modifier,
    featureEnabled: Boolean = true,
    logger: Logger = LocalDataContainer.current.logger,
) {
    if (!shouldRender(featureEnabled)) return
    val selection = LocalDataContainer.current.selectedVehicleStore
    val viewModel: AIChargingCurveFingerprintClusteringViewModel =
        viewModel(
            key = AIChargingCurveFingerprintClusteringRegistration.FEATURE_ID,
            factory = AIChargingCurveFingerprintClusteringViewModel.factory(ProcessAiExplainStream, selection, logger),
        )
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val strings = rememberClusteringStrings(context)
    AIChargingCurveFingerprintClusteringContent(
        state = state,
        strings = strings,
        onExplain = viewModel::explain,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Draws the card for any [state]: the header
 * (title + Helix badge + description + the empty hint when no vehicle is in scope), the "Ask Helix" action
 * (disabled while a stream is open or no vehicle is selected), and the output panel (hidden before the
 * first run, the thinking indicator while awaiting the first token, the inline Helix error, or the
 * accumulated narrative). Every state renders a non-blank surface. The thinking affordance honors
 * [reduceMotion] (P1 a11y). The header block carries the merged [cardAccessibilityLabel] so TalkBack reads
 * it as one announcement; the action stays a separately-labeled control.
 */
@Composable
fun AIChargingCurveFingerprintClusteringContent(
    state: ClusteringSurfaceState,
    strings: ClusteringStrings,
    onExplain: () -> Unit,
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            ClusteringHeader(state = state, strings = strings)
            ClusteringActionRow(state = state, strings = strings, onExplain = onExplain)
            ClusteringOutputPanel(
                panelState = outputPanelStateFor(state.phase, state.text, state.error, strings.errorUnknown),
                strings = strings,
                reduceMotion = reduceMotion,
            )
        }
    }
}

/** The card header: title + cyan Helix badge, the description, and the empty hint when no vehicle is in scope. */
@Composable
private fun ClusteringHeader(
    state: ClusteringSurfaceState,
    strings: ClusteringStrings,
) {
    val announcement =
        cardAccessibilityLabel(strings.title, strings.badge, strings.description, strings.emptyHint, state.canStart)
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics(mergeDescendants = true) { contentDescription = announcement },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle(strings.title, modifier = Modifier.weight(1f, fill = false))
            HelixBadge(strings.badge)
        }
        Caption(strings.description)
        if (!state.canStart) {
            HelperText(strings.emptyHint)
        }
    }
}

/** The right-aligned "Ask Helix" action row (the AIFeatureCard `below` layout, idiomatic on phone widths). */
@Composable
private fun ClusteringActionRow(
    state: ClusteringSurfaceState,
    strings: ClusteringStrings,
    onExplain: () -> Unit,
) {
    val isStreaming = state.phase == AiStreamPhase.Streaming
    val label = if (isStreaming) strings.thinking else strings.askHelix
    val accessibleName = strings.askHelix + ARIA_SEPARATOR + strings.buttonLabel
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Button(
            label = label,
            onClick = onExplain,
            modifier = Modifier.semantics { contentDescription = accessibleName },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = !buttonDisabled(state.canStart, state.phase),
            leadingIcon = HelixGlyphs.Mark,
        )
    }
}

/** The bordered streaming-output panel — hidden, thinking, error, or accumulated narrative (web AiOutputPanel). */
@Composable
private fun ClusteringOutputPanel(
    panelState: OutputPanelState,
    strings: ClusteringStrings,
    reduceMotion: Boolean,
) {
    if (panelState is OutputPanelState.Hidden) return
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(Radius.md),
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = OUTPUT_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Box(Modifier.padding(Spacing.md)) {
            when (panelState) {
                is OutputPanelState.Thinking -> ThinkingIndicator(strings.thinking, reduceMotion)
                is OutputPanelState.Error -> HelixError(strings.errorLabel, panelState.message)
                is OutputPanelState.Text -> BodyText(panelState.text)
                is OutputPanelState.Hidden -> Unit
            }
        }
    }
}

/** The animated "Helix is thinking" affordance: a cyan label row over thinning skeleton bars (web AIThinkingIndicator). */
@Composable
private fun ThinkingIndicator(
    label: String,
    reduceMotion: Boolean,
) {
    Column(
        modifier =
            Modifier.semantics {
                liveRegion = LiveRegionMode.Polite
                contentDescription = label
            },
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(HelixGlyphs.Mark, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.info)
            Text(label, style = MaterialTheme.typography.labelLarge, color = TeslaTokens.status.info)
        }
        ThinkingSkeleton(reduceMotion)
    }
}

/** The thinning skeleton bars beneath the thinking label; shimmering by default, static under reduced motion. */
@Composable
private fun ThinkingSkeleton(reduceMotion: Boolean) {
    val alpha = if (reduceMotion) SKELETON_STATIC_ALPHA else rememberShimmerAlpha()
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SKELETON_WIDTHS.forEach { width -> SkeletonBar(width, alpha) }
    }
}

/** A single skeleton bar at [widthFraction] of the row, tinted cyan and faded to [alpha]. */
@Composable
private fun SkeletonBar(
    widthFraction: Float,
    alpha: Float,
) {
    Box(
        Modifier
            .fillMaxWidth(widthFraction)
            .height(SKELETON_BAR_HEIGHT)
            .clip(RoundedCornerShape(Radius.sm))
            .alpha(alpha)
            .background(TeslaTokens.status.info.copy(alpha = ACCENT_BG_ALPHA)),
    )
}

/** Drives the shimmer opacity between [SKELETON_PULSE_LOW] and [SKELETON_PULSE_HIGH] on a reversing loop. */
@Composable
private fun rememberShimmerAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "helixThinking")
    val alpha by transition.animateFloat(
        initialValue = SKELETON_PULSE_LOW,
        targetValue = SKELETON_PULSE_HIGH,
        animationSpec = infiniteRepeatable(tween(SKELETON_PULSE_MS), RepeatMode.Reverse),
        label = "helixShimmer",
    )
    return alpha
}

/** The inline Helix error: a cyan-free danger mark, the localized "Helix error:" prefix, and the message. */
@Composable
private fun HelixError(
    errorLabel: String,
    message: String,
) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(HelixGlyphs.Mark, contentDescription = null, size = IconSize.Sm, tint = TeslaTokens.status.danger)
        Text(
            text = "$errorLabel $message",
            style = MaterialTheme.typography.bodyMedium,
            color = TeslaTokens.status.danger,
        )
    }
}

/** The cyan "Helix" brand chip rendered next to the title (web AIBadge): a HelixMark over a low-alpha cyan wash. */
@Composable
private fun HelixBadge(label: String) {
    val accent = TeslaTokens.status.info
    Surface(
        shape = RoundedCornerShape(Radius.pill),
        color = accent.copy(alpha = ACCENT_BG_ALPHA),
        contentColor = accent,
        border = BorderStroke(HAIRLINE, accent.copy(alpha = ACCENT_BORDER_ALPHA)),
        modifier = Modifier.clearAndSetBadgeLabel(label),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
            horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(HelixGlyphs.Mark, contentDescription = null, size = IconSize.Xs, tint = accent)
            Text(label, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Sets the badge's single accessible label (web AIBadge `aria-label`) so its glyph + text read as one chip. */
private fun Modifier.clearAndSetBadgeLabel(label: String): Modifier = semantics(mergeDescendants = true) { contentDescription = label }

/**
 * Resolves the surface's localized strings: the four surface keys from the catalog (`stringResource`), the
 * shared-card chrome strings from the by-name optional-catalog seam with the web default as the fallback
 * (web `t(key, default)`). Remembered against the context so the by-name reads run once per composition.
 */
@Composable
private fun rememberClusteringStrings(context: Context): ClusteringStrings {
    val title = stringResource(R.string.translation_charging_aiClustering_title)
    val description = stringResource(R.string.translation_charging_aiClustering_description)
    val buttonLabel = stringResource(R.string.translation_charging_aiClustering_generateButton)
    val badge = stringResource(R.string.translation_charging_aiClustering_badge)
    return remember(context, title, description, buttonLabel, badge) {
        ClusteringStrings(
            title = title,
            description = description,
            buttonLabel = buttonLabel,
            badge = badge,
            askHelix = context.stringOr(KEY_ASK_HELIX, AiClusteringDefaults.ASK_HELIX),
            thinking = context.stringOr(KEY_THINKING, AiClusteringDefaults.THINKING),
            errorLabel = context.stringOr(KEY_ERROR_LABEL, AiClusteringDefaults.ERROR_LABEL),
            errorUnknown = context.stringOr(KEY_ERROR_UNKNOWN, AiClusteringDefaults.ERROR_UNKNOWN),
            emptyHint = AiClusteringDefaults.EMPTY_HINT,
        )
    }
}

/** Reads [resourceName] from the catalog if present and non-blank, else returns [fallback] (web `t(key, default)`). */
private fun Context.stringOr(
    resourceName: String,
    fallback: String,
): String = optionalString(resourceName)?.takeIf { it.isNotBlank() } ?: fallback

/**
 * Optional by-name read from the Android string catalog — the production seam reproducing web
 * `t(key, default)` for keys the catalog may not yet carry. `getIdentifier` is the only way to attempt a
 * possibly-absent key (a compile-time `R.string` reference cannot express "resolve if present, else fall
 * back"), so `DiscouragedApi` is suppressed; release builds keep resource names (shrinking is off), so the
 * lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * The locally authored lucide-style `HelixMark` brand glyph (the TeslaSync AI assistant icon), absent from
 * the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog and outside this surface's
 * allowed-files scope, drawn as a 24×24 stroked [ImageVector] recolored at render time by the [Icon] tint:
 * two intertwined sinusoidal strands crossing at the centre with two connecting rungs — the exact path
 * data of web/src/components/branding/HelixMark.tsx. Authored locally exactly as the sibling AIRestorePanel
 * authors its lucide `Sparkles` glyph.
 */
private object HelixGlyphs {
    val Mark: ImageVector =
        stroked("HelixMark") {
            // Strand A: top-left → centre → bottom-right (web `M 8 2 Q 18 7 12 12 Q 6 17 16 22`).
            moveTo(8f, 2f)
            quadTo(18f, 7f, 12f, 12f)
            quadTo(6f, 17f, 16f, 22f)
            // Strand B: mirrored about x=12, crossing strand A at the centre (web `M 16 2 Q 6 7 12 12 Q 18 17 8 22`).
            moveTo(16f, 2f)
            quadTo(6f, 7f, 12f, 12f)
            quadTo(18f, 17f, 8f, 22f)
            // Two rungs where the strands run nearly parallel (web `<line>`s at y=7 and y=17).
            moveTo(10f, 7f)
            lineTo(14f, 7f)
            moveTo(10f, 17f)
            lineTo(14f, 17f)
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
                    strokeLineWidth = 1.75f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ───────────────────────

private val SAMPLE_STRINGS =
    ClusteringStrings(
        title = AiClusteringDefaults.TITLE,
        description = AiClusteringDefaults.DESCRIPTION,
        buttonLabel = AiClusteringDefaults.BUTTON_LABEL,
        badge = AiClusteringDefaults.BADGE,
        askHelix = AiClusteringDefaults.ASK_HELIX,
        thinking = AiClusteringDefaults.THINKING,
        errorLabel = AiClusteringDefaults.ERROR_LABEL,
        errorUnknown = AiClusteringDefaults.ERROR_UNKNOWN,
        emptyHint = AiClusteringDefaults.EMPTY_HINT,
    )

private const val SAMPLE_NARRATIVE: String =
    "Cluster A — \"Cold-soak DC fast charges\": 11 sessions that start below 10\u00B0C and taper from " +
        "250 kW at a low state of charge. Cluster B — \"Warm AC top-ups\": steady 11 kW evening sessions."

@Preview(name = "Idle — vehicle selected", showBackground = true)
@Composable
private fun ClusteringIdlePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIChargingCurveFingerprintClusteringContent(
            state = ClusteringSurfaceState(phase = AiStreamPhase.Idle, canStart = true),
            strings = SAMPLE_STRINGS,
            onExplain = {},
        )
    }
}

@Preview(name = "Empty — no vehicle in scope", showBackground = true)
@Composable
private fun ClusteringEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIChargingCurveFingerprintClusteringContent(
            state = ClusteringSurfaceState(phase = AiStreamPhase.Idle, canStart = false),
            strings = SAMPLE_STRINGS,
            onExplain = {},
        )
    }
}

@Preview(name = "Streaming — thinking", showBackground = true)
@Composable
private fun ClusteringThinkingPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        AIChargingCurveFingerprintClusteringContent(
            state = ClusteringSurfaceState(phase = AiStreamPhase.Streaming, canStart = true),
            strings = SAMPLE_STRINGS,
            onExplain = {},
            reduceMotion = true,
        )
    }
}

@Preview(name = "Done — narrative", showBackground = true)
@Composable
private fun ClusteringDonePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIChargingCurveFingerprintClusteringContent(
            state = ClusteringSurfaceState(phase = AiStreamPhase.Done, text = SAMPLE_NARRATIVE, canStart = true),
            strings = SAMPLE_STRINGS,
            onExplain = {},
        )
    }
}

@Preview(name = "Error — Helix error", showBackground = true)
@Composable
private fun ClusteringErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIChargingCurveFingerprintClusteringContent(
            state = ClusteringSurfaceState(phase = AiStreamPhase.Error, error = "stream_http_503", canStart = true),
            strings = SAMPLE_STRINGS,
            onExplain = {},
        )
    }
}
