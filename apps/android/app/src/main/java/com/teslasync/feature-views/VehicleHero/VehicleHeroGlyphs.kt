// Line-style icons for the dashboard Vehicle Hero feature view, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` (`Car`, `Monitor`, `Navigation`, `Activity`, `Thermometer`, `Unlock`,
// plus `Lock`, `Shield`, `Zap`, `Gauge`, `Clock`, `MapPin`, `BatteryCharging`, `Eye`). The shared data-display /
// ui sets already ship the latter group, so this file authors only the six the shared sets lack — as 24×24
// stroked vectors (the same hand-authored approach as `components/ui/TeslaGlyphs` and the sibling BatteryTab
// surface). Each is monochrome and recolored at render time by the `Icon` composable's `tint`, so they track
// the active theme.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehicleHero) cannot form a valid Kotlin package, so the package intentionally
// diverges from the path, exactly as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclehero

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The six lucide glyphs the hero needs that the shared data-display / ui sets do not provide. */
object VehicleHeroGlyphs {
    /** lucide `Car` — the header / empty-state vehicle mark. */
    val Car: ImageVector =
        heroStroked("VehicleHeroCar") {
            moveTo(4f, 13f)
            lineTo(6.5f, 8f)
            lineTo(15f, 8f)
            lineTo(18.5f, 12f)
            moveTo(3f, 13f)
            lineTo(21f, 13f)
            lineTo(21f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(7.5f, 16f)
            lineTo(7.6f, 16f)
            moveTo(16.5f, 16f)
            lineTo(16.6f, 16f)
        }

    /** lucide `Monitor` — the Digital Twin quick action. */
    val Monitor: ImageVector =
        heroStroked("VehicleHeroMonitor") {
            moveTo(4f, 4f)
            lineTo(20f, 4f)
            lineTo(20f, 15f)
            lineTo(4f, 15f)
            close()
            moveTo(9f, 19f)
            lineTo(15f, 19f)
            moveTo(12f, 15f)
            lineTo(12f, 19f)
        }

    /** lucide `Navigation` — the Odometer stat accent. */
    val Navigation: ImageVector =
        heroStroked("VehicleHeroNavigation") {
            moveTo(3f, 11f)
            lineTo(22f, 2f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** lucide `Activity` — the Ideal Range stat accent (the cardiac-pulse line). */
    val Activity: ImageVector =
        heroStroked("VehicleHeroActivity") {
            moveTo(22f, 12f)
            lineTo(18f, 12f)
            lineTo(15f, 21f)
            lineTo(9f, 3f)
            lineTo(6f, 12f)
            lineTo(2f, 12f)
        }

    /** lucide `Thermometer` — the Inside / Outside temperature stats. */
    val Thermometer: ImageVector =
        heroStroked("VehicleHeroThermometer") {
            moveTo(10f, 5f)
            lineTo(14f, 5f)
            moveTo(12f, 5f)
            lineTo(12f, 14f)
            moveTo(12f, 14f)
            curveTo(10.3f, 14f, 9f, 15.3f, 9f, 17f)
            curveTo(9f, 18.7f, 10.3f, 20f, 12f, 20f)
            curveTo(13.7f, 20f, 15f, 18.7f, 15f, 17f)
            curveTo(15f, 15.3f, 13.7f, 14f, 12f, 14f)
            close()
        }

    /** lucide `Unlock` — the unlocked Status stat (open-shackle padlock). */
    val Unlock: ImageVector =
        heroStroked("VehicleHeroUnlock") {
            moveTo(5f, 11f)
            lineTo(19f, 11f)
            lineTo(19f, 20f)
            lineTo(5f, 20f)
            close()
            moveTo(8f, 11f)
            lineTo(8f, 7f)
            moveTo(8f, 7f)
            curveTo(8f, 4.8f, 9.8f, 3f, 12f, 3f)
            curveTo(13.7f, 3f, 15.1f, 4f, 15.7f, 5.5f)
        }
}

/** Builds a 24×24 round-capped stroked [ImageVector] from a [PathBuilder] block (lucide stroke style). */
private fun heroStroked(
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

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
