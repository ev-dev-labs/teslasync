// Pure, framework-free model + projection for the Alerts weekly-digest feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/analytics/components/weekly-digest/AlertsSection.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web component is purely presentational — its parent (the Weekly Digest page, via useWeeklyDigest)
// builds `metrics.alertsByType` (a severity → count map) and the derived `alertPieData`, then passes them
// down. Both the "Alerts by Severity" list and the distribution pie iterate the SAME map entries in the same
// order, and `metrics.alertTotal` equals the sum of those counts. This file owns exactly that derivation: it
// takes the severity counts (received order preserved, as the web `Object.entries` map order is), derives the
// per-severity display name (web `severity.charAt(0).toUpperCase() + severity.slice(1)`), the grouped integer
// labels (web `fmtInt`), the total, and the empty guard (web `metrics.alertTotal === 0`). Slice colors are
// theme tokens resolved at the Compose boundary (never a raw hex here), so the projection carries the
// vendor-neutral [AlertSeverity] kind instead of a color.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AlertsSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.alertssection

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import java.util.Locale

/** Em dash shown for an unknown freshness age — the shared freshness "no value" fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object AlertsSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "alerts-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "AlertsSection"
}

/**
 * The semantic severity of an alert bucket — the vendor-neutral classification of the raw web severity key
 * (`'critical'` / `'warning'` / `'info'`, or anything else). The render layer maps this to a status/chart
 * design token and a glyph so the model stays free of Compose color types; [Other] is the catch-all the web
 * pie color falls back to (web `ALERT_SEVERITY_COLORS[severity] ?? CHART_COLORS[4]`).
 */
enum class AlertSeverity {
    Critical,
    Warning,
    Info,
    Other,
    ;

    companion object {
        /** Classifies a raw severity key exactly like the web string comparisons (case/space tolerant). */
        fun from(raw: String): AlertSeverity =
            when (raw.trim().lowercase(Locale.ROOT)) {
                "critical" -> Critical
                "warning" -> Warning
                "info" -> Info
                else -> Other
            }
    }
}

/**
 * One severity bucket — the native mirror of a web `metrics.alertsByType` entry (`[severity, count]`).
 * [severity] is the raw backend key (e.g. `critical`) and [count] the number of alerts of that severity in
 * the selected week (a non-negative integer, so `Long`).
 */
data class AlertSeverityCount(
    val severity: String,
    val count: Long,
)

/**
 * A fully projected, render-ready slice — the native analogue of one row of the web "Alerts by Severity" list
 * and, simultaneously, one `alertPieData` entry (both iterate the same map). Pure data (no Compose types): the
 * composable resolves [kind] to a token color + glyph and renders [displayName] / [countLabel].
 */
data class AlertSliceProjection(
    val severity: String,
    val displayName: String,
    val count: Long,
    val countLabel: String,
    val kind: AlertSeverity,
)

/**
 * The fully projected inputs the composable renders — the native analogue of the data the web component reads
 * from `metrics` + `alertPieData`. [slices] preserves the received order, [total] is the alert count (web
 * `metrics.alertTotal`, equal to the sum of the slice counts) with its grouped [totalLabel], and [isEmpty]
 * drives the empty branch (web `metrics.alertTotal === 0`).
 */
data class AlertsSectionProjectionResult(
    val slices: List<AlertSliceProjection>,
    val total: Long,
    val totalLabel: String,
    val isEmpty: Boolean,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free so it is fully covered by the off-device unit gate.
 */
object AlertsSectionProjection {
    /**
     * Projects the [counts] into render-ready slices, preserving the received order (the web map iteration
     * order, which both the severity list and the pie follow). Each bucket contributes one display name
     * (capitalized severity), one grouped count label, and its [AlertSeverity] kind; [total] sums the counts
     * and [isEmpty] is `true` when that sum is zero (web `metrics.alertTotal === 0`).
     */
    fun project(
        counts: List<AlertSeverityCount>,
        locale: Locale = Locale.getDefault(),
    ): AlertsSectionProjectionResult {
        val slices =
            counts.map { entry ->
                AlertSliceProjection(
                    severity = entry.severity,
                    displayName = capitalizeFirst(entry.severity),
                    count = entry.count,
                    countLabel = formatCount(entry.count, locale),
                    kind = AlertSeverity.from(entry.severity),
                )
            }
        val total = counts.sumOf { it.count }
        return AlertsSectionProjectionResult(
            slices = slices,
            total = total,
            totalLabel = formatCount(total, locale),
            isEmpty = total == 0L,
        )
    }

    /** Locale-grouped integer formatting — the web `fmtInt` (grouped, zero-decimal). */
    fun formatCount(
        count: Long,
        locale: Locale = Locale.getDefault(),
    ): String = String.format(locale, "%,d", count)

    /**
     * Capitalizes the first character and leaves the rest untouched — the web
     * `severity.charAt(0).toUpperCase() + severity.slice(1)`. Locale-root so the mapping is deterministic for
     * tests (and matches the locale-independent JS `toUpperCase`).
     */
    fun capitalizeFirst(value: String): String = if (value.isEmpty()) value else value.replaceFirstChar { it.uppercase(Locale.ROOT) }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [AlertsSectionRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordAlertsSectionOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to AlertsSectionRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws three lucide icons (`AlertTriangle`, `AlertCircle`, `Info`). Android has no bundled
// lucide set, and feature views may not expand the shared icon library from a surface prompt (allowed-files),
// so the three are authored here as 24×24 stroked vectors in the shared monochrome style — recolored at
// render time by the `Icon` composable's tint, exactly as the sibling surfaces author their local glyphs.

/** The web header / warning-severity `AlertTriangle` (lucide) — a triangle enclosing an exclamation. */
val AlertTriangleGlyph: ImageVector =
    strokedGlyph("AlertTriangle") {
        moveTo(12f, 3.5f)
        lineTo(22f, 20.5f)
        lineTo(2f, 20.5f)
        close()
        moveTo(12f, 9f)
        lineTo(12f, 13f)
        exclamationDot(12f, 16.5f)
    }

/** The web critical-severity `AlertCircle` (lucide) — a circle enclosing an exclamation. */
val AlertCircleGlyph: ImageVector =
    strokedGlyph("AlertCircle") {
        glyphCircle()
        moveTo(12f, 8f)
        lineTo(12f, 12f)
        exclamationDot(12f, 16f)
    }

/** The web info-severity `Info` (lucide) — a circle enclosing a lowercase information "i". */
val InfoGlyph: ImageVector =
    strokedGlyph("Info") {
        glyphCircle()
        moveTo(12f, 11f)
        lineTo(12f, 16f)
        exclamationDot(12f, 8f)
    }

/** Builds a 24×24 round-capped stroked [ImageVector] in the shared monochrome icon style. */
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
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
                pathBuilder = build,
            )
        }.build()

/** Full circle of radius 9 centered in the 24×24 viewport, approximated by two semicircular arcs. */
private fun PathBuilder.glyphCircle() {
    moveTo(3f, 12f)
    arcTo(9f, 9f, 0f, false, true, 21f, 12f)
    arcTo(9f, 9f, 0f, false, true, 3f, 12f)
    close()
}

/** A round-capped near-zero-length segment that renders as the exclamation/information dot at ([x], [y]). */
private fun PathBuilder.exclamationDot(
    x: Float,
    y: Float,
) {
    moveTo(x, y)
    lineTo(x + 0.1f, y)
}
