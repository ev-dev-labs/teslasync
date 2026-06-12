// Locally authored lucide-style glyphs for the VehicleCommandCenter feature view — 24×24 monochrome
// stroked (and one filled) vectors, recoloured at render time by the `Icon` tint. The shared icon catalogs
// ship no command/vehicle glyphs and editing them is outside this surface's allowed files, so the glyphs
// the web `commands.ts` icons + the header/feedback chrome reference are authored here — the same approach
// the sibling CollapsibleCommandGroup / FavoritesBar ports document. Each web lucide icon maps to the
// nearest authored family via [glyphVector]; the map (rather than a `when`) keeps the lookup free of the
// cyclomatic-complexity the 29-way branch would otherwise trip.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path — exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclecommandcenter

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

private val GLYPH_DIMENSION: Dp = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
private const val GLYPH_DOT_EPSILON = 0.1f

/**
 * The authored glyph set for the command catalogue + header/feedback chrome. Each is a monochrome 24×24
 * vector recoloured by the `Icon` tint at the render boundary.
 */
object VehicleCommandCenterGlyphs {
    val power: ImageVector =
        glyphStroked("VccPower") {
            moveTo(12f, 3f)
            lineTo(12f, 11.5f)
            moveTo(8f, 6.5f)
            arcTo(6.5f, 6.5f, 0f, true, false, 16f, 6.5f)
        }

    val lock: ImageVector =
        glyphStroked("VccLock") {
            glyphRect(5f, 11f, 19f, 21f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            arcTo(4f, 4f, 0f, true, true, 16f, 7f)
            lineTo(16f, 11f)
        }

    val unlock: ImageVector =
        glyphStroked("VccUnlock") {
            glyphRect(5f, 11f, 19f, 21f)
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            arcTo(4f, 4f, 0f, true, true, 16f, 7f)
        }

    val shield: ImageVector = glyphStroked("VccShield") { shieldOutline() }

    val shieldAlert: ImageVector =
        glyphStroked("VccShieldAlert") {
            shieldOutline()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            glyphDot(12f, 16f)
        }

    val wind: ImageVector =
        glyphStroked("VccWind") {
            moveTo(3f, 9f)
            lineTo(13f, 9f)
            curveTo(15.2f, 9f, 15.2f, 6f, 13f, 6f)
            moveTo(3f, 13f)
            lineTo(17f, 13f)
            curveTo(19.5f, 13f, 19.5f, 16f, 17f, 16f)
            moveTo(3f, 16.5f)
            lineTo(10f, 16.5f)
            curveTo(12f, 16.5f, 12f, 19f, 10f, 19f)
        }

    val thermometer: ImageVector =
        glyphStroked("VccThermometer") {
            moveTo(10f, 13.5f)
            lineTo(10f, 5f)
            arcTo(2f, 2f, 0f, true, true, 14f, 5f)
            lineTo(14f, 13.5f)
            glyphCircle(12f, 16.5f, 3f)
        }

    val flame: ImageVector =
        glyphStroked("VccFlame") {
            moveTo(12f, 3f)
            curveTo(13f, 7f, 17f, 8f, 17f, 13f)
            curveTo(17f, 16.5f, 14.8f, 19f, 12f, 19f)
            curveTo(9.2f, 19f, 7f, 16.5f, 7f, 13f)
            curveTo(7f, 11f, 8f, 10f, 9f, 9.5f)
            curveTo(9.5f, 11f, 10.5f, 11.5f, 11f, 11f)
            curveTo(11.5f, 9f, 10.5f, 6f, 12f, 3f)
            close()
        }

    val snowflake: ImageVector =
        glyphStroked("VccSnowflake") {
            moveTo(12f, 3f)
            lineTo(12f, 21f)
            moveTo(4.2f, 7.5f)
            lineTo(19.8f, 16.5f)
            moveTo(19.8f, 7.5f)
            lineTo(4.2f, 16.5f)
        }

    val bolt: ImageVector =
        glyphStroked("VccBolt") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(13f, 11f)
            close()
        }

    val battery: ImageVector =
        glyphStroked("VccBattery") {
            glyphRect(3f, 8f, 18f, 16f)
            moveTo(20.5f, 11f)
            lineTo(20.5f, 13f)
        }

