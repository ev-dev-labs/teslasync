// Authored lucide-style vector glyphs for the TemplateGallery feature view. The web cards draw lucide
// icons for each dashboard widget (Battery / Car / Zap / Shield / …) plus the gallery chrome (LayoutGrid for
// the blank option, ArrowLeft for "Back", Sparkles for "Use This Template"). Android bundles no lucide set,
// and a feature view may not expand the shared icon library from a surface prompt, so each is authored here
// as a 24×24 stroked vector in the shared monochrome style — recolored at render time by the `Icon` tint,
// exactly as the sibling feature-view surfaces author their glyphs.
//
// [WIDGET_GLYPHS] maps every vendor-neutral [WidgetIconKind] to its glyph; [glyphFor] is the total lookup
// the composable uses (a map, not a 26-branch `when`, so it carries no cyclomatic complexity).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory cannot form a valid Kotlin
// package, so the package intentionally diverges from the path (see TemplateGalleryModel.kt).
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.templategallery

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** lucide `rocket` — a capsule body with fins, a window, and an exhaust plume (the system onboarding glyph). */
val RocketGlyph: ImageVector =
    glyph("Rocket") {
        moveTo(12f, 3f)
        curveTo(15.5f, 5f, 16.5f, 9.5f, 16f, 14f)
        lineTo(8f, 14f)
        curveTo(7.5f, 9.5f, 8.5f, 5f, 12f, 3f)
        close()
        circle(12f, 8.5f, 1.6f)
        moveTo(8f, 14f)
        lineTo(5f, 17f)
        lineTo(8.2f, 16.2f)
        moveTo(16f, 14f)
        lineTo(19f, 17f)
        lineTo(15.8f, 16.2f)
        moveTo(10f, 16.5f)
        lineTo(12f, 21f)
        lineTo(14f, 16.5f)
    }

/** lucide `car` — a rounded body over two wheels. */
val CarGlyph: ImageVector =
    glyph("Car") {
        moveTo(3f, 13f)
        lineTo(5f, 7.5f)
        lineTo(19f, 7.5f)
        lineTo(21f, 13f)
        lineTo(21f, 16.5f)
        lineTo(3f, 16.5f)
        close()
        circle(7f, 16.5f, 1.4f)
        circle(17f, 16.5f, 1.4f)
    }

/** lucide `battery` — a body, terminal nub, and a charge bar. */
val BatteryGlyph: ImageVector =
    glyph("Battery") {
        rect(3f, 8f, 18f, 16f)
        moveTo(18f, 11f)
        lineTo(20.5f, 11f)
        lineTo(20.5f, 13f)
        lineTo(18f, 13f)
        moveTo(6f, 10.5f)
        lineTo(6f, 13.5f)
    }

/** lucide `thermometer` — a capped stem above a bulb. */
val ThermometerGlyph: ImageVector =
    glyph("Thermometer") {
        moveTo(10f, 13.5f)
        lineTo(10f, 5f)
        arcTo(2f, 2f, 0f, true, true, 14f, 5f)
        lineTo(14f, 13.5f)
        circle(12f, 16.5f, 3f)
    }

/** lucide `zap` — a lightning bolt. */
val ZapGlyph: ImageVector =
    glyph("Zap") {
        moveTo(13f, 2f)
        lineTo(3f, 14f)
        lineTo(12f, 14f)
        lineTo(11f, 22f)
        lineTo(21f, 10f)
        lineTo(12f, 10f)
        close()
    }

/** lucide `shield` — a crest outline. */
val ShieldGlyph: ImageVector =
    glyph("Shield") {
        moveTo(12f, 2.5f)
        lineTo(20f, 5.5f)
        lineTo(20f, 11.5f)
        curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21.5f)
        curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11.5f)
        lineTo(4f, 5.5f)
        close()
    }

/** lucide `map-pin` — a teardrop with an inner dot. */
val MapPinGlyph: ImageVector =
    glyph("MapPin") {
        moveTo(12f, 22f)
        curveTo(8f, 16f, 5f, 12f, 5f, 9f)
        curveTo(5f, 5.1f, 8.1f, 2f, 12f, 2f)
        curveTo(15.9f, 2f, 19f, 5.1f, 19f, 9f)
        curveTo(19f, 12f, 16f, 16f, 12f, 22f)
        close()
        circle(12f, 9f, 2.4f)
    }

