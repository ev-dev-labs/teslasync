// The single line-style icon the DriveTimeline surface needs, drawn as a Material [ImageVector].
//
// The web component (drive-detail/DriveTimeline.tsx) marks the start and end of the drive with the
// `lucide-react` `Flag` glyph (`<Flag className="h-3 w-3" />`). The shared `ui.TeslaGlyphs` /
// `datadisplay.DataDisplayGlyphs` sets do not carry a flag, and Android has no bundled lucide equivalent
// without the frozen `material-icons-extended` artifact, so the glyph is authored here as a 24×24 stroked
// vector in the same monochrome style as the sibling surfaces' `*Glyphs` sets. It is recolored at render time
// by the `Icon` composable's `tint`, so it inherits the start (success) / end (danger) marker accent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/DriveTimeline) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.drivetimeline

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/** The drive start/end marker glyph, mapped 1:1 onto the web `lucide-react` `Flag` icon. */
object DriveTimelineGlyphs {
    /**
     * Waving banner on a staff — web lucide `Flag`
     * (`M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z` + the `M4 22V15` pole), normalized to the
     * 24px grid. The pole runs up the left edge; the banner's top and bottom edges wave out to the right.
     */
    val Flag: ImageVector =
        stroked("Flag") {
            moveTo(5f, 21f)
            lineTo(5f, 4f)
            moveTo(5f, 4f)
            curveTo(8f, 2.5f, 12f, 5.5f, 19f, 4f)
            lineTo(19f, 12f)
            curveTo(12f, 13.5f, 8f, 10.5f, 5f, 12f)
            close()
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
