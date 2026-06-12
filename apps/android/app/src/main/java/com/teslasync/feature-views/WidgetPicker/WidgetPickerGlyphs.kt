// Locally-authored 24×24 stroked icons for the WidgetPicker surface — the Android stand-ins for the
// `lucide-react` glyphs the web component and its widget registry reference (the search field's `Search`, the
// Recently-Added header's `Clock`, and one representative glyph per widget category). Android ships no lucide
// equivalent without pulling the frozen `material-icons-extended` artifact, so — exactly as the sibling
// AddWidgetButton surface does for its lucide port — this surface authors its own monochrome [ImageVector]s
// (recolored at render time by the shared `Icon` content color), keeping the surface self-contained within
// its allowed-files directory.
//
// The web registry assigns a per-widget lucide icon; reproducing 100-plus distinct vendor glyphs is neither
// gated nor maintainable, so the native catalogue card shows its category's glyph via [forCategory] — a
// faithful, complete native composition (every card carries a meaningful, category-appropriate icon) rather
// than a per-widget 1:1 trace. Each glyph reproduces the silhouette of the lucide icon the web source uses
// for that category's section.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/WidgetPicker) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.widgetpicker

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The glyph set the WidgetPicker references — the search/clock chrome icons plus one representative icon per
 * widget category. All are 24×24 round-capped stroked vectors so they inherit the Material 3 content color in
 * every theme/state, and all are decorative (each call site supplies its own accessibility text or `null`).
 */
object WidgetPickerGlyphs {
    /** lucide `Search` — the search field's leading affordance (web `<Search/>` inside the input). */
    val Search: ImageVector =
        glyph("WidgetPickerSearch") {
            circle(10f, 10f, 7f)
            moveTo(20f, 20f)
            lineTo(15f, 15f)
        }

    /** lucide `Clock` — the Recently-Added section header (web `<Clock/>`). */
    val Clock: ImageVector =
        glyph("WidgetPickerClock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7f)
            lineTo(12f, 12f)
            lineTo(16f, 14f)
        }

    /** lucide `Car` — Vehicle category. */
    val Car: ImageVector =
        glyph("WidgetPickerCar") {
            moveTo(5f, 13f)
            lineTo(7f, 8f)
            lineTo(17f, 8f)
            lineTo(19f, 13f)
            moveTo(4f, 13f)
            lineTo(20f, 13f)
            lineTo(20f, 16f)
            lineTo(4f, 16f)
            close()
            circle(7.5f, 16.5f, 1.5f)
            circle(16.5f, 16.5f, 1.5f)
        }

    /** lucide `Battery` — Battery & Range category. */
    val Battery: ImageVector =
        glyph("WidgetPickerBattery") {
            moveTo(3f, 8f)
            lineTo(17f, 8f)
            lineTo(17f, 16f)
            lineTo(3f, 16f)
            close()
            moveTo(20f, 10.5f)
            lineTo(20f, 13.5f)
        }

