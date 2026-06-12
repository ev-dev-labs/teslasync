// The native Jetpack Compose + Material 3 DriveHighlightSlide feature view — a parity port of
// web/src/features/analytics/components/review/DriveHighlightSlide.tsx. The web component is one slide in the
// Year-in-Review deck: it shows a category emoji, an uppercase label, and — for a populated drive — a
// translucent card carrying the route (start → end), a three-up stats grid (distance / duration /
// efficiency), and the drive date. When the slide has no drive (`!drive`) it shows the emoji above a single
// "No drive data for this year" line instead.
//
// The surface binds no data hook of its own (web parity): the deck owns the Year-in-Review query and passes
// `drive` / `label` / `emoji` as props. Its only web hooks map to the native shared layer — `useTranslation`
// to the generated i18n catalog (P1/S10) and `useUnits` to the live [UnitFormatter] from the shared data
// layer (P1/S8). As in the sibling AchievementBadge / SummaryStatsRow ports, the cache-then-network
// lifecycle (loading / error / stale / offline) lives on the owning page, not here; the two branches the web
// source defines — empty (`!drive`) vs the populated card — are the complete state set this surface renders,
// and both are reproduced below. Every derivation flows through the pure [DriveHighlightSlideProjection]; the
// composable is a thin render layer.
//
// Color mapping (P1/S9 tokens, no ported Tailwind): web `text-white` → `colorScheme.onSurface`,
// `--text-secondary` → `onSurfaceVariant`, `--text-muted` → `onSurfaceVariant` at [MUTED_ALPHA]. The card's
// translucent `white/[0.05]` wash + `white/[0.08]` border reproduce the web alpha values over `onSurface`
// (the same approach the sibling AchievementBadge surface uses), so the slide stays correct in light and dark
// themes. The four route/stat icons reuse the shared [DataDisplayGlyphs] lucide ports (MapPin / ArrowRight /
// Bolt=Zap / Clock) rather than re-authoring them.
//
// Motion honors the reduced-motion preference (P1/S9): the emoji's entrance spring (web framer
// `scale 0→1, rotate −10→0`) and the label/card fade-and-rise (web `<motion.p>` / `<motion.div>`) collapse to
// a static, final-state render when the user (or the OS animator scale) asks for reduced motion. The one-shot
// `view.opened` diagnostic (P1/S11) is emitted on first composition.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DriveHighlightSlide) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivehighlightslide

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.motion.FadeIn
import io.teslasync.android.components.motion.rememberReducedMotion
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.data.UnitPreferences
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.Locale

// ── Emoji entrance (web framer `scale 0→1, rotate −10→0`, spring) + glyph sizes ─────────────────────
private const val EMOJI_INITIAL_ROTATION_DEGREES = -10f
private val CONTENT_EMOJI_SIZE: TextUnit = 56.sp
private val EMPTY_EMOJI_SIZE: TextUnit = 60.sp

// ── Entrance delays (web `<motion.p>` delay 0.2s, `<motion.div>` delay 0.4s) ────────────────────────
private const val LABEL_DELAY_MS = 200
private const val CARD_DELAY_MS = 400

// ── Card geometry + the web alpha washes (reproduced over the theme `onSurface`) ────────────────────
private val CARD_MAX_WIDTH: Dp = 384.dp
private val CARD_BORDER_WIDTH: Dp = 1.dp
private const val CARD_BG_ALPHA = 0.05f
private const val CARD_BORDER_ALPHA = 0.08f

/** Web `--text-muted`: the muted variant of the secondary text/icon color. */
private const val MUTED_ALPHA = 0.7f

/** Web `tracking-wider` on the uppercase label. */
private val LABEL_LETTER_SPACING: TextUnit = 1.sp

/**
 * Stateful entry point — the faithful 1:1 port of the web `DriveHighlightSlide({ drive, label, emoji })`
 * props. Binds `useUnits` (the live [UnitFormatter] from the shared P1/S8 data layer), records the one-shot
 * PII-safe `view.opened` diagnostic (P1/S11) on first composition, and renders. The surface performs no HTTP;
 * the deck supplies [drive] (which may be `null`), [label], and [emoji].
 *
 * @param drive the highlighted drive to render, or `null` when this category has no drive this year.
 * @param label the already-localized category label shown above the card (web `label` prop).
 * @param emoji the category emoji (web `emoji` prop).
 * @param logger the sanctioned redacting logger; defaults to the app's `LocalDataContainer`.
 */
@Composable
fun DriveHighlightSlide(
    drive: DriveHighlight?,
    label: String,
    emoji: String,
    modifier: Modifier = Modifier,
    logger: Logger = LocalDataContainer.current.logger,
) {
    val formatter by LocalDataContainer.current.unitFormatter.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { DriveHighlightSlideDiagnostics.recordViewOpened(logger) }
    DriveHighlightSlideContent(
        drive = drive,
        label = label,
        emoji = emoji,
        formatter = formatter,
        modifier = modifier,
    )
}

