// Pure, framework-free model + projection for the AnomalyInlineRow feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/system/components/status/AnomalyInlineRow.tsx). No Compose, no Android framework, no
// HTTP: every declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping
// the composable a thin render layer. The shared S7/S8 layer serves the `/analytics/anomalies` envelope as a
// raw SI `JsonElement` (snake_case, Phase-42), so the readers below narrow each field exactly as the web
// `AnomalyData` / `AnomalyEntry` types do.
//
// The web component is an inline Health row that returns `null` whenever there is no data, no anomaly in the
// 24h window, or no top entry — it simply does not appear. The P3 contract instead requires every state to
// render (never a blank box), so this surface renders the row in EVERY state and folds the web's three
// null branches into one benign "No anomalies" empty row (driven by [AnomalyInlineDisplay.hasAnomaly]). This
// is the same documented parity choice the sibling SecurityStatusCards port makes for its web `undefined`
// branch; it is recorded here rather than left silent (Honesty Covenant #9).
//
// The web `formatRelative` buckets elapsed seconds (<60s ⇒ Ns, <1h ⇒ Nm, <24h ⇒ Nh, else Nd) and shows
// "recently" for an unparseable timestamp; the closest catalog key for that fallback is `freshness.justNow`,
// so an unparseable/absent timestamp maps to [RelativeUnit.JustNow] at the render boundary.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/AnomalyInlineRow — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling SecurityStatusCards / BatteryPill do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.anomalyinlinerow

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no VIN, signal value, or
 * any anomaly payload, so a diagnostics line can never leak the operator's fleet state.
 */
const val ANOMALY_INLINE_ROW_SLUG: String = "AnomalyInlineRow"

/** The rolling window the web component queries (`days=1`) and reports (`anomalies_last_24h`). */
const val ANOMALY_INLINE_WINDOW_DAYS: Int = 1

/** Em dash shown when the top anomaly carries no signal name (defensive; the web reads a raw string). */
internal const val EM_DASH: String = "\u2014"

/** The web summary separator (`·`) between the count, signal, and recency segments. */
internal const val SUMMARY_SEPARATOR: String = " \u00B7 "

// Envelope + entry fields the web reads off `/analytics/anomalies` (web `AnomalyData` / `AnomalyEntry`).
private const val FIELD_LAST_24H = "anomalies_last_24h"
private const val FIELD_ANOMALIES = "anomalies"
private const val FIELD_SIGNAL = "signal"
private const val FIELD_SEVERITY = "severity"
private const val FIELD_DETECTED_AT = "detected_at"

/**
 * The Health-row status the dot + summary color resolve from — the native subset of the web `HeroStatus`
 * the component actually produces (`unhealthy` / `degraded` / `unknown`) plus the benign `Healthy` used for
 * the "no anomalies" empty row. The render layer maps each onto the per-theme `TeslaTokens.status` palette.
 */
enum class HealthRowStatus {
    /** No anomalies in the window — a benign green row (the web's null branch, rendered non-blank). */
    Healthy,

    /** Web `warning` severity → `degraded` (amber). */
    Degraded,

    /** Web `critical` severity → `unhealthy` (red). */
    Unhealthy,

    /** Web `info` severity → `unknown` (muted/neutral). */
    Unknown,
}

/**
 * Statistical-anomaly severity tier (web `AnomalyEntry.severity`: `critical` / `warning` / `info`). The
 * [toStatus] mapping is a 1:1 port of the web `SEVERITY_TO_STATUS` record.
 */
enum class AnomalyInlineSeverity {
    Critical,
    Warning,
    Info,
    ;

    /** Web `SEVERITY_TO_STATUS[severity]`. */
    fun toStatus(): HealthRowStatus =
        when (this) {
            Critical -> HealthRowStatus.Unhealthy
            Warning -> HealthRowStatus.Degraded
            Info -> HealthRowStatus.Unknown
        }

