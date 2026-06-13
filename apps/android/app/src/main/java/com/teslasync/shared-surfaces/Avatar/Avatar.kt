// The native Jetpack Compose + Material 3 Avatar shared surface — a parity port of
// web/src/components/data-display/Avatar.tsx. It renders one of three visuals in the web's priority order —
// an `src` image (falling back to initials/glyph on load error), deterministic two-letter initials on a
// colour-blind-safe hue hashed from the user-id/name seed, or a generic glyph (a person for `kind="user"`,
// the Helix brand mark for `kind="bot"`) — plus the optional presence dot and the optional tooltip. All
// projection logic lives in the pure [resolveAvatarVisual] (AvatarModel.kt) so this file is a thin renderer.
//
// [Avatar] is the stateless primitive: a faithful 1:1 port of the web component's props, the reusable atom
// and the per-state preview/test entry. [AvatarSurface] is the holder-backed entry the prompt mandates: it
// binds the [AvatarSource] identity seam (P1/S8) through [AvatarViewModel], records the one-shot `view.opened`
// diagnostic (P1/S11), collects the live identity (so a presence transition updates the dot in place) and
// renders it — the same primitive/consumer split as the accepted VisuallyHidden / AnnouncerRegion siblings.
//
// The web `HelixMark` and the generic person glyph have no native atom (those are the out-of-scope P3
// component-library bundle), so both are authored here as native [Canvas] drawings in the shared monochrome
// style (mirroring the sibling AIChatbotIndicator's Helix), recolouring with the resolved foreground tint —
// complete, working visuals, not skeletons. The web `<img>` branch is reproduced through a host-supplied
// [AvatarImageContent] slot wired to the web `onError` → fallback behaviour: the self-hosted app ships no
// network image loader, so when no slot is supplied the avatar resolves to the initials/glyph fallback
// exactly as the web does after an image error — the image LOGIC is reproduced without hard-wiring a loader
// this surface does not own. Every visible string resolves through the P1/S10 catalog (`translation_avatar_*`)
// and the whole avatar carries one merged TalkBack description (name + presence).
//
// `MatchingDeclarationName`/`InvalidPackageDeclaration` are suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/Avatar) cannot form a valid Kotlin package and the file hosts several
// co-located composables, exactly as the sibling surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.avatar

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.teslasync.android.R
import io.teslasync.android.components.ui.Tooltip
import io.teslasync.android.data.LocalDataContainer
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.Radius
import io.teslasync.shared.core.diagnostics.Logger
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * A host slot rendering the avatar image (web `<img>`). It receives the resolved [src], the [contentDescription]
 * (the avatar's accessible name) and an [onError] callback to invoke when the image fails to load — wiring the
 * web `onError` → fallback. The self-hosted app ships no network image loader, so callers that have one pass it
 * here; when omitted, [Avatar] resolves to the initials/glyph fallback.
 */
typealias AvatarImageContent = @Composable (src: String, contentDescription: String, onError: () -> Unit) -> Unit

/** Generic-glyph dimension as a fraction of the avatar box (web `Math.round(sizePx * 0.6)`). */
private const val GLYPH_RATIO: Float = 0.6f

/** Foreground tint for content on a saturated, attributed palette hue (web `text-white`). */
private val ATTRIBUTED_FOREGROUND: Color = Color.White

/** Ring width separating the presence dot from the avatar (web `ring-2 ring-[--surface-1]`). */
private val STATUS_RING_WIDTH: Dp = 2.dp

// Person-glyph geometry, normalized to the canvas' min dimension.
private const val GLYPH_CENTER: Float = 0.5f
private const val USER_HEAD_RADIUS: Float = 0.19f
private const val USER_HEAD_CENTER_Y: Float = 0.30f
private const val USER_SHOULDER_START: Float = 180f
private const val USER_SHOULDER_SWEEP: Float = 180f
private const val USER_SHOULDER_LEFT: Float = 0.14f
private const val USER_SHOULDER_TOP: Float = 0.52f
private const val USER_SHOULDER_WIDTH: Float = 0.72f
private const val USER_SHOULDER_HEIGHT: Float = 0.92f

// HelixMark geometry (normalized), mirroring web `HelixMark` and the sibling AIChatbotIndicator.
private const val HELIX_TOP: Float = 0.12f
private const val HELIX_BOTTOM: Float = 0.88f
private const val HELIX_AMPLITUDE: Float = 0.24f
private const val HELIX_STROKE: Float = 0.085f
private const val HELIX_RUNG_STROKE: Float = 0.06f
private const val HELIX_TURNS: Float = 1.5f
private const val HELIX_HALF_TURN: Float = 2f
private const val HELIX_SEGMENTS: Int = 28
private const val HELIX_RUNGS: Int = 3

/**
 * The stateless Avatar primitive — the faithful port of the web `Avatar` component. Renders, in priority
 * order, the [src] image (via [imageContent], falling back on error), deterministic initials for [name], or
 * the [kind] glyph, on a colour-blind-safe hue hashed from [userId]/[name]; an optional presence [status] dot;
 * and an optional [showTooltip] wrapper. The reusable atom and the per-state preview/test entry — it performs
 * no work beyond rendering its inputs.
 */
@Composable
fun Avatar(
    modifier: Modifier = Modifier,
    userId: String? = null,
    name: String? = null,
    src: String? = null,
    size: AvatarSize = AvatarSize.Sm,
    shape: AvatarShape = AvatarShape.Circle,
    status: AvatarStatus? = null,
    showTooltip: Boolean = false,
    kind: AvatarKind = AvatarKind.User,
    imageContent: AvatarImageContent? = null,
) {
    AvatarRender(
        identity = AvatarIdentity(userId = userId, name = name, src = src, status = status, kind = kind),
        size = size,
        shape = shape,
        showTooltip = showTooltip,
        imageContent = imageContent,
        modifier = modifier,
    )
}

/**
 * The holder-backed Avatar surface — binds the [source] identity seam (P1/S8) through an [AvatarViewModel],
 * records the one-shot `view.opened` diagnostic (P1/S11), collects the live [AvatarIdentity] (so a presence
 * transition re-renders the dot) and renders it. Mount this where the avatar's identity comes from the shared
 * layer; use [Avatar] directly when the props are already in hand. [logger] defaults to the process logger and
 * [instanceKey] scopes the ViewModel per placement.
 */
@Composable
fun AvatarSurface(
    source: AvatarSource,
    modifier: Modifier = Modifier,
    size: AvatarSize = AvatarSize.Sm,
    shape: AvatarShape = AvatarShape.Circle,
    showTooltip: Boolean = false,
    imageContent: AvatarImageContent? = null,
    logger: Logger = LocalDataContainer.current.logger,
    instanceKey: String = AVATAR_SLUG,
) {
    val viewModel: AvatarViewModel =
        viewModel(key = instanceKey, factory = AvatarViewModel.factory(source, logger))
    LaunchedEffect(viewModel) { viewModel.onViewOpened() }
    val identity by viewModel.state.collectAsStateWithLifecycle()
    AvatarRender(
        identity = identity,
        size = size,
        shape = shape,
        showTooltip = showTooltip,
        imageContent = imageContent,
        modifier = modifier,
    )
}

/**
 * Resolves [identity] into its [AvatarVisual] (owning the local image-failure flag the web component keeps in
 * state) and renders the figure, wrapping it in a [Tooltip] when [showTooltip] is set. When no [imageContent]
 * slot is supplied the image is treated as unavailable so the surface falls back to initials/glyph — the web
 * `onError` outcome. Shared by both public entries so they render identically.
 */
@Composable
private fun AvatarRender(
    identity: AvatarIdentity,
    size: AvatarSize,
    shape: AvatarShape,
    showTooltip: Boolean,
    imageContent: AvatarImageContent?,
    modifier: Modifier = Modifier,
) {
    var imageFailed by remember(identity.src) { mutableStateOf(false) }
    val palette = TeslaTokens.chart.categorical
    val canRenderImage = imageContent != null
    val visual = resolveAvatarVisual(identity, imageFailed || !canRenderImage, palette.size)

    val unknown = stringResource(R.string.translation_avatar_unknown)
    val statusLabel = identity.status?.let { stringResource(statusLabelRes(it)) }
    val description = avatarAccessibilityLabel(identity.name, unknown, statusLabel)
    val altText = avatarTooltipLabel(identity.name, unknown)

    val figure: @Composable () -> Unit = {
        AvatarFigure(
            visual = visual,
            status = identity.status,
            size = size,
            shape = shape,
            description = description,
            altText = altText,
            palette = palette,
            imageContent = imageContent,
            onImageError = { imageFailed = true },
            modifier = modifier,
        )
    }
    if (showTooltip) {
        Tooltip(text = altText) { figure() }
    } else {
        figure()
    }
}

/**
 * The avatar box: a clipped, optionally coloured circle/rounded square carrying the resolved [visual]
 * (image / initials / glyph) and the optional presence dot. Coloured with the seeded palette hue only when
 * the avatar is [AvatarVisual.attributed] (web `isAttributed`); otherwise a neutral surface so an anonymous
 * avatar never implies a user identity. The whole box carries one merged [description] for TalkBack.
 */
@Composable
private fun AvatarFigure(
    visual: AvatarVisual,
    status: AvatarStatus?,
    size: AvatarSize,
    shape: AvatarShape,
    description: String,
    altText: String,
    palette: List<Color>,
    imageContent: AvatarImageContent?,
    onImageError: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val figureShape = if (shape == AvatarShape.Circle) CircleShape else RoundedCornerShape(Radius.lg)
    val background =
        when {
            visual.content is AvatarContent.Image -> Color.Transparent
            visual.attributed && palette.isNotEmpty() -> palette[visual.colorIndex]
            else -> MaterialTheme.colorScheme.surfaceVariant
        }
    val foreground = if (visual.attributed) ATTRIBUTED_FOREGROUND else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier =
            modifier
                .size(size.px.dp)
                .clip(figureShape)
                .background(background)
                .clearAndSetSemantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        when (val content = visual.content) {
            is AvatarContent.Image -> imageContent?.invoke(content.src, altText, onImageError)
            is AvatarContent.Initials -> AvatarInitials(text = content.text, size = size, color = foreground)
            is AvatarContent.Glyph -> AvatarGlyph(kind = content.kind, size = size, tint = foreground)
        }
        if (status != null) {
            AvatarStatusDot(status = status, size = size)
        }
    }
}

