// The native Jetpack Compose + Material 3 StatusHero shared surface — a parity port of
// web/src/components/status/StatusHero.tsx. The web surface is a large, at-a-glance "is my instance healthy?"
// hero card: a tinted status ring + glyph, a bold headline (the caller's override or a per-status default), an
// optional subline (with an optional inline "Live" dot), and an optional refresh CTA — used by the
// SystemStatusPage hero and embeddable on dashboards. It is pure presentational — the parent owns the status
// and the component has no data hook.
//
// Every derivation flows through the pure model in StatusHeroModel.kt (projectStatus → [StatusHeroProjection]);
// this composable is a thin render layer that maps the projected [StatusTone] onto the per-theme TeslaTokens
// palette (P1/S9), the projected [StatusGlyphKind] onto a stroked vector, and the default headline onto a
// localized P1/S10 string, then paints the GlassPanel hero. It performs NO HTTP and fires the one-shot PII-safe
// `view.opened` diagnostic (P1/S11) on first composition.
//
// Faithful mapping of the web behaviour:
//   • the web `STATUS_CONFIG[status]` icon + colour family → [statusGlyph] + [statusToneColor], one per status;
//   • the web glow (`boxShadow: 0 0 60px {rgba}`) → the GlassPanel tinted `accent` border, the platform glow
//     replacement the shared GlassPanel documents ([statusPanelAccent]);
//   • the web `headline ?? cfg.defaultHeadline` → the caller's [headline] or the localized default; the web
//     hardcodes English defaults (it has no `useTranslation`), so — per the native covenant (no English
//     literals) — the native port routes every default through the P1/S10 catalog instead;
//   • the web `role="status" aria-live="polite"` region → a merged status node with a polite live region;
//   • the web `<LiveIndicator variant="dot" /> Live` (shown only with a subline) → the native LiveIndicator dot
//     surface (the @/components/data-display counterpart) plus the localized "Live" label;
//   • the web `<Button … ><RefreshCw className={loading && 'animate-spin'} />{label}</Button>` CTA → the shared
//     `Button` with a refresh leading icon and a `loading` spinner that also disables the control.
//
// States reproduced (every one renders a non-blank card): the five status branches (healthy / degraded /
// unhealthy / unknown / maintenance — `unknown` being the cold-start / not-yet-known surface), the
// headline-override branch, the subline branch, the inline live-dot branch, and the CTA branch.
//
// The web `id` (in-page anchor for the StickyCompactHero IntersectionObserver) and `className` are web-DOM
// concerns: `className` maps to [Modifier]; `id` has no native analogue (there is no DOM scroll target) and is
// intentionally not ported.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/StatusHero) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed for the co-located stateless renderer, glyphs, helpers, and previews.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.statushero

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ReadOnlyComposable
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.R
import io.teslasync.android.components.feedback.FeedbackGlyphs
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelAccent
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.sharedsurfaces.liveindicator.LiveIndicator
import io.teslasync.android.sharedsurfaces.liveindicator.LiveIndicatorVariant
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger

/** Test tag identifying the merged status region (the web `role="status"` node) — used by the a11y UI test. */
const val STATUS_HERO_STATUS_TAG: String = "status-hero-status"

/** The status ring diameter — the native mirror of the web `h-14 w-14` (56px) circle. */
private val RING_SIZE = 56.dp

/** The status ring stroke — the native mirror of the web `ring-2` (2px) ring. */
private val RING_STROKE = 2.dp

/** Soft tint behind the glyph over the status colour — the native mirror of the web `bg-{color}/15`. */
private const val RING_BG_ALPHA = 0.15f

/** The status ring colour over the status colour — the native mirror of the web `ring-{color}/40`. */
private const val RING_BORDER_ALPHA = 0.4f