/** lucide `gauge` — a dial arc with a needle. */
val GaugeGlyph: ImageVector =
    glyph("Gauge") {
        moveTo(4f, 16f)
        arcTo(8f, 8f, 0f, true, true, 20f, 16f)
        moveTo(12f, 15f)
        lineTo(15.5f, 9.5f)
    }

/** lucide `bar-chart-3` — an axis with three columns. */
val BarChartGlyph: ImageVector =
    glyph("BarChart") {
        moveTo(4f, 4f)
        lineTo(4f, 20f)
        lineTo(20f, 20f)
        moveTo(8f, 20f)
        lineTo(8f, 13f)
        moveTo(13f, 20f)
        lineTo(13f, 8f)
        moveTo(18f, 20f)
        lineTo(18f, 15f)
    }

/** lucide `trending-up` — a rising line with an arrowhead. */
val TrendingUpGlyph: ImageVector =
    glyph("TrendingUp") {
        moveTo(3f, 17f)
        lineTo(9f, 11f)
        lineTo(13f, 15f)
        lineTo(21f, 7f)
        moveTo(15f, 7f)
        lineTo(21f, 7f)
        lineTo(21f, 13f)
    }

/** lucide `wifi` — two arcs over a dot. */
val WifiGlyph: ImageVector =
    glyph("Wifi") {
        moveTo(5f, 10.5f)
        curveTo(9f, 6.5f, 15f, 6.5f, 19f, 10.5f)
        moveTo(8f, 13.5f)
        curveTo(10.4f, 11.2f, 13.6f, 11.2f, 16f, 13.5f)
        dot(12f, 17f)
    }

/** lucide `activity` — an ECG pulse line. */
val ActivityGlyph: ImageVector =
    glyph("Activity") {
        moveTo(3f, 12f)
        lineTo(8f, 12f)
        lineTo(11f, 5f)
        lineTo(15f, 19f)
        lineTo(18f, 12f)
        lineTo(21f, 12f)
    }

/** lucide `monitor` — a screen on a stand. */
val MonitorGlyph: ImageVector =
    glyph("Monitor") {
        rect(3f, 4f, 21f, 16f)
        moveTo(12f, 16f)
        lineTo(12f, 20f)
        moveTo(9f, 20f)
        lineTo(15f, 20f)
    }

/** lucide `dollar-sign` — a stem through an S. */
val DollarSignGlyph: ImageVector =
    glyph("DollarSign") {
        moveTo(12f, 3f)
        lineTo(12f, 21f)
        moveTo(16f, 7f)
        curveTo(15f, 5.5f, 13.5f, 5f, 12f, 5f)
        curveTo(9.5f, 5f, 8f, 6.3f, 8f, 8f)
        curveTo(8f, 9.7f, 9.5f, 10.5f, 12f, 11f)
        curveTo(14.5f, 11.5f, 16f, 12.5f, 16f, 14.5f)
        curveTo(16f, 16.5f, 14.5f, 18f, 12f, 18f)
        curveTo(10f, 18f, 8.5f, 17.3f, 8f, 16f)
    }

/** lucide `calendar` — a page with a header bar and two rings. */
val CalendarGlyph: ImageVector =
    glyph("Calendar") {
        rect(4f, 5f, 20f, 20f)
        moveTo(4f, 9f)
        lineTo(20f, 9f)
        moveTo(8f, 3f)
        lineTo(8f, 6f)
        moveTo(16f, 3f)
        lineTo(16f, 6f)
    }

/** lucide `workflow` — two nodes joined by an elbow connector. */
val WorkflowGlyph: ImageVector =
    glyph("Workflow") {
        rect(3f, 4f, 10f, 10f)
        rect(14f, 14f, 21f, 20f)
        moveTo(6.5f, 10f)
        lineTo(6.5f, 17f)
        lineTo(14f, 17f)
    }

/** lucide `door-open` — a hinged door over a floor line, with a knob. */
val DoorOpenGlyph: ImageVector =
    glyph("DoorOpen") {
        moveTo(13f, 4f)
        lineTo(6f, 6f)
        lineTo(6f, 20f)
        lineTo(13f, 20f)
        lineTo(13f, 4f)
        close()
        moveTo(4f, 20f)
        lineTo(16f, 20f)
        dot(9.5f, 12f)
    }

