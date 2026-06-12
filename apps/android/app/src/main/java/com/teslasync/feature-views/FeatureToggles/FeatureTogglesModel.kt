// Pure, framework-free model + projection for the FeatureToggles feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/FeatureToggles.tsx). The web component reads
// `useTeslaFeatureConfig()` (the raw `Record<string, unknown>` `data` blob + its `fetched_at` stamp) and,
// in a `useMemo`, flattens it into a list of `{ key, enabled, details }` rows: a row whose value is an
// object takes `enabled` from `value.enabled` and joins the remaining members into a compact
// `k: JSON.stringify(v)` detail string; a row whose value is a primitive takes `enabled = Boolean(value)`
// with no details. This file owns exactly that derivation (plus the localized "Synced" stamp) as a pure
// function so it is fully exercised off-device in the :android:testReleaseUnitTest gate and the composable
// stays a thin render layer. The only non-logic declarations are the co-located lucide glyph vectors
// (static ImageVector values), authored locally exactly as the sibling feature-view surfaces do.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FeatureToggles — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.featuretoggles

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.user.TeslaConfigEnvelope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.time.format.FormatStyle
import java.util.Locale

/** Em dash shown for an unknown/blank/absent value — the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object FeatureTogglesRegistration {
    /** Stable surface id. */
    const val ID: String = "feature-toggles"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FeatureToggles"
}

/**
 * One fully projected, render-ready feature-flag row — the native analogue of one entry the web
 * `useMemo` produces. Pure data (no Compose types): the composable resolves [enabled] to a status badge
 * and renders [key] + [details].
 *
 * @property key the flag name, shown emphasized (web `entry.key`, `font-medium`).
 * @property enabled the JS-truthiness of the flag's `enabled` member (object value) or of the value
 *   itself (primitive value) — web `Boolean(enabled)` / `Boolean(value)`.
 * @property details the joined `k: JSON.stringify(v)` preview of an object value's non-`enabled` members
 *   (web `details`), or `null` for a primitive value. An object value with no extra members yields the
 *   empty string (web `[].join(', ')`), distinct from a primitive's `null` — the render layer shows the
 *   em dash only for `null` (web `entry.details ?? '—'`).
 */
data class FeatureEntry(
    val key: String,
    val enabled: Boolean,
    val details: String?,
)

/** Compact (no-whitespace) JSON encoder mirroring the web `JSON.stringify(value)` used for [details]. */
private val COMPACT_JSON: Json = Json

/**
 * The pure projection the composable renders — the native mirror of the web component's `useMemo`
 * derivation. Stateless and side-effect-free (the [ZoneId]/[Locale] are injected) so it is fully covered
 * by the off-device unit gate.
 */
object FeatureTogglesProjection {
    /** Whether the envelope has ever been fetched (web `featureConfig?.fetched_at` truthiness). */
    fun hasFetched(envelope: TeslaConfigEnvelope<JsonElement>?): Boolean = !envelope?.fetchedAt.isNullOrBlank()

    /** Whether the envelope resolves to "no feature rows" (web `featureEntries.length > 0` is false). */
    fun isEmpty(envelope: TeslaConfigEnvelope<JsonElement>?): Boolean = entries(envelope?.data).isEmpty()

    /**
     * Flattens the raw feature-config `data` blob into render-ready [FeatureEntry] rows — a 1:1 port of
     * the web `useMemo`. The canonical `data` is a JSON object (the web `Record<string, unknown>`); a
     * non-object payload (primitive, `null`, or absent) yields no rows, matching the web
     * `!data || typeof data !== 'object'` guard. Insertion order is preserved (web `Object.entries`,
     * here a [JsonObject]'s `LinkedHashMap` backing) — the web component does not sort.
     */
    fun entries(data: JsonElement?): List<FeatureEntry> {
        val obj = data as? JsonObject ?: return emptyList()
        return obj.entries.map { (key, value) ->
            val asObject = value as? JsonObject
            val enabledSource = if (asObject != null) asObject["enabled"] else value
            FeatureEntry(
                key = key,
                enabled = jsTruthy(enabledSource),
                details = asObject?.let { detailsFor(it) },
            )
        }
    }

