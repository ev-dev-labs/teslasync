// File hosts the SignalHealth surface's pure model + projection + registry; named after the surface
// bundle (SignalHealthWidget*) rather than the single declaration it leads with.
@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboardwidgets.signalhealth

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.data.ErrorKind
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.util.Locale

/** The em-dash shown wherever a value is unknown (matches the shared formatter fallback). */
internal const val SIGNAL_HEALTH_EM_DASH: String = "\u2014"

/**
 * The widget's grid footprint (columns × rows) — the Android port of the web `WidgetProps.size`
 * plus the `isCompact` / `isWide` logic in
 * `web/src/features/dashboard/widgets/SignalHealthWidget.tsx`.
 */
data class SignalHealthSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): show the centered badge + count. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    /** True at three or more columns (web `isWide = size.cols >= 3`): add the stale/gap signal list. */
    val isWide: Boolean get() = cols >= WIDE_MIN_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
        const val WIDE_MIN_COLS = 3
    }
}

/**
 * Canonical registry metadata for the Signal Health surface — the native mirror of the web registry
 * entry in `web/src/features/dashboard/widgets/registry/telemetry.ts` (`signal-health`). A dashboard
 * host binds this surface with the same [ID] and honours the same [MIN_SIZE]/[MAX_SIZE] footprint.
 */
object SignalHealthRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "signal-health"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "telemetry"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SignalHealthWidget"

    /** A signal whose last sample is older than this (5 minutes) is a gap (web `STALE_THRESHOLD_MS`). */
    const val STALE_THRESHOLD_MS: Long = 5L * 60L * 1000L

    /** Stale/gap rows shown in the wide list (web `slice(0, isCompact ? 3 : 15)` — standard/wide path). */
    const val STALE_LIST_LIMIT: Int = 15

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: SignalHealthSize = SignalHealthSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: SignalHealthSize = SignalHealthSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: SignalHealthSize = SignalHealthSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SignalHealthSize): Boolean =
        size.cols >= MIN_SIZE.cols &&
            size.cols <= MAX_SIZE.cols &&
            size.rows >= MIN_SIZE.rows &&
            size.rows <= MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SignalHealthSize): SignalHealthSize =
        SignalHealthSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * The overall coverage health — the native analogue of the web `healthLevel` union
 * (`'green' | 'amber' | 'red' | 'neutral'`). The render layer maps each onto a badge tone + label +
 * accent color (green=healthy/success, amber=degraded/warning, red=critical/danger, neutral=unknown).
 */
enum class SignalHealthLevel { Healthy, Degraded, Critical, Unknown }

/**
 * One stale / gap signal row — the native analogue of the web `GapSignal`. [lastSeenMillis] is the
 * parsed epoch-millis of the signal's last sample, or `null` when the live entry carried no timestamp
 * (the render shows an em-dash); rows are pre-sorted null-first then oldest-first.
 */
data class SignalGap(
    val name: String,
    val lastSeenMillis: Long?,
)

/**
 * The fully projected, render-ready view of the widget — the native analogue of everything
 * `SignalHealthWidget.tsx` derives in its `analysis` / `healthLevel` memos before returning JSX.
 * Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property totalSignals the available-signal catalog size (web `signals?.length`).
 * @property activeCount signals whose last sample is within the freshness window (web `activeCount`).
 * @property staleCount signals with a gap — stale or never-seen (web `staleCount`).
 * @property gapSignals the stale/gap rows, pre-sorted (web `gapSignals`).
 * @property freshnessAgeSeconds age of the newest sample in seconds, or `null` when none (web
 *   `freshnessAge`).
 * @property healthLevel the coverage health bucket (web `healthLevel`).
 * @property resolved whether any of the three feeds resolved — the web `hasData = stats || signals ||
 *   gapData` truthiness; `false` ⇒ the surface renders its "No signal health data" empty state.
 */
data class SignalHealthData(
    val totalSignals: Int,
    val activeCount: Int,
    val staleCount: Int,
    val gapSignals: List<SignalGap>,
    val freshnessAgeSeconds: Long?,
    val healthLevel: SignalHealthLevel,
    val resolved: Boolean,
) {
    /** Active over the live total (web compact `{activeCount}/{activeCount + staleCount}`). */
    val liveTotal: Int get() = activeCount + staleCount

    /** Web `hasData = stats || signals || gapData` — false ⇒ the empty state. */
    val hasData: Boolean get() = resolved

    companion object {
        /** The no-data projection (web all-undefined ⇒ empty state). */
        val EMPTY: SignalHealthData =
            SignalHealthData(
                totalSignals = 0,
                activeCount = 0,
                staleCount = 0,
                gapSignals = emptyList(),
                freshnessAgeSeconds = null,
                healthLevel = SignalHealthLevel.Unknown,
                resolved = false,
            )
    }
}

