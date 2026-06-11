// Pure, framework-free model + projection for the TimestampTool feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/devtools/tools/TimestampTool.tsx). No Compose, no Android, no HTTP:
// every type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// The web tool binds NO data hook — its only "source" is `useTranslation`, plus local `useState`/
// `useEffect` for a one-second ticking clock and the two text inputs. So the cache-then-network lifecycle
// states (loading / stale / offline) the data-bound surfaces carry do not exist here, exactly as the sibling
// ToolCard (P3/0010) and ResultPanel ports documented. The surface's real states are the live clock and the
// per-input parsed/empty branches, all reproduced below as pure projections.
//
// Three derivations are ported verbatim from the web source and its helpers:
//   * the live clock (`floor(now/1000)` unix seconds + `now.toISOString()`), refreshed each tick;
//   * the unix-input parse `ms = unix.length > 10 ? parseInt(unix,10) : parseInt(unix,10) * 1000` followed by
//     `new Date(ms)` validity, and the iso-input parse `new Date(iso)` validity (helpers `getRelativeTime`
//     and `formatDateTime`);
//   * the per-input conversion rows (unix -> Iso/Local/Relative, iso -> Unix/Local/Relative).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/TimestampTool — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling ResultPanel / ToolCard surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.timestamptool

import io.teslasync.shared.core.diagnostics.Logger
import java.math.BigInteger
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TimestampToolRegistration {
    /** Stable surface id. */
    const val ID: String = "timestamp-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TimestampTool"
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface
 * [TimestampToolRegistration.SLUG] — never an entered timestamp or a converted value — so a diagnostics line
 * can never leak the inspected data.
 */
object TimestampToolDiagnostics {
    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to TimestampToolRegistration.SLUG))
    }
}

/**
 * The live clock row (web `floor(now/1000)` ` | ` `now.toISOString()`), refreshed each one-second tick.
 *
 * @property unixSeconds the current epoch-second count as text (web `Math.floor(now.getTime() / 1000)`).
 * @property iso the current instant as a UTC ISO-8601 string with millis + `Z` (web `now.toISOString()`).
 */
data class LiveClock(
    val unixSeconds: String,
    val iso: String,
)

/**
 * The two values the web "Now" button writes into the inputs: `String(floor(Date.now()/1000))` and
 * `new Date().toISOString()`.
 */
data class NowFieldValues(
    val unix: String,
    val iso: String,
)

/**
 * The three conversion rows shown beneath the unix input when it parses (web `{fromUnix && …}`): the same
 * instant rendered as an ISO string, a locale-aware "Local" string, and a relative-time string.
 */
data class UnixConversion(
    val iso: String,
    val local: String,
    val relative: String,
)

/**
 * The three conversion rows shown beneath the iso input when it parses (web `{fromIso && …}`): the epoch-second
 * count, a locale-aware "Local" string, and a relative-time string.
 */
data class IsoConversion(
    val unix: String,
    val local: String,
    val relative: String,
)

/**
 * Pure projection from the raw inputs + current instant to the render-ready values — the native port of the
 * derivations the web component performs (the ticking clock, the `fromUnix` / `fromIso` memos, and the
 * `getRelativeTime` / `formatDateTime` helper calls) before returning JSX. Framework-free so every branch is
 * unit-tested without a UI host; the [zone] and [locale] are passed in (the composable supplies the device's)
 * so the "Local" rendering is deterministic under test.
 */
object TimestampToolProjection {
    /** Epoch seconds for [instant], floored like JS `Math.floor(ms / 1000)` (correct for negative instants too). */
    fun unixSeconds(instant: Instant): Long = Math.floorDiv(instant.toEpochMilli(), MILLIS_PER_SECOND)

    /** UTC ISO-8601 with three-digit millis and a `Z` suffix — byte-compatible with JS `Date.toISOString()`. */
    fun toIso(instant: Instant): String = ISO_FORMATTER.format(instant)

