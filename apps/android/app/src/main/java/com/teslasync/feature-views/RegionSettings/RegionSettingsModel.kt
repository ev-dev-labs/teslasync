// Pure, framework-free model + projection for the RegionSettings feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/RegionSettings.tsx). The projection logic carries no Compose,
// Android, or HTTP types, so it is fully exercised off-device in the :android:testReleaseUnitTest gate and the
// composable stays a thin render layer. The only non-logic declarations are the co-located lucide glyph
// vectors (static ImageVector values), authored locally exactly as the sibling feature-view surfaces do.
//
// The web component reads `useTeslaUserRegion()` (the region envelope + its `fetched_at` stamp) and renders a
// two-card grid (the Fleet-API region code + the regional base URL), falling back to an empty state when the
// account has no resolved region yet (web `regionConfig?.data?.region` is falsy). This file owns the
// derivations the web component computes inline: the "has a region" guard (web `data?.region`), the
// "ever fetched" guard (web `fetched_at` truthiness), the base-URL fallback (web `fleet_api_base_url ?? '—'`),
// and the localized "Synced" stamp (web `formatDateTime`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RegionSettings — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.regionsettings

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaRegionEnvelope
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an unknown/blank value — the web `'—'` / invalid-date fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object RegionSettingsRegistration {
    /** Stable surface id. */
    const val ID: String = "region-settings"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "RegionSettings"
}

/**
 * One fully projected, render-ready region document — the native analogue of the two cards the web component
 * renders inside its `data?.region` branch. Pure data (no Compose types): the composable lays out the region
 * code + the Fleet API base URL rows.
 *
 * @property region the resolved Fleet-API region code, shown prominently (web `data.region`).
 * @property fleetApiUrl the regional base URL, already falling back to [EM_DASH] for a blank value
 *   (web `data.fleet_api_base_url ?? '—'`), shown monospace and allowed to wrap.
 */
data class RegionView(
    val region: String,
    val fleetApiUrl: String,
)

/**
 * The pure projection the composable renders — the native mirror of the web component's data derivations.
 * Stateless and side-effect-free (the [ZoneId]/[Locale] are injected) so it is fully covered by the
 * off-device unit gate.
 */
object RegionSettingsProjection {
    /** Whether the envelope has ever been fetched (web `regionConfig?.fetched_at` truthiness). */
    fun hasFetched(envelope: TeslaRegionEnvelope?): Boolean = !envelope?.fetchedAt.isNullOrBlank()

    /**
     * Whether the envelope resolves to "no region yet" — the web empty-state guard, which falls back whenever
     * `regionConfig?.data?.region` is falsy (no envelope, or a blank region code).
     */
    fun isEmpty(envelope: TeslaRegionEnvelope?): Boolean = envelope?.data?.region.isNullOrBlank()

    /**
     * Projects [envelope] into the render-ready [RegionView], or `null` when there is no resolved region (the
     * web `data?.region ?` guard is false) — in which case the surface renders its empty state. The base URL
     * falls back to [EM_DASH] for a blank value (web `?? '—'`).
     */
    fun regionView(envelope: TeslaRegionEnvelope?): RegionView? {
        val data = envelope?.data?.takeIf { it.region.isNotBlank() } ?: return null
        return RegionView(
            region = data.region,
            fleetApiUrl = data.fleetApiBaseUrl.ifBlank { EM_DASH },
        )
    }

    /**
     * Localized "medium date, short time" formatter for the header sync stamp — the native analogue of the web
     * `formatDateTime`. A blank or unparseable input yields [EM_DASH].
     */
    fun formatSynced(
        iso: String?,
        zone: ZoneId,
        locale: Locale,
    ): String {
        val instant = parseInstant(iso) ?: return EM_DASH
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(locale)
            .withZone(zone)
            .format(instant)
    }

    // Tolerant decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a zoneless local
    // date-time treated as UTC. The first that parses wins; none parsing yields null (the em-dash guard).
    private val instantParsers: List<(String) -> Instant?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw) } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC) } },
        )

    private fun parseInstant(raw: String?): Instant? = if (raw.isNullOrBlank()) null else instantParsers.firstNotNullOfOrNull { it(raw) }

    private fun <T> tryParse(block: () -> T): T? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RegionSettingsRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect. Only the surface slug is logged — never the region code or the base URL.
 */
fun recordRegionSettingsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to RegionSettingsRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws three lucide icons (Globe, RefreshCw, Info). Android has no bundled lucide set, and
// feature views may not expand the shared icon library from a surface prompt (allowed-files), so the two not
// already in the shared `TeslaGlyphs` set are authored here as 24×24 stroked vectors in the shared monochrome
// style — recolored at render time by the `Icon` composable's tint, exactly as the sibling surfaces author
// their local glyphs. The web `Info` reuses the shared `TeslaGlyphs.Info`.

/** The web header `Globe` (lucide) — a circle with an equator and two curved meridians. */
val GlobeGlyph: ImageVector =
    strokedGlyph("Globe") {
        circle(12f, 12f, 9f)
        moveTo(3f, 12f)
        lineTo(21f, 12f)
        moveTo(12f, 3f)
        curveTo(7.5f, 7f, 7.5f, 17f, 12f, 21f)
        moveTo(12f, 3f)
        curveTo(16.5f, 7f, 16.5f, 17f, 12f, 21f)
    }

/** The web Refresh `RefreshCw` (lucide) — a circular refresh arrow with a head. */
val RefreshGlyph: ImageVector =
    strokedGlyph("Refresh") {
        moveTo(21f, 12f)
        arcToRelative(9f, 9f, 0f, true, true, -9f, -9f)
        arcToRelative(9.75f, 9.75f, 0f, false, true, 6.74f, 2.74f)
        lineTo(21f, 8f)
        moveTo(21f, 3f)
        verticalLineToRelative(5f)
        horizontalLineToRelative(-5f)
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

/** Approximates a circle of radius [r] at ([cx], [cy]) with two semicircular arcs — the globe outline. */
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
