// Locally-authored stroked vector glyphs for the SearchPage surface — the native counterparts of the web lucide
// icons the page renders (web/src/features/system/pages/SearchPage.tsx imports Search, Car, Route, BatteryCharging,
// BellRing, Bell, MapPinned, Workflow, MapPin, Compass, ArrowRight). The shared icon catalog (TeslaGlyphs) ships
// none of these page glyphs and editing it is outside this surface's allowed files, so they are authored here as
// 24×24 monochrome stroked vectors and recolored at render via the `Icon` tint — exactly the approach the sibling
// A7 page surfaces document (CommandsPageIcons, GlancePageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.search

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.presentation.search.SearchHitType

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web SearchPage lucide icons). Each is a monochrome 24×24 stroked vector
 * recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object SearchGlyphs {
    /** Search — web `Search` (the field icon + every empty-state). A lens circle with a handle. */
    val Search: ImageVector =
        strokedGlyph("SearchSearch") {
            glyphCircle(10.5f, 10.5f, 6f)
            moveTo(14.7f, 14.7f)
            lineTo(20f, 20f)
        }

    /** Car — web `Car` (the Vehicles facet + section). Cabin slope, body, two wheels. */
    val Car: ImageVector =
        strokedGlyph("SearchCar") {
            moveTo(5f, 11f)
            lineTo(6.5f, 7f)
            lineTo(17.5f, 7f)
            lineTo(19f, 11f)
            moveTo(3f, 11f)
            lineTo(21f, 11f)
            lineTo(21f, 15f)
            lineTo(3f, 15f)
            close()
            glyphCircle(7.5f, 15f, 1.5f)
            glyphCircle(16.5f, 15f, 1.5f)
        }

    /** Route — web `Route` (the Drives facet + section). Two endpoint nodes joined by an L-shaped path. */
    val Route: ImageVector =
        strokedGlyph("SearchRoute") {
            glyphCircle(6f, 18f, 1.6f)
            glyphCircle(18f, 6f, 1.6f)
            moveTo(6f, 16.4f)
            lineTo(6f, 11f)
            lineTo(18f, 11f)
            lineTo(18f, 7.6f)
        }

    /** Battery-charging — web `BatteryCharging` (the Charging facet + section). Battery body, terminal, bolt. */
    val BatteryCharging: ImageVector =
        strokedGlyph("SearchBatteryCharging") {
            moveTo(3f, 9f)
            lineTo(12f, 9f)
            moveTo(3f, 15f)
            lineTo(12f, 15f)
            moveTo(3f, 9f)
            lineTo(3f, 15f)
            moveTo(15f, 9f)
            lineTo(18f, 9f)
            lineTo(18f, 15f)
            lineTo(15f, 15f)
            moveTo(20.5f, 11f)
            lineTo(20.5f, 13f)
            moveTo(10f, 8f)
            lineTo(6.5f, 12.5f)
            lineTo(9f, 12.5f)
            lineTo(8f, 16f)
            lineTo(11.5f, 11.5f)
            lineTo(9f, 11.5f)
            close()
        }

    /** Bell-ring — web `BellRing` (the Alerts facet + section). A bell with a clapper and two side rings. */
    val BellRing: ImageVector =
        strokedGlyph("SearchBellRing") {
            bellBody()
            moveTo(4.8f, 6.4f)
            arcTo(3.4f, 3.4f, 0f, false, false, 4.1f, 10f)
            moveTo(19.2f, 6.4f)
            arcTo(3.4f, 3.4f, 0f, false, true, 19.9f, 10f)
        }

    /** Bell — web `Bell` (the Notifications facet + section). A bell with a clapper. */
    val Bell: ImageVector =
        strokedGlyph("SearchBell") {
            bellBody()
        }

    /** Map-pinned — web `MapPinned` (the Geofences facet + section). A pin over a ground arc. */
    val MapPinned: ImageVector =
        strokedGlyph("SearchMapPinned") {
            pinBody()
            moveTo(8f, 19.5f)
            arcTo(4.5f, 1.8f, 0f, false, false, 16f, 19.5f)
        }

    /** Workflow — web `Workflow` (the Automations facet + section). Two nodes joined by an L connector. */
    val Workflow: ImageVector =
        strokedGlyph("SearchWorkflow") {
            moveTo(3.5f, 4f)
            lineTo(8.5f, 4f)
            lineTo(8.5f, 9f)
            lineTo(3.5f, 9f)
            close()
            moveTo(15.5f, 15f)
            lineTo(20.5f, 15f)
            lineTo(20.5f, 20f)
            lineTo(15.5f, 20f)
            close()
            moveTo(6f, 9f)
            lineTo(6f, 17.5f)
            lineTo(15.5f, 17.5f)
        }

    /** Map-pin — web `MapPin` (the Locations facet + section). A teardrop pin with an inner dot. */
    val MapPin: ImageVector =
        strokedGlyph("SearchMapPin") {
            pinBody()
        }

    /** Compass — web `Compass` (the Trips facet + section). A ring with a diamond needle. */
    val Compass: ImageVector =
        strokedGlyph("SearchCompass") {
            glyphCircle(12f, 12f, 8f)
            moveTo(15.5f, 8.5f)
            lineTo(10.5f, 10.5f)
            lineTo(8.5f, 15.5f)
            lineTo(13.5f, 13.5f)
            close()
        }

    /** Arrow-right — web `ArrowRight` (the trailing chevron on every result row). Shaft + head. */
    val ArrowRight: ImageVector =
        strokedGlyph("SearchArrowRight") {
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            moveTo(14f, 6f)
            lineTo(20f, 12f)
            lineTo(14f, 18f)
        }
}

