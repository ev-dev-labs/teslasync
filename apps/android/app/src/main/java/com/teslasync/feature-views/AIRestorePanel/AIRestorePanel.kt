// The native Jetpack Compose + Material 3 AIRestorePanel feature view — a parity port of
// web/src/features/settings/components/AIRestorePanel.tsx. The web component is the presentational, host-
// controlled "restore previous Helix selection" prompt on the AI settings page: given the `archived` snapshot
// and `onConfirm` / `onDecline` callbacks it renders a purple alert region (`role="alert" aria-live="polite"`)
// with a Sparkles icon, a localized Subhead title, a Caption description, an optional bulleted preview of the
// archived feature names (shown only when there are labels), and the Decline (ghost) / Restore (primary)
// buttons. This port reproduces that composition, data, states, and i18n in native primitives — no ported
// Tailwind classes; platform tokens from P1/S9.
//
// All pure derivation (the label preview, the AI feature registry, the surface-state classifier, the host
// gate, the accessibility fold, and the `view.opened` diagnostic) lives in AIRestorePanelModel.kt and is
// unit-tested off-device, so this file stays a thin render layer: it resolves the i18n strings (P1/S10) and
// the design-token accent (P1/S9), wires the dynamic per-feature label key through a by-name catalog read (the
// `resources.getIdentifier` analogue of the web dynamic `t(\`…${id}…\`, default)`), and lays out the surface.
//
// The web Tailwind purple hue (border purple-400/40, bg purple-500/5, icon purple-300 — the Helix/AI accent)
// maps onto the theme-invariant brand purple `TeslaTokens.chart.power` (#A855F7 = Tailwind purple-500), tinted
// with the same border/background alphas so light/dark/high-contrast stay consistent. The lucide `Sparkles`
// glyph, absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs] catalog, is authored locally
// as a stroked vector — exactly as the sibling EfficiencyPanel authors its lucide `Activity` glyph.
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/feature-views/AIRestorePanel) cannot form a valid Kotlin package; `MatchingDeclarationName`
// is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.airestorepanel

import android.annotation.SuppressLint
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.HelperText
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.Subhead
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Web `bg-purple-500/5` alert background tint, applied to the brand purple accent. */
private const val ALERT_BG_ALPHA: Float = 0.05f

/** Web `border-purple-400/40` alert border tint, applied to the brand purple accent. */
private const val ALERT_BORDER_ALPHA: Float = 0.40f

/** The web 1px alert border (`border`). */
private val ALERT_BORDER_WIDTH: Dp = 1.dp

/** The web list bullet (`list-disc`) shown before each preview label. */
private const val BULLET: String = "\u2022  "

/**
 * Stateful entry point — the faithful port of the web `AIRestorePanel({ archived, onConfirm, onDecline })`.
 * Records the one-shot PII-safe `view.opened` diagnostic on first composition (P1/S11), builds the preview
 * labels via the pure [previewLabels] projection (resolving each known feature's localized label by name from
 * the catalog, falling back to the registry name — the web `t('ai.settings.feature.<id>.label', default)`),
 * and renders. The surface performs no HTTP; the `archived` snapshot is owned by the host AI-settings page.
 *
 * @param archived the `ai_features_archived` snapshot (web prop): feature-id → previously-enabled.
 * @param onConfirm invoked when Restore is tapped (web `onConfirm` — applies + saves the archived selection).
 * @param onDecline invoked when "No thanks" is tapped (web `onDecline` — dismisses for the session).
 * @param logger the sanctioned redacting logger; defaults to the app's [LocalDataContainer].
 */
