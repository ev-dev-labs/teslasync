// Locally-authored stroked vector glyphs for the SystemStatusPage surface — the native counterparts of the web
// lucide icons (`@/lib/icons`) the page uses (Activity, Server, Database, Zap, ShieldCheck, Bell, Cpu, HardDrive,
// Boxes, Package, Clock, RefreshCw, Car, Inbox, AlertTriangle). This mirrors the established sibling precedent
// (ApiLogsPage's glyph set): a glyph is authored locally as a 24×24 stroked vector and recolored at render via the
// Icon/StatCard `tint`, rather than editing the shared TeslaGlyphs catalog (out of scope here). The co-located
// tone mappers turn a [HealthTone] into the design-system badge variant / banner tone the render layer needs.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.system.systemstatus

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.ui.BadgeVariant

private const val STROKE_WIDTH = 2f

/** Build a 24×24 stroked glyph; the stroke color is replaced by the Icon/StatCard `tint` at render. */
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

/** The local glyph set this surface needs (web lucide icons). */
object SystemStatusGlyphs {
    /** ECG-style pulse line — web `Activity` (overall health hero). */
    val Activity: ImageVector =
        strokedGlyph("SystemStatusActivity") {
            moveTo(3f, 12f)
            lineTo(7f, 12f)
            lineTo(10f, 5f)
            lineTo(14f, 19f)
            lineTo(17f, 12f)
            lineTo(21f, 12f)
        }

    /** Stacked racks — web `Server` (services & components). */
    val Server: ImageVector =
        strokedGlyph("SystemStatusServer") {
            roundedRect(3f, 4f, 21f, 10f)
            roundedRect(3f, 14f, 21f, 20f)
            moveTo(7f, 7f)
            lineTo(7.1f, 7f)
            moveTo(7f, 17f)
            lineTo(7.1f, 17f)
        }

    /** Cylinder stack — web `Database` (database & connections). */
    val Database: ImageVector =
        strokedGlyph("SystemStatusDatabase") {
            moveTo(4f, 6f)
            curveTo(4f, 4.3f, 7.6f, 3f, 12f, 3f)
            curveTo(16.4f, 3f, 20f, 4.3f, 20f, 6f)
            lineTo(20f, 18f)
            curveTo(20f, 19.7f, 16.4f, 21f, 12f, 21f)
            curveTo(7.6f, 21f, 4f, 19.7f, 4f, 18f)
            close()
            moveTo(4f, 6f)
            curveTo(4f, 7.7f, 7.6f, 9f, 12f, 9f)
            curveTo(16.4f, 9f, 20f, 7.7f, 20f, 6f)
            moveTo(4f, 12f)
            curveTo(4f, 13.7f, 7.6f, 15f, 12f, 15f)
            curveTo(16.4f, 15f, 20f, 13.7f, 20f, 12f)
        }

    /** Lightning bolt — web `Zap` (telemetry pipeline). */
    val Zap: ImageVector =
        strokedGlyph("SystemStatusZap") {
            moveTo(13f, 3f)
            lineTo(5f, 13f)
            lineTo(12f, 13f)
            lineTo(11f, 21f)
            lineTo(19f, 11f)
            lineTo(12f, 11f)
            close()
        }

    /** Shield with a check — web `ShieldCheck` (Tesla auth). */
    val ShieldCheck: ImageVector =
        strokedGlyph("SystemStatusShieldCheck") {
            moveTo(12f, 3f)
            lineTo(19f, 6f)
            lineTo(19f, 11f)
            curveTo(19f, 16f, 16f, 19.5f, 12f, 21f)
            curveTo(8f, 19.5f, 5f, 16f, 5f, 11f)
            lineTo(5f, 6f)
            close()
            moveTo(9f, 11.5f)
            lineTo(11.5f, 14f)
            lineTo(15.5f, 9f)
        }

    /** Bell — web `Bell` (notifications & audit). */
    val Bell: ImageVector =
        strokedGlyph("SystemStatusBell") {
            moveTo(6f, 10f)
            curveTo(6f, 7f, 8.7f, 4.5f, 12f, 4.5f)
            curveTo(15.3f, 4.5f, 18f, 7f, 18f, 10f)
            lineTo(18f, 15f)
            lineTo(20f, 18f)
            lineTo(4f, 18f)
            lineTo(6f, 15f)
            close()
            moveTo(10f, 21f)
            curveTo(11.2f, 22f, 12.8f, 22f, 14f, 21f)
        }

