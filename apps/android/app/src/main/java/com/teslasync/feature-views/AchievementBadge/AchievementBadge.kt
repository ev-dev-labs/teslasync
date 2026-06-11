// The native Jetpack Compose + Material 3 AchievementBadge feature view — a parity port of
// web/src/features/analytics/components/AchievementBadge.tsx. The web component renders a small rounded
// card for one achievement: an emoji badge (overlaid on a circular progress ring while the achievement is
// still locked), the name, a one-line description, and a status line that reads "✓ Unlocked" when earned
// or `{pct}%` while in progress. Earned achievements get a gold-tinted card + border and a gold name;
// in-progress ones get a muted card, a grayed/half-opacity emoji, and a gray ring — except when
// near-complete (`!unlocked && progress >= 0.8`), where the ring turns gold and the whole card pulses.
//
// Every derivation flows through the pure [AchievementBadgeProjection]; the composable is a thin render
// layer. The surface binds no data hook (the `achievement` arrives as a prop, web parity), and its one
// catalog string — the "✓ Unlocked" status — resolves through the generated i18n catalog (P1/S10)
// `lifetime.unlocked` key, so there is no English literal in this file. The one-shot `view.opened`
// diagnostic (P1/S11) is emitted on first composition.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): the web "achievement gold" (yellow-400/500) maps to
// the theme accent `colorScheme.tertiary` — the same mapping the sibling RecentlyUnlockedAchievements
// surface uses, so the two achievement surfaces stay visually consistent. The in-progress gray
// (web gray-500) maps to `colorScheme.onSurfaceVariant`. The card wash/border alphas reproduce the web
// values exactly (gold/8 + gold/30 unlocked, white/3 + white/6 locked).
//
// The near-complete pulse honors the reduced-motion preference (P1/S9, `rememberReducedMotion`): it falls
// back to a static card when the user (or the OS animator scale) asks for reduced motion.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AchievementBadge) cannot form a valid Kotlin package.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.achievementbadge

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Paint
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.ProgressRing
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import java.text.NumberFormat
import java.util.Locale

// ── Geometry per size (web `sizeConfig`: ring px / stroke px / icon text size / gap) ────────────────
private val RING_SM: Dp = 56.dp
private val RING_MD: Dp = 72.dp
private val RING_LG: Dp = 96.dp
private val STROKE_SM: Dp = 3.dp
private val STROKE_MD: Dp = 4.dp
private val STROKE_LG: Dp = 5.dp
private val ICON_SM: TextUnit = 20.sp
private val ICON_MD: TextUnit = 30.sp
private val ICON_LG: TextUnit = 36.sp

// ── Card geometry + the web alpha washes (reproduced exactly) ───────────────────────────────────────
private val BORDER_WIDTH: Dp = 1.dp
private const val UNLOCKED_BG_ALPHA = 0.08f
private const val UNLOCKED_BORDER_ALPHA = 0.30f
private const val UNLOCKED_STATUS_ALPHA = 0.70f
private const val LOCKED_BG_ALPHA = 0.03f
private const val LOCKED_BORDER_ALPHA = 0.06f
private const val LOCKED_ICON_ALPHA = 0.50f

// ── Near-complete pulse (web `animate-pulse`: opacity 1 ↔ .5, ~1s each way) ─────────────────────────
private const val PULSE_MIN_ALPHA = 0.50f
private const val PULSE_DURATION_MS = 1000

private const val NAME_MAX_LINES = 2
private const val DESCRIPTION_MAX_LINES = 2
private const val PERCENT_DIVISOR = 100.0
private const val RING_MAX = 1.0
private const val TABULAR_NUMS = "tnum"

/**
 * Stateful entry point — the faithful 1:1 port of the web `AchievementBadge({ achievement, size })` props.
 * Records the one-shot `view.opened` diagnostic on first composition (P1/S11) and renders the badge. The
 * surface binds no data of its own; the caller supplies the [achievement] (web parity).
 *
 * @param achievement the achievement to render (web `achievement`).
 * @param size the badge size (web `size`, default medium); selects the ring/icon geometry.
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun AchievementBadge(
    achievement: AchievementData,
    modifier: Modifier = Modifier,
    size: AchievementBadgeSize = AchievementBadgeSize.Md,
    logger: Logger = LocalDataContainer.current.logger,
) {
    LaunchedEffect(Unit) { AchievementBadgeDiagnostics.recordViewOpened(logger) }
    AchievementBadgeContent(achievement = achievement, size = size, modifier = modifier)
}

/**
 * Stateless renderer — the unit/UI-test + preview entry point. Reproduces the web layout exactly: a
 * centered column (web `flex flex-col items-center rounded-xl p-3`) holding the badge circle, the name,
 * the description, and the status, wrapped in a card whose wash/border switch on [AchievementData.unlocked]
 * and which pulses while near-complete (unless reduced motion is requested).
 */
