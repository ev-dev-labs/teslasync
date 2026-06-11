// Pure, framework-free model + projection for the SummaryStatsRow feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/security-access/SummaryStatsRow.tsx). No Compose, no Android, no HTTP:
// every declaration here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// SummaryStatsRow is a presentational surface — the web component takes its four values plus `isLoading`
// as props from the Security & Access page (which owns the TanStack query over the security-event history),
// so this surface binds no data hooks (its only data source is `useTranslation`). As in the sibling
// StatusHeader/ResultPanel ports, the cache-then-network states (stale / offline / fetch-error) live on the
// owning page, not here; the two branches the web source defines — `isLoading` (four skeleton tiles) and
// the resolved summary (four MetricCards, which render "—" and zeros when a value is absent, never a blank
// box) — are the complete state set this presentational surface renders.
//
// The web renders four cards: a secure/unsecure status, the relative age of the last lock change
// (`timeSince`), the sentry uptime percentage (`fmtInt(...) + '%'`), and the raw total-events count. The
// relative-age cutoffs are reproduced verbatim from the web `timeSince` helper — note they differ from the
// shared `freshnessAge`/`relativeAge` buckets (no seconds tier, no week roll-over, and a future timestamp
// renders "—"), so this surface carries its own faithful [LockChangeAge] bucketer rather than reusing them.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/SummaryStatsRow — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.summarystatsrow

import io.teslasync.shared.core.diagnostics.Logger
import java.math.RoundingMode
import java.text.NumberFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZonedDateTime
import java.util.Locale

/** The em-dash sentinel rendered for an absent / future lock-change timestamp (web `timeSince` → '—'). */
internal const val EM_DASH: String = "\u2014"

private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
private const val MILLIS_PER_SECOND: Long = 1_000L

/**
 * Coarse, i18n-friendly bucket for the last-lock-change relative age — a 1:1 port of the web `timeSince`
 * helper's outcomes (web/src/features/admin/components/security-access/helpers.ts). The composable maps each
 * bucket to a localized `translation_freshness_*` string so the pure logic carries no English microcopy.
 *
 * The web cutoffs are reproduced exactly: a missing or future timestamp is [Unknown] ('—'), under a minute
 * is [JustNow] ("just now"), then minutes / hours / days with no seconds tier and no week roll-over (10 days
 * stays "10d ago"). This is deliberately distinct from the shared `freshnessAge` (which has a seconds tier
 * and caps at hours) and `relativeAge` (which rolls into weeks), so neither is reused.
 */
sealed interface LockChangeAge {
    /** No timestamp, or a future timestamp — web `if (!iso) return '—'` / `if (diff < 0) return '—'`. */
    data object Unknown : LockChangeAge

    /** Under one minute old — web `if (seconds < 60) return 'just now'`. */
    data object JustNow : LockChangeAge

    /** Whole minutes old — web `${minutes}m ago`. */
    data class Minutes(
        val value: Long,
    ) : LockChangeAge

    /** Whole hours old — web `${hours}h ago`. */
    data class Hours(
        val value: Long,
    ) : LockChangeAge

    /** Whole days old — web `${days}d ago` (no week roll-over). */
    data class Days(
        val value: Long,
    ) : LockChangeAge
}

/**
 * The localized `translation_freshness_*` templates the composable resolves once and hands to
 * [SummaryStatsRowProjection.formatLockChange]. Keeping the mapping pure (templates in, string out) lets the
 * accessible last-lock label be unit-tested off-device without a Compose/resources host.
 *
 * @property dash the em-dash sentinel (`translation_freshness` has no key for it — use [EM_DASH]).
 * @property justNow `translation_freshness_justNow` ("just now").
 * @property minutesAgo `translation_freshness_minutes` ("%1$sm ago").
 * @property hoursAgo `translation_freshness_hours` ("%1$sh ago").
 * @property daysAgo `translation_freshness_days` ("%1$sd ago").
 */
data class LockChangeLabels(
    val dash: String,
    val justNow: String,
    val minutesAgo: String,
    val hoursAgo: String,
    val daysAgo: String,
)

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property loading whether the owning query is still in flight (web `isLoading` prop); the four tiles
 *   render skeleton chrome while true.
 * @property isSecure whether the vehicle is currently secure (web `isSecure` prop); drives the status card's
 *   value (Secure / Unsecure) and accent (success / danger).
 * @property lastLock the relative age of the last lock change (web `timeSince(lastLockChange)`), as a
 *   localizable [LockChangeAge] bucket.
 * @property sentryUptime the sentry-mode uptime percentage 0–100 (web `sentryUptime`); rendered via
 *   [formatUptimePercent] which mirrors the web `fmtInt(...) + '%'`.
 * @property totalEvents the total security-event count (web `totalEvents`); rendered via [formatEventCount].
 */
data class SummaryStatsRowDisplay(
    val loading: Boolean,
    val isSecure: Boolean,
    val lastLock: LockChangeAge,
    val sentryUptime: Double,
    val totalEvents: Int,
)

/**
 * The four security-summary values the owning Security & Access page threads into this surface — the native
 * grouping of the web component's `isSecure` / `lastLockChange` / `sentryUptime` / `totalEvents` props (the
 * `isLoading` flag and the render clock are passed alongside, not bundled here). Grouping the cohesive inputs
 * keeps the [SummaryStatsRowProjection.project] entry small and gives the adapter test a single value to
 * thread.
 *
 * @property isSecure whether the vehicle is currently secure (web `isSecure`).
 * @property lastLockChange ISO-8601 timestamp of the most recent lock change, or `null` (web
 *   `lastLockChange: string | undefined`).
 * @property sentryUptime sentry-mode uptime percentage 0–100 (web `sentryUptime`).
 * @property totalEvents total security-event count (web `totalEvents`).
 */
