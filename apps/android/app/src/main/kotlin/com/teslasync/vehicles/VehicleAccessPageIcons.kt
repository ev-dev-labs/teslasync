// Locally-authored stroked vector glyphs for the VehicleAccessPage vehicles surface — the native counterparts of
// the web lucide icons the page renders (web/src/features/vehicles/pages/VehicleAccessPage.tsx imports RefreshCw,
// UserPlus, UserMinus, XCircle, Users, Mail, Shield). This mirrors the established A7 precedent
// (SharedDrivePageIcons / LifetimeStatsPageIcons): the three glyphs the shared catalogs already carry are
// re-exported (Users + Refresh from the feedback catalog, Shield from the data-display catalog), and the remaining
// four (Mail, UserPlus, UserMinus, XCircle) are authored locally as 24×24 stroked vectors and recoloured at render
// via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehicles.vehicleaccess

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.components.feedback.FeedbackGlyphs

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke colour is replaced by the Icon `tint` at render. */
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

/** Axis-aligned rounded-corner-free rectangle from ([left], [top]) to ([right], [bottom]). */
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

/** A person silhouette (head + shoulders) seated on the left of the 24×24 box (lucide `user`). */
private fun PathBuilder.personLeft() {
    circle(9f, 7f, 3.5f)
    moveTo(3f, 20f)
    curveTo(3f, 16.5f, 5.5f, 15f, 9f, 15f)
    curveTo(11f, 15f, 12.6f, 15.6f, 13.5f, 16.6f)
}

/**
 * The glyph set this surface needs (web lucide icons). The three glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other four are authored locally.
 */
object VehicleAccessGlyphs {
    /** People — web `Users` (drivers section header + drivers empty state). From the shared feedback catalog. */
    val Users: ImageVector = FeedbackGlyphs.Users

    /** Refresh arrows — web `RefreshCw` (the drivers + invitations refresh buttons). From the feedback catalog. */
    val Refresh: ImageVector = FeedbackGlyphs.Refresh

    /** Shield — web `Shield` (the invitations empty state). From the shared data-display catalog. */
    val Shield: ImageVector = DataDisplayGlyphs.Shield

    /** Envelope — web `Mail` (the invitations section header). */
    val Mail: ImageVector =
        strokedGlyph("VehicleAccessMail") {
            rect(3f, 5f, 21f, 19f)
            moveTo(3f, 6.5f)
            lineTo(12f, 12.5f)
            lineTo(21f, 6.5f)
        }

    /** Person with a plus — web `UserPlus` (the create-invitation "Invite Driver" button). */
    val UserPlus: ImageVector =
        strokedGlyph("VehicleAccessUserPlus") {
            personLeft()
            moveTo(19f, 8.5f)
            lineTo(19f, 14.5f)
            moveTo(16f, 11.5f)
            lineTo(22f, 11.5f)
        }

    /** Person with a minus — web `UserMinus` (the remove-driver row action). */
    val UserMinus: ImageVector =
        strokedGlyph("VehicleAccessUserMinus") {
            personLeft()
            moveTo(16f, 11.5f)
            lineTo(22f, 11.5f)
        }

    /** Circled cross — web `XCircle` (the revoke-invitation row action). */
    val XCircle: ImageVector =
        strokedGlyph("VehicleAccessXCircle") {
            circle(12f, 12f, 9f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
        }
}
