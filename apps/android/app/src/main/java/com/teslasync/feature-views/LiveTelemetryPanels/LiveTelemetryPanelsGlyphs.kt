// Self-contained line-style icon set for the LiveTelemetryPanels surface, drawn as Material [ImageVector]s.
//
// The web component uses `lucide-react` glyphs that the shared `DataDisplayGlyphs` set does not carry, and
// Android ships no lucide-equivalent set without the frozen `material-icons-extended` artifact. So — exactly
// as the sibling LiveTelemetry / LiveVehicleState surfaces do for their lucide ports — the glyphs this
// surface needs and the shared set lacks are authored here as 24×24 stroked vectors. Each is monochrome
// (drawn in opaque black) and recolored at render time by the [Icon] composable's `tint`. The web glyphs that
// the shared `DataDisplayGlyphs` already provides — Shield (security header), Gauge (tire header),
// BatteryCharging (energy header), Snowflake (defrost chip), Bolt (climate / charge chips), Lock (locked),
// Person (user present), MapPin (location) — are reused from there and not re-authored.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/LiveTelemetryPanels) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.livetelemetrypanels

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-equivalent glyphs the panels render that the shared sets do not provide. */
internal object LiveTelemetryPanelsGlyphs {
    /** lucide `cog` — the powertrain header + shift row: a hub ring with eight teeth. */
    val Cog: ImageVector =
        stroked("Cog") {
            circle(12f, 12f, 5.5f)
            dot(12f, 12f)
            spoke(12f, 3.5f, 12f, 6.5f)
            spoke(12f, 17.5f, 12f, 20.5f)
            spoke(3.5f, 12f, 6.5f, 12f)
            spoke(17.5f, 12f, 20.5f, 12f)
            spoke(6f, 6f, 7.8f, 7.8f)
            spoke(18f, 6f, 16.2f, 7.8f)
            spoke(6f, 18f, 7.8f, 16.2f)
            spoke(18f, 18f, 16.2f, 16.2f)
        }

    /** lucide `circle-dot` — the shift badge: a ring around a centre dot. */
    val CircleDot: ImageVector =
        stroked("CircleDot") {
            circle(12f, 12f, 8f)
            dot(12f, 12f)
        }

    /** lucide `thermometer` — the climate header: a mercury column with a bulb and two tick marks. */
    val Thermometer: ImageVector =
        stroked("Thermometer") {
            moveTo(12f, 4f)
            lineTo(12f, 14.5f)
            circle(12f, 17.5f, 2.5f)
            spoke(13.5f, 7f, 15f, 7f)
            spoke(13.5f, 10f, 15f, 10f)
        }

    /** lucide `fan` — the fan-speed row: four curved blades around a hub. */
    val Fan: ImageVector =
        stroked("Fan") {
            dot(12f, 12f)
            moveTo(12f, 12f)
            curveTo(12f, 8f, 13f, 4.5f, 16f, 4.5f)
            curveTo(18.5f, 4.5f, 18.5f, 8f, 12f, 12f)
            moveTo(12f, 12f)
            curveTo(16f, 12f, 19.5f, 13f, 19.5f, 16f)
            curveTo(19.5f, 18.5f, 16f, 18.5f, 12f, 12f)
            moveTo(12f, 12f)
            curveTo(12f, 16f, 11f, 19.5f, 8f, 19.5f)
            curveTo(5.5f, 19.5f, 5.5f, 16f, 12f, 12f)
            moveTo(12f, 12f)
            curveTo(8f, 12f, 4.5f, 11f, 4.5f, 8f)
            curveTo(4.5f, 5.5f, 8f, 5.5f, 12f, 12f)
        }

    /** lucide `activity` — the vehicle-state header: a heartbeat line. */
    val Activity: ImageVector =
        stroked("Activity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 4f)
            lineTo(14f, 20f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** lucide `lightbulb` — the high-beams row: a bulb with a short base. */
    val Lightbulb: ImageVector =
        stroked("Lightbulb") {
            moveTo(9f, 17f)
            lineTo(15f, 17f)
            moveTo(10f, 20f)
            lineTo(14f, 20f)
            moveTo(12f, 3f)
            curveTo(8.7f, 3f, 6.5f, 5.5f, 6.5f, 8.5f)
            curveTo(6.5f, 11f, 8f, 12.5f, 9f, 14f)
            lineTo(15f, 14f)
            curveTo(16f, 12.5f, 17.5f, 11f, 17.5f, 8.5f)
            curveTo(17.5f, 5.5f, 15.3f, 3f, 12f, 3f)
            close()
        }

    /** lucide `car` — the turn-signal / valet rows: a cabin over two wheels. */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(4f, 14f)
            lineTo(5.5f, 9.5f)
            curveTo(5.8f, 8.6f, 6.6f, 8f, 7.5f, 8f)
            lineTo(16.5f, 8f)
            curveTo(17.4f, 8f, 18.2f, 8.6f, 18.5f, 9.5f)
            lineTo(20f, 14f)
            lineTo(20f, 17.5f)
            lineTo(4f, 17.5f)
            close()
            dot(7.5f, 17.5f)
            dot(16.5f, 17.5f)
        }

    /** lucide `shield-alert` — the sentry row: a shield with an inner exclamation. */
    val ShieldAlert: ImageVector =
        stroked("ShieldAlert") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(12f, 8.5f)
            lineTo(12f, 13f)
            dot(12f, 16f)
        }