/** Decorative two-letter initials (web `aria-hidden` span), sized to the avatar so they never overflow. */
@Composable
private fun AvatarInitials(
    text: String,
    size: AvatarSize,
    color: Color,
) {
    val fontSize = with(LocalDensity.current) { initialsFontDp(size).toSp() }
    Text(
        text = text,
        color = color,
        fontSize = fontSize,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

/** The generic no-name glyph: a native person silhouette ([AvatarKind.User]) or the Helix mark
 * ([AvatarKind.Bot]), drawn with [Canvas] so it recolours with [tint]. */
@Composable
private fun AvatarGlyph(
    kind: AvatarKind,
    size: AvatarSize,
    tint: Color,
) {
    val dimension = (size.px * GLYPH_RATIO).roundToInt().dp
    when (kind) {
        AvatarKind.User -> Canvas(Modifier.size(dimension)) { drawUserGlyph(tint) }
        AvatarKind.Bot -> Canvas(Modifier.size(dimension)) { drawHelixMark(tint) }
    }
}

/** The presence dot anchored bottom-end: green (online) / amber (idle) / neutral grey (offline), inside a
 * surface-coloured ring so it reads against any avatar background (web's status dot + ring). */
@Composable
private fun BoxScope.AvatarStatusDot(
    status: AvatarStatus,
    size: AvatarSize,
) {
    val dot = statusDotDp(size)
    val color =
        when (status) {
            AvatarStatus.Online -> TeslaTokens.status.success
            AvatarStatus.Idle -> TeslaTokens.status.warning
            AvatarStatus.Offline -> MaterialTheme.colorScheme.outlineVariant
        }
    Box(
        modifier =
            Modifier
                .align(Alignment.BottomEnd)
                .size(dot + STATUS_RING_WIDTH * 2)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surface),
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(dot).clip(CircleShape).background(color))
    }
}