    /** CPU chip — web `Cpu` (background workers / system info). */
    val Cpu: ImageVector =
        strokedGlyph("SystemStatusCpu") {
            roundedRect(7f, 7f, 17f, 17f)
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

    /** Disk platter — web `HardDrive` (storage used / backups). */
    val HardDrive: ImageVector =
        strokedGlyph("SystemStatusHardDrive") {
            moveTo(3f, 12f)
            lineTo(7f, 5f)
            lineTo(17f, 5f)
            lineTo(21f, 12f)
            lineTo(21f, 18f)
            lineTo(3f, 18f)
            close()
            moveTo(3f, 12f)
            lineTo(21f, 12f)
            moveTo(7f, 15f)
            lineTo(7.1f, 15f)
        }

    /** Stacked boxes — web `Boxes` (total rows). */
    val Boxes: ImageVector =
        strokedGlyph("SystemStatusBoxes") {
            roundedRect(4f, 4f, 11f, 11f)
            roundedRect(13f, 4f, 20f, 11f)
            roundedRect(8.5f, 13f, 15.5f, 20f)
        }

    /** Parcel — web `Package` (backups). */
    val Package: ImageVector =
        strokedGlyph("SystemStatusPackage") {
            moveTo(12f, 3f)
            lineTo(20f, 7f)
            lineTo(20f, 17f)
            lineTo(12f, 21f)
            lineTo(4f, 17f)
            lineTo(4f, 7f)
            close()
            moveTo(4f, 7f)
            lineTo(12f, 11f)
            lineTo(20f, 7f)
            moveTo(12f, 11f)
            lineTo(12f, 21f)
        }

    /** Clock — web `Clock` (uptime / system info). */
    val Clock: ImageVector =
        strokedGlyph("SystemStatusClock") {
            moveTo(12f, 4f)
            curveTo(7.6f, 4f, 4f, 7.6f, 4f, 12f)
            curveTo(4f, 16.4f, 7.6f, 20f, 12f, 20f)
            curveTo(16.4f, 20f, 20f, 16.4f, 20f, 12f)
            curveTo(20f, 7.6f, 16.4f, 4f, 12f, 4f)
            close()
            moveTo(12f, 7.5f)
            lineTo(12f, 12f)
            lineTo(15f, 14f)
        }

    /** Circular refresh arrows — web `RefreshCw` (refresh action). */
    val RefreshCw: ImageVector =
        strokedGlyph("SystemStatusRefreshCw") {
            moveTo(20f, 7f)
            lineTo(20f, 11f)
            lineTo(16f, 11f)
            moveTo(4f, 17f)
            lineTo(4f, 13f)
            lineTo(8f, 13f)
            moveTo(6f, 9f)
            curveTo(7.5f, 6f, 10.5f, 4.5f, 13.5f, 5.3f)
            curveTo(15.7f, 5.9f, 17.4f, 7.6f, 19f, 10f)
            moveTo(18f, 15f)
            curveTo(16.5f, 18f, 13.5f, 19.5f, 10.5f, 18.7f)
            curveTo(8.3f, 18.1f, 6.6f, 16.4f, 5f, 14f)
        }

    /** Car silhouette — web `Car` (vehicles / telemetry). */
    val Car: ImageVector =
        strokedGlyph("SystemStatusCar") {
            moveTo(4f, 16f)
            lineTo(4f, 12f)
            lineTo(6f, 7f)
            lineTo(18f, 7f)
            lineTo(20f, 12f)
            lineTo(20f, 16f)
            lineTo(4f, 16f)
            close()
            moveTo(4f, 12f)
            lineTo(20f, 12f)
            moveTo(7.5f, 16f)
            lineTo(7.5f, 18f)
            moveTo(16.5f, 16f)
            lineTo(16.5f, 18f)
        }

    /** Inbox tray — web `Inbox` (recent errors / audit). */
    val Inbox: ImageVector =
        strokedGlyph("SystemStatusInbox") {
            moveTo(4f, 13f)
            lineTo(8f, 13f)
            lineTo(10f, 16f)
            lineTo(14f, 16f)
            lineTo(16f, 13f)
            lineTo(20f, 13f)
            moveTo(4f, 13f)
            lineTo(7f, 5f)
            lineTo(17f, 5f)
            lineTo(20f, 13f)
            lineTo(20f, 19f)
            lineTo(4f, 19f)
            close()
        }

    /** Warning triangle with a bang — web `AlertTriangle` (degraded / over-budget callouts). */
    val AlertTriangle: ImageVector =
        strokedGlyph("SystemStatusAlertTriangle") {
            moveTo(12f, 4f)
            lineTo(21f, 19f)
            lineTo(3f, 19f)
            close()
            moveTo(12f, 10f)
            lineTo(12f, 14f)
            moveTo(12f, 16.5f)
            lineTo(12f, 16.6f)
        }
}

/** Map a [HealthTone] to its design-system [BadgeVariant] (the status-chip palette). */
internal fun HealthTone.badgeVariant(): BadgeVariant =
    when (this) {
        HealthTone.Healthy -> BadgeVariant.Success
        HealthTone.Degraded -> BadgeVariant.Warning
        HealthTone.Unhealthy -> BadgeVariant.Danger
        HealthTone.Maintenance -> BadgeVariant.Info
        HealthTone.Unknown -> BadgeVariant.Neutral
    }

/** Map a [HealthTone] to the inline-banner [Tone] (info / success / warning / danger). */
internal fun HealthTone.bannerTone(): Tone =
    when (this) {
        HealthTone.Healthy -> Tone.Success
        HealthTone.Degraded -> Tone.Warning
        HealthTone.Unhealthy -> Tone.Danger
        HealthTone.Maintenance -> Tone.Info
        HealthTone.Unknown -> Tone.Info
    }

/** Axis-aligned rounded-ish rectangle from ([left], [top]) to ([right], [bottom]) drawn as a closed path. */
private fun PathBuilder.roundedRect(
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