/** lucide `eye` — an almond outline with an iris. */
val EyeGlyph: ImageVector =
    glyph("Eye") {
        moveTo(2f, 12f)
        curveTo(4.5f, 6.5f, 8f, 5f, 12f, 5f)
        curveTo(16f, 5f, 19.5f, 6.5f, 22f, 12f)
        curveTo(19.5f, 17.5f, 16f, 19f, 12f, 19f)
        curveTo(8f, 19f, 4.5f, 17.5f, 2f, 12f)
        close()
        circle(12f, 12f, 2.5f)
    }

/** lucide `credit-card` — a card with a magnetic stripe. */
val CreditCardGlyph: ImageVector =
    glyph("CreditCard") {
        rect(3f, 6f, 21f, 18f)
        moveTo(3f, 10f)
        lineTo(21f, 10f)
        moveTo(7f, 14.5f)
        lineTo(11f, 14.5f)
    }

/** lucide `bell` — a dome with a clapper. */
val BellGlyph: ImageVector =
    glyph("Bell") {
        moveTo(6f, 10f)
        curveTo(6f, 7f, 8.5f, 4.5f, 12f, 4.5f)
        curveTo(15.5f, 4.5f, 18f, 7f, 18f, 10f)
        curveTo(18f, 15f, 20f, 17f, 20f, 17f)
        lineTo(4f, 17f)
        curveTo(4f, 17f, 6f, 15f, 6f, 10f)
        close()
        moveTo(10f, 20f)
        curveTo(10.6f, 21f, 11.3f, 21.5f, 12f, 21.5f)
        curveTo(12.7f, 21.5f, 13.4f, 21f, 14f, 20f)
    }

/** lucide `command` — a center square with four open corner loops. */
val CommandGlyph: ImageVector =
    glyph("Command") {
        rect(9f, 9f, 15f, 15f)
        circle(6.5f, 6.5f, 2.5f)
        circle(17.5f, 6.5f, 2.5f)
        circle(6.5f, 17.5f, 2.5f)
        circle(17.5f, 17.5f, 2.5f)
    }

/** lucide `cloud-sun` — a sun with a few rays partly behind a cloud. */
val CloudSunGlyph: ImageVector =
    glyph("CloudSun") {
        circle(8f, 8f, 3f)
        moveTo(8f, 2.5f)
        lineTo(8f, 4f)
        moveTo(3.5f, 8f)
        lineTo(5f, 8f)
        moveTo(4.6f, 4.6f)
        lineTo(5.7f, 5.7f)
        moveTo(8f, 18.5f)
        curveTo(6f, 18.5f, 5f, 17f, 5.5f, 15.5f)
        curveTo(6f, 14f, 8f, 14f, 9f, 14.5f)
        curveTo(9.5f, 12.5f, 13f, 12.5f, 14f, 14.5f)
        curveTo(16.5f, 14f, 18f, 16f, 17f, 18.5f)
        close()
    }

/** lucide `circle-dot` — a ring around a center dot (the tire-pressure glyph). */
val CircleDotGlyph: ImageVector =
    glyph("CircleDot") {
        circle(12f, 12f, 8f)
        dot(12f, 12f)
    }

/** lucide `list` — three rows with leading bullets. */
val ListGlyph: ImageVector =
    glyph("List") {
        moveTo(8f, 7f)
        lineTo(20f, 7f)
        moveTo(8f, 12f)
        lineTo(20f, 12f)
        moveTo(8f, 17f)
        lineTo(20f, 17f)
        dot(4f, 7f)
        dot(4f, 12f)
        dot(4f, 17f)
    }

/** lucide `layout-grid` / `grid-3x3` — four quadrant squares (also the blank-option + empty glyph). */
val GridGlyph: ImageVector =
    glyph("Grid") {
        rect(4f, 4f, 11f, 11f)
        rect(13f, 4f, 20f, 11f)
        rect(4f, 13f, 11f, 20f)
        rect(13f, 13f, 20f, 20f)
    }

