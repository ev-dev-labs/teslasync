// Pure, framework-free model + projection + diagnostics for the WidgetEventFeed widget primitive — the
// native analogue of every decision the web component makes
// (web/src/features/dashboard/widgets/shared/WidgetEventFeed.tsx) before it paints. No Compose, no Android
// framework, no HTTP: every declaration here is exercised off-device in the :app:testReleaseUnitTest gate,
// keeping the composable a thin render layer.
//
// What the web surface is (and therefore the COMPLETE branch set this primitive reproduces):
//   • A PURE PRESENTATIONAL feed used by many dashboard widgets (e.g. SentryEventLog wraps it). The parent
//     owns the `items` array; the primitive only sorts them newest-first, caps them at the per-footprint
//     limit, formats each timestamp as a relative label, and renders a TimelineItem per row — or the
//     "No events yet" empty state when the capped list is empty. It has NO hook that fetches data
//     (`useTranslation` + `useDateFormat` are presentation facades, not data ports), so there is no P1/S8
//     state holder to bind and no Source/ViewModel — modelling one would invent a fetch the web spec does
//     not have (honesty covenant: no scope narrowing, no silent drift). The sibling presentational ports
//     HistoryListRow / BatteryDelta / DateGroupedList document the same rationale (composable + model, no
//     Source). Its real, fully reproduced states are therefore the two the web returns: the populated feed
//     and the empty state; the generic data-surface lifecycle (loading / error / stale / offline) belongs
//     to the consuming widget's shell, not to this store-less primitive.
//   • The only real logic — reproduced here as pure functions — is the per-footprint cap
//     (`maxItems ?? (compact ? 3 : 10)`), the newest-first sort + slice, and the `formatRelativeTime`
//     tiering ("Just now" / "Xm ago" / "Xh ago" / an absolute date once ≥ 24h old). Each is pinned by the
//     off-device WidgetEventFeedModelTest without a Compose host.
//
// i18n: this layer carries NO English microcopy. The relative-time tiers are returned as the structured
// [EventRelativeTime] buckets, which the composable maps onto the P1/S10 catalog keys
// (`translation_freshness_justNow` / `_minutes` / `_hours`) and a locale-aware absolute formatter — exactly
// the sibling SentryEventLog / TimeStamp split that keeps the pure logic locale-stable.
//
// `InvalidPackageDeclaration` is suppressed because this primitive's mandated directory
// (com/teslasync/widget-primitives/WidgetEventFeed — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.widgetprimitives.widgeteventfeed

import io.teslasync.shared.core.diagnostics.Logger
import java.time.Instant
import java.time.OffsetDateTime
import java.util.Locale

/** Em dash shown for an unparseable / absent relative time — the tolerant fallback (web `'—'`). */
internal const val EM_DASH: String = "\u2014"

/** Joins the visible fields of a row into one TalkBack phrase. */
internal const val A11Y_SEPARATOR: String = ", "

private const val COMPACT_LIMIT = 3
private const val DEFAULT_LIMIT = 10
private const val MILLIS_PER_MINUTE = 60_000L
private const val MINUTES_PER_HOUR = 60L
private const val HOURS_PER_DAY = 24L

/**
 * Optional severity tag carried on an [EventFeedItem] — the faithful port of the web
 * `severity?: 'info' | 'warning' | 'critical'` union. The web render does not branch on it (only id, icon,
 * title, subtitle, timestamp, color and href are read), so it is retained for contract parity and decoding
 * convenience, never to drive a colour here. [fromWire] mirrors the web string union, mapping any unknown /
 * absent token to `null` (the web optional prop).
 */
enum class EventSeverity {
    /** Web `'info'`. */
    Info,

    /** Web `'warning'`. */
    Warning,

    /** Web `'critical'`. */
    Critical,

    ;

    companion object {
        /** Decode a wire severity token (case-insensitive) into a [EventSeverity], or `null` when unknown. */
        fun fromWire(token: String?): EventSeverity? =
            when (token?.trim()?.lowercase(Locale.US)) {
                "info" -> Info
                "warning" -> Warning
                "critical" -> Critical
                else -> null
            }
    }
}

/**
 * The structured relative-time tier a timestamp resolves to — the framework-free port of the web
 * `formatRelativeTime` helper. The composable maps each tier onto a localized string (the freshness catalog
 * keys for the under-a-day tiers, a locale-aware absolute formatter for [Absolute]), keeping this logic free
 * of English microcopy and locale-stable for the off-device test.
 */