data class SecuritySummary(
    val isSecure: Boolean,
    val lastLockChange: String?,
    val sentryUptime: Double,
    val totalEvents: Int,
)

/**
 * Pure projection from the surface's props to its render-ready [SummaryStatsRowDisplay] — a 1:1 port of the
 * derivations the web component performs: the `timeSince(lastLockChange)` relative age, the
 * `fmtInt(sentryUptime) + '%'` uptime, and the raw `totalEvents` count rendered as React renders a numeric
 * child (no grouping, locale-independent). The status card's value/accent are derived in the composable from
 * the [SummaryStatsRowDisplay.isSecure] flag against the i18n catalog and the design-token palette.
 */
object SummaryStatsRowProjection {
    /**
     * Select the render-ready view for the given [summary] and [loading] flag. [nowMillis] is the wall clock
     * the last-lock relative age is measured against (the composable passes `System.currentTimeMillis()`;
     * tests pass a fixed instant for determinism).
     */
    fun project(
        summary: SecuritySummary,
        loading: Boolean,
        nowMillis: Long,
    ): SummaryStatsRowDisplay =
        SummaryStatsRowDisplay(
            loading = loading,
            isSecure = summary.isSecure,
            lastLock = lockChangeAge(parseIsoMillis(summary.lastLockChange), nowMillis),
            sentryUptime = summary.sentryUptime,
            totalEvents = summary.totalEvents,
        )

    /**
     * Parse an ISO-8601 timestamp to epoch millis the way the web `new Date(iso).getTime()` does, returning
     * `null` for a blank, missing, or unparseable value (the web treats `NaN` the same way once it reaches
     * the "—" fall-through). Tolerates the three RFC-3339 shapes the backend emits: a `Z`-suffixed instant,
     * an explicit numeric offset, and a zoned date-time.
     */
    fun parseIsoMillis(iso: String?): Long? {
        val raw = iso?.trim()
        if (raw.isNullOrEmpty()) return null
        return runCatching { Instant.parse(raw).toEpochMilli() }
            .recoverCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
            .recoverCatching { ZonedDateTime.parse(raw).toInstant().toEpochMilli() }
            .getOrNull()
    }

    /**
     * Bucket a parsed [timestampMillis] against [nowMillis] into a [LockChangeAge] — a verbatim port of the
     * web `timeSince` cutoffs: null / future → [LockChangeAge.Unknown]; `< 60s` → [LockChangeAge.JustNow];
     * `< 60m` → minutes; `< 24h` → hours; else days (floored, no week roll-over).
     */
    fun lockChangeAge(
        timestampMillis: Long?,
        nowMillis: Long,
    ): LockChangeAge {
        if (timestampMillis == null) return LockChangeAge.Unknown
        val deltaMs = nowMillis - timestampMillis
        val seconds = deltaMs / MILLIS_PER_SECOND
        val minutes = seconds / SECONDS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        return when {
            deltaMs < 0L -> LockChangeAge.Unknown
            seconds < SECONDS_PER_MINUTE -> LockChangeAge.JustNow
            minutes < MINUTES_PER_HOUR -> LockChangeAge.Minutes(minutes)
            hours < HOURS_PER_DAY -> LockChangeAge.Hours(hours)
            else -> LockChangeAge.Days(hours / HOURS_PER_DAY)
        }
    }

    /**
     * Render a [LockChangeAge] to its localized string using the resolved [labels] — the pure half of the
     * web `timeSince` helper (the cutoffs live in [lockChangeAge]; the microcopy is injected here so the
     * accessible label is testable off-device). Mirrors the sibling `rememberAlertFreshnessFormatter`.
     */
    fun formatLockChange(
        age: LockChangeAge,
        labels: LockChangeLabels,
    ): String =
        when (age) {
            LockChangeAge.Unknown -> labels.dash
            LockChangeAge.JustNow -> labels.justNow
            is LockChangeAge.Minutes -> labels.minutesAgo.format(age.value)
            is LockChangeAge.Hours -> labels.hoursAgo.format(age.value)
            is LockChangeAge.Days -> labels.daysAgo.format(age.value)
        }

    /**
     * Format the sentry uptime the way the web `${fmtInt(sentryUptime)}%` does: a non-finite value is
     * coerced to 0 (web `safeNumber`), then rounded to a whole number with locale grouping separators and
     * a trailing percent sign. HALF_UP matches `Intl.NumberFormat`'s default "halfExpand" rounding, so a
     * value like 62.5 renders "63%" on both platforms rather than diverging on banker's rounding.
     */
    fun formatUptimePercent(
        value: Double,
        locale: Locale = Locale.getDefault(),
    ): String {
        val safe = if (value.isFinite()) value else 0.0
        val formatter =
            NumberFormat.getIntegerInstance(locale).apply {
                roundingMode = RoundingMode.HALF_UP
            }
        return formatter.format(safe) + "%"
    }

    /**
     * Format the total-events count the way the web `value={totalEvents}` does — React renders a numeric
     * child as its bare, locale-independent string (e.g. `1234`, never grouped). Note the deliberate
     * asymmetry with [formatUptimePercent], which goes through `fmtInt` and so gains locale grouping; this
     * faithfully reproduces the web source rather than silently "fixing" it.
     */
    fun formatEventCount(value: Int): String = value.toString()
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the
 * secure flag, the uptime, the event count, or the lock-change time — so a diagnostics line can never leak
 * the fleet's security posture.
 */
object SummaryStatsRowDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = "SummaryStatsRow"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