/**
 * Stateful entry point — the faithful port of `<StatusHero status={…} … />`. Records the one-shot `view.opened`
 * diagnostic, projects [status] via [projectStatus] (the web `STATUS_CONFIG[status]`), resolves the headline
 * ([headline] override or the localized per-status default), and renders the hero. Always renders (the web
 * component never returns `null`). Performs no HTTP; [logger] defaults to the process logger.
 *
 * @param status the health tier to surface (web `status`).
 * @param headline overrides the per-status default headline (web `headline`).
 * @param subline the line shown beneath the headline (web `subline`); the inline live dot renders only with it.
 * @param live whether to show the inline "Live" dot next to the subline (web `live`).
 * @param cta an optional refresh call-to-action (web `cta`).
 * @param logger the sanctioned redacting logger; defaults to the app's [io.teslasync.android.data.DataContainer].
 */
@Composable
fun StatusHero(
    status: HeroStatus,
    modifier: Modifier = Modifier,
    headline: String? = null,
    subline: String? = null,
    live: Boolean = false,
    cta: StatusHeroCta? = null,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { StatusHeroDiagnostics.recordViewOpened(logger) }
    val projection = remember(status) { projectStatus(status) }
    val heading = headline ?: stringResource(defaultHeadlineRes(status))
    StatusHeroContent(
        projection = projection,
        heading = heading,
        modifier = modifier,
        subline = subline,
        cta = cta,
        liveSlot =
            if (live) {
                { LiveIndicator(variant = LiveIndicatorVariant.Dot) }
            } else {
                null
            },
    )
}

/**
 * Stateless renderer — the UI-test + preview entry point. Paints the GlassPanel hero from a fully resolved
 * [projection] + [heading]: the tinted status ring + glyph, the bold tone-coloured headline inside a merged
 * polite status region (web `role="status"`), the optional [subline] with its optional [liveSlot] + "Live"
 * label, and the optional [cta]. Carries no diagnostics, so a parent embedding several heroes never emits
 * per-item events, and it never touches [LocalDataContainer] — so previews and tests host it without a
 * DataContainer (the live dot is injected via [liveSlot]).
 */
@Composable
fun StatusHeroContent(
    projection: StatusHeroProjection,
    heading: String,
    modifier: Modifier = Modifier,
    subline: String? = null,
    cta: StatusHeroCta? = null,
    liveSlot: (@Composable () -> Unit)? = null,
) {
    val tone = statusToneColor(projection.tone)
    GlassPanel(modifier = modifier, accent = statusPanelAccent(projection.tone)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.md),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            StatusIconRing(glyph = statusGlyph(projection.glyph), tone = tone)
            StatusHeroText(
                heading = heading,
                tone = tone,
                subline = subline,
                liveSlot = liveSlot,
                modifier = Modifier.weight(1f),
            )
            if (cta != null) {
                Button(
                    label = cta.label,
                    onClick = cta.onClick,
                    variant = ButtonVariant.Primary,
                    size = ButtonSize.Md,
                    loading = cta.loading,
                    leadingIcon = FeedbackGlyphs.Refresh,
                )
            }
        }
    }
}