@Composable
fun AchievementBadgeContent(
    achievement: AchievementData,
    modifier: Modifier = Modifier,
    size: AchievementBadgeSize = AchievementBadgeSize.Md,
) {
    val display = remember(achievement) { AchievementBadgeProjection.project(achievement) }
    val metrics = achievementBadgeMetrics(size)
    val accent = MaterialTheme.colorScheme.tertiary
    val reducedMotion = rememberReducedMotion()

    val pulseAlpha =
        if (display.isNearComplete && !reducedMotion) {
            val transition = rememberInfiniteTransition(label = "achievement-pulse")
            transition
                .animateFloat(
                    initialValue = 1f,
                    targetValue = PULSE_MIN_ALPHA,
                    animationSpec = infiniteRepeatable(tween(PULSE_DURATION_MS), RepeatMode.Reverse),
                    label = "achievement-pulse-alpha",
                ).value
        } else {
            1f
        }

    val containerColor =
        if (display.unlocked) {
            accent.copy(alpha = UNLOCKED_BG_ALPHA)
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = LOCKED_BG_ALPHA)
        }
    val borderColor =
        if (display.unlocked) {
            accent.copy(alpha = UNLOCKED_BORDER_ALPHA)
        } else {
            MaterialTheme.colorScheme.onSurface.copy(alpha = LOCKED_BORDER_ALPHA)
        }

    Surface(
        modifier = modifier.graphicsLayer { this.alpha = pulseAlpha },
        shape = RoundedCornerShape(Radius.md),
        color = containerColor,
        contentColor = MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(BORDER_WIDTH, borderColor),
    ) {
        Column(
            modifier = Modifier.padding(Spacing.md),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(metrics.gap),
        ) {
            BadgeCircle(display = display, metrics = metrics, accent = accent)
            AchievementName(display = display, style = metrics.nameStyle, accent = accent)
            Text(
                text = display.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                maxLines = DESCRIPTION_MAX_LINES,
                overflow = TextOverflow.Ellipsis,
            )
            AchievementStatus(display = display, accent = accent)
        }
    }
}

/**
 * The badge circle: the emoji icon, overlaid on the circular [ProgressRing] while [AchievementBadgeDisplay.showProgressRing]
 * is set (web renders the ring only when locked). The ring is gold when near-complete and gray otherwise;
 * the locked icon is grayscaled + half-opacity (web `opacity-50 grayscale`).
 */
@Composable
private fun BadgeCircle(
    display: AchievementBadgeDisplay,
    metrics: BadgeMetrics,
    accent: Color,
) {
    val ringColor = if (display.isNearComplete) accent else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier = if (display.showProgressRing) Modifier.size(metrics.ring) else Modifier,
        contentAlignment = Alignment.Center,
    ) {
        if (display.showProgressRing) {
            // Web `value={pct} max={100}`: the equivalent 0..1 progress fraction (pct / 100).
            ProgressRing(
                value = display.percent / PERCENT_DIVISOR,
                max = RING_MAX,
                size = metrics.ring,
                strokeWidth = metrics.stroke,
                color = ringColor,
            )
        }
        EmojiIcon(
            icon = display.icon,
            fontSize = metrics.icon,
            label = display.name,
            dimmed = !display.unlocked,
        )
    }
}

/**
 * The emoji badge glyph. Web parity: `role="img" aria-label={name}` — the raw emoji semantics are cleared
 * and replaced with the achievement [label] so TalkBack announces the name, not the emoji. When [dimmed]
 * (locked) the glyph is desaturated to half opacity (web `opacity-50 grayscale`).
 */
@Composable
private fun EmojiIcon(
    icon: String,
    fontSize: TextUnit,
    label: String,
    dimmed: Boolean,
) {
    val glyphModifier = if (dimmed) Modifier.desaturate(LOCKED_ICON_ALPHA) else Modifier
    Text(
        text = icon,
        fontSize = fontSize,
        textAlign = TextAlign.Center,
        modifier =
            glyphModifier.clearAndSetSemantics {
                contentDescription = label
                role = Role.Image
            },
    )
}

/** The name line: gold + emphasized when unlocked, muted otherwise (web `text-yellow-400` vs secondary). */
@Composable
private fun AchievementName(
    display: AchievementBadgeDisplay,
    style: TextStyle,
    accent: Color,
) {
    Text(
        text = display.name,
        style = style.copy(fontWeight = FontWeight.SemiBold),
        color = if (display.unlocked) accent else MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        maxLines = NAME_MAX_LINES,
        overflow = TextOverflow.Ellipsis,
    )
}