    /** lucide `Zap` — Energy category. */
    val Zap: ImageVector =
        glyph("WidgetPickerZap") {
            moveTo(13f, 2f)
            lineTo(4f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(20f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** lucide `Gauge` — Driving category. */
    val Gauge: ImageVector =
        glyph("WidgetPickerGauge") {
            moveTo(12f, 14f)
            lineTo(16f, 10f)
            moveTo(4f, 17f)
            arcToRelative(9f, 9f, 0f, true, true, 16f, 0f)
        }

    /** lucide `BatteryCharging` — Charging category. */
    val BatteryCharging: ImageVector =
        glyph("WidgetPickerBatteryCharging") {
            moveTo(3f, 8f)
            lineTo(8f, 8f)
            moveTo(3f, 16f)
            lineTo(9f, 16f)
            moveTo(15f, 8f)
            lineTo(17f, 8f)
            lineTo(17f, 16f)
            lineTo(13f, 16f)
            moveTo(20f, 10.5f)
            lineTo(20f, 13.5f)
            moveTo(11f, 6f)
            lineTo(8f, 12f)
            lineTo(12f, 12f)
            lineTo(9f, 18f)
        }

    /** lucide `Thermometer` — Climate category. */
    val Thermometer: ImageVector =
        glyph("WidgetPickerThermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14f)
            circle(12f, 17f, 3f)
        }

    /** lucide `CircleDot` — Tires category. */
    val CircleDot: ImageVector =
        glyph("WidgetPickerCircleDot") {
            circle(12f, 12f, 9f)
            circle(12f, 12f, 1.5f)
        }

    /** lucide `Shield` — Security category. */
    val Shield: ImageVector =
        glyph("WidgetPickerShield") {
            moveTo(12f, 3f)
            lineTo(20f, 6f)
            lineTo(20f, 11f)
            lineTo(12f, 21f)
            lineTo(4f, 11f)
            lineTo(4f, 6f)
            close()
        }

    /** lucide `Terminal` — Commands category. */
    val Terminal: ImageVector =
        glyph("WidgetPickerTerminal") {
            moveTo(4f, 6f)
            lineTo(10f, 12f)
            lineTo(4f, 18f)
            moveTo(12f, 18f)
            lineTo(20f, 18f)
        }

    /** lucide `Music` — Media category. */
    val Music: ImageVector =
        glyph("WidgetPickerMusic") {
            moveTo(9f, 18f)
            lineTo(9f, 6f)
            lineTo(20f, 4f)
            lineTo(20f, 15f)
            circle(6f, 18f, 3f)
            circle(17f, 16f, 3f)
        }

    /** lucide `Activity` — Telemetry category. */
    val Activity: ImageVector =
        glyph("WidgetPickerActivity") {
            moveTo(2f, 12f)
            lineTo(6f, 12f)
            lineTo(9f, 4f)
            lineTo(15f, 20f)
            lineTo(18f, 12f)
            lineTo(22f, 12f)
        }

    /** lucide `BarChart` — Analytics category. */
    val BarChart: ImageVector =
        glyph("WidgetPickerBarChart") {
            moveTo(3f, 20f)
            lineTo(21f, 20f)
            moveTo(6f, 20f)
            lineTo(6f, 16f)
            moveTo(12f, 20f)
            lineTo(12f, 10f)
            moveTo(18f, 20f)
            lineTo(18f, 4f)
        }

    /** lucide `Bell` — Alerts category. */
    val Bell: ImageVector =
        glyph("WidgetPickerBell") {
            moveTo(8f, 17f)
            lineTo(8f, 11f)
            arcToRelative(4f, 4f, 0f, true, true, 8f, 0f)
            lineTo(16f, 17f)
            moveTo(5f, 17f)
            lineTo(19f, 17f)
            moveTo(10.5f, 20f)
            lineTo(13.5f, 20f)
        }

    /** lucide `Workflow` — Automations category. */
    val Workflow: ImageVector =
        glyph("WidgetPickerWorkflow") {
            moveTo(3f, 4f)
            lineTo(9f, 4f)
            lineTo(9f, 9f)
            lineTo(3f, 9f)
            close()
            moveTo(15f, 15f)
            lineTo(21f, 15f)
            lineTo(21f, 20f)
            lineTo(15f, 20f)
            close()
            moveTo(9f, 6.5f)
            lineTo(13f, 6.5f)
            lineTo(13f, 17.5f)
            lineTo(15f, 17.5f)
        }

    /** lucide `Server` — System category. */
    val Server: ImageVector =
        glyph("WidgetPickerServer") {
            moveTo(3f, 4f)
            lineTo(21f, 4f)
            lineTo(21f, 9f)
            lineTo(3f, 9f)
            close()
            moveTo(3f, 13f)
            lineTo(21f, 13f)
            lineTo(21f, 18f)
            lineTo(3f, 18f)
            close()
            moveTo(6.5f, 6.5f)
            lineTo(8f, 6.5f)
            moveTo(6.5f, 15.5f)
            lineTo(8f, 15.5f)
        }

    /** lucide `MapPin` — Maps category. */
    val MapPin: ImageVector =
        glyph("WidgetPickerMapPin") {
            moveTo(12f, 22f)
            lineTo(5.5f, 12f)
            arcToRelative(8f, 8f, 0f, true, true, 13f, 0f)
            close()
            circle(12f, 10f, 2.5f)
        }

    /** The representative glyph for [category] — the icon shown on every catalogue card in that category. */
    @Suppress("CyclomaticComplexMethod") // A flat, exhaustive 1:1 category→glyph mapping, not branching logic.
    fun forCategory(category: WidgetCategory): ImageVector =
        when (category) {
            WidgetCategory.Vehicle -> Car
            WidgetCategory.Battery -> Battery
            WidgetCategory.Energy -> Zap
            WidgetCategory.Driving -> Gauge
            WidgetCategory.Charging -> BatteryCharging
            WidgetCategory.Climate -> Thermometer
            WidgetCategory.Tires -> CircleDot
            WidgetCategory.Security -> Shield
            WidgetCategory.Commands -> Terminal
            WidgetCategory.Media -> Music
            WidgetCategory.Telemetry -> Activity
            WidgetCategory.Analytics -> BarChart
            WidgetCategory.Alerts -> Bell
            WidgetCategory.Automations -> Workflow
            WidgetCategory.System -> Server
            WidgetCategory.Maps -> MapPin
        }
}

/** Adds a full circle of radius [r] centered at ([cx], [cy]) as two semicircular arcs. */
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcToRelative(r, r, 0f, true, true, 2f * r, 0f)
    arcToRelative(r, r, 0f, true, true, -2f * r, 0f)
    close()
}

/** Builds a standard 24×24 round-capped stroked [ImageVector] from a single [PathBuilder] program. */
private fun glyph(
    name: String,
    pathBuilder: PathBuilder.() -> Unit,
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
                pathBuilder = pathBuilder,
            )
        }.build()

private val GLYPH_SIZE = 24.dp
private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f