/** The tinted status ring + centred glyph — the web `rounded-full ring-2 {bg} {ring}` circle. Decorative. */
@Composable
private fun StatusIconRing(
    glyph: ImageVector,
    tone: Color,
) {
    Box(
        modifier =
            Modifier
                .size(RING_SIZE)
                .clip(CircleShape)
                .background(tone.copy(alpha = RING_BG_ALPHA))
                .border(RING_STROKE, tone.copy(alpha = RING_BORDER_ALPHA), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        // Decorative (web `aria-hidden`): the status meaning is spoken by the headline in the status region.
        Icon(imageVector = glyph, contentDescription = null, size = IconSize.Xl, tint = tone)
    }
}

/**
 * The headline + optional subline, wrapped in the merged polite status region (web `role="status"
 * aria-live="polite"`). The inline live dot + "Live" label render only with a [subline], exactly as the web
 * nests them inside the `{subline && …}` block.
 */
@Composable
private fun StatusHeroText(
    heading: String,
    tone: Color,
    subline: String?,
    liveSlot: (@Composable () -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
            modifier
                .testTag(STATUS_HERO_STATUS_TAG)
                .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        verticalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(
            text = heading,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = tone,
        )
        if (subline != null) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = subline,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (liveSlot != null) {
                    liveSlot()
                    Text(
                        text = stringResource(R.string.translation_Live),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/**
 * Map the projected [StatusTone] onto a per-theme colour — the native mirror of the web `STATUS_CONFIG` colour
 * families, drawn from the TeslaTokens status palette (and the Material scheme's muted colour for the neutral
 * `unknown` tier) so light / dark / high-contrast all stay correct.
 */
@Composable
@ReadOnlyComposable
private fun statusToneColor(tone: StatusTone): Color =
    when (tone) {
        StatusTone.Success -> TeslaTokens.status.success
        StatusTone.Warning -> TeslaTokens.status.warning
        StatusTone.Danger -> TeslaTokens.status.danger
        StatusTone.Info -> TeslaTokens.status.info
        StatusTone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant
    }

/**
 * Map the projected [StatusTone] onto the GlassPanel border accent — the platform replacement for the web glow
 * (the shared GlassPanel documents `accent` as the glow affordance). The neutral `unknown` tier uses the
 * default outline ([PanelAccent.None]).
 */
private fun statusPanelAccent(tone: StatusTone): PanelAccent =
    when (tone) {
        StatusTone.Success -> PanelAccent.Success
        StatusTone.Warning -> PanelAccent.Warning
        StatusTone.Danger -> PanelAccent.Danger
        StatusTone.Info -> PanelAccent.Info
        StatusTone.Neutral -> PanelAccent.None
    }

/**
 * The localized default headline for a [status] — the native mirror of the web `STATUS_CONFIG.defaultHeadline`.
 * The web hardcodes English; the native port resolves each through the P1/S10 catalog (the parallel status
 * labels plus the exact maintenance title), so no English literal lives in native code and the headline stays
 * translated. The primary call path supplies an explicit localized [headline] anyway.
 */
@StringRes
private fun defaultHeadlineRes(status: HeroStatus): Int =
    when (status) {
        HeroStatus.Healthy -> R.string.translation_Healthy
        HeroStatus.Degraded -> R.string.translation_Degraded
        HeroStatus.Unhealthy -> R.string.translation_Unhealthy
        HeroStatus.Unknown -> R.string.translation_Unknown
        HeroStatus.Maintenance -> R.string.translation_serviceMode_banner_maintenanceTitle
    }

/** Resolve a [StatusGlyphKind] to its stroked vector — the native mirror of the web `STATUS_CONFIG.icon`. */
private fun statusGlyph(kind: StatusGlyphKind): ImageVector =
    when (kind) {
        StatusGlyphKind.CheckCircle -> StatusHeroGlyphs.CheckCircle
        StatusGlyphKind.AlertTriangle -> StatusHeroGlyphs.AlertTriangle
        StatusGlyphKind.XCircle -> StatusHeroGlyphs.XCircle
        StatusGlyphKind.HelpCircle -> StatusHeroGlyphs.HelpCircle
        StatusGlyphKind.Wrench -> StatusHeroGlyphs.Wrench
    }

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The status glyph set, authored as 24×24 stroked [ImageVector]s in the same line style as the shared
 * `DataDisplayGlyphs` / `FeedbackGlyphs` catalogs (Android has no bundled `lucide-react`). Each is monochrome
 * and recoloured at render time by the `Icon` tint. Kept local so the surface owns its full status icon set
 * (XCircle / HelpCircle are not in any shared catalog), exactly as the per-surface glyph files do.
 */
private object StatusHeroGlyphs {
    /** Web `CheckCircle` (healthy). */
    val CheckCircle: ImageVector =
        statusStroked("CheckCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(8f, 12.5f)
            lineTo(11f, 15.5f)
            lineTo(16f, 9f)
        }

    /** Web `AlertTriangle` (degraded). */
    val AlertTriangle: ImageVector =
        statusStroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphDot(12f, 16.5f)
        }

    /** Web `XCircle` (unhealthy). */
    val XCircle: ImageVector =
        statusStroked("XCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
        }

    /** Web `HelpCircle` (unknown). */
    val HelpCircle: ImageVector =
        statusStroked("HelpCircle") {
            glyphCircle(12f, 12f, 9f)
            moveTo(9.5f, 9.5f)
            curveTo(9.5f, 7.8f, 10.6f, 7f, 12f, 7f)
            curveTo(13.4f, 7f, 14.5f, 8f, 14.5f, 9.4f)
            curveTo(14.5f, 11f, 13f, 11.4f, 12.4f, 12.4f)
            lineTo(12.4f, 13.5f)
            glyphDot(12.4f, 16.5f)
        }

    /** Web `Wrench` (maintenance). */
    val Wrench: ImageVector =
        statusStroked("Wrench") {
            moveTo(15f, 4f)
            curveTo(17.5f, 4f, 19.5f, 6f, 19.5f, 8.5f)
            curveTo(19.5f, 9.5f, 19f, 10.5f, 19f, 10.5f)
            lineTo(10.5f, 19f)
            curveTo(9.5f, 20f, 8f, 20f, 7f, 19f)
            curveTo(6f, 18f, 6f, 16.5f, 7f, 15.5f)
            lineTo(15.5f, 7f)
            curveTo(15.5f, 7f, 14.5f, 4f, 15f, 4f)
            close()
        }
}

/** Build a round-capped, round-joined 24×24 stroked vector — the shared catalog's glyph authoring style. */
private fun statusStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_SIZE,
            defaultHeight = GLYPH_SIZE,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(
                stroke = SolidColor(Color.Black),
                strokeLineWidth = GLYPH_STROKE,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.glyphDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs. */
private fun PathBuilder.glyphCircle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}

// ── Previews (tooling-only; sample sublines / CTA labels are never shipped UI) ─────────────────────────────

@Composable
private fun PreviewHero(
    status: HeroStatus,
    subline: String? = null,
    cta: StatusHeroCta? = null,
    live: Boolean = false,
) {
    StatusHeroContent(
        projection = projectStatus(status),
        heading = stringResource(defaultHeadlineRes(status)),
        subline = subline,
        cta = cta,
        liveSlot = if (live) ({ PreviewLiveDot() }) else null,
    )
}

/** A static colored dot standing in for the stateful LiveIndicator in previews (which have no DataContainer). */
@Composable
private fun PreviewLiveDot() {
    Box(Modifier.size(8.dp).clip(CircleShape).background(TeslaTokens.status.success))
}

@Preview(name = "Healthy — default headline", showBackground = true)
@Composable
private fun StatusHeroHealthyPreview() {
    TeslaSyncTheme(dynamicColor = false) { PreviewHero(HeroStatus.Healthy) }
}

@Preview(name = "Degraded — with subline", showBackground = true)
@Composable
private fun StatusHeroDegradedPreview() {
    TeslaSyncTheme(dynamicColor = false) { PreviewHero(HeroStatus.Degraded, subline = "Last checked 12s ago") }
}

@Preview(name = "Unhealthy — subline + live dot", showBackground = true)
@Composable
private fun StatusHeroUnhealthyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHero(HeroStatus.Unhealthy, subline = "Health check failed", live = true)
    }
}

@Preview(name = "Unknown — cold start", showBackground = true)
@Composable
private fun StatusHeroUnknownPreview() {
    TeslaSyncTheme(dynamicColor = false) { PreviewHero(HeroStatus.Unknown) }
}

@Preview(name = "Maintenance — with CTA", showBackground = true)
@Composable
private fun StatusHeroMaintenancePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        PreviewHero(HeroStatus.Maintenance, cta = StatusHeroCta(label = "Run health check", onClick = {}))
    }
}

@Preview(name = "Dark — healthy with CTA loading", showBackground = true)
@Composable
private fun StatusHeroDarkPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        PreviewHero(
            HeroStatus.Healthy,
            subline = "All checks passing",
            cta = StatusHeroCta(label = "Run health check", onClick = {}, loading = true),
        )
    }
}