@Composable
fun AIRestorePanel(
    archived: Map<String, Boolean>,
    onConfirm: () -> Unit,
    onDecline: () -> Unit,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { recordAIRestorePanelOpened(logger) }
    val context = LocalContext.current
    val labels =
        remember(archived, context) {
            previewLabels(archived) { id, fallback ->
                resolveOptional({ name -> context.optionalString(name) }, AiFeatureRegistry.labelResourceName(id), fallback)
            }
        }
    AIRestorePanelContent(
        labels = labels,
        onConfirm = onConfirm,
        onDecline = onDecline,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the preview / UI-test entry point. Switches on [surfaceState]:
 * [AIRestoreSurfaceState.Prompt] (the default, web parity) draws the purple alert region with its preview +
 * actions; [AIRestoreSurfaceState.Loading] and [AIRestoreSurfaceState.Error] draw the shared lifecycle chrome
 * a host may supply (never faked from a fetch this surface does not perform). Every state renders a non-blank
 * surface. The loading affordance honors [reduceMotion] (P1 a11y).
 *
 * @param labels the already-resolved preview labels (web `previewLabels(...)`); the list is omitted when empty.
 */
@Composable
fun AIRestorePanelContent(
    labels: List<String>,
    onConfirm: () -> Unit,
    onDecline: () -> Unit,
    modifier: Modifier = Modifier,
    surfaceState: AIRestoreSurfaceState = AIRestoreSurfaceState.Prompt,
    onRetry: () -> Unit = {},
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    when (surfaceState) {
        AIRestoreSurfaceState.Loading -> AIRestoreLoading(modifier, reduceMotion)
        AIRestoreSurfaceState.Error -> AIRestoreError(modifier, onRetry)
        AIRestoreSurfaceState.Prompt -> AIRestorePrompt(labels, onConfirm, onDecline, modifier)
    }
}

/**
 * The restore prompt — the faithful native render of the web alert `<section>`: a purple live-region panel
 * with a decorative Sparkles icon, the localized title + description, the optional bulleted preview (web
 * `labels.length > 0 && <ul>`), and the Decline / Restore buttons. The textual block carries the merged
 * [alertAnnouncement] so TalkBack reads the whole alert as one polite announcement; the buttons remain
 * separately-labeled controls.
 */
@Composable
private fun AIRestorePrompt(
    labels: List<String>,
    onConfirm: () -> Unit,
    onDecline: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val title = stringResource(R.string.translation_ai_settings_archive_title)
    val description = stringResource(R.string.translation_ai_settings_archive_description)
    val announcement = alertAnnouncement(title, description, labels)
    AIRestoreAlertSection(modifier) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                AIRestorePanelGlyphs.Sparkles,
                contentDescription = null,
                size = IconSize.Md,
                tint = TeslaTokens.chart.power,
            )
            Column(
                modifier =
                    Modifier
                        .weight(1f)
                        .semantics(mergeDescendants = true) { contentDescription = announcement },
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                Subhead(title)
                Caption(description)
                if (labels.isNotEmpty()) {
                    Column(
                        modifier = Modifier.padding(top = Spacing.xs),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                    ) {
                        labels.forEach { label -> HelperText("$BULLET$label") }
                    }
                }
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm, Alignment.End),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Button(
                label = stringResource(R.string.translation_ai_settings_archive_decline),
                onClick = onDecline,
                variant = ButtonVariant.Ghost,
            )
            Button(
                label = stringResource(R.string.translation_ai_settings_archive_restore),
                onClick = onConfirm,
                variant = ButtonVariant.Primary,
            )
        }
    }
}

/**
 * The purple alert container — the native counterpart of the web `rounded-md border border-purple-400/40
 * bg-purple-500/5 p-4 space-y-2` section, marked a polite live region so the prompt is announced when it
 * appears. Content is laid out in a [ColumnScope] spaced like the web `space-y-2`.
 */
@Composable
private fun AIRestoreAlertSection(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val accent = TeslaTokens.chart.power
    Surface(
        modifier = modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite },
        shape = RoundedCornerShape(Radius.md),
        color = accent.copy(alpha = ALERT_BG_ALPHA),
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(ALERT_BORDER_WIDTH, accent.copy(alpha = ALERT_BORDER_ALPHA)),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.lg),
            verticalArrangement = Arrangement.spacedBy(Spacing.sm),
            content = content,
        )
    }
}