/**
 * Stateless renderer — the unit/UI-test and preview entry point. Reproduces the two web branches: when
 * [drive] is `null` it renders the empty slide (emoji + "No drive data for this year"); otherwise it projects
 * the drive for the [formatter]'s distance preference and renders the populated slide. [formatter] is the
 * `useUnits` boundary; it defaults to metric for previews and cold start.
 */
@Composable
fun DriveHighlightSlideContent(
    drive: DriveHighlight?,
    label: String,
    emoji: String,
    modifier: Modifier = Modifier,
    formatter: UnitFormatter = UnitFormatter.default(),
) {
    if (drive == null) {
        DriveHighlightEmpty(emoji = emoji, modifier = modifier)
        return
    }
    val display =
        remember(drive, formatter.prefs.distance) {
            DriveHighlightSlideProjection.project(drive, formatter.prefs.distance)
        }
    DriveHighlightBody(emoji = emoji, label = label, display = display, modifier = modifier)
}

/**
 * The empty slide (web `!drive` branch): a vertically-centered column with the static category emoji above
 * the localized "No drive data for this year" message. The emoji is decorative — the message conveys the
 * meaning — so it is cleared from the accessibility tree.
 */
@Composable
private fun DriveHighlightEmpty(
    emoji: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = Spacing.xl3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        EmojiGlyph(
            emoji = emoji,
            fontSize = EMPTY_EMOJI_SIZE,
            modifier = Modifier.padding(bottom = Spacing.lg),
        )
        Text(
            text = stringResource(R.string.translation_yearReview_noDriveData),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

/**
 * The populated slide (web content branch): the spring-entering emoji, the fade-and-rise uppercase label, and
 * the fade-and-rise stats card, stacked and centered. The label is uppercased for display (web CSS
 * `uppercase`) using the active locale so non-Latin scripts are unaffected.
 */
@Composable
private fun DriveHighlightBody(
    emoji: String,
    label: String,
    display: DriveHighlightDisplay,
    modifier: Modifier = Modifier,
) {
    val locale: Locale = LocalConfiguration.current.locales[0]
    Column(
        modifier = modifier.fillMaxSize().padding(horizontal = Spacing.xl3),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        AnimatedEmoji(emoji = emoji, modifier = Modifier.padding(bottom = Spacing.lg))
        FadeIn(modifier = Modifier.padding(bottom = Spacing.md), delayMs = LABEL_DELAY_MS) {
            Text(
                text = label.uppercase(locale),
                style = MaterialTheme.typography.titleMedium.copy(letterSpacing = LABEL_LETTER_SPACING),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
        FadeIn(delayMs = CARD_DELAY_MS) {
            DriveHighlightCard(display = display)
        }
    }
}

/**
 * The translucent stats card (web `bg-white/[0.05] rounded-2xl p-6 max-w-sm border border-white/[0.08]`):
 * the route row, the three-up stats grid, and the date. Reproduced as a Material 3 [Surface] whose wash and
 * border are the web alpha values over the theme `onSurface`, so the card reads correctly in either theme.
 */
@Composable
private fun DriveHighlightCard(
    display: DriveHighlightDisplay,
    modifier: Modifier = Modifier,
) {
    val onSurface = MaterialTheme.colorScheme.onSurface
    Surface(
        modifier = modifier.fillMaxWidth().widthIn(max = CARD_MAX_WIDTH),
        shape = RoundedCornerShape(Radius.lg),
        color = onSurface.copy(alpha = CARD_BG_ALPHA),
        contentColor = onSurface,
        border = BorderStroke(CARD_BORDER_WIDTH, onSurface.copy(alpha = CARD_BORDER_ALPHA)),
    ) {
        Column(modifier = Modifier.padding(Spacing.xl2)) {
            DriveRouteRow(display = display, modifier = Modifier.padding(bottom = Spacing.lg))
            DriveStatsGrid(display = display)
            Text(
                text = display.date,
                style = MaterialTheme.typography.bodySmall,
                color = onSurface.copy(alpha = MUTED_ALPHA),
                modifier = Modifier.padding(top = Spacing.lg),
            )
        }
    }
}

/**
 * The route row (web `<MapPin/> start → <ArrowRight/> end`): a pin icon, the truncating start address, an
 * arrow, and the truncating end address. Addresses use the secondary text color; the icons use the muted
 * variant. Each address takes an equal share of the row and ellipsizes (web `truncate`).
 */
@Composable
private fun DriveRouteRow(
    display: DriveHighlightDisplay,
    modifier: Modifier = Modifier,
) {
    val secondary = MaterialTheme.colorScheme.onSurfaceVariant
    val muted = secondary.copy(alpha = MUTED_ALPHA)
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(imageVector = DataDisplayGlyphs.MapPin, contentDescription = null, size = IconSize.Md, tint = muted)
        Text(
            text = display.routeStart,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            color = secondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Icon(imageVector = DataDisplayGlyphs.ArrowRight, contentDescription = null, size = IconSize.Xs, tint = muted)
        Text(
            text = display.routeEnd,
            modifier = Modifier.weight(1f),
            style = MaterialTheme.typography.bodyMedium,
            color = secondary,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/**
 * The three-up stats grid (web `grid grid-cols-3 gap-3`): distance (no icon), duration (clock icon + the
 * localized "duration" label), and efficiency (bolt icon). Each cell takes an equal third of the row.
 */
@Composable
private fun DriveStatsGrid(
    display: DriveHighlightDisplay,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.md),
    ) {
        DriveStatCell(
            value = display.distanceValue,
            unit = display.distanceUnit,
            modifier = Modifier.weight(1f),
        )
        DriveStatCell(
            value = display.durationValue,
            unit = stringResource(R.string.translation_yearReview_duration),
            modifier = Modifier.weight(1f),
            icon = DataDisplayGlyphs.Clock,
        )
        DriveStatCell(
            value = display.efficiencyValue,
            unit = display.efficiencyUnit,
            modifier = Modifier.weight(1f),
            icon = DataDisplayGlyphs.Bolt,
        )
    }
}

/**
 * One stat cell (web column): the bold value — optionally preceded by a small [icon] in a centered row (web
 * `flex items-center justify-center gap-1`) — above the muted unit label. The value inherits the card's
 * `onSurface` content color (web `text-white`).
 */
@Composable
private fun DriveStatCell(
    value: String,
    unit: String,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = MUTED_ALPHA)
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (icon == null) {
            StatValue(value = value)
        } else {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(imageVector = icon, contentDescription = null, size = IconSize.Xs, tint = muted)
                StatValue(value = value)
            }
        }
        Text(
            text = unit,
            style = MaterialTheme.typography.bodySmall,
            color = muted,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

/** The bold stat number (web `text-2xl font-bold text-white`). */
@Composable
private fun StatValue(value: String) {
    Text(
        text = value,
        style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
    )
}

/**
 * The category emoji with its entrance spring (web framer `initial scale 0 rotate −10 → animate scale 1
 * rotate 0`). Honors reduced motion: when motion is reduced the emoji renders at its final scale/rotation
 * immediately. The transform is draw-time (graphicsLayer) so the layout slot is stable while it animates.
 */
@Composable
private fun AnimatedEmoji(
    emoji: String,
    modifier: Modifier = Modifier,
) {
    val reduce = rememberReducedMotion()
    val progress = remember { Animatable(if (reduce) 1f else 0f) }
    LaunchedEffect(reduce) {
        if (reduce) {
            progress.snapTo(1f)
        } else {
            progress.snapTo(0f)
            progress.animateTo(
                targetValue = 1f,
                animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMediumLow),
            )
        }
    }
    EmojiGlyph(
        emoji = emoji,
        fontSize = CONTENT_EMOJI_SIZE,
        modifier =
            modifier.graphicsLayer {
                val scale = progress.value
                scaleX = scale
                scaleY = scale
                rotationZ = EMOJI_INITIAL_ROTATION_DEGREES * (1f - scale)
            },
    )
}

/** The emoji glyph, centered and cleared from the accessibility tree (decorative — adjacent text labels it). */
@Composable
private fun EmojiGlyph(
    emoji: String,
    fontSize: TextUnit,
    modifier: Modifier = Modifier,
) {
    Text(
        text = emoji,
        fontSize = fontSize,
        textAlign = TextAlign.Center,
        modifier = modifier.clearAndSetSemantics {},
    )
}

// ── Previews (tooling-only; @Preview entry points exercise each render branch) ──────────────────────

private val PREVIEW_DRIVE =
    DriveHighlight(
        driveId = 42,
        date = "2026-03-14",
        distanceKm = 412.7,
        durationMin = 245.0,
        startAddress = "San Francisco, CA",
        endAddress = "Los Angeles, CA",
        efficiencyWhKm = 168.0,
    )

/** A miles/mph formatter for the imperial-unit preview (the `useUnits` boundary with `unit_of_length = mi`). */
private fun milesFormatter(): UnitFormatter {
    val settings = buildJsonObject { put("unit_of_length", "mi") }
    return UnitFormatter(UnitPreferences.fromSettings(settings))
}

@Preview(name = "Empty — no drive", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun DriveHighlightSlideEmptyPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveHighlightSlideContent(drive = null, label = "Longest Drive", emoji = "\uD83C\uDFC6")
    }
}

@Preview(name = "Content — metric", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun DriveHighlightSlideMetricPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveHighlightSlideContent(drive = PREVIEW_DRIVE, label = "Longest Drive", emoji = "\uD83C\uDFC6")
    }
}

@Preview(name = "Content — imperial", showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun DriveHighlightSlideImperialPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        DriveHighlightSlideContent(
            drive = PREVIEW_DRIVE,
            label = "Most Efficient",
            emoji = "\u26A1",
            formatter = milesFormatter(),
        )
    }
}
