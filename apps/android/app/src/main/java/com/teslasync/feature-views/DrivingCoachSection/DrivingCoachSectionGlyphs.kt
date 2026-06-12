// Locally authored line-style glyphs for the DrivingCoachSection surface — the native analogues of the web
// lucide icons the section renders (`Zap` on the Avg-Efficiency stat, `ShieldCheck` on the Best-Efficiency
// stat, `Lightbulb` beside the Recommendations title). The shared data-display icon set does not already ship
// these three, so they are authored here as 24×24 stroked [ImageVector]s in the shared monochrome style so
// they recolor at render time via the [Icon] tint. They are kept local to this surface (the mandated
// allowed-files path) rather than expanding a shared icon set from a feature prompt — the same approach the
// sibling DrivingSection / DrivingCoachWidget surfaces take with their co-located glyph objects.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/DrivingCoachSection) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the object name.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivingcoachsection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The lucide-style glyphs DrivingCoachSection renders that the shared icon set does not already provide. */
internal object DrivingCoachSectionGlyphs {
    /** Lightning-bolt glyph (lucide `zap`) — the Avg Efficiency stat-card icon. */
    val Zap: ImageVector =
        coachStroked("DrivingCoachZap") {
            moveTo(13f, 2f)
            lineTo(3f, 14f)
            lineTo(12f, 14f)
            lineTo(11f, 22f)
            lineTo(21f, 10f)
            lineTo(12f, 10f)
            close()
        }

    /** Shield-with-check glyph (lucide `shield-check`) — the Best Efficiency stat-card icon. */
    val ShieldCheck: ImageVector =
        coachStroked("DrivingCoachShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 12f)
            curveTo(19f, 16.5f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16.5f, 5f, 12f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 12.5f)
            lineTo(11f, 14.5f)
            lineTo(15.5f, 9.5f)
        }

    /** Lightbulb glyph (lucide `lightbulb`) — the icon beside the Recommendations title. */
    val Lightbulb: ImageVector =
        coachStroked("DrivingCoachLightbulb") {
            moveTo(12f, 2f)
            curveTo(8.7f, 2f, 6f, 4.7f, 6f, 8f)
            curveTo(6f, 10.5f, 7.5f, 12.5f, 9f, 14f)
            lineTo(9f, 16f)
            lineTo(15f, 16f)
            lineTo(15f, 14f)
            curveTo(16.5f, 12.5f, 18f, 10.5f, 18f, 8f)
            curveTo(18f, 4.7f, 15.3f, 2f, 12f, 2f)
            close()
            moveTo(9.5f, 19f)
            lineTo(14.5f, 19f)
            moveTo(10f, 22f)
            lineTo(14f, 22f)
        }
}

/** Builds a 24×24 round-joined stroked vector from a path [build] block — the shared glyph drawing style. */
private fun coachStroked(
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