    val door: ImageVector =
        glyphStroked("VccDoor") {
            moveTo(4f, 21f)
            lineTo(4f, 5f)
            lineTo(14f, 3f)
            lineTo(14f, 21f)
            moveTo(14f, 5f)
            lineTo(18f, 5f)
            lineTo(18f, 21f)
            moveTo(2f, 21f)
            lineTo(20f, 21f)
            glyphDot(11f, 12f)
        }

    val car: ImageVector =
        glyphStroked("VccCar") {
            glyphRect(3.5f, 11f, 20.5f, 16f)
            moveTo(5.5f, 11f)
            lineTo(7f, 7f)
            curveTo(7.3f, 6.4f, 7.9f, 6f, 8.6f, 6f)
            lineTo(15.4f, 6f)
            curveTo(16.1f, 6f, 16.7f, 6.4f, 17f, 7f)
            lineTo(18.5f, 11f)
            glyphCircle(7.5f, 16f, 1.5f)
            glyphCircle(16.5f, 16f, 1.5f)
        }

    val window: ImageVector =
        glyphStroked("VccWindow") {
            glyphRect(4f, 4f, 20f, 20f)
            moveTo(12f, 4f)
            lineTo(12f, 20f)
            moveTo(4f, 12f)
            lineTo(20f, 12f)
        }

    val sun: ImageVector =
        glyphStroked("VccSun") {
            glyphCircle(12f, 12f, 4f)
            moveTo(12f, 2f)
            lineTo(12f, 4f)
            moveTo(12f, 20f)
            lineTo(12f, 22f)
            moveTo(2f, 12f)
            lineTo(4f, 12f)
            moveTo(20f, 12f)
            lineTo(22f, 12f)
            moveTo(5f, 5f)
            lineTo(6.5f, 6.5f)
            moveTo(17.5f, 17.5f)
            lineTo(19f, 19f)
            moveTo(19f, 5f)
            lineTo(17.5f, 6.5f)
            moveTo(6.5f, 17.5f)
            lineTo(5f, 19f)
        }

