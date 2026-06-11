// Line-style icon set for the Security Event Timeline surface, drawn as Material [ImageVector]s.
//
// The web component (security-access/EventTimeline.tsx) uses six `lucide-react` glyphs —
// Lock / Unlock / ShieldCheck / ShieldAlert / DoorClosed / DoorOpen. The shared `ui.TeslaGlyphs`
// and `feedback.FeedbackGlyphs` sets carry only a subset (Lock), and Android has no bundled lucide
// equivalent without the frozen `material-icons-extended` artifact, so the remaining surface-specific
// glyphs are authored here as 24×24 stroked vectors in the same monochrome style as the shared sets.
// Each is recolored at render time by the `Icon` composable's `tint`, so they inherit the marker accent.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/EventTimeline) cannot form a valid Kotlin package, so the package
// intentionally diverges from the path — as the sibling feature-view surfaces do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.eventtimeline

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The six timeline-marker glyphs, mapped 1:1 onto the web `timelineIcon` lucide icons. [resolve] turns a
 * pure [EventTimelineGlyph] key (chosen by the off-device projection) into the concrete vector the
 * composable renders, keeping glyph selection unit-testable and rendering declarative.
 */
object EventTimelineGlyphs {
    /** Secured padlock (closed shackle) — web lucide `Lock`, for `lock` + positive. */
    val Lock: ImageVector =
        stroked("Lock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
            lineTo(16f, 11f)
        }

    /** Open padlock (shackle swung clear of the right post) — web lucide `Unlock`, for `lock` + negative. */
    val Unlock: ImageVector =
        stroked("Unlock") {
            rect(5f, 11f, 19f, 20f)
            moveTo(8f, 11f)
            lineTo(8f, 8f)
            curveTo(8f, 5.8f, 9.8f, 4f, 12f, 4f)
            curveTo(14.2f, 4f, 16f, 5.8f, 16f, 8f)
        }

    /** Shield with a check — web lucide `ShieldCheck`, for `sentry` + positive (surveillance enabled). */
    val ShieldCheck: ImageVector =
        stroked("ShieldCheck") {
            shield()
            moveTo(9f, 12f)
            lineTo(11f, 14f)
            lineTo(15.5f, 9.5f)
        }

    /** Shield with an alert mark — web lucide `ShieldAlert`, for `sentry` + negative (surveillance off). */
    val ShieldAlert: ImageVector =
        stroked("ShieldAlert") {
            shield()
            moveTo(12f, 8f)
            lineTo(12f, 12.5f)
            dot(12f, 15.5f)
        }

    /** Closed door with knob — web lucide `DoorClosed`, for `door` + positive (Doors Closed). */
    val DoorClosed: ImageVector =
        stroked("DoorClosed") {
            moveTo(6f, 20f)
            lineTo(6f, 6f)
            curveTo(6f, 4.9f, 6.9f, 4f, 8f, 4f)
            lineTo(16f, 4f)
            curveTo(17.1f, 4f, 18f, 4.9f, 18f, 6f)
            lineTo(18f, 20f)
            moveTo(3f, 20f)
            lineTo(21f, 20f)
            dot(14.5f, 12f)
        }

    /** Ajar door (leaning panel + frame post) with knob — web lucide `DoorOpen`, for `door` + negative. */
    val DoorOpen: ImageVector =
        stroked("DoorOpen") {
            moveTo(5f, 20f)
            lineTo(5f, 6f)
            lineTo(13f, 3.5f)
            lineTo(13f, 20f)
            close()
            moveTo(13f, 4f)
            lineTo(16f, 4f)
            curveTo(17.1f, 4f, 18f, 4.9f, 18f, 6f)
            lineTo(18f, 20f)
            moveTo(3f, 20f)
            lineTo(21f, 20f)
            dot(10f, 12.5f)
        }

    /** Resolves a pure [EventTimelineGlyph] key to its authored vector. */
    fun resolve(glyph: EventTimelineGlyph): ImageVector =
        when (glyph) {
            EventTimelineGlyph.Lock -> Lock
            EventTimelineGlyph.Unlock -> Unlock
            EventTimelineGlyph.ShieldCheck -> ShieldCheck
            EventTimelineGlyph.ShieldAlert -> ShieldAlert
            EventTimelineGlyph.DoorClosed -> DoorClosed
            EventTimelineGlyph.DoorOpen -> DoorOpen
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

/** Heater-shield outline shared by the two sentry glyphs: top-center down each flank to the bottom point. */
private fun PathBuilder.shield() {
    moveTo(12f, 3f)
    lineTo(20f, 6f)
    lineTo(20f, 11f)
    curveTo(20f, 16f, 16.5f, 19.5f, 12f, 21f)
    curveTo(7.5f, 19.5f, 4f, 16f, 4f, 11f)
    lineTo(4f, 6f)
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