    /** lucide `door-closed` — the doors row: a door slab with a knob. */
    val DoorClosed: ImageVector =
        stroked("DoorClosed") {
            moveTo(6f, 20f)
            lineTo(6f, 5f)
            curveTo(6f, 4.4f, 6.4f, 4f, 7f, 4f)
            lineTo(17f, 4f)
            curveTo(17.6f, 4f, 18f, 4.4f, 18f, 5f)
            lineTo(18f, 20f)
            moveTo(4f, 20f)
            lineTo(20f, 20f)
            dot(14.5f, 12f)
        }

    /** lucide `key-round` — the remote-start row: a ring with a stem and a tooth. */
    val KeyRound: ImageVector =
        stroked("KeyRound") {
            circle(8.5f, 8.5f, 4.5f)
            moveTo(11.7f, 11.7f)
            lineTo(19f, 19f)
            moveTo(16f, 16f)
            lineTo(18f, 14f)
            moveTo(18.5f, 18.5f)
            lineTo(20.5f, 16.5f)
        }

    /** lucide `settings` — the service-mode row: a cog approximated as a gear ring. */
    val Settings: ImageVector =
        stroked("Settings") {
            circle(12f, 12f, 3f)
            spoke(12f, 4f, 12f, 6.5f)
            spoke(12f, 17.5f, 12f, 20f)
            spoke(4f, 12f, 6.5f, 12f)
            spoke(17.5f, 12f, 20f, 12f)
            spoke(6.3f, 6.3f, 8f, 8f)
            spoke(17.7f, 6.3f, 16f, 8f)
            spoke(6.3f, 17.7f, 8f, 16f)
            spoke(17.7f, 17.7f, 16f, 16f)
        }

    /** lucide `monitor` — the centre-display row: a screen over a stand. */
    val Monitor: ImageVector =
        stroked("Monitor") {
            roundedRect(3.5f, 4f, 17f, 11f)
            moveTo(9f, 19f)
            lineTo(15f, 19f)
            moveTo(12f, 15f)
            lineTo(12f, 19f)
        }

    /** lucide `unlock` — the unlocked state: an open shackle over a body. */
    val Unlock: ImageVector =
        stroked("Unlock") {
            roundedRect(5f, 11f, 14f, 9f)
            moveTo(8f, 11f)
            lineTo(8f, 7.5f)
            curveTo(8f, 5.3f, 9.8f, 3.5f, 12f, 3.5f)
            curveTo(13.8f, 3.5f, 15.3f, 4.7f, 15.8f, 6.3f)
        }

    /** lucide `headphones` — the media header: a band arc over two earcups. */
    val Headphones: ImageVector =
        stroked("Headphones") {
            moveTo(4f, 15f)
            curveTo(4f, 9f, 7.6f, 5.5f, 12f, 5.5f)
            curveTo(16.4f, 5.5f, 20f, 9f, 20f, 15f)
            moveTo(4f, 14.5f)
            lineTo(4f, 18f)
            curveTo(4f, 19.3f, 6f, 19.3f, 6f, 18f)
            lineTo(6f, 14.5f)
            close()
            moveTo(18f, 14.5f)
            lineTo(18f, 18f)
            curveTo(18f, 19.3f, 20f, 19.3f, 20f, 18f)
            lineTo(20f, 14.5f)
            close()
        }

    /** lucide `navigation-2` — the navigation sub-header: an upward location pointer. */
    val Navigation2: ImageVector =
        stroked("Navigation2") {
            moveTo(12f, 2.5f)
            lineTo(19f, 20.5f)
            lineTo(12f, 16.5f)
            lineTo(5f, 20.5f)
            close()
        }
}

private fun stroked(
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

/** A straight spoke from ([x1], [y1]) to ([x2], [y2]). */
private fun PathBuilder.spoke(
    x1: Float,
    y1: Float,
    x2: Float,
    y2: Float,
) {
    moveTo(x1, y1)
    lineTo(x2, y2)
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

/** A simple rectangle from its top-left ([x], [y]) with [w] width and [h] height. */
private fun PathBuilder.roundedRect(
    x: Float,
    y: Float,
    w: Float,
    h: Float,
) {
    moveTo(x, y)
    lineTo(x + w, y)
    lineTo(x + w, y + h)
    lineTo(x, y + h)
    close()
}