    companion object {
        /** Maps a wire severity string to a tier, defaulting to [Info] (the web's lowest rank). */
        fun fromWire(value: String?): AnomalyInlineSeverity =
            when (value?.trim()?.lowercase()) {
                "critical" -> Critical
                "warning" -> Warning
                else -> Info
            }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property hasAnomaly whether a qualifying anomaly exists (web `anomalies_last_24h > 0 && anomalies[0]`);
 *   when false the surface renders the benign "No anomalies" empty row.
 * @property count the 24h anomaly count (web `anomalies_last_24h`), rendered as the leading summary segment.
 * @property status the Health-row status the dot + summary color resolve from.
 * @property topSeverity the top anomaly's severity, or `null` when there is no qualifying anomaly.
 * @property topSignal the top anomaly's signal name (web `top.signal`), or `null` when absent.
 * @property detectedAtIso the top anomaly's ISO-8601 detection timestamp (web `top.detected_at`), or `null`.
 */
data class AnomalyInlineDisplay(
    val hasAnomaly: Boolean,
    val count: Int,
    val status: HealthRowStatus,
    val topSeverity: AnomalyInlineSeverity?,
    val topSignal: String?,
    val detectedAtIso: String?,
)

/**
 * Pure projection from the raw `/analytics/anomalies` [JsonElement] envelope to the render-ready
 * [AnomalyInlineDisplay] — a 1:1 port of the derivations the web component performs (`anomalies_last_24h`,
 * `anomalies[0]`, and the `SEVERITY_TO_STATUS` mapping) before returning JSX. Null / malformed payloads
 * collapse to the benign empty display rather than throwing, so the view always has something to render.
 */
object AnomalyInlineRowProjection {
    /** The benign empty display — no anomaly, healthy status (web's null branch, rendered non-blank). */
    val EMPTY: AnomalyInlineDisplay =
        AnomalyInlineDisplay(
            hasAnomaly = false,
            count = 0,
            status = HealthRowStatus.Healthy,
            topSeverity = null,
            topSignal = null,
            detectedAtIso = null,
        )

    /** Select the render-ready view for the [json] envelope. */
    fun project(json: JsonElement?): AnomalyInlineDisplay {
        val obj = json as? JsonObject
        val count = obj?.intField(FIELD_LAST_24H) ?: 0
        val top = (obj?.get(FIELD_ANOMALIES) as? JsonArray)?.firstOrNull() as? JsonObject
        // Web `if (!data || anomalies_last_24h === 0) return null` then `if (!top) return null`.
        if (obj == null || count <= 0 || top == null) return EMPTY
        val severity = AnomalyInlineSeverity.fromWire(top.stringField(FIELD_SEVERITY))
        return AnomalyInlineDisplay(
            hasAnomaly = true,
            count = count,
            status = severity.toStatus(),
            topSeverity = severity,
            topSignal = top.stringField(FIELD_SIGNAL)?.takeIf { it.isNotBlank() },
            detectedAtIso = top.stringField(FIELD_DETECTED_AT),
        )
    }

    /** True when the projected envelope renders the empty row (web `!data || last24h === 0 || !top`). */
    fun isEmpty(json: JsonElement?): Boolean = !project(json).hasAnomaly

    private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.let { it.intOrNull ?: it.doubleOrNull?.toInt() }
}

/** Relative-time bucket, mapped to the freshness i18n keys at the render boundary (web `formatRelative`). */
enum class RelativeUnit { JustNow, Seconds, Minutes, Hours, Days }

/** A bucketed elapsed-time amount (`value` is unused for [RelativeUnit.JustNow]). */
data class RelativeTime(
    val unit: RelativeUnit,
    val value: Long,
)

/**
 * Buckets the elapsed time between [detectedAtMs] and [nowMs] exactly like the web `formatRelative`
 * (&lt;60s ⇒ Ns, &lt;1h ⇒ Nm, &lt;24h ⇒ Nh, else Nd). A null / unparseable timestamp clamps to
 * [RelativeUnit.JustNow] (the closest catalog key for the web's "recently" fallback); future timestamps
 * clamp to zero elapsed so they read as the most recent bucket rather than a negative age.
 */
fun relativeTimeOf(
    detectedAtMs: Long?,
    nowMs: Long,
): RelativeTime {
    if (detectedAtMs == null) return RelativeTime(RelativeUnit.JustNow, 0)
    val seconds = (nowMs - detectedAtMs).coerceAtLeast(0) / MILLIS_PER_SECOND
    return when {
        seconds < SECONDS_PER_MINUTE -> RelativeTime(RelativeUnit.Seconds, seconds)
        seconds < SECONDS_PER_HOUR -> RelativeTime(RelativeUnit.Minutes, seconds / SECONDS_PER_MINUTE)
        seconds < SECONDS_PER_DAY -> RelativeTime(RelativeUnit.Hours, seconds / SECONDS_PER_HOUR)
        else -> RelativeTime(RelativeUnit.Days, seconds / SECONDS_PER_DAY)
    }
}

/** Lenient ISO-8601 → epoch-millis parse (offset, `Z`, or zoneless-as-UTC), `null` on failure. */
fun parseIsoToEpochMillis(iso: String?): Long? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso).toEpochMilli() }
        .recoverCatching { OffsetDateTime.parse(iso).toInstant().toEpochMilli() }
        .recoverCatching { LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC).toEpochMilli() }
        .getOrNull()
}

private const val MILLIS_PER_SECOND = 1_000L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3_600L
private const val SECONDS_PER_DAY = 86_400L