    /** The live clock row for [now] (web `floor(now/1000)` + `now.toISOString()`). */
    fun liveClock(now: Instant): LiveClock = LiveClock(unixSeconds(now).toString(), toIso(now))

    /** The values the "Now" button writes into the inputs (web `String(floor(now/1000))` + `now.toISOString()`). */
    fun nowFieldValues(now: Instant): NowFieldValues = NowFieldValues(unixSeconds(now).toString(), toIso(now))

    /**
     * Parses the unix-timestamp input, reproducing the web memo exactly:
     * `ms = unix.length > 10 ? parseInt(unix, 10) : parseInt(unix, 10) * 1000; const d = new Date(ms);
     * return isNaN(d.getTime()) ? null : d`. The `> 10` test is on the RAW input length (web parity), the
     * integer parse follows JS `parseInt` base-10 semantics (see [parseLeadingInt]), and the JS `Date`
     * validity bound (±8.64e15 ms) maps a magnitude out of range to `null` like `isNaN(d.getTime())`.
     */
    fun parseUnix(input: String): Instant? {
        val magnitude = if (input.isEmpty()) null else parseLeadingInt(input)
        val millis =
            magnitude?.let { value ->
                if (input.length > UNIX_SECONDS_MAX_DIGITS) value else value.multiply(MILLIS_PER_SECOND_BIG)
            }
        return millis
            ?.takeIf { it.abs() <= JS_MAX_DATE_MILLIS }
            ?.let { Instant.ofEpochMilli(it.toLong()) }
    }

    /**
     * Parses the ISO-timestamp input, reproducing the web `const d = new Date(iso); return isNaN(d.getTime())
     * ? null : d` for the ISO-8601 forms the field accepts: an instant/offset string (`…Z`, `…+05:30`), a
     * zoneless local date-time (interpreted in [zone], like JS local time), and a date-only string
     * (interpreted as UTC midnight, matching JS's date-only-is-UTC rule). Any input none of these accept maps
     * to `null`, exactly as an unparseable string makes `new Date(iso)` invalid. JS `Date`'s non-ISO leniency
     * (e.g. RFC strings) is intentionally not reproduced — the field's example value is ISO-8601.
     */
    fun parseIso(
        input: String,
        zone: ZoneId,
    ): Instant? {
        if (input.isEmpty()) return null
        return ISO_PARSERS.firstNotNullOfOrNull { parse -> runCatching { parse(input, zone) }.getOrNull() }
    }

    /**
     * Relative-time string for [from] measured against [now] — a verbatim port of the web `getRelativeTime`
     * helper, including its `Math.abs` (so a future instant still reads "… ago") and its `Xs/Xm/Xh/Xd ago`
     * format. These format tokens are NOT translated in the web source (the helper hardcodes them), so
     * reproducing them verbatim is the faithful-parity choice; they are programmatic units, not localizable copy.
     */
    fun relative(
        from: Instant,
        now: Instant,
    ): String {
        val seconds = abs(now.toEpochMilli() - from.toEpochMilli()) / MILLIS_PER_SECOND
        val minutes = seconds / SECONDS_PER_MINUTE
        val hours = minutes / MINUTES_PER_HOUR
        val days = hours / HOURS_PER_DAY
        return when {
            seconds < SECONDS_PER_MINUTE -> "$seconds$REL_SECONDS"
            minutes < MINUTES_PER_HOUR -> "$minutes$REL_MINUTES"
            hours < HOURS_PER_DAY -> "$hours$REL_HOURS"
            else -> "$days$REL_DAYS"
        }
    }

    /**
     * Locale-aware "Local" rendering of [instant] in [zone] — the native analogue of the web `formatDateTime`
     * helper's `toLocaleString(locale, { year:'numeric', month:'short', day:'numeric', hour:'2-digit',
     * minute:'2-digit' })`. The pattern mirrors the en-US shape ("Apr 4, 2026, 02:30 AM"); month/period names
     * follow [locale]. Intl's full per-locale hour-cycle parity is not byte-reproduced (java.time uses a fixed
     * pattern), which is acceptable for a locale-dependent "Local" value.
     */
    fun local(
        instant: Instant,
        zone: ZoneId,
        locale: Locale,
    ): String = DateTimeFormatter.ofPattern(LOCAL_PATTERN, locale).withZone(zone).format(instant)

