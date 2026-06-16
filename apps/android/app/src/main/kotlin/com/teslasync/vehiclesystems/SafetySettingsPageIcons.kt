// Locally-authored stroked vector glyphs for the SafetySettingsPage surface — the native counterparts of the web
// lucide icons the page renders (web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx imports UserCheck,
// Armchair, Lock, Navigation, Cpu, AlertCircle). This mirrors the established analytics-page precedent
// (StatisticsPageIcons): glyphs the shared catalogs already carry are re-exported from those catalogs
// (Lock from the data-display catalog, Shield from the nav catalog for the empty/score affordance), and the remainder
// (UserCheck / Armchair / Navigation / Cpu / AlertCircle) are authored locally as 24×24 stroked vectors and recolored
// at render via the Icon `tint`, rather than editing the shared catalogs (out of scope here).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehiclesystems) diverges
// from the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.vehiclesystems.safetysettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.datadisplay.DataDisplayGlyphs
import io.teslasync.android.navigation.NavGlyphs

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon `tint` at render. */
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

/**
 * The glyph set this surface needs (web lucide icons). The two glyphs the shared catalogs already carry are
 * re-exported so the page reads every icon from one source; the other five are authored locally.
 */
object SafetyGlyphs {
    /** Padlock — web `Lock` (vehicle-lock signal). Reused from the shared data-display catalog. */
    val Lock: ImageVector = DataDisplayGlyphs.Lock

    /** Shield — the safety-score / empty-state affordance. Reused from the shared nav catalog. */
    val Shield: ImageVector = NavGlyphs.Shield

    /** Person with a check — web `UserCheck` (seat-belt signals). */
    val UserCheck: ImageVector =
        strokedGlyph("SafetyUserCheck") {
            moveTo(4f, 20f)
            curveTo(4f, 16.5f, 6.5f, 14f, 10f, 14f)
            curveTo(13.5f, 14f, 16f, 16.5f, 16f, 20f)
            moveTo(10f, 11f)
            curveTo(7.8f, 11f, 6f, 9.2f, 6f, 7f)
            curveTo(6f, 4.8f, 7.8f, 3f, 10f, 3f)
            curveTo(12.2f, 3f, 14f, 4.8f, 14f, 7f)
            curveTo(14f, 9.2f, 12.2f, 11f, 10f, 11f)
            moveTo(16f, 11f)
            lineTo(18f, 13f)
            lineTo(22f, 9f)
        }

    /** Armchair — web `Armchair` (driver-seat occupancy signal). */
    val Armchair: ImageVector =
        strokedGlyph("SafetyArmchair") {
            moveTo(5f, 11f)
            curveTo(5f, 9.9f, 5.9f, 9f, 7f, 9f)
            curveTo(8.1f, 9f, 9f, 9.9f, 9f, 11f)
            lineTo(9f, 13f)
            lineTo(15f, 13f)
            lineTo(15f, 11f)
            curveTo(15f, 9.9f, 15.9f, 9f, 17f, 9f)
            curveTo(18.1f, 9f, 19f, 9.9f, 19f, 11f)
            lineTo(19f, 16f)
            lineTo(5f, 16f)
            close()
            moveTo(6f, 9.5f)
            lineTo(6f, 7f)
            curveTo(6f, 5.3f, 7.3f, 4f, 9f, 4f)
            lineTo(15f, 4f)
            curveTo(16.7f, 4f, 18f, 5.3f, 18f, 7f)
            lineTo(18f, 9.5f)
            moveTo(7f, 16f)
            lineTo(7f, 19f)
            moveTo(17f, 16f)
            lineTo(17f, 19f)
        }

    /** Navigation arrow — web `Navigation` (distance-since-reset metric). */
    val Navigation: ImageVector =
        strokedGlyph("SafetyNavigation") {
            moveTo(3f, 11f)
            lineTo(21f, 3f)
            lineTo(13f, 21f)
            lineTo(11f, 13f)
            close()
        }

    /** CPU chip — web `Cpu` (self-driving distance metric). */
    val Cpu: ImageVector =
        strokedGlyph("SafetyCpu") {
            moveTo(7f, 7f)
            lineTo(17f, 7f)
            lineTo(17f, 17f)
            lineTo(7f, 17f)
            close()
            moveTo(10f, 4f)
            lineTo(10f, 7f)
            moveTo(14f, 4f)
            lineTo(14f, 7f)
            moveTo(10f, 17f)
            lineTo(10f, 20f)
            moveTo(14f, 17f)
            lineTo(14f, 20f)
            moveTo(4f, 10f)
            lineTo(7f, 10f)
            moveTo(4f, 14f)
            lineTo(7f, 14f)
            moveTo(17f, 10f)
            lineTo(20f, 10f)
            moveTo(17f, 14f)
            lineTo(20f, 14f)
        }

    /** Circle with an exclamation — web `AlertCircle` (the error banner). */
    val AlertCircle: ImageVector =
        strokedGlyph("SafetyAlertCircle") {
            moveTo(12f, 3f)
            curveTo(7f, 3f, 3f, 7f, 3f, 12f)
            curveTo(3f, 17f, 7f, 21f, 12f, 21f)
            curveTo(17f, 21f, 21f, 17f, 21f, 12f)
            curveTo(21f, 7f, 17f, 3f, 12f, 3f)
            close()
            moveTo(12f, 8f)
            lineTo(12f, 13f)
            moveTo(12f, 16f)
            lineTo(12f, 16.5f)
        }
}
