// The native Jetpack Compose + Material 3 AIFeatureCard shared surface — a parity port of
// web/src/components/ai/AIFeatureCard.tsx and the AiOutputPanel / AIThinkingIndicator scaffold it composes.
// AIFeatureCard is the reusable card every "header + Ask-Helix button + streamed output" AI feature is built on,
// so this port is a reusable, parameterised composable (not a single bound feature): a GlassPanel wrapping the
// branded header (per-feature title + the cyan "Helix" badge + description + optional empty hint), an optional
// prompt-input slot, the universal "Ask Helix" action (its visible label flips to "Helix is thinking…" while
// streaming, its accessible name carries the per-feature verb, disabled while in flight / offline / not ready),
// an optional domain-specific children slot, and the output panel reproducing every lifecycle state the prompt
// mandates: a thinking affordance (loading), the streamed prose (content), an idle/ready card (empty), an
// inline "Helix error" panel with retry (error), a refreshing stale chip over the last text (stale), and a
// cached-value + offline chip (offline).
//
// All pure derivation (the output-state projection, the action label/accessible-name/enabled rules, the i18n
// fold, the merged TalkBack announcement, the `view.opened` diagnostic) lives in AIFeatureCardModel.kt and is
// unit-tested off-device, so this file stays a thin render layer: it resolves the Helix-brand + lifecycle i18n
// strings (P1/S10), the design-token accent (P1/S9), binds either a host-supplied stream snapshot or the
// [AIFeatureCardViewModel] (P1/S8 — no HTTP from the view), and lays out the surface with platform tokens (no
// ported Tailwind classes).
//
// The web cyan AI badge (border-cyan-300/30, bg-cyan-300/10, icon cyan-300) maps onto the theme-invariant brand
// accent `TeslaTokens.status.info`, tinted with the same border/background alphas so light/dark/high-contrast
// stay consistent. The lucide HelixMark, absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs]
// catalog, is authored locally as a stroked vector reproducing the web HelixMark's exact double-helix path —
// recolored at render time by the [Icon] tint, exactly as the sibling surfaces author their marks. The web
// `title` hover-tooltips (badge + action) become Material 3 long-press tooltips (touch has no hover), so no
// affordance is dropped.
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration`/`filename` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/AIFeatureCard) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration", "ktlint:standard:filename")

package io.teslasync.android.sharedsurfaces.aifeaturecard

import android.annotation.SuppressLint
import android.content.Context
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.components.feedback.ErrorDisplay
import io.teslasync.android.components.feedback.Spinner
import io.teslasync.android.components.feedback.SpinnerSize
import io.teslasync.android.components.motion.FadeIn
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
import io.teslasync.android.components.ui.StatusPill
import io.teslasync.android.components.ui.StatusTone
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing

private const val PANEL_FADE_DELAY_MS = 120

/** Web `bg-cyan-300/10` badge background tint, applied to the brand info accent. */
private const val BADGE_BG_ALPHA = 0.10f

/** Web `border-cyan-300/30` badge border tint, applied to the brand info accent. */
private const val BADGE_BORDER_ALPHA = 0.30f

/** Web `bg-white/[0.02]` output-panel tint, applied to the surface-variant container. */
private const val OUTPUT_BG_ALPHA = 0.30f

private val HAIRLINE: Dp = 1.dp

/** The web HelixMark default stroke width (`strokeWidth={1.75}`). */
private const val HELIX_STROKE = 1.75f

// ── Stateful host (binds the ViewModel — P1/S8) ──────────────────────────────────────────────────────────────

/**
 * Stateful entry point that binds the surface to its [AIFeatureCardViewModel] (P1/S8). Records the one-shot
 * PII-safe `view.opened` diagnostic on first composition (P1/S11), honors the per-feature AI-Off gate (renders
 * nothing when closed — web `withAiFeature` → null), collects the projected [AiFeatureCardSnapshot], and renders
 * [AIFeatureCardContent]. The host constructs the view-model via [AIFeatureCardViewModel.factory]; this view
 * never performs HTTP. The per-feature [title]/[description]/[buttonLabel] are passed already-translated (web
 * parity — the card does not i18n those).
 */
@Composable
fun AIFeatureCardHost(
    viewModel: AIFeatureCardViewModel,
    title: String,
    description: String,
    buttonLabel: String,
    modifier: Modifier = Modifier,
    badgeLabel: String? = null,
    emptyHint: String? = null,
    buttonTitle: String? = null,
    buttonPlacement: ButtonPlacement = ButtonPlacement.Inline,
    inputSlot: (@Composable () -> Unit)? = null,
    children: (@Composable ColumnScope.() -> Unit)? = null,
) {
    LaunchedEffect(viewModel) { viewModel.recordViewOpened() }

    val gated by viewModel.gated.collectAsStateWithLifecycle()
    if (!gated) return

    val snapshot by viewModel.snapshot.collectAsStateWithLifecycle()
    AIFeatureCardContent(
        snapshot = snapshot,
        title = title,
        description = description,
        buttonLabel = buttonLabel,
        onAction = viewModel::start,
        onRetry = viewModel::retry,
        modifier = modifier,
        badgeLabel = badgeLabel,
        emptyHint = emptyHint,
        buttonTitle = buttonTitle,
        buttonPlacement = buttonPlacement,
        inputSlot = inputSlot,
        children = children,
    )
}

// ── Reusable scaffold (web-style props — projects internally) ────────────────────────────────────────────────

/**
 * The reusable AIFeatureCard scaffold with the web component's prop shape: it takes the host [stream] snapshot +
 * [canStart] + [online] and projects them internally, so a feature screen consumes it exactly like the web
 * `<AIFeatureCard stream={…} canStart={…} … />`. Prefer this when the host owns its own `useAiStream`-analogue
 * state holder and wants to drop the card into a larger screen; prefer [AIFeatureCardHost] when the card is the
 * whole surface and should own its `view.opened` + gate.
 */
@Composable
fun AIFeatureCard(
    title: String,
    description: String,
    buttonLabel: String,
    stream: AiFeatureStream,
    canStart: Boolean,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    badgeLabel: String? = null,
    emptyHint: String? = null,
    buttonTitle: String? = null,
    online: Boolean = true,
    buttonPlacement: ButtonPlacement = ButtonPlacement.Inline,
    inputSlot: (@Composable () -> Unit)? = null,
    children: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val snapshot = remember(stream, canStart, online) { projectAiFeatureCard(stream, canStart, online) }
    AIFeatureCardContent(
        snapshot = snapshot,
        title = title,
        description = description,
        buttonLabel = buttonLabel,
        onAction = onAction,
        onRetry = onAction,
        modifier = modifier,
        badgeLabel = badgeLabel,
        emptyHint = emptyHint,
        buttonTitle = buttonTitle,
        buttonPlacement = buttonPlacement,
        inputSlot = inputSlot,
        children = children,
    )
}

// ── Stateless renderer (preview / UI-test entry point) ───────────────────────────────────────────────────────

/**
 * Stateless renderer of the surface — the unit/UI-test + @Preview entry point. Reproduces the web AIFeatureCard
 * layout (header → optional input slot → action button → optional children → output panel) and every render
 * state from [AiFeatureCardSnapshot]. The button's placement follows the web rules: `inline` shares the header
 * row, `below` (the default when an [inputSlot] is present) sits on its own right-aligned row.
 */
@Composable
fun AIFeatureCardContent(
    snapshot: AiFeatureCardSnapshot,
    title: String,
    description: String,
    buttonLabel: String,
    onAction: () -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    badgeLabel: String? = null,
    emptyHint: String? = null,
    buttonTitle: String? = null,
    buttonPlacement: ButtonPlacement = ButtonPlacement.Inline,
    inputSlot: (@Composable () -> Unit)? = null,
    children: (@Composable ColumnScope.() -> Unit)? = null,
    resolve: StringResolver = rememberStringResolver(),
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val chrome = remember(resolve) { aiFeatureCardChrome(resolve) }
    val placement = effectivePlacement(buttonPlacement, inputSlot != null)
    val action: @Composable () -> Unit = {
        ActionButton(
            label = actionLabel(snapshot.phase, chrome.askHelix, chrome.thinking),
            contentDescription = actionContentDescription(chrome.askHelix, buttonLabel),
            tooltip = buttonTitle ?: buttonLabel,
            enabled = snapshot.actionEnabled,
            busy = snapshot.busy,
            onClick = onAction,
        )
    }

    FadeIn(modifier = modifier.fillMaxWidth(), delayMs = PANEL_FADE_DELAY_MS) {
        GlassPanel(padding = PanelPadding.Lg) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.lg)) {
                Header(
                    title = title,
                    description = description,
                    badge = badgeLabel ?: chrome.badge,
                    badgeAria = chrome.badgeAria,
                    badgeTooltip = chrome.badgeTooltip,
                    emptyHint = emptyHint?.takeIf { !snapshot.canStart },
                    inline = placement == ButtonPlacement.Inline,
                    inlineButton = action.takeIf { placement == ButtonPlacement.Inline },
                )
                inputSlot?.invoke()
                if (placement == ButtonPlacement.Below) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { action() }
                }
                children?.invoke(this)
                OutputPanel(
                    snapshot = snapshot,
                    chrome = chrome,
                    onRetry = onRetry,
                    reduceMotion = reduceMotion,
                )
            }
        }
    }
}

// ── Header (web AIFeatureCard header + AIBadge) ──────────────────────────────────────────────────────────────

@Composable
private fun Header(
    title: String,
    description: String,
    badge: String,
    badgeAria: String,
    badgeTooltip: String,
    emptyHint: String?,
    inline: Boolean,
    inlineButton: (@Composable () -> Unit)?,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
        verticalAlignment = if (inline) Alignment.CenterVertically else Alignment.Top,
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                PanelTitle(title, modifier = Modifier.weight(1f, fill = false))
                AIBadge(text = badge, contentDescription = badgeAria, tooltip = badgeTooltip)
            }
            HelperText(description)
            if (emptyHint != null) Caption(emptyHint)
        }
        if (inline && inlineButton != null) inlineButton()
    }
}

/**
 * The cyan "Helix" pill (web AIBadge, exported separately so a custom-header call site can reuse the treatment):
 * an info-tinted rounded surface with the brand mark + label, a single merged accessible name, and the web
 * `title` tooltip as a long-press tooltip. The default label is "Helix"; callers may override via [text].
 */
@Composable
fun AIBadge(
    text: String,
    contentDescription: String,
    tooltip: String,
    modifier: Modifier = Modifier,
) {
    val accent = TeslaTokens.status.info
    Tooltip(text = tooltip) {
        Surface(
            modifier = modifier.semantics(mergeDescendants = true) { this.contentDescription = contentDescription },
            shape = RoundedCornerShape(Radius.pill),
            color = accent.copy(alpha = BADGE_BG_ALPHA),
            contentColor = accent,
            border = BorderStroke(HAIRLINE, accent.copy(alpha = BADGE_BORDER_ALPHA)),
        ) {
            Row(
                modifier = Modifier.padding(horizontal = Spacing.sm, vertical = Spacing.xs),
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(AIFeatureCardGlyphs.Helix, contentDescription = null, size = IconSize.Sm, tint = accent)
                Text(text, style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

// ── Action button (web AIFeatureCard "Ask Helix" CTA) ────────────────────────────────────────────────────────

/**
 * The universal "Ask Helix" action — an Outline, small button with a leading Helix mark whose visible label is
 * "Ask Helix" (idle) / "Helix is thinking…" (streaming, with the shared [Button]'s in-button loading ring), whose
 * accessible name carries the per-feature verb ([contentDescription]), and whose web `title` is a long-press
 * [tooltip]. Disabled while busy / offline / not ready (web `disabled = !canStart || isStreaming`).
 */
@Composable
private fun ActionButton(
    label: String,
    contentDescription: String,
    tooltip: String,
    enabled: Boolean,
    busy: Boolean,
    onClick: () -> Unit,
) {
    Tooltip(text = tooltip) {
        Button(
            label = label,
            onClick = onClick,
            modifier = Modifier.semantics { this.contentDescription = contentDescription },
            variant = ButtonVariant.Outline,
            size = ButtonSize.Sm,
            enabled = enabled,
            loading = busy,
            leadingIcon = AIFeatureCardGlyphs.Helix,
        )
    }
}

// ── Output panel (web AiOutputPanel + the mandated stale/offline overlays) ────────────────────────────────────

/**
 * The output region — the native AiOutputPanel: it renders nothing for [AiOutputSurface.Hidden] (web returns
 * null while idle; the card header + action above is the friendly ready/empty surface), and otherwise wraps the
 * per-state body in a bordered, polite live-region [OutputShell] whose merged accessible name is the
 * [outputAnnouncement] for that state.
 */
@Composable
private fun OutputPanel(
    snapshot: AiFeatureCardSnapshot,
    chrome: AIFeatureCardChrome,
    onRetry: () -> Unit,
    reduceMotion: Boolean,
) {
    if (snapshot.surface == AiOutputSurface.Hidden) return
    OutputShell(announcement = outputAnnouncement(snapshot, chrome)) {
        when (snapshot.surface) {
            AiOutputSurface.Thinking -> ThinkingBody(chrome.thinking, reduceMotion)
            AiOutputSurface.Stale -> StaleBody(chrome, snapshot.text, reduceMotion)
            AiOutputSurface.Content ->
                if (snapshot.text.isBlank()) HelperText(chrome.emptyOutput) else BodyText(snapshot.text)
            AiOutputSurface.Error -> ErrorBody(chrome, snapshot, onRetry)
            AiOutputSurface.Offline -> OfflineBody(chrome, snapshot.text)
            AiOutputSurface.Hidden -> Unit
        }
    }
}

/**
 * The bordered output container — the native counterpart of the web `rounded-lg border bg-white/[0.02] p-4`
 * panel, marked a polite live region so streamed output and lifecycle changes are announced once via the merged
 * [announcement].
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
        border = BorderStroke(HAIRLINE, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

/**
 * The thinking affordance — the native AIThinkingIndicator: the stream is open but no token has arrived. Honors
 * reduced motion (a static Helix mark instead of the [Spinner]) and shows the "Helix is thinking…" label beside
 * it.
 */
@Composable
private fun ThinkingBody(
    thinking: String,
    reduceMotion: Boolean,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        if (reduceMotion) {
            Icon(AIFeatureCardGlyphs.Helix, contentDescription = null, size = IconSize.Md, tint = TeslaTokens.status.info)
        } else {
            Spinner(size = SpinnerSize.Sm)
        }
        BodyText(thinking)
    }
}

/**
 * The stale body (the prompt's "stale chip + auto-refresh") — a refresh is streaming over previously-streamed
 * text: an info "Helix is refreshing…" chip above the last-known partial text (kept visible, never blanked), or
 * the thinking affordance if no text has arrived in this pass.
 */
@Composable
private fun ColumnScope.StaleBody(
    chrome: AIFeatureCardChrome,
    text: String,
    reduceMotion: Boolean,
) {
    StatusPill(text = chrome.refreshing, tone = StatusTone.Info)
    if (text.isNotBlank()) BodyText(text) else ThinkingBody(chrome.thinking, reduceMotion)
}

/**
 * The error body — the native AiOutputPanel error branch: the "Helix error:" label as the title and the terminal
 * message (or "unknown") beneath, with a retry affordance enabled only when the action is otherwise available
 * (online + ready).
 */
@Composable
private fun ErrorBody(
    chrome: AIFeatureCardChrome,
    snapshot: AiFeatureCardSnapshot,
    onRetry: () -> Unit,
) {
    ErrorDisplay(
        message = outputErrorMessage(snapshot.error, chrome),
        title = chrome.errorLabel,
        onRetry = if (snapshot.actionEnabled) onRetry else null,
        retryLabel = chrome.retry,
    )
}

/**
 * The offline body — no connectivity: an offline chip, any last streamed text kept visible (the prompt's "cached
 * value + offline chip"), and the "we'll retry when your connection returns" detail. The action is already
 * disabled by [projectAiFeatureCard].
 */
@Composable
private fun ColumnScope.OfflineBody(
    chrome: AIFeatureCardChrome,
    text: String,
) {
    StatusPill(text = chrome.offline, tone = StatusTone.Warning)
    if (text.isNotBlank()) BodyText(text)
    HelperText(chrome.offlineDetail)
}

// ── i18n facade (web `t(key, fallback)`) ─────────────────────────────────────────────────────────────────────

/**
 * By-name resolver against the generated Android catalog, falling back to the web English when a key is absent
 * (web `t(key, default)`). Remembered against the context so a locale change re-resolves the surface. The
 * Helix-brand keys are not in the catalog (the web renders them from `t`'s default too), so they resolve to the
 * identical English either way; the lifecycle-chrome keys (`common.*`, `error.network.*`) are present and
 * localize.
 */
@Composable
private fun rememberStringResolver(): StringResolver {
    val context = LocalContext.current
    return remember(context) {
        { key: String, fallback: String -> context.optionalString(foldCatalogKey(key)) ?: fallback }
    }
}

@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id).takeIf { it.isNotBlank() } else null
}

// ── Helix brand mark (locally-authored stroked vector, web HelixMark path verbatim) ──────────────────────────

/**
 * The lucide HelixMark glyph, absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog,
 * drawn as a 24×24 stroked [ImageVector] recolored at render time by the [Icon] tint. It reproduces the web
 * HelixMark's exact geometry: two intertwined sinusoidal strands meeting at the centre with two horizontal rungs
 * where they run parallel (web paths `M 8 2 Q 18 7 12 12 Q 6 17 16 22`, its mirror, and the rungs at y=7/y=17).
 */
private object AIFeatureCardGlyphs {
    val Helix: ImageVector =
        stroked("AIFeatureCardHelix") {
            // Strand A: top-left → centre → bottom-right (web `M 8 2 Q 18 7 12 12 Q 6 17 16 22`).
            moveTo(8f, 2f)
            quadTo(18f, 7f, 12f, 12f)
            quadTo(6f, 17f, 16f, 22f)
            // Strand B: mirrored about x=12 (web `M 16 2 Q 6 7 12 12 Q 18 17 8 22`).
            moveTo(16f, 2f)
            quadTo(6f, 7f, 12f, 12f)
            quadTo(18f, 17f, 8f, 22f)
            // Two rungs where the strands run parallel (web lines at y=7 and y=17).
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
                    strokeLineWidth = HELIX_STROKE,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                    pathBuilder = build,
                )
            }.build()
}

// ── Previews (FallbackResolver → web English; tooling-only, one per render state) ────────────────────────────

private const val SAMPLE_TITLE = "Summarize this drive"
private const val SAMPLE_DESCRIPTION =
    "Ask Helix to summarize the drive's notable events, efficiency, and any anomalies — grounded in the same " +
        "telemetry the charts render."
private const val SAMPLE_BUTTON = "Summarize drive"
private const val SAMPLE_OUTPUT =
    "Smooth 42-minute commute. Average efficiency 248 Wh/mi (8% better than your 30-day mean). One hard-regen " +
        "event near the canyon descent; no thermal or charging anomalies."

@Suppress("LongParameterList")
private fun previewSnapshot(
    surface: AiOutputSurface,
    phase: AiStreamPhase = AiStreamPhase.Idle,
    text: String = "",
    error: String? = null,
    canStart: Boolean = true,
    online: Boolean = true,
): AiFeatureCardSnapshot =
    AiFeatureCardSnapshot(
        surface = surface,
        phase = phase,
        text = text,
        error = error,
        canStart = canStart,
        actionEnabled = canStart && online && phase != AiStreamPhase.Streaming,
        busy = phase == AiStreamPhase.Streaming,
        online = online,
        stale = surface == AiOutputSurface.Stale || (surface == AiOutputSurface.Offline && text.isNotBlank()),
    )

@Composable
private fun PreviewCard(
    snapshot: AiFeatureCardSnapshot,
    emptyHint: String? = null,
) {
    TeslaSyncTheme(dynamicColor = false) {
        AIFeatureCardContent(
            snapshot = snapshot,
            title = SAMPLE_TITLE,
            description = SAMPLE_DESCRIPTION,
            buttonLabel = SAMPLE_BUTTON,
            onAction = {},
            onRetry = {},
            emptyHint = emptyHint,
            buttonPlacement = ButtonPlacement.Below,
            resolve = FallbackResolver,
            reduceMotion = true,
        )
    }
}

@Preview(name = "Empty — idle/ready", showBackground = true)
@Composable
private fun AIFeatureCardEmptyPreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Hidden))
}

@Preview(name = "Empty — not ready (hint)", showBackground = true)
@Composable
private fun AIFeatureCardNotReadyPreview() {
    PreviewCard(
        previewSnapshot(AiOutputSurface.Hidden, canStart = false),
        emptyHint = "Select a drive to let Helix summarize it.",
    )
}

@Preview(name = "Loading — Helix thinking", showBackground = true)
@Composable
private fun AIFeatureCardThinkingPreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Thinking, phase = AiStreamPhase.Streaming))
}

@Preview(name = "Content — streamed text", showBackground = true)
@Composable
private fun AIFeatureCardContentPreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Content, phase = AiStreamPhase.Done, text = SAMPLE_OUTPUT))
}

@Preview(name = "Stale — refreshing over last text", showBackground = true)
@Composable
private fun AIFeatureCardStalePreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Stale, phase = AiStreamPhase.Streaming, text = SAMPLE_OUTPUT))
}

@Preview(name = "Error — stream failed", showBackground = true)
@Composable
private fun AIFeatureCardErrorPreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Error, phase = AiStreamPhase.Error, error = "stream_http_503"))
}

@Preview(name = "Offline — cached + chip", showBackground = true)
@Composable
private fun AIFeatureCardOfflinePreview() {
    PreviewCard(previewSnapshot(AiOutputSurface.Offline, phase = AiStreamPhase.Done, text = SAMPLE_OUTPUT, online = false))
}
