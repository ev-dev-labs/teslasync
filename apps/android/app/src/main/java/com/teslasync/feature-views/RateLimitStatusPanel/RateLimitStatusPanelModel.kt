// Pure, framework-free model + projection for the RateLimitStatusPanel feature view — the native
// analogue of everything the web component derives before returning JSX
// (web/src/features/admin/components/RateLimitStatusPanel.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer over these pure functions.
//
// The web component reads the `useRateLimitStatus` feed (web `useSystem` hook domain) and renders one
// `MetricBar` per `ScopeBudget`. This file owns the parts the web computes from each scope: the
// severity → colour-band classification (`SEVERITY_COLOR`/`SEVERITY_TONE_CLASS`), the bar maximum
// (`limit > 0 ? limit : 1`), the window-label decision (`window_seconds <= 0 ? instant : seconds`),
// the reset-countdown gate (`reset_at` → ms-until-refill, dropped when ≤ 0 or unparseable), the long
// duration formatter (web `formatDurationMsLong`), the locale-grouped budget formatter (web
// `fmtNumber`), the "updated" timestamp parse (web `formatRelative` input), and the PII-safe
// `view.opened` diagnostic.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/RateLimitStatusPanel — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.ratelimitstatuspanel

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.system.RateLimitStatusResponse
import io.teslasync.shared.core.presentation.system.ScopeBudget
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.roundToLong

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no scope id, counter
 * value, or deployment detail, so a diagnostics line can never leak the install's throttle posture.
 */
const val RATE_LIMIT_STATUS_PANEL_SLUG: String = "RateLimitStatusPanel"

/** Em dash used as the universal "no value" marker, matching the web `FALLBACK`. */
internal const val EM_DASH: String = "\u2014"

/**
 * The colour band a scope renders in — the native mirror of the web `RateLimitSeverity`
 * (`ok` | `warn` | `critical`) plus an [Unknown] forward-compatible fallback. The backend owns the
 * threshold tuning, so the panel never recomputes severity; it only maps the wire value to a tone.
 */
enum class RateLimitSeverity {
    Ok,
    Warn,
    Critical,
    Unknown,
    ;

    companion object {
        /** Folds the backend wire string to a band; an unrecognised value becomes [Unknown]. */
        fun fromWire(raw: String): RateLimitSeverity =
            when (raw.trim().lowercase(Locale.ROOT)) {
                "ok" -> Ok
                "warn" -> Warn
                "critical" -> Critical
                else -> Unknown
            }
    }
}

/**
 * One render-ready rate-limit row — the native projection of a web `ScopeBudget`. Only the fields the
 * panel draws are modelled. [severityWire] keeps the raw backend value so an [RateLimitSeverity.Unknown]
 * band still labels itself verbatim (web `t(\`…severity.${severity}\`, severity)` fallback), exactly as
 * the web renders the raw string when no translation key matches. [barMax] is the pre-clamped bar
 * denominator (web `limit > 0 ? limit : 1`) so a zero-limit scope never divides by zero.
 */
data class RateLimitRowView(
    val id: String,
    val name: String,
    val severity: RateLimitSeverity,
    val severityWire: String,
    val current: Double,
    val limit: Double,
    val barMax: Double,
    val windowSeconds: Int,
    val resetAt: String?,
    val detail: String,
)

/**
 * Pure projection from the feed payload to the panel's render inputs — a 1:1 port of the per-scope
 * derivations the web component performs inside `RateLimitRow`/`RateLimitStatusPanel`. Stateless and
 * side-effect-free so it is fully covered by the off-device unit gate; the composable only resolves
 * localized strings and draws what these functions return.
 */
object RateLimitStatusPanelProjection {
    private const val MILLIS_PER_SECOND: Double = 1_000.0
    private const val SECONDS_PER_MINUTE: Double = 60.0
    private const val DEFAULT_PRECISION: Int = 2
    private const val MAX_PRECISION: Int = 20

    /** Projects every scope in the (possibly null) response to a [RateLimitRowView], preserving order. */
    fun rows(response: RateLimitStatusResponse?): List<RateLimitRowView> = response?.scopes?.map(::row) ?: emptyList()

    /** Projects one [ScopeBudget] onto its render view, computing the bar maximum + severity band. */
    fun row(scope: ScopeBudget): RateLimitRowView =
        RateLimitRowView(
            id = scope.id,
            name = scope.name,
            severity = RateLimitSeverity.fromWire(scope.severity),
            severityWire = scope.severity,
            current = scope.current,
            limit = scope.limit,
            barMax = if (scope.limit > 0.0) scope.limit else 1.0,
            windowSeconds = scope.windowSeconds,
            resetAt = scope.resetAt,
            detail = scope.detail,
        )