/** lucide `heart-pulse` — a heart with an ECG line through it. */
val HeartPulseGlyph: ImageVector =
    glyph("HeartPulse") {
        moveTo(12f, 20f)
        curveTo(4f, 14f, 3f, 9f, 6f, 6f)
        curveTo(8.5f, 3.5f, 11f, 5f, 12f, 7f)
        curveTo(13f, 5f, 15.5f, 3.5f, 18f, 6f)
        curveTo(21f, 9f, 20f, 14f, 12f, 20f)
        close()
        moveTo(4.5f, 12.5f)
        lineTo(9f, 12.5f)
        lineTo(10.5f, 9.5f)
        lineTo(13f, 15.5f)
        lineTo(14.5f, 12.5f)
        lineTo(19.5f, 12.5f)
    }

/** lucide `arrow-left` — a left-pointing arrow (the detail "Back" button). */
val ArrowLeftGlyph: ImageVector =
    glyph("ArrowLeft") {
        moveTo(19f, 12f)
        lineTo(5f, 12f)
        moveTo(11f, 6f)
        lineTo(5f, 12f)
        lineTo(11f, 18f)
    }

/** lucide `sparkles` — a large four-point star with a small companion (the "Use This Template" button). */
val SparklesGlyph: ImageVector =
    glyph("Sparkles") {
        moveTo(11f, 3f)
        lineTo(12.6f, 8.4f)
        lineTo(18f, 10f)
        lineTo(12.6f, 11.6f)
        lineTo(11f, 17f)
        lineTo(9.4f, 11.6f)
        lineTo(4f, 10f)
        lineTo(9.4f, 8.4f)
        close()
        moveTo(18f, 15f)
        lineTo(18.7f, 17.3f)
        lineTo(21f, 18f)
        lineTo(18.7f, 18.7f)
        lineTo(18f, 21f)
        lineTo(17.3f, 18.7f)
        lineTo(15f, 18f)
        lineTo(17.3f, 17.3f)
        close()
    }

/** Maps every [WidgetIconKind] to its authored glyph. Total over the enum; declared once, reused per tile. */
val WIDGET_GLYPHS: Map<WidgetIconKind, ImageVector> =
    mapOf(
        WidgetIconKind.Rocket to RocketGlyph,
        WidgetIconKind.Car to CarGlyph,
        WidgetIconKind.Battery to BatteryGlyph,
        WidgetIconKind.Thermometer to ThermometerGlyph,
        WidgetIconKind.Zap to ZapGlyph,
        WidgetIconKind.Shield to ShieldGlyph,
        WidgetIconKind.MapPin to MapPinGlyph,
        WidgetIconKind.Gauge to GaugeGlyph,
        WidgetIconKind.BarChart to BarChartGlyph,
        WidgetIconKind.TrendingUp to TrendingUpGlyph,
        WidgetIconKind.Wifi to WifiGlyph,
        WidgetIconKind.Activity to ActivityGlyph,
        WidgetIconKind.Monitor to MonitorGlyph,
        WidgetIconKind.DollarSign to DollarSignGlyph,
        WidgetIconKind.Calendar to CalendarGlyph,
        WidgetIconKind.Workflow to WorkflowGlyph,
        WidgetIconKind.DoorOpen to DoorOpenGlyph,
        WidgetIconKind.Eye to EyeGlyph,
        WidgetIconKind.CreditCard to CreditCardGlyph,
        WidgetIconKind.Bell to BellGlyph,
        WidgetIconKind.Command to CommandGlyph,
        WidgetIconKind.CloudSun to CloudSunGlyph,
        WidgetIconKind.CircleDot to CircleDotGlyph,
        WidgetIconKind.List to ListGlyph,
        WidgetIconKind.Grid to GridGlyph,
        WidgetIconKind.HeartPulse to HeartPulseGlyph,
    )

/** The authored glyph for an [icon] kind; falls back to [GridGlyph] should a kind ever lack a mapping. */
fun glyphFor(icon: WidgetIconKind): ImageVector = WIDGET_GLYPHS[icon] ?: GridGlyph

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
private fun glyph(
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
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** A round-capped near-zero-length segment renders as a filled dot at ([x], [y]). */
private fun PathBuilder.dot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}

/** Axis-aligned rectangle from ([left], [top]) to ([right], [bottom]). */
private fun PathBuilder.rect(
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
private fun PathBuilder.circle(
    cx: Float,
    cy: Float,
    r: Float,
) {
    moveTo(cx - r, cy)
    arcTo(r, r, 0f, false, true, cx + r, cy)
    arcTo(r, r, 0f, false, true, cx - r, cy)
    close()
}