sealed interface EventRelativeTime {
    /** No / unparseable timestamp — rendered as the em-dash (tolerant fallback; web would show "Invalid Date"). */
    data object Unknown : EventRelativeTime

    /** Younger than a minute (web `diffMin < 1` → "Just now"); also covers future timestamps. */
    data object JustNow : EventRelativeTime

    /** Under an hour old (web `diffMin < 60` → "Xm ago"); [value] is whole minutes. */
    data class Minutes(
        val value: Long,
    ) : EventRelativeTime

    /** Under a day old (web `diffHrs < 24` → "Xh ago"); [value] is whole hours. */
    data class Hours(
        val value: Long,
    ) : EventRelativeTime

    /** At least a day old (web `formatDateTime(isoStr)`); the composable renders an absolute date + time. */
    data class Absolute(
        val epochMillis: Long,
    ) : EventRelativeTime
}

/**
 * Tier a timestamp into its [EventRelativeTime] bucket — the exact port of the web `formatRelativeTime`
 * cutoffs: `diffMin < 1` → just now, `diffMin < 60` → minutes, `diffHrs < 24` → hours, else the absolute
 * date. Floors toward negative infinity (web `Math.floor`), so a future [timestampMillis] (negative delta)
 * lands in [EventRelativeTime.JustNow] just as the web returns "Just now". A `null` timestamp yields
 * [EventRelativeTime.Unknown] (the tolerant em-dash) rather than throwing.
 */
fun eventRelativeTime(
    timestampMillis: Long?,
    nowMillis: Long,
): EventRelativeTime {
    if (timestampMillis == null) return EventRelativeTime.Unknown
    val diffMinutes = Math.floorDiv(nowMillis - timestampMillis, MILLIS_PER_MINUTE)
    return when {
        diffMinutes < 1L -> EventRelativeTime.JustNow
        diffMinutes < MINUTES_PER_HOUR -> EventRelativeTime.Minutes(diffMinutes)
        else -> {
            val diffHours = Math.floorDiv(diffMinutes, MINUTES_PER_HOUR)
            if (diffHours < HOURS_PER_DAY) EventRelativeTime.Hours(diffHours) else EventRelativeTime.Absolute(timestampMillis)
        }
    }
}

/**
 * Resolve the feed cap — the port of the web `limit = maxItems ?? (compact ? 3 : 10)`. An explicit
 * [maxItems] always wins; otherwise a [compact] footprint shows three rows and a regular one shows ten.
 */
fun eventFeedLimit(
    maxItems: Int?,
    compact: Boolean,
): Int = maxItems ?: if (compact) COMPACT_LIMIT else DEFAULT_LIMIT

/**
 * Order a feed newest-first and cap it — the port of the web `[...items].sort(byTimestampDesc).slice(0,
 * limit)`. [timestampMillisOf] extracts each item's epoch-millis (the composable passes the tolerant
 * [parseEpochMillis]); items with no parseable timestamp sort last (web `NaN` comparisons sink them) via the
 * `Long.MIN_VALUE` fallback. The sort is stable, so equal timestamps keep input order. A non-positive [limit]
 * yields the empty list (guarding `take`), matching a degenerate cap.
 */
fun <T> orderEventFeed(
    items: List<T>,
    limit: Int,
    timestampMillisOf: (T) -> Long?,
): List<T> =
    items
        .sortedByDescending { timestampMillisOf(it) ?: Long.MIN_VALUE }
        .take(limit.coerceAtLeast(0))

/**
 * Tolerant ISO-8601 → epoch-millis parse for a wire timestamp (the web keeps the raw string and parses on
 * demand). Returns `null` for a blank / absent / unparseable value so a partial row degrades to the em-dash
 * relative time instead of throwing.
 */
internal fun parseEpochMillis(raw: String?): Long? {
    if (raw.isNullOrBlank()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        .recoverCatching { Instant.parse(raw).toEpochMilli() }
        .getOrNull()
}

/**
 * The one PII-safe diagnostic this primitive emits (P1/S11). It carries only the surface [SLUG] — never any
 * event title, subtitle, timestamp, or href (which can hold locations and vehicle activity) — so a
 * diagnostics line can never leak user data through this feed.
 */
object WidgetEventFeedDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event — the slug the prompt mandates. */
    const val SLUG: String = "WidgetEventFeed"

    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