/** The P1/S10 string id for a presence [status] (`translation_avatar_status*`). */
private fun statusLabelRes(status: AvatarStatus): Int =
    when (status) {
        AvatarStatus.Online -> R.string.translation_avatar_statusOnline
        AvatarStatus.Idle -> R.string.translation_avatar_statusIdle
        AvatarStatus.Offline -> R.string.translation_avatar_statusOffline
    }

/** Decorative initials font size per avatar size, matching the web `text-[8px]`..`text-sm` ramp. */
private fun initialsFontDp(size: AvatarSize): Dp =
    when (size) {
        AvatarSize.Xs -> 8.dp
        AvatarSize.Sm -> 10.dp
        AvatarSize.Md -> 12.dp
        AvatarSize.Lg -> 14.dp
    }

/** Presence-dot diameter per avatar size (web `h-1.5`..`h-3`). */
private fun statusDotDp(size: AvatarSize): Dp =
    when (size) {
        AvatarSize.Xs -> 6.dp
        AvatarSize.Sm -> 8.dp
        AvatarSize.Md -> 10.dp
        AvatarSize.Lg -> 12.dp
    }

/** Draws a person silhouette (head + shoulders dome) filling the canvas in [tint]. */
private fun DrawScope.drawUserGlyph(tint: Color) {
    val side = size.minDimension
    drawCircle(
        color = tint,
        radius = side * USER_HEAD_RADIUS,
        center = Offset(side * GLYPH_CENTER, side * USER_HEAD_CENTER_Y),
    )
    drawArc(
        color = tint,
        startAngle = USER_SHOULDER_START,
        sweepAngle = USER_SHOULDER_SWEEP,
        useCenter = true,
        topLeft = Offset(side * USER_SHOULDER_LEFT, side * USER_SHOULDER_TOP),
        size = Size(side * USER_SHOULDER_WIDTH, side * USER_SHOULDER_HEIGHT),
    )
}