/**
 * Pure projection from the available-signal catalog + the live-gap map + whether stats resolved to the
 * render-ready [SignalHealthData] — the native port of the `analysis` + `healthLevel` work in
 * `SignalHealthWidget.tsx`. Side-effect-free (no Android, no Compose, no coroutines) so the gate
 * unit-tests every branch without a device.
 */
object SignalHealthProjection {
    /**
     * Build the analysis from the available [signalNames] (web `useSignals`), the live-gap [gaps] map
     * (web `useSignalGaps`, each entry the raw `{value, timestamp}` element), and whether the stats
     * feed [statsResolved] (web `useSignalStats`). [nowMillis] is the reference clock for the
     * stale/freshness math. A live entry whose timestamp is missing or unparseable counts as a
     * never-seen gap (null last-seen); every other entry is active or stale by the 5-minute window.
     */
    fun build(
        signalNames: List<String>?,
        gaps: Map<String, JsonElement>?,
        statsResolved: Boolean,
        nowMillis: Long,
    ): SignalHealthData {
        val entries = gaps ?: emptyMap()
        var active = 0
        var stale = 0
        var latest: Long? = null
        val gapSignals = ArrayList<SignalGap>(entries.size)
        for ((name, entry) in entries) {
            val lastSeen = liveEntryMillis(entry)
            if (lastSeen == null) {
                stale++
                gapSignals.add(SignalGap(name, null))
            } else {
                if (nowMillis - lastSeen > SignalHealthRegistration.STALE_THRESHOLD_MS) {
                    stale++
                    gapSignals.add(SignalGap(name, lastSeen))
                } else {
                    active++
                }
                if (latest == null || lastSeen > latest) latest = lastSeen
            }
        }
        gapSignals.sortWith(GAP_ORDER)
        return SignalHealthData(
            totalSignals = signalNames?.size ?: 0,
            activeCount = active,
            staleCount = stale,
            gapSignals = gapSignals,
            freshnessAgeSeconds = latest?.let { ((nowMillis - it) / MILLIS_PER_SECOND).coerceAtLeast(0L) },
            healthLevel = healthLevelOf(active, stale),
            resolved = statsResolved || signalNames != null || gaps != null,
        )
    }

    /**
     * The coverage health bucket — a 1:1 port of the web `healthLevel` memo: no live signals ⇒
     * [SignalHealthLevel.Unknown]; a stale ratio at or above 50% ⇒ [SignalHealthLevel.Critical]; any
     * stale at all ⇒ [SignalHealthLevel.Degraded]; otherwise [SignalHealthLevel.Healthy].
     */
    fun healthLevelOf(
        active: Int,
        stale: Int,
    ): SignalHealthLevel {
        val total = active + stale
        if (total == 0) return SignalHealthLevel.Unknown
        val staleRatio = stale.toDouble() / total.toDouble() // parity:allow toDouble() numeric conversion not a stub
        return when {
            staleRatio >= CRITICAL_RATIO -> SignalHealthLevel.Critical
            staleRatio > 0.0 -> SignalHealthLevel.Degraded
            else -> SignalHealthLevel.Healthy
        }
    }

    /**
     * Extract a live entry's last-sample epoch millis — the native port of `entry?.timestamp ?? null`
     * fed through `new Date(ts).getTime()`. Only an object entry with a string `timestamp` that parses
     * contributes a value; a bare scalar, an absent/blank timestamp, or an unparseable one yields
     * `null` (a never-seen gap).
     */
    fun liveEntryMillis(entry: JsonElement?): Long? =
        parseTimestampMillis(
            ((entry as? JsonObject)?.get("timestamp") as? JsonPrimitive)?.takeIf { it.isString }?.content,
        )

    /** Parse an ISO wire timestamp to epoch millis (tolerant of `Z`, an offset, or no zone). */
    fun parseTimestampMillis(raw: String?): Long? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(value).toInstant().toEpochMilli() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
    }

    /** Format an integer count with locale grouping (web `fmtInt`). */
    fun formatCount(
        value: Int,
        locale: Locale = Locale.getDefault(),
    ): String = ChartFormat.number(value.toDouble(), COUNT_DECIMALS, locale) // parity:allow toDouble() numeric conversion not a stub

    /** Null-first then oldest-first ordering of the gap rows — the web `gapSignals.sort` comparator. */
    private val GAP_ORDER: Comparator<SignalGap> =
        compareBy<SignalGap> { it.lastSeenMillis != null }
            .thenBy { it.lastSeenMillis ?: Long.MIN_VALUE }
            .thenBy { it.name }

    private const val COUNT_DECIMALS = 0
    private const val CRITICAL_RATIO = 0.5
    private const val MILLIS_PER_SECOND = 1000L
}