/**
 * The status line: the localized "✓ Unlocked" label (catalog `lifetime.unlocked`) when earned, otherwise
 * the `{pct}%` progress rendered with locale-aware, tabular figures (web `tabular-nums`).
 */
@Composable
private fun AchievementStatus(
    display: AchievementBadgeDisplay,
    accent: Color,
) {
    if (display.unlocked) {
        Text(
            text = stringResource(R.string.translation_lifetime_unlocked),
            style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Medium),
            color = accent.copy(alpha = UNLOCKED_STATUS_ALPHA),
        )
    } else {
        val locale: Locale = LocalConfiguration.current.locales[0]
        val percentText =
            remember(display.percent, locale) {
                NumberFormat.getPercentInstance(locale).format(display.percent / PERCENT_DIVISOR)
            }
        Text(
            text = percentText,
            style = MaterialTheme.typography.labelMedium.copy(fontFeatureSettings = TABULAR_NUMS),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Resolved geometry + name typography for a [size] — the native analogue of the web `sizeConfig[size]`. */
private class BadgeMetrics(
    val ring: Dp,
    val stroke: Dp,
    val icon: TextUnit,
    val gap: Dp,
    val nameStyle: TextStyle,
)

@Composable
private fun achievementBadgeMetrics(size: AchievementBadgeSize): BadgeMetrics {
    val typography = MaterialTheme.typography
    return when (size) {
        AchievementBadgeSize.Sm -> BadgeMetrics(RING_SM, STROKE_SM, ICON_SM, Spacing.xs, typography.labelLarge)
        AchievementBadgeSize.Md -> BadgeMetrics(RING_MD, STROKE_MD, ICON_MD, Spacing.sm, typography.bodyMedium)
        AchievementBadgeSize.Lg -> BadgeMetrics(RING_LG, STROKE_LG, ICON_LG, Spacing.md, typography.titleSmall)
    }
}

/**
 * Desaturating overlay — the native analogue of the web `grayscale` + `opacity-50` filters. Draws the
 * content into an offscreen layer painted through a zero-saturation [ColorMatrix] at [alpha] opacity, so
 * even a full-color emoji renders gray and dim. Works on every supported API level (no RenderEffect gate).
 */
private fun Modifier.desaturate(alpha: Float): Modifier =
    drawWithContent {
        val grayscale = ColorMatrix().apply { setToSaturation(0f) }
        val paint =
            Paint().apply {
                colorFilter = ColorFilter.colorMatrix(grayscale)
                this.alpha = alpha
            }
        drawIntoCanvas { canvas ->
            canvas.saveLayer(Rect(Offset.Zero, size), paint)
            drawContent()
            canvas.restore()
        }
    }

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_UNLOCKED =
    AchievementData(
        id = "first-drive",
        name = "First Drive",
        description = "Complete your first recorded drive",
        icon = "🏁",
        unlocked = true,
        unlockedAt = "2026-01-01T00:00:00Z",
        progress = 1.0,
        target = 1.0,
        current = 1.0,
    )

private val PREVIEW_IN_PROGRESS =
    AchievementData(
        id = "road-tripper",
        name = "Road Tripper",
        description = "Drive 1,000 km in a single month",
        icon = "🛣️",
        unlocked = false,
        progress = 0.45,
        target = 1_000.0,
        current = 450.0,
    )

private val PREVIEW_NEAR_COMPLETE =
    AchievementData(
        id = "supercharged",
        name = "Supercharged",
        description = "Use 50 Supercharger sessions",
        icon = "⚡",
        unlocked = false,
        progress = 0.9,
        target = 50.0,
        current = 45.0,
    )

@Preview(name = "Unlocked", showBackground = true)
@Composable
private fun AchievementBadgeUnlockedPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AchievementBadgeContent(PREVIEW_UNLOCKED)
    }
}

@Preview(name = "In progress", showBackground = true)
@Composable
private fun AchievementBadgeInProgressPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AchievementBadgeContent(PREVIEW_IN_PROGRESS)
    }
}

@Preview(name = "Near complete", showBackground = true)
@Composable
private fun AchievementBadgeNearCompletePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AchievementBadgeContent(PREVIEW_NEAR_COMPLETE)
    }
}

@Preview(name = "Large — unlocked", showBackground = true)
@Composable
private fun AchievementBadgeLargePreview() {
    TeslaSyncTheme(dynamicColor = false) {
        AchievementBadgeContent(PREVIEW_UNLOCKED, size = AchievementBadgeSize.Lg)
    }
}
