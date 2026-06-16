// Locally-authored stroked vector glyphs for the MQTTInspectorPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/telemetry/pages/MQTTInspectorPage.tsx imports Radio, Wifi, WifiOff,
// RefreshCw, AlertTriangle). The shared icon catalogs (TeslaGlyphs/DataDisplayGlyphs) do not ship the page's Radio /
// RefreshCw glyphs and editing them is outside this surface's allowed files, so the full set is authored here as
// 24×24 monochrome stroked vectors and recolored at render via the `Icon` tint — exactly the approach the sibling A7
// page surfaces document (DiagnosticPageIcons, StatisticsPageIcons).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/telemetry) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.telemetry.mqttinspector

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

private const val GLYPH_VIEWPORT = 24f
private const val GLYPH_STROKE = 2f

/**
 * The glyph set this surface needs (the web MQTTInspectorPage lucide icons). Each is a monochrome 24×24 stroked
 * vector recolored by the `Icon` tint at the render boundary, so it inherits every theme/state color automatically.
 */
object MqttInspectorGlyphs {
    /** Radio — web `Radio` (the four KPI StatCards). A broadcast core with two emitted waves on each side. */
    val Radio: ImageVector =
        strokedGlyph("MqttRadio") {
            glyphCircle(12f, 12f, 1.6f)
            moveTo(9f, 9.5f)
            lineTo(7.5f, 12f)
            lineTo(9f, 14.5f)
            moveTo(6.5f, 7f)
            lineTo(4.5f, 12f)
            lineTo(6.5f, 17f)
            moveTo(15f, 9.5f)
            lineTo(16.5f, 12f)
            lineTo(15f, 14.5f)
            moveTo(17.5f, 7f)
            lineTo(19.5f, 12f)
            lineTo(17.5f, 17f)
        }

    /** Wifi — web `Wifi` (the Connected status Badge). Three concentric upward arcs over a base dot. */
    val Wifi: ImageVector =
        strokedGlyph("MqttWifi") {
            moveTo(3.5f, 8.5f)
            arcTo(11f, 11f, 0f, false, true, 20.5f, 8.5f)
            moveTo(6f, 11.5f)
            arcTo(8f, 8f, 0f, false, true, 18f, 11.5f)
            moveTo(8.5f, 14.5f)
            arcTo(5f, 5f, 0f, false, true, 15.5f, 14.5f)
            glyphCircle(12f, 18f, 0.6f)
        }

    /** WifiOff — web `WifiOff` (the Disconnected status Badge). The wifi arcs struck through by a diagonal slash. */
    val WifiOff: ImageVector =
        strokedGlyph("MqttWifiOff") {
            moveTo(4.5f, 9.5f)
            arcTo(9.5f, 9.5f, 0f, false, true, 19.5f, 9.5f)
            moveTo(8.5f, 14.5f)
            arcTo(5f, 5f, 0f, false, true, 15.5f, 14.5f)
            glyphCircle(12f, 18f, 0.6f)
            moveTo(4f, 4f)
            lineTo(20f, 20f)
        }

    /** RefreshCw — web `RefreshCw` (the "Refreshes every 5s" action). Two arcs with arrowhead brackets. */
    val RefreshCw: ImageVector =
        strokedGlyph("MqttRefreshCw") {
            moveTo(19f, 12f)
            arcTo(7f, 7f, 0f, false, false, 7.5f, 6.5f)
            moveTo(5f, 4f)
            lineTo(5f, 9f)
            lineTo(10f, 9f)
            moveTo(5f, 12f)
            arcTo(7f, 7f, 0f, false, false, 16.5f, 17.5f)
            moveTo(19f, 20f)
            lineTo(19f, 15f)
            lineTo(14f, 15f)
        }

    /** AlertTriangle — web `AlertTriangle` (the fetch-error banner + the stale-vehicle warning). Triangle + bang. */
    val AlertTriangle: ImageVector =
        strokedGlyph("MqttAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            glyphCircle(12f, 16.5f, 0.5f)
        }
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