/**
 * The loading chrome the shared P1/S8 lifecycle can carry. Honors reduced motion: an animated [Spinner]
 * normally, a static labeled row (a Sparkles glyph + the localized "Loading…" label) when motion is reduced.
 * Both branches expose the same single localized accessible name so TalkBack announces it either way.
 */
@Composable
private fun AIRestoreLoading(
    modifier: Modifier = Modifier,
    reduceMotion: Boolean = rememberReducedMotion(),
) {
    val label = stringResource(R.string.translation_common_loading)
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        Box(
            modifier = Modifier.fillMaxWidth().padding(Spacing.xl2),
            contentAlignment = Alignment.Center,
        ) {
            if (reduceMotion) {
                Row(
                    modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                ) {
                    Icon(AIRestorePanelGlyphs.Sparkles, contentDescription = null, size = IconSize.Md)
                    BodyText(label)
                }
            } else {
                Spinner(size = SpinnerSize.Md, label = label)
            }
        }
    }
}

/**
 * The hard-error chrome the shared P1/S8 lifecycle can carry — the shared [ErrorDisplay] with a localized
 * title + message and a retry affordance that calls [onRetry].
 */
@Composable
private fun AIRestoreError(
    modifier: Modifier = Modifier,
    onRetry: () -> Unit = {},
) {
    GlassPanel(modifier = modifier.fillMaxWidth(), padding = PanelPadding.Lg) {
        ErrorDisplay(
            message = stringResource(R.string.translation_error_serverError_message),
            modifier = Modifier.fillMaxWidth(),
            title = stringResource(R.string.translation_error_serverError_title),
            onRetry = onRetry,
            retryLabel = stringResource(R.string.translation_common_retry),
        )
    }
}

/**
 * Optional by-name read from the Android string catalog — the production seam that reproduces web
 * `t(key, default)`. `getIdentifier` is the only way to attempt a key that may be absent (a compile-time
 * `R.string` reference cannot express "resolve if present, else fall back"), so `DiscouragedApi` is
 * suppressed. Release builds keep resource names (resource shrinking is off — see app/build.gradle.kts), so
 * the by-name lookup stays stable.
 */
@SuppressLint("DiscouragedApi")
private fun Context.optionalString(resourceName: String): String? {
    val id = resources.getIdentifier(resourceName, "string", packageName)
    return if (id != 0) getString(id) else null
}

/**
 * Locally authored lucide `Sparkles` glyph, absent from the shared [io.teslasync.android.components.ui.TeslaGlyphs]
 * catalog and outside this surface's allowed-files scope, drawn as a 24×24 stroked [ImageVector] recolored at
 * render time by the [Icon] tint: a four-point concave star with a small accent sparkle — exactly as the
 * sibling EfficiencyPanel authors its lucide `Activity` glyph.
 */
private object AIRestorePanelGlyphs {
    val Sparkles: ImageVector =
        stroked("AIRestoreSparkles") {
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

private val SAMPLE_LABELS =
    listOf(
        "Per-drive coaching",
        "Charging session diagnosis",
        "Battery health forecast narrative",
    )

@Preview(name = "Prompt — with preview", showBackground = true)
@Composable
private fun AIRestorePanelPromptPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIRestorePanelContent(labels = SAMPLE_LABELS, onConfirm = {}, onDecline = {})
    }
}

@Preview(name = "Prompt — empty (no labels)", showBackground = true)
@Composable
private fun AIRestorePanelEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIRestorePanelContent(labels = emptyList(), onConfirm = {}, onDecline = {})
    }
}

@Preview(name = "Loading chrome", showBackground = true)
@Composable
private fun AIRestorePanelLoadingPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIRestorePanelContent(
            labels = emptyList(),
            onConfirm = {},
            onDecline = {},
            surfaceState = AIRestoreSurfaceState.Loading,
            reduceMotion = false,
        )
    }
}

@Preview(name = "Error chrome", showBackground = true)
@Composable
private fun AIRestorePanelErrorPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AIRestorePanelContent(
            labels = emptyList(),
            onConfirm = {},
            onDecline = {},
            surfaceState = AIRestoreSurfaceState.Error,
        )
    }
}