/** Draws the Helix brand mark — two interleaving strands joined by rungs — in [tint] (web `HelixMark`). */
private fun DrawScope.drawHelixMark(tint: Color) {
    val side = size.minDimension
    val centerX = size.width / 2f
    val top = side * HELIX_TOP
    val bottom = side * HELIX_BOTTOM
    val amplitude = side * HELIX_AMPLITUDE

    fun strand(phase: Float): Path =
        Path().apply {
            for (i in 0..HELIX_SEGMENTS) {
                val fraction = i / HELIX_SEGMENTS.toFloat()
                val y = top + (bottom - top) * fraction
                val x = centerX + amplitude * sin(fraction * HELIX_TURNS * HELIX_HALF_TURN * PI.toFloat() + phase)
                if (i == 0) moveTo(x, y) else lineTo(x, y)
            }
        }
    drawPath(strand(0f), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
    drawPath(strand(PI.toFloat()), color = tint, style = Stroke(width = side * HELIX_STROKE, cap = StrokeCap.Round))
    for (k in 1..HELIX_RUNGS) {
        val fraction = k / (HELIX_RUNGS + 1).toFloat()
        val y = top + (bottom - top) * fraction
        val angle = fraction * HELIX_TURNS * HELIX_HALF_TURN * PI.toFloat()
        drawLine(
            color = tint,
            start = Offset(centerX + amplitude * sin(angle), y),
            end = Offset(centerX + amplitude * sin(angle + PI.toFloat()), y),
            strokeWidth = side * HELIX_RUNG_STROKE,
            cap = StrokeCap.Round,
        )
    }
}

// ── Previews (tooling-only; sample names are never shipped UI) ────────────────────────────────────────────

@Preview(name = "Initials — online", showBackground = true)
@Composable
private fun AvatarInitialsPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Avatar(userId = "user-1", name = "John Doe", size = AvatarSize.Lg, status = AvatarStatus.Online)
    }
}

@Preview(name = "Bot Helix mark", showBackground = true)
@Composable
private fun AvatarBotPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Avatar(kind = AvatarKind.Bot, size = AvatarSize.Lg)
    }
}

@Preview(name = "Anonymous person — offline", showBackground = true)
@Composable
private fun AvatarAnonymousPreview() {
    TeslaSyncTheme(dynamicColor = false) {
        Avatar(size = AvatarSize.Lg, status = AvatarStatus.Offline)
    }
}

@Preview(name = "Rounded id-only — idle", showBackground = true)
@Composable
private fun AvatarRoundedPreview() {
    TeslaSyncTheme(darkTheme = true, dynamicColor = false) {
        Avatar(
            userId = "vehicle-7",
            size = AvatarSize.Lg,
            shape = AvatarShape.Rounded,
            status = AvatarStatus.Idle,
        )
    }
}
