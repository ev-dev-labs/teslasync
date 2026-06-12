// Locally-authored stroked vector glyphs for the AlertStudioPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses that the shared TeslaGlyphs catalog does not yet carry
// (sparkles, bell, bell-off, moon-star, clock, search, save, and the per-template category icons). This
// mirrors the established feature-view precedent (ActionBuilder's `Trash`, CronParser's glyph set): a glyph
// absent from the shared catalog is authored locally as a 24×24 stroked vector and recolored at render via
// the Icon/IconButton `tint`, rather than editing shared files (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/AlertStudioPage) cannot form a valid Kotlin package identifier.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertstudiopage

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/IconButton `tint` at render. */
private fun strokedGlyph(
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
                strokeLineWidth = STROKE_WIDTH,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** The local glyph set this surface needs (web lucide icons absent from the shared catalog). */
object AlertStudioGlyphs {
    /** Sparkles — web `Icons.sparkles` (Templates action + empty-template state). */
    val Sparkles: ImageVector =
        strokedGlyph("AlertStudioSparkles") {
            moveTo(12f, 3f)
            lineTo(13.4f, 9f)
            lineTo(19f, 10.5f)
            lineTo(13.4f, 12f)
            lineTo(12f, 18f)
            lineTo(10.6f, 12f)
            lineTo(5f, 10.5f)
            lineTo(10.6f, 9f)
            close()
            moveTo(18f, 4f)
            lineTo(18.6f, 6f)
            lineTo(20.5f, 6.6f)
            lineTo(18.6f, 7.2f)
            lineTo(18f, 9f)
            lineTo(17.4f, 7.2f)
            lineTo(15.5f, 6.6f)
            lineTo(17.4f, 6f)
            close()
        }

    /** Bell — web `Icons.notifications` (enabled rule + channel chip). */
    val Bell: ImageVector =
        strokedGlyph("AlertStudioBell") {
            moveTo(6f, 16f)
            lineTo(6f, 11f)
            curveTo(6f, 7.7f, 8.7f, 5f, 12f, 5f)
            curveTo(15.3f, 5f, 18f, 7.7f, 18f, 11f)
            lineTo(18f, 16f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(10f, 18f)
            curveTo(10f, 19.1f, 10.9f, 20f, 12f, 20f)
            curveTo(13.1f, 20f, 14f, 19.1f, 14f, 18f)
        }

    /** Bell with a slash — web `Icons.notificationsMuted` (disabled rule). */
    val BellOff: ImageVector =
        strokedGlyph("AlertStudioBellOff") {
            moveTo(6f, 16f)
            lineTo(6f, 11f)
            curveTo(6f, 7.7f, 8.7f, 5f, 12f, 5f)
            curveTo(15.3f, 5f, 18f, 7.7f, 18f, 11f)
            lineTo(18f, 16f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            close()
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    /** Crescent moon with a star — web `Icons.moonStar` (snooze). */
    val MoonStar: ImageVector =
        strokedGlyph("AlertStudioMoonStar") {
            moveTo(15f, 4f)
            curveTo(11f, 4f, 8f, 7f, 8f, 11f)
            curveTo(8f, 15f, 11f, 18f, 15f, 18f)
            curveTo(13f, 16.5f, 12f, 14f, 12f, 11f)
            curveTo(12f, 8f, 13f, 5.5f, 15f, 4f)
            close()
            moveTo(18f, 5f)
            lineTo(18.5f, 6.5f)
            lineTo(20f, 7f)
            lineTo(18.5f, 7.5f)
            lineTo(18f, 9f)
            lineTo(17.5f, 7.5f)
            lineTo(16f, 7f)
            lineTo(17.5f, 6.5f)
            close()
        }

    /** Clock — web `Icons.clock` (rule updated-at timestamp). */
    val Clock: ImageVector =
        strokedGlyph("AlertStudioClock") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
        }

    /** Magnifying glass — web `Icons.search` (no-match rules state). */
    val Search: ImageVector =
        strokedGlyph("AlertStudioSearch") {
            moveTo(11f, 4f)
            curveTo(7.1f, 4f, 4f, 7.1f, 4f, 11f)
            curveTo(4f, 14.9f, 7.1f, 18f, 11f, 18f)
            curveTo(14.9f, 18f, 18f, 14.9f, 18f, 11f)
            curveTo(18f, 7.1f, 14.9f, 4f, 11f, 4f)
            close()
            moveTo(16f, 16f)
            lineTo(20f, 20f)
        }

    /** Floppy disk — web `Icons.save` (Save action). */
    val Save: ImageVector =
        strokedGlyph("AlertStudioSave") {
            moveTo(5f, 4f)
            lineTo(16f, 4f)
            lineTo(20f, 8f)
            lineTo(20f, 20f)
            lineTo(4f, 20f)
            lineTo(4f, 5f)
            close()
            moveTo(8f, 4f)
            lineTo(8f, 9f)
            lineTo(15f, 9f)
            lineTo(15f, 4f)
            moveTo(7f, 13f)
            lineTo(17f, 13f)
            lineTo(17f, 20f)
            lineTo(7f, 20f)
            close()
        }

    /** Battery — web `Icons.battery` (Battery category templates). */
    val Battery: ImageVector =
        strokedGlyph("AlertStudioBattery") {
            moveTo(3f, 8f)
            lineTo(18f, 8f)
            lineTo(18f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(20f, 11f)
            lineTo(20f, 13f)
        }

    /** Lightning bolt — web `Icons.charging` (Charging / Motor / Software / Powershare templates). */
    val Charging: ImageVector =
        strokedGlyph("AlertStudioCharging") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(11f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(13f, 11f)
            close()
        }

    /** Car silhouette — web `Icons.vehicle` (Driving / Location / Media templates). */
    val Vehicle: ImageVector =
        strokedGlyph("AlertStudioVehicle") {
            moveTo(4f, 14f)
            lineTo(5.5f, 9f)
            lineTo(18.5f, 9f)
            lineTo(20f, 14f)
            lineTo(20f, 17f)
            lineTo(4f, 17f)
            close()
            moveTo(7f, 17f)
            curveTo(7f, 18.1f, 6.1f, 19f, 5f, 19f)
            curveTo(3.9f, 19f, 3f, 18.1f, 3f, 17f)
            moveTo(21f, 17f)
            curveTo(21f, 18.1f, 20.1f, 19f, 19f, 19f)
            curveTo(17.9f, 19f, 17f, 18.1f, 17f, 17f)
        }

    /** Speed gauge — web `Icons.speed` (Driving speed templates). */
    val Speed: ImageVector =
        strokedGlyph("AlertStudioSpeed") {
            moveTo(4f, 17f)
            curveTo(4f, 12.6f, 7.6f, 9f, 12f, 9f)
            curveTo(16.4f, 9f, 20f, 12.6f, 20f, 17f)
            moveTo(12f, 17f)
            lineTo(15f, 12f)
        }

    /** Padlock — web `Icons.locked` (Security lock templates). */
    val Lock: ImageVector =
        strokedGlyph("AlertStudioLock") {
            moveTo(6f, 11f)
            lineTo(18f, 11f)
            lineTo(18f, 20f)
            lineTo(6f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
            lineTo(16f, 11f)
        }

    /** Shield — web `Icons.security` (Sentry / Safety templates). */
    val Shield: ImageVector =
        strokedGlyph("AlertStudioShield") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16f, 5f, 12f)
            lineTo(5f, 6f)
            close()
        }

    /** Thermometer — web `Icons.climate` (Climate / Motor temperature templates). */
    val Climate: ImageVector =
        strokedGlyph("AlertStudioClimate") {
            moveTo(11f, 4f)
            lineTo(13f, 4f)
            lineTo(13f, 14f)
            curveTo(14.2f, 14.8f, 15f, 16.1f, 15f, 17.5f)
            curveTo(15f, 19.4f, 13.4f, 21f, 11.5f, 21f)
            curveTo(9.6f, 21f, 8f, 19.4f, 8f, 17.5f)
            curveTo(8f, 16.1f, 9.8f, 14.8f, 11f, 14f)
            close()
        }

    /** Droplet — web `Icons.droplets` (Tire-pressure templates). */
    val Droplets: ImageVector =
        strokedGlyph("AlertStudioDroplets") {
            moveTo(12f, 4f)
            lineTo(16f, 11f)
            curveTo(18f, 14.5f, 15.5f, 19f, 12f, 19f)
            curveTo(8.5f, 19f, 6f, 14.5f, 8f, 11f)
            close()
        }

    /** Trash can — web `Icons.delete` (delete-rule control). */
    val Trash: ImageVector =
        strokedGlyph("AlertStudioTrash") {
            moveTo(4f, 7f)
            lineTo(20f, 7f)
            moveTo(9f, 4f)
            lineTo(15f, 4f)
            moveTo(6f, 7f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 7f)
            moveTo(10f, 10.5f)
            lineTo(10.5f, 16.5f)
            moveTo(14f, 10.5f)
            lineTo(13.5f, 16.5f)
        }
}

/** Map a [TemplateGlyph] to its locally-authored vector (web `RuleTemplate.icon`). */
fun TemplateGlyph.imageVector(): ImageVector =
    when (this) {
        TemplateGlyph.BATTERY -> AlertStudioGlyphs.Battery
        TemplateGlyph.CHARGING -> AlertStudioGlyphs.Charging
        TemplateGlyph.VEHICLE -> AlertStudioGlyphs.Vehicle
        TemplateGlyph.SPEED -> AlertStudioGlyphs.Speed
        TemplateGlyph.LOCK -> AlertStudioGlyphs.Lock
        TemplateGlyph.SECURITY -> AlertStudioGlyphs.Shield
        TemplateGlyph.CLIMATE -> AlertStudioGlyphs.Climate
        TemplateGlyph.DROPLETS -> AlertStudioGlyphs.Droplets
    }