    /** Projects the unix input into its conversion rows, or `null` when it does not parse (web `{fromUnix && …}`). */
    fun projectUnix(
        input: String,
        now: Instant,
        zone: ZoneId,
        locale: Locale,
    ): UnixConversion? =
        parseUnix(input)?.let { instant ->
            UnixConversion(
                iso = toIso(instant),
                local = local(instant, zone, locale),
                relative = relative(instant, now),
            )
        }

    /** Projects the iso input into its conversion rows, or `null` when it does not parse (web `{fromIso && …}`). */
    fun projectIso(
        input: String,
        now: Instant,
        zone: ZoneId,
        locale: Locale,
    ): IsoConversion? =
        parseIso(input, zone)?.let { instant ->
            IsoConversion(
                unix = unixSeconds(instant).toString(),
                local = local(instant, zone, locale),
                relative = relative(instant, now),
            )
        }

    /**
     * JS `parseInt(value, 10)` for the leading run of the string: skip leading whitespace, accept an optional
     * sign, read base-10 digits until the first non-digit, and yield `null` (JS `NaN`) when no digit is read.
     * Returns a [BigInteger] so an over-long digit run is bounded by the date-validity check in [parseUnix]
     * rather than overflowing.
     */
    private fun parseLeadingInt(raw: String): BigInteger? {
        var index = 0
        while (index < raw.length && raw[index].isWhitespace()) index++
        val negative = index < raw.length && raw[index] == '-'
        if (index < raw.length && (raw[index] == '+' || raw[index] == '-')) index++
        val start = index
        while (index < raw.length && raw[index] in '0'..'9') index++
        if (index == start) return null
        val digits = BigInteger(raw.substring(start, index))
        return if (negative) digits.negate() else digits
    }

    // Web `unix.length > 10` splits seconds from milliseconds on the raw input length.
    private const val UNIX_SECONDS_MAX_DIGITS = 10
    private const val MILLIS_PER_SECOND = 1000L
    private const val SECONDS_PER_MINUTE = 60L
    private const val MINUTES_PER_HOUR = 60L
    private const val HOURS_PER_DAY = 24L

    // Untranslated relative-time format tokens, identical to the web `getRelativeTime` helper.
    private const val REL_SECONDS = "s ago"
    private const val REL_MINUTES = "m ago"
    private const val REL_HOURS = "h ago"
    private const val REL_DAYS = "d ago"

    // en-US-shaped "Local" pattern (web `toLocaleString` options); month/period names follow the caller's locale.
    private const val LOCAL_PATTERN = "MMM d, yyyy, hh:mm a"

    private val MILLIS_PER_SECOND_BIG: BigInteger = BigInteger.valueOf(MILLIS_PER_SECOND)

    // JS `Date` is valid for ±8,640,000,000,000,000 ms; a larger magnitude makes `isNaN(d.getTime())` true.
    private val JS_MAX_DATE_MILLIS: BigInteger = BigInteger.valueOf(8_640_000_000_000_000L)

    // UTC formatter that always emits three-digit millis + `Z`, matching JS `Date.toISOString()`.
    private val ISO_FORMATTER: DateTimeFormatter =
        DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT).withZone(ZoneOffset.UTC)

    // The ISO-8601 forms the field accepts, tried in order; the first that parses wins (web `new Date(iso)`).
    private val ISO_PARSERS: List<(String, ZoneId) -> Instant> =
        listOf(
            { text, _ -> OffsetDateTime.parse(text).toInstant() },
            { text, _ -> Instant.parse(text) },
            { text, zone -> LocalDateTime.parse(text).atZone(zone).toInstant() },
            { text, _ -> LocalDate.parse(text).atStartOfDay(ZoneOffset.UTC).toInstant() },
        )
}
