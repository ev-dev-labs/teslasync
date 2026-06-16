// Line-style icon glyphs for the GuardModePage surface, authored as 24×24 stroked Material [ImageVector]s.
//
// The web page uses `lucide-react` glyphs (ShieldCheck, ShieldAlert, ShieldOff, Siren, MapPin, Clock, CheckCircle2,
// AlertTriangle, Lock, Unlock, Car, Eye, Info). Android ships no bundled lucide equivalent without the frozen
// `material-icons-extended` artifact (which this module deliberately does not depend on — see
// components/ui/TeslaGlyphs.kt), so the glyphs the page's status / panic / timeline rows + the map empty state need
// are authored here, mirroring the sibling MapOverviewPageIcons precedent. Each is monochrome and recolored at render
// time by the shared `Icon` composable's `tint`, so they inherit every theme/state color automatically.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The page-local glyph set — the lucide icons the web GuardModePage uses, authored as stroked vectors. */
object GuardModeGlyphs {
    /** Shield with a check (web `ShieldCheck`) — the armed state of the guard toggle card. */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            shield()
            moveTo(8.7f, 12f)
            lineTo(11f, 14.3f)
            lineTo(15.3f, 9.7f)
        }

    /** Shield with an alert mark (web `ShieldAlert`) — the triggered state + the alert banner. */
    val ShieldAlert: ImageVector =
        stroked("ShieldAlert") {
            shield()
            moveTo(12f, 8f)
            lineTo(12f, 12.5f)
            dot(12f, 15.5f)
        }

    /** Shield with a slash (web `ShieldOff`) — the disarmed state of the guard toggle card. */
    val ShieldOff: ImageVector =
        stroked("ShieldOff") {
            shield()
            moveTo(6f, 5.5f)
            lineTo(18f, 18.5f)
        }

    /** Emergency siren (web `Siren`) — the panic card + a manual-panic event row. */
    val Siren: ImageVector =
        stroked("Siren") {
            moveTo(7f, 20f)
            lineTo(17f, 20f)
            moveTo(7f, 20f)
            lineTo(7f, 13f)
            curveTo(7f, 9.7f, 9.2f, 7f, 12f, 7f)
            curveTo(14.8f, 7f, 17f, 9.7f, 17f, 13f)
            lineTo(17f, 20f)
            moveTo(12f, 7f)
            lineTo(12f, 4f)
            moveTo(4.5f, 11f)
            lineTo(3f, 10.3f)
            moveTo(19.5f, 11f)
            lineTo(21f, 10.3f)
        }

    /** Map pin (web `MapPin`) — the live-map empty state. */
    val MapPin: ImageVector =
        stroked("MapPin") {
            moveTo(12f, 2f)
            curveTo(8.13f, 2f, 5f, 5.13f, 5f, 9f)
            curveTo(5f, 14.25f, 12f, 22f, 12f, 22f)
            curveTo(12f, 22f, 19f, 14.25f, 19f, 9f)
            curveTo(19f, 5.13f, 15.87f, 2f, 12f, 2f)
            close()
            circle(12f, 9f, 2.5f)
        }

    /** Clock (web `Clock`) — the "armed since" status row. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 9f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** Closed padlock (web `Lock`) — the locked status row. */
    val Lock: ImageVector =
        stroked("Lock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.79f, 9.79f, 4f, 12f, 4f)
            curveTo(14.21f, 4f, 16f, 5.79f, 16f, 8f)
            lineTo(16f, 11f)
            dot(12f, 15.5f)
        }

    /** Open padlock (web `Unlock`) — an unauthorized-unlock event row. */
    val Unlock: ImageVector =
        stroked("Unlock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.79f, 9.79f, 4f, 12f, 4f)
            curveTo(13.64f, 4f, 15.05f, 4.99f, 15.66f, 6.4f)
            dot(12f, 15.5f)
        }

    /** Eye (web `Eye`) — the sentry-mode status row. */
    val Eye: ImageVector =
        stroked("Eye") {
            moveTo(2f, 12f)
            curveTo(4.5f, 6.5f, 8f, 5f, 12f, 5f)
            curveTo(16f, 5f, 19.5f, 6.5f, 22f, 12f)
            curveTo(19.5f, 17.5f, 16f, 19f, 12f, 19f)
            curveTo(8f, 19f, 4.5f, 17.5f, 2f, 12f)
            close()
            dot(12f, 12f)
        }

    /** Warning triangle (web `AlertTriangle`) — the unack-events status row + the generic event icon. */
    val AlertTriangle: ImageVector =
        stroked("AlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            dot(12f, 16.5f)
        }

    /** Circled check (web `CheckCircle2`) — an acknowledged event row. */
    val CheckCircle: ImageVector =
        stroked("CheckCircle") {
            circle(12f, 12f, 9f)
            moveTo(8f, 12.5f)
            lineTo(11f, 15.5f)
            lineTo(16f, 9f)
        }

    /** Car (web `Car`) — an unauthorized-drive event row. */
    val Car: ImageVector =
        stroked("Car") {
            moveTo(4f, 15f)
            lineTo(4f, 11.5f)
            lineTo(6.5f, 8f)
            lineTo(17.5f, 8f)
            lineTo(20f, 11.5f)
            lineTo(20f, 15f)
            moveTo(4f, 11.5f)
            lineTo(20f, 11.5f)
            circle(8f, 16f, 1.6f)
            circle(16f, 16f, 1.6f)
        }

    /** Info circle (web `Info`) — the empty event-timeline state. */
    val Info: ImageVector =
        stroked("Info") {
            circle(12f, 12f, 9f)
            moveTo(12f, 11f)
            lineTo(12f, 16f)
            dot(12f, 8f)
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
}

/** The shared shield silhouette used by the three guard-state glyphs. */
private fun PathBuilder.shield() {
    moveTo(12f, 3f)
    lineTo(19f, 6f)
    lineTo(19f, 11f)
    curveTo(19f, 16f, 12f, 21f, 12f, 21f)
    curveTo(12f, 21f, 5f, 16f, 5f, 11f)
    lineTo(5f, 6f)
    close()
}

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
