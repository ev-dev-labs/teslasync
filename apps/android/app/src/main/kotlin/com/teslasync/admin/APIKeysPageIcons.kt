// Page-local line-style icon set for the APIKeysPage surface, authored as 24×24 stroked [ImageVector]s.
//
// The shared [io.teslasync.android.components.ui.TeslaGlyphs] set is a deliberately small library of the glyphs
// the shared UI primitives need, and it lives outside this surface's allowed files. The web page leans on
// `lucide-react` for `Key`, `Trash2`, `Shield`, `ShieldAlert`, `Crown`, `Clock`, and `XCircle` — glyphs the
// shared set does not carry — so they are authored here, monochrome (opaque black) and recolored at render time
// by the [io.teslasync.android.components.ui.Icon] composable's `tint`, inheriting `LocalContentColor` and every
// theme/state color automatically. This mirrors how `TeslaGlyphs` itself authors its vectors, so the visual
// language stays consistent without pulling the frozen `material-icons-extended` artifact.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) cannot match
// the app's `io.teslasync.android.*` package root.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The seven lucide-parity glyphs the APIKeysPage renders, drawn as stroked 24×24 vectors. Each is recolored at
 * render time by the [io.teslasync.android.components.ui.Icon] `tint`, so they honour every theme + dynamic-color
 * scheme (ADR-015) without per-glyph color.
 */
object ApiKeysGlyphs {
    /** A key with a round bow and a notched shaft (web `Key`). The row leading icon + the empty-state glyph. */
    val Key: ImageVector =
        stroked("Key") {
            circle(8f, 16f, 3.2f)
            moveTo(10.2f, 13.8f)
            lineTo(21f, 3f)
            moveTo(17f, 7f)
            lineTo(20f, 10f)
            moveTo(14.5f, 9.5f)
            lineTo(16.5f, 11.5f)
        }

    /** A waste bin with a lid + two inner bars (web `Trash2`). The delete affordance. */
    val Trash: ImageVector =
        stroked("Trash") {
            moveTo(4f, 6f)
            lineTo(20f, 6f)
            moveTo(9f, 6f)
            lineTo(9f, 4f)
            lineTo(15f, 4f)
            lineTo(15f, 6f)
            moveTo(6f, 6f)
            lineTo(7f, 20f)
            lineTo(17f, 20f)
            lineTo(18f, 6f)
            moveTo(10f, 10f)
            lineTo(10f, 17f)
            moveTo(14f, 10f)
            lineTo(14f, 17f)
        }

    /** A shield outline (web `Shield`). The read-permission badge glyph. */
    val Shield: ImageVector =
        stroked("Shield") {
            shieldOutline()
        }

    /** A shield with an exclamation (web `ShieldAlert`). The read-write-permission badge glyph. */
    val ShieldAlert: ImageVector =
        stroked("ShieldAlert") {
            shieldOutline()
            moveTo(12f, 8.5f)
            lineTo(12f, 13f)
            dot(12f, 15.5f)
        }

    /** A five-point crown (web `Crown`). The admin-permission badge glyph. */
    val Crown: ImageVector =
        stroked("Crown") {
            moveTo(5f, 18f)
            lineTo(19f, 18f)
            moveTo(5f, 18f)
            lineTo(3f, 7f)
            lineTo(8.5f, 11.5f)
            lineTo(12f, 5f)
            lineTo(15.5f, 11.5f)
            lineTo(21f, 7f)
            lineTo(19f, 18f)
        }

    /** A clock face with two hands (web `Clock`). The "Created" metadata glyph. */
    val Clock: ImageVector =
        stroked("Clock") {
            circle(12f, 12f, 8f)
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15.5f, 14f)
        }

    /** A circled cross (web `XCircle`). The revoke affordance + the "Expired" badge glyph. */
    val XCircle: ImageVector =
        stroked("XCircle") {
            circle(12f, 12f, 8f)
            moveTo(9f, 9f)
            lineTo(15f, 15f)
            moveTo(15f, 9f)
            lineTo(9f, 15f)
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

/** The shared shield silhouette used by both [ApiKeysGlyphs.Shield] and [ApiKeysGlyphs.ShieldAlert]. */
private fun PathBuilder.shieldOutline() {
    moveTo(12f, 3f)
    lineTo(20f, 6f)
    lineTo(20f, 12f)
    curveTo(20f, 16.5f, 16.5f, 20f, 12f, 21f)
    curveTo(7.5f, 20f, 4f, 16.5f, 4f, 12f)
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
