// File named for its purpose (token-driven style-JSON assembly); the co-located data class is a supporting type.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.components.maps

import androidx.compose.ui.graphics.Color
import java.util.Locale
import kotlin.math.roundToInt

/*
 * Token-driven Google Maps style JSON, kept framework-free so the JSON assembly is unit-tested
 * (the composable in `TeslaMap.kt` resolves the active theme's colors, converts them to hex via
 * [colorToHex], and feeds the result to a `MapStyleOptions`). This is the Android equivalent of
 * the web `MapTileLayer` provider selection — the brand dark base map comes from our tokens.
 */

/** The handful of theme colors the dark base-map style references. */
data class MapStyleColors(
    val landHex: String,
    val waterHex: String,
    val roadHex: String,
    val textHex: String,
    val strokeHex: String,
)

/** `#RRGGBB` for a Compose [color] (alpha dropped — Maps style colors are opaque). */
fun colorToHex(color: Color): String {
    val r = (color.red * MAX_CHANNEL).roundToInt()
    val g = (color.green * MAX_CHANNEL).roundToInt()
    val b = (color.blue * MAX_CHANNEL).roundToInt()
    return String.format(Locale.ROOT, "#%02X%02X%02X", r, g, b)
}

/** A Google Maps style-array JSON string tinted from the supplied token [colors]. */
fun darkMapStyleJson(colors: MapStyleColors): String =
    """
    [
      {"elementType":"geometry","stylers":[{"color":"${colors.landHex}"}]},
      {"elementType":"labels.text.fill","stylers":[{"color":"${colors.textHex}"}]},
      {"elementType":"labels.text.stroke","stylers":[{"color":"${colors.strokeHex}"}]},
      {"elementType":"labels.icon","stylers":[{"visibility":"off"}]},
      {"featureType":"administrative","elementType":"geometry.stroke","stylers":[{"color":"${colors.strokeHex}"}]},
      {"featureType":"poi","elementType":"geometry","stylers":[{"color":"${colors.landHex}"}]},
      {"featureType":"road","elementType":"geometry","stylers":[{"color":"${colors.roadHex}"}]},
      {"featureType":"road","elementType":"geometry.stroke","stylers":[{"color":"${colors.strokeHex}"}]},
      {"featureType":"transit","elementType":"geometry","stylers":[{"color":"${colors.roadHex}"}]},
      {"featureType":"water","elementType":"geometry","stylers":[{"color":"${colors.waterHex}"}]}
    ]
    """.trimIndent()

private const val MAX_CHANNEL = 255