/**
 * The icon for a search hit [type] — the native analogue of the web `searchHitIconSm(type)` switch
 * (web/src/features/system/pages/SearchPage.tsx). Used on both the facet chips and the grouped section headers.
 */
fun searchGlyphFor(type: SearchHitType): ImageVector =
    when (type) {
        SearchHitType.Vehicle -> SearchGlyphs.Car
        SearchHitType.Drive -> SearchGlyphs.Route
        SearchHitType.Charging -> SearchGlyphs.BatteryCharging
        SearchHitType.Alert -> SearchGlyphs.BellRing
        SearchHitType.Notification -> SearchGlyphs.Bell
        SearchHitType.Geofence -> SearchGlyphs.MapPinned
        SearchHitType.Automation -> SearchGlyphs.Workflow
        SearchHitType.Location -> SearchGlyphs.MapPin
        SearchHitType.Trip -> SearchGlyphs.Compass
    }

/** The shared bell silhouette (dome + base + clapper) used by both [SearchGlyphs.Bell] and [SearchGlyphs.BellRing]. */
private fun PathBuilder.bellBody() {
    moveTo(6f, 16f)
    lineTo(18f, 16f)
    moveTo(7.5f, 16f)
    lineTo(7.5f, 11f)
    arcTo(4.5f, 4.5f, 0f, false, true, 16.5f, 11f)
    lineTo(16.5f, 16f)
    moveTo(10.3f, 18.5f)
    arcTo(1.7f, 1.7f, 0f, false, false, 13.7f, 18.5f)
}

/** The shared teardrop pin (loop + tip + inner dot) used by both [SearchGlyphs.MapPin] and [SearchGlyphs.MapPinned]. */
private fun PathBuilder.pinBody() {
    moveTo(12f, 21f)
    lineTo(7f, 12f)
    arcTo(6f, 6f, 0f, true, true, 17f, 12f)
    lineTo(12f, 21f)
    close()
    glyphCircle(12f, 9.5f, 2f)
}

/** Builds a 24×24 round-capped stroked [ImageVector]; the stroke color is replaced by the `Icon` tint at render. */
private fun strokedGlyph(
    name: String,
    build: PathBuilder.() -> Unit,
): ImageVector =
    ImageVector
        .Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
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