    val calendar: ImageVector =
        glyphStroked("VccCalendar") {
            glyphRect(4f, 5f, 20f, 20f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(12f, 12f)
            lineTo(12f, 17f)
            moveTo(9.5f, 14.5f)
            lineTo(14.5f, 14.5f)
        }

    val calendarMinus: ImageVector =
        glyphStroked("VccCalendarMinus") {
            glyphRect(4f, 5f, 20f, 20f)
            moveTo(8f, 3f)
            lineTo(8f, 7f)
            moveTo(16f, 3f)
            lineTo(16f, 7f)
            moveTo(4f, 9f)
            lineTo(20f, 9f)
            moveTo(9.5f, 14.5f)
            lineTo(14.5f, 14.5f)
        }

    val speaker: ImageVector =
        glyphStroked("VccSpeaker") {
            glyphRect(5f, 2f, 19f, 22f)
            glyphCircle(12f, 14f, 3.5f)
            glyphDot(12f, 6f)
        }

    val navigation: ImageVector =
        glyphStroked("VccNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    val download: ImageVector =
        glyphStroked("VccDownload") {
            moveTo(4f, 16f)
            lineTo(4f, 20f)
            lineTo(20f, 20f)
            lineTo(20f, 16f)
            moveTo(8f, 11f)
            lineTo(12f, 15f)
            lineTo(16f, 11f)
            moveTo(12f, 15f)
            lineTo(12f, 3f)
        }

    val playMedia: ImageVector =
        glyphStroked("VccPlay") {
            moveTo(7f, 5f)
            lineTo(19f, 12f)
            lineTo(7f, 19f)
            close()
        }

    val pencil: ImageVector =
        glyphStroked("VccPencil") {
            moveTo(16f, 3f)
            lineTo(21f, 8f)
            lineTo(8f, 21f)
            lineTo(3f, 21f)
            lineTo(3f, 16f)
            close()
        }

    val key: ImageVector =
        glyphStroked("VccKey") {
            glyphCircle(8f, 8f, 4f)
            moveTo(10.8f, 10.8f)
            lineTo(20f, 20f)
            moveTo(17f, 17f)
            lineTo(19f, 15f)
            moveTo(14f, 14f)
            lineTo(16f, 12f)
        }

    val eraser: ImageVector =
        glyphStroked("VccEraser") {
            moveTo(9f, 20f)
            lineTo(4f, 15f)
            lineTo(13f, 6f)
            lineTo(20f, 13f)
            lineTo(13f, 20f)
            close()
        }

    val user: ImageVector =
        glyphStroked("VccUser") {
            glyphCircle(12f, 8f, 3.5f)
            moveTo(5f, 20f)
            curveTo(5f, 16f, 8f, 14f, 12f, 14f)
            curveTo(16f, 14f, 19f, 16f, 19f, 20f)
        }

    val dog: ImageVector =
        glyphStroked("VccDog") {
            glyphCircle(12f, 14f, 4f)
            glyphDot(10.5f, 13f)
            glyphDot(13.5f, 13f)
            moveTo(7f, 6f)
            lineTo(9f, 10f)
            moveTo(17f, 6f)
            lineTo(15f, 10f)
        }

    val tent: ImageVector =
        glyphStroked("VccTent") {
            moveTo(12f, 4f)
            lineTo(3f, 20f)
            lineTo(21f, 20f)
            close()
            moveTo(12f, 4f)
            lineTo(12f, 20f)
        }

    val volume: ImageVector =
        glyphStroked("VccVolume") {
            moveTo(4f, 9f)
            lineTo(8f, 9f)
            lineTo(12f, 5f)
            lineTo(12f, 19f)
            lineTo(8f, 15f)
            lineTo(4f, 15f)
            close()
            moveTo(15.5f, 9f)
            curveTo(17.5f, 11f, 17.5f, 13f, 15.5f, 15f)
        }

    val gauge: ImageVector =
        glyphStroked("VccGauge") {
            moveTo(4f, 17f)
            arcTo(9f, 9f, 0f, true, true, 20f, 17f)
            moveTo(12f, 13f)
            lineTo(15.5f, 9.5f)
        }

    /** A Wi-Fi signal — the web header `Wifi` glyph. */
    val wifi: ImageVector =
        glyphStroked("VccWifi") {
            moveTo(4f, 9f)
            curveTo(9f, 4.5f, 15f, 4.5f, 20f, 9f)
            moveTo(7f, 12.5f)
            curveTo(10f, 9.8f, 14f, 9.8f, 17f, 12.5f)
            moveTo(10f, 16f)
            curveTo(11.2f, 14.9f, 12.8f, 14.9f, 14f, 16f)
            glyphDot(12f, 19f)
        }

    /** A clock — the web stale-banner `Clock` glyph. */
    val clock: ImageVector =
        glyphStroked("VccClock") {
            glyphCircle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** The filled favourite star (web `Star` with `fill-neon-amber`). */
    val starFilled: ImageVector = glyphFilled("VccStarFilled") { starOutline() }

    /** The hollow favourite star, shown when a command is not favourited. */
    val starOutline: ImageVector = glyphStroked("VccStarOutline") { starOutline() }
}

/** The shared shield silhouette used by both [VehicleCommandCenterGlyphs.shield] and `shieldAlert`. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(19f, 6f)
    lineTo(19f, 12f)
    curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
    curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
    lineTo(5f, 6f)
    close()
}

/** The shared five-point star silhouette used by the filled + hollow favourite glyphs. */
private fun PathBuilder.starOutline() {
    moveTo(12f, 2f)
    lineTo(14.35f, 8.76f)
    lineTo(21.51f, 8.91f)
    lineTo(15.8f, 13.24f)
    lineTo(17.88f, 20.09f)
    lineTo(12f, 16f)
    lineTo(6.12f, 20.09f)
    lineTo(8.2f, 13.24f)
    lineTo(2.49f, 8.91f)
    lineTo(9.65f, 8.76f)
    close()
}

/**
 * Maps a [CommandGlyph] family to its authored [ImageVector] at the render boundary. A [Map] lookup rather
 * than a `when` keeps the 29-family resolution free of cyclomatic complexity; an unmapped family folds to
 * the neutral [VehicleCommandCenterGlyphs.gauge] so a tile is never iconless.
 */
val COMMAND_GLYPHS: Map<CommandGlyph, ImageVector> =
    mapOf(
        CommandGlyph.Power to VehicleCommandCenterGlyphs.power,
        CommandGlyph.Lock to VehicleCommandCenterGlyphs.lock,
        CommandGlyph.Unlock to VehicleCommandCenterGlyphs.unlock,
        CommandGlyph.Shield to VehicleCommandCenterGlyphs.shield,
        CommandGlyph.ShieldAlert to VehicleCommandCenterGlyphs.shieldAlert,
        CommandGlyph.Wind to VehicleCommandCenterGlyphs.wind,
        CommandGlyph.Thermometer to VehicleCommandCenterGlyphs.thermometer,
        CommandGlyph.Flame to VehicleCommandCenterGlyphs.flame,
        CommandGlyph.Snowflake to VehicleCommandCenterGlyphs.snowflake,
        CommandGlyph.Bolt to VehicleCommandCenterGlyphs.bolt,
        CommandGlyph.Battery to VehicleCommandCenterGlyphs.battery,
        CommandGlyph.Door to VehicleCommandCenterGlyphs.door,
        CommandGlyph.Car to VehicleCommandCenterGlyphs.car,
        CommandGlyph.Window to VehicleCommandCenterGlyphs.window,
        CommandGlyph.Sun to VehicleCommandCenterGlyphs.sun,
        CommandGlyph.Calendar to VehicleCommandCenterGlyphs.calendar,
        CommandGlyph.CalendarMinus to VehicleCommandCenterGlyphs.calendarMinus,
        CommandGlyph.Speaker to VehicleCommandCenterGlyphs.speaker,
        CommandGlyph.Navigation to VehicleCommandCenterGlyphs.navigation,
        CommandGlyph.Download to VehicleCommandCenterGlyphs.download,
        CommandGlyph.PlayMedia to VehicleCommandCenterGlyphs.playMedia,
        CommandGlyph.Pencil to VehicleCommandCenterGlyphs.pencil,
        CommandGlyph.Key to VehicleCommandCenterGlyphs.key,
        CommandGlyph.Eraser to VehicleCommandCenterGlyphs.eraser,
        CommandGlyph.User to VehicleCommandCenterGlyphs.user,
        CommandGlyph.Dog to VehicleCommandCenterGlyphs.dog,
        CommandGlyph.Tent to VehicleCommandCenterGlyphs.tent,
        CommandGlyph.Volume to VehicleCommandCenterGlyphs.volume,
        CommandGlyph.Gauge to VehicleCommandCenterGlyphs.gauge,
    )

/** Resolve a [CommandGlyph] to its authored vector, defaulting to the neutral gauge when unmapped. */
fun glyphVector(glyph: CommandGlyph): ImageVector = COMMAND_GLYPHS[glyph] ?: VehicleCommandCenterGlyphs.gauge

/** Builds a 24×24 round-capped stroked [ImageVector]; the path is filled by [build]. */
private fun glyphStroked(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_DIMENSION,
            defaultHeight = GLYPH_DIMENSION,
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

/** Builds a 24×24 filled [ImageVector] (opaque black, recoloured by the `Icon` tint); the path is [build]. */
private fun glyphFilled(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = GLYPH_DIMENSION,
            defaultHeight = GLYPH_DIMENSION,
            viewportWidth = GLYPH_VIEWPORT,
            viewportHeight = GLYPH_VIEWPORT,
        ).apply {
            path(fill = SolidColor(Color.Black), pathBuilder = build)
        }.build()

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.glyphRect(
    left: Float,
    top: Float,
    right: Float,
    bottom: Float,
) {
    moveTo(left, top)
    lineTo(right, top)
    lineTo(right, bottom)
    lineTo(left, bottom)
    close()
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

/** A single dot (a degenerate one-unit stroke) at ([x], [y]). */
private fun PathBuilder.glyphDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + GLYPH_DOT_EPSILON, y)
}