/**
 * The freshness-age bucket shown in the "Freshness" stat — the native port of the web `formatAge`
 * (`null → —`, `< 60s → Ns ago`, `< 3600s → Nm ago`, else `Nh ago`). Pure (the i18n words are applied
 * by the composable) so it is unit-tested off-device.
 */
sealed interface SignalAge {
    /** No newest sample (renders the em-dash). */
    data object Unknown : SignalAge

    /** Younger than a minute — `Ns ago`. */
    data class Seconds(
        val value: Long,
    ) : SignalAge

    /** Under an hour old — `Nm ago`. */
    data class Minutes(
        val value: Long,
    ) : SignalAge

    /** An hour or older — `Nh ago` (web `formatAge` never rolls over to days). */
    data class Hours(
        val value: Long,
    ) : SignalAge
}

/** Buckets [seconds] for the Freshness stat — a 1:1 port of the web `formatAge`. */
fun signalFreshnessAge(seconds: Long?): SignalAge =
    when {
        seconds == null -> SignalAge.Unknown
        seconds < SECONDS_PER_MINUTE -> SignalAge.Seconds(seconds)
        seconds < SECONDS_PER_HOUR -> SignalAge.Minutes(seconds / SECONDS_PER_MINUTE)
        else -> SignalAge.Hours(seconds / SECONDS_PER_HOUR)
    }

/**
 * The relative age of a stale/gap row's last sample — the native port of the web `formatRelative`
 * (`< 60s → just now`, `< 60m → Nm ago`, `< 24h → Nh ago`, `< 7d → Nd ago`, else absolute date).
 * Pure so the i18n words + absolute formatting are applied by the composable and the buckets are
 * unit-tested off-device.
 */
sealed interface SignalRelative {
    /** No parseable last-sample timestamp (renders the em-dash). */
    data object Unknown : SignalRelative

    /** Younger than a minute — web literal "just now". */
    data object JustNow : SignalRelative

    /** Under an hour old — `Nm ago`. */
    data class Minutes(
        val value: Long,
    ) : SignalRelative

    /** Under a day old — `Nh ago`. */
    data class Hours(
        val value: Long,
    ) : SignalRelative

    /** Under a week old — `Nd ago`. */
    data class Days(
        val value: Long,
    ) : SignalRelative

    /** A week or older — the render layer formats [epochMillis] as a localized absolute datetime. */
    data class Absolute(
        val epochMillis: Long,
    ) : SignalRelative
}

/** Buckets a gap row's [millis] last-seen for display — a 1:1 port of the web `formatRelative`. */
fun signalRelativeAge(
    millis: Long?,
    nowMillis: Long,
): SignalRelative {
    if (millis == null) return SignalRelative.Unknown
    val seconds = Math.floorDiv(nowMillis - millis, MILLIS_PER_SECOND)
    val minutes = seconds / SECONDS_PER_MINUTE
    val hours = minutes / MINUTES_PER_HOUR
    val days = hours / HOURS_PER_DAY
    return when {
        seconds < SECONDS_PER_MINUTE -> SignalRelative.JustNow
        minutes < MINUTES_PER_HOUR -> SignalRelative.Minutes(minutes)
        hours < HOURS_PER_DAY -> SignalRelative.Hours(hours)
        days < DAYS_PER_WEEK -> SignalRelative.Days(days)
        else -> SignalRelative.Absolute(millis)
    }
}

/**
 * Maps the coverage [level] onto the shared badge tone — the native analogue of the web
 * `healthBadgeVariant` map (`green → success`, `amber → warning`, `red → danger`, `neutral → neutral`).
 */
fun signalHealthBadgeVariant(level: SignalHealthLevel): BadgeVariant =
    when (level) {
        SignalHealthLevel.Healthy -> BadgeVariant.Success
        SignalHealthLevel.Degraded -> BadgeVariant.Warning
        SignalHealthLevel.Critical -> BadgeVariant.Danger
        SignalHealthLevel.Unknown -> BadgeVariant.Neutral
    }

/** Maps the Android [errorKind] + HTTP [httpStatus] onto the feedback layer's recovery-oriented bucket. */
fun signalHealthErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

private const val MILLIS_PER_SECOND = 1000L
private const val SECONDS_PER_MINUTE = 60L
private const val SECONDS_PER_HOUR = 3600L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L
private const val DAYS_PER_WEEK = 7L
