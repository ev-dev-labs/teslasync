// File named after its primary @Composable; the co-located enums/functions are supporting types.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.ui.theme.TeslaTokens
import io.teslasync.android.ui.theme.generated.ChartPalette

/** Avatar pixel size. */
enum class AvatarSize { Xs, Sm, Md, Lg }

/** Avatar corner shape. */
enum class AvatarShape { Circle, Rounded }

/** Presence dot anchored to the avatar's bottom-right corner. */
enum class AvatarStatus { Online, Idle, Offline }

/** No-name fallback glyph selector. */
enum class AvatarKind { User, Bot }

/**
 * djb2 hash — small, deterministic, dependency-free; used only to map a seed string onto a
 * stable palette index. Kotlin Int arithmetic wraps at 32 bits (matching the web's int32 `^`).
 */
fun djb2(input: String): Int {
    var hash = 5381
    for (char in input) {
        hash = (hash * 33) xor char.code
    }
    return hash
}

/** Stable palette index for a [seed]; always in `0 until paletteSize`. */
fun avatarColorIndex(
    seed: String,
    paletteSize: Int,
): Int {
    if (paletteSize <= 0) return 0
    val hash = djb2(seed)
    return ((hash % paletteSize) + paletteSize) % paletteSize
}

/**
 * Visible initials for a [name]: first character of the first two words, or the first two
 * characters of a single-word name. Empty / blank input returns "?" so the avatar is never blank.
 */
fun avatarInitials(name: String?): String {
    val trimmed = name?.trim().orEmpty()
    if (trimmed.isEmpty()) return "?"
    val parts = trimmed.split(Regex("\\s+")).filter { it.isNotEmpty() }
    return if (parts.size >= 2) {
        "${parts[0].first()}${parts[1].first()}".uppercase()
    } else {
        parts[0].take(2).uppercase()
    }
}

/**
 * Shared avatar — the Android counterpart of the web `Avatar`. Renders, in priority order, a
 * supplied [image] slot, deterministic initials on a hashed palette color, or a generic glyph
 * chosen by [kind]. An optional presence [status] dot is overlaid. Network image loading is the
 * page's responsibility (pass a loaded [image] node); this component stays dependency-free.
 */
@Composable
fun Avatar(
    modifier: Modifier = Modifier,
    userId: String? = null,
    name: String? = null,
    size: AvatarSize = AvatarSize.Sm,
    shape: AvatarShape = AvatarShape.Circle,
    status: AvatarStatus? = null,
    kind: AvatarKind = AvatarKind.User,
    contentDescription: String? = null,
    image: (@Composable () -> Unit)? = null,
) {
    val trimmedName = name?.trim().orEmpty()
    val seed = (userId?.takeIf { it.isNotEmpty() } ?: trimmedName).ifEmpty { "?" }
    val initials = avatarInitials(name)
    val hasInitials = initials != "?"
    val isAttributed = trimmedName.isNotEmpty() || !userId.isNullOrEmpty()
    val palette = ChartPalette.categorical
    val background =
        when {
            image != null -> Color.Transparent
            isAttributed && palette.isNotEmpty() -> palette[avatarColorIndex(seed, palette.size)]
            else -> MaterialTheme.colorScheme.surfaceVariant
        }
    val dimension = avatarDimension(size)
    val cornerShape: Shape = if (shape == AvatarShape.Circle) CircleShape else RoundedCornerShape(dimension / 4)

    Box(
        modifier =
            modifier
                .size(dimension)
                .clip(cornerShape)
                .background(background)
                .clearAndSetSemantics { if (contentDescription != null) this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        when {
            image != null -> image()
            hasInitials ->
                Text(
                    initials,
                    style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold),
                    color = Color.White,
                )
            else ->
                Icon(
                    if (kind == AvatarKind.Bot) DataDisplayGlyphs.Robot else DataDisplayGlyphs.Person,
                    contentDescription = null,
                    size = IconSize.Sm,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }
        if (status != null) {
            Box(
                modifier =
                    Modifier
                        .align(Alignment.BottomEnd)
                        .size(statusDotSize(size))
                        .clip(CircleShape)
                        .background(avatarStatusColor(status))
                        .border(STATUS_RING_WIDTH, MaterialTheme.colorScheme.surface, CircleShape),
            )
        }
    }
}

@Composable
private fun avatarStatusColor(status: AvatarStatus): Color =
    when (status) {
        AvatarStatus.Online -> TeslaTokens.status.success
        AvatarStatus.Idle -> TeslaTokens.status.warning
        AvatarStatus.Offline -> MaterialTheme.colorScheme.onSurfaceVariant
    }

private fun avatarDimension(size: AvatarSize): Dp =
    when (size) {
        AvatarSize.Xs -> 16.dp
        AvatarSize.Sm -> 24.dp
        AvatarSize.Md -> 32.dp
        AvatarSize.Lg -> 48.dp
    }

private fun statusDotSize(size: AvatarSize): Dp =
    when (size) {
        AvatarSize.Xs -> 6.dp
        AvatarSize.Sm -> 8.dp
        AvatarSize.Md -> 10.dp
        AvatarSize.Lg -> 12.dp
    }

private val STATUS_RING_WIDTH = 2.dp