    /**
     * Whether the response has no scopes — the web empty branch (`scopes.length === 0`). Used as the
     * `toUiState` emptiness predicate so a payload with zero rows resolves to the empty surface rather
     * than a blank content panel.
     */
    fun isEmpty(response: RateLimitStatusResponse): Boolean = response.scopes.isEmpty()

    /**
     * Whether the window label is the instant ("Live snapshot") form — web
     * `!scope.window_seconds || scope.window_seconds <= 0`. A token-bucket scope (zero window) is an
     * instant snapshot; a positive window is a rolling "Last Ns window".
     */
    fun isInstantWindow(windowSeconds: Int): Boolean = windowSeconds <= 0

    /**
     * Milliseconds from [nowMs] until the bucket refills, or `null` when no countdown should show — the
     * web `reset_at` gate: `null`/blank/unparseable `reset_at`, or a non-positive delta (already
     * refilled), yields no "Refills in …" label.
     */
    fun resetCountdownMs(
        resetAt: String?,
        nowMs: Long,
    ): Long? {
        val epoch = resetAt?.takeIf { it.isNotBlank() }?.let(::parseEpochMillis)
        return epoch?.minus(nowMs)?.takeIf { it > 0L }
    }

    /**
     * Long human duration for a positive millisecond span — a faithful port of the web
     * `formatDurationMsLong`: sub-second → "{ms}ms", sub-minute → "{s.s}s" (one decimal, `.`-separated
     * like JS `toFixed`), else "{m}m {s}s" with the seconds remainder rounded to a whole number (web
     * `formatRoundedInt`). The unit letters (ms/s/m) are universal abbreviations reproduced verbatim
     * from the web lib, exactly as the sibling duration formatters do.
     */
    fun formatResetDuration(ms: Long): String {
        val seconds = ms / MILLIS_PER_SECOND
        return when {
            ms < MILLIS_PER_SECOND -> "${ms}ms"
            seconds < SECONDS_PER_MINUTE -> "${String.format(Locale.US, "%.1f", seconds)}s"
            else -> {
                val minutes = (seconds / SECONDS_PER_MINUTE).toLong()
                val remainderSeconds = (seconds % SECONDS_PER_MINUTE).roundToLong()
                "${minutes}m ${remainderSeconds}s"
            }
        }
    }

    /**
     * Locale-grouped budget count — the native mirror of the web `fmtNumber(value)` with its global
     * defaults (two fraction digits, locale separators, non-finite → 0). [locale] supplies the grouping
     * + decimal symbols; [precision] mirrors the web global precision and is clamped to a sane range.
     */
    fun formatBudget(
        value: Double,
        locale: Locale = Locale.getDefault(),
        precision: Int = DEFAULT_PRECISION,
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val digits = precision.coerceIn(0, MAX_PRECISION)
        return String.format(locale, "%,.${digits}f", safe)
    }

    /**
     * Epoch milliseconds of the snapshot's `generated_at`, or `null` when absent/unparseable — the
     * gate behind the web "Updated {when}" label (`data?.generated_at` → `formatRelative`). The render
     * layer turns a non-null result into a localized relative-time string.
     */
    fun updatedAtMillis(generatedAt: String): Long? = if (generatedAt.isBlank()) null else parseEpochMillis(generatedAt)

    // Tolerant ISO-8601 decode chain: an RFC-3339 instant ("…Z"), then an offset date-time, then a
    // zoneless local date-time treated as UTC. The first that parses wins; none parsing yields null.
    private val parsers: List<(String) -> Long?> =
        listOf(
            { raw -> tryParse { Instant.parse(raw).toEpochMilli() } },
            { raw -> tryParse { OffsetDateTime.parse(raw).toInstant().toEpochMilli() } },
            { raw -> tryParse { LocalDateTime.parse(raw).toInstant(ZoneOffset.UTC).toEpochMilli() } },
        )

    private fun parseEpochMillis(raw: String): Long? = parsers.firstNotNullOfOrNull { it(raw) }

    private fun tryParse(block: () -> Long): Long? =
        try {
            block()
        } catch (_: DateTimeParseException) {
            null
        }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RATE_LIMIT_STATUS_PANEL_SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it
 * from its first-composition effect.
 */
fun recordRateLimitStatusPanelOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to RATE_LIMIT_STATUS_PANEL_SLUG))
}