    /**
     * Localized "medium date, short time" formatter for the header sync stamp — the native analogue of
     * the web `formatDateTime(featureConfig.fetched_at)`. A blank or unparseable input yields [EM_DASH].
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

    /**
     * Joins an object value's non-`enabled` members into the web `details` string: each surviving member
     * renders as `k: JSON.stringify(v)`, comma-separated, in insertion order. An object with no extra
     * members yields the empty string (web `[].join(', ')`).
     */
    private fun detailsFor(value: JsonObject): String =
        value.entries
            .filter { (key, _) -> key != "enabled" }
            .joinToString(", ") { (key, member) -> "$key: ${COMPACT_JSON.encodeToString(JsonElement.serializer(), member)}" }

    /**
     * JavaScript `Boolean(x)` truthiness over the JSON value domain — the exact coercion the web
     * `Boolean(enabled)` / `Boolean(value)` applies: a missing key (Kotlin `null`, web `undefined`) and a
     * JSON `null` are falsy; an object or array is truthy; a JSON boolean uses its value; a JSON number is
     * truthy when non-zero and finite; a JSON string is truthy when non-empty (so the string `"false"` is
     * truthy, matching JS). The `isString` guard is required because [JsonPrimitive.content] alone cannot
     * tell the JSON boolean `false` from the JSON string `"false"`.
     */
    private fun jsTruthy(value: JsonElement?): Boolean =
        when (value) {
            null -> false
            is JsonNull -> false
            is JsonObject -> true
            is JsonArray -> true
            is JsonPrimitive -> primitiveTruthy(value)
        }

    /**
     * JS `Boolean(primitive)`: a JSON string is truthy when non-empty (the `isString` guard keeps the
     * boolean `false` distinct from the string `"false"`); a JSON boolean uses its value; a JSON number is
     * truthy when non-zero and finite.
     */
    private fun primitiveTruthy(value: JsonPrimitive): Boolean =
        if (value.isString) {
            value.content.isNotEmpty()
        } else {
            value.booleanOrNull ?: value.doubleOrNull?.let { it != 0.0 && !it.isNaN() } ?: false
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
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FeatureTogglesRegistration.SLUG]
 * (P1/S11). Carries no flag key or value, so a diagnostics line can never leak the account's feature
 * posture. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordFeatureTogglesOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FeatureTogglesRegistration.SLUG))
}

// ── Local lucide glyphs ──────────────────────────────────────────────────────────────────────────────────
// The web component draws three lucide icons (Flag, RefreshCw, Info). Android has no bundled lucide set, and
// feature views may not expand the shared icon library from a surface prompt (allowed-files), so the two not
// already in the shared `TeslaGlyphs` set are authored here as 24×24 stroked vectors in the shared monochrome
// style — recolored at render time by the `Icon` composable's tint, exactly as the sibling surfaces author
// their local glyphs. The web `Info` (empty state) reuses the shared `TeslaGlyphs.Info`.

/** The web header `Flag` (lucide) — a waving banner on a vertical pole. */
val FlagGlyph: ImageVector =
    strokedGlyph("Flag") {
        moveTo(4f, 15f)
        curveTo(4f, 15f, 5f, 14f, 8f, 14f)
        curveTo(11f, 14f, 13f, 16f, 16f, 16f)
        curveTo(19f, 16f, 20f, 15f, 20f, 15f)
        lineTo(20f, 3f)
        curveTo(20f, 3f, 19f, 4f, 16f, 4f)
        curveTo(13f, 4f, 11f, 2f, 8f, 2f)
        curveTo(5f, 2f, 4f, 3f, 4f, 3f)
        close()
        moveTo(4f, 22f)
        lineTo(4f, 15f)
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
