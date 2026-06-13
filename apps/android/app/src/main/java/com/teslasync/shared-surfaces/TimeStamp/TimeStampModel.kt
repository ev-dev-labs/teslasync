// Pure, framework-free model + projection + diagnostics for the TimeStamp shared surface — the native
// analogue of everything web/src/components/data-display/TimeStamp.tsx derives before returning its
// `<span>`, plus the pure library helpers that component leans on (web/src/lib/dateFormat.ts
// `formatRelative` + `formatDateTime`, web/src/lib/timezone.ts `resolveTimezone`, web/src/lib/locale.ts).
// No Compose, no Android framework, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these functions.
//
// The web TimeStamp renders a single instant (its `value` PROP — never fetched) twice: a VISIBLE body and a
// hover/long-press tooltip carrying the ALTERNATE format. Which one is visible is picked by the resolved
// format — `'auto'` (the default) honours the user's `time_format_default` Settings preference
// (`useTimeFormatPreference`, default `'relative'`); explicit `'relative'` / `'absolute'` override it. The
// two formats come from `useDateFormat(in)`: `formatRelative` ("just now", "5m ago", "2h ago", "3d ago",
// then the absolute date once older than a week) and `formatDateTime` ("Apr 4, 2026, 2:30 AM"). Both are
// locale + timezone aware: the zone is resolved from the user's `tz_display_default` mode (overridable per
// surface via the `in` prop), the user's `timezone_user` override, and the active vehicle's reported zone;
// the locale from `settings.locale`. Those feeds are cache-then-network (P1/S8), so this file projects their
// combined [Resource] onto the shared [UiState] so the render boundary can show every freshness state the
// ADR-013 contract carries.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web component degrades gracefully —
// while settings/vehicle load it renders immediately against sensible defaults and refines once data
// arrives, and it never blanks. The P3 contract additionally requires every state of the bound feeds to
// render a non-blank affordance. Both are honoured at once: the formatted timestamp is ALWAYS rendered
// (cached → fresh → device-default zone fallback), and only the resolution feed's non-fresh states surface
// as a compact trailing chip (updating / stale / offline / a retry affordance). The surface's own "empty"
// state is the web em-dash marker shown for a null / unparseable `value`, not a feed branch. The web
// `formatRelative` English tokens ("just now", "{n}m ago", "{n}h ago", "{n}d ago") are routed through the
// i18n catalog (P1/S10) via the byte-identical `freshness.justNow` + `palette.recent.*` keys rather than
// reproduced as native literals.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/TimeStamp — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the
// path, exactly as the sibling DateTime / VisuallyHidden surfaces do. `MatchingDeclarationName` is
// suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timestamp

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.components.feedback.classifyQueryError
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Canonical registry metadata for the TimeStamp surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`TimeStamp`).
 */
object TimeStampRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the surface with). */
    const val ID: String = "time-stamp"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TimeStamp"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val TIME_STAMP_VIEW_OPENED_EVENT: String = "view.opened"

/**
 * The universal fallback marker the surface renders for an unrenderable `value` — the native port of the
 * web `'—'` em dash (web/src/components/data-display/TimeStamp.tsx). Shown for a null, blank, or unparseable
 * value so the inline element never collapses to nothing (the surface's "empty" state). No tooltip is wrapped
 * around it, matching the web bare-`<span>` null branch.
 */
const val EM_DASH: String = "\u2014"

/** The literal IANA name for Coordinated Universal Time — the web `'UTC'` sentinel. */
const val UTC_ZONE: String = "UTC"

/** The BCP-47 fallback locale tag — the web `resolveLocale` default (`'en-US'`). */
const val DEFAULT_LOCALE_TAG: String = "en-US"

/**
 * The visible format the surface picks — the native port of the web `TimeStampFormat`
 * (`'relative' | 'absolute' | 'auto'`). [Auto] honours the user's `time_format_default` Settings preference;
 * [Relative] / [Absolute] override it for a specific surface.
 */
enum class TimeStampFormat { Relative, Absolute, Auto }

/**
 * The user's globally preferred default format — the native port of what web `useTimeFormatPreference`
 * resolves `settings.time_format_default` to (`'relative' | 'absolute'`). Used when the surface's
 * [TimeStampFormat] is [TimeStampFormat.Auto].
 */
enum class TimeFormat {
    Relative,
    Absolute,
    ;

    companion object {
        /**
         * Parses the wire token stored in `settings.time_format_default`. Only the literal `absolute` selects
         * [Absolute]; anything else (including blank / unknown / `null`) falls back to [Relative] — the web
         * `pref === 'absolute' ? 'absolute' : 'relative'` default.
         */
        fun fromWire(token: String?): TimeFormat = if (token?.trim()?.lowercase(Locale.US) == "absolute") Absolute else Relative
    }
}

/**
 * Time-zone display modes — the native port of the web `TzMode` (`'vehicle' | 'user' | 'utc'`). Renders a UTC
 * instant in the car's local zone, the user's zone, or literal UTC while the data itself stays UTC.
 */
enum class TzMode {
    Vehicle,
    User,
    Utc,
    ;

    companion object {
        /**
         * Parses the wire token stored in `settings.tz_display_default` / passed as the web `in` prop. Unknown
         * or blank tokens fall back to [Vehicle] — the web `settings.tz_display_default ?? 'vehicle'` default.
         */
        fun fromWire(token: String?): TzMode =
            when (token?.trim()?.lowercase(Locale.US)) {
                "utc" -> Utc
                "user" -> User
                else -> Vehicle
            }
    }
}

/**
 * Resolves a usable BCP-47 locale tag — the native port of web `resolveLocale` (web/src/lib/locale.ts): a
 * non-blank tag is used (trimmed for the platform formatters), an empty/blank/`null` tag degrades to
 * [DEFAULT_LOCALE_TAG] rather than throwing.
 */
fun resolveLocaleTag(locale: String?): String = if (!locale.isNullOrBlank()) locale.trim() else DEFAULT_LOCALE_TAG

/**
 * Computes the IANA timezone for [mode] from the vehicle's reported zone + the user's optional override + the
 * platform [deviceZone] — the native port of web `resolveTimezone` (web/src/lib/timezone.ts):
 *  - [TzMode.Utc] → [UTC_ZONE];
 *  - [TzMode.User] → the override when set, else the device zone;
 *  - [TzMode.Vehicle] → the vehicle's zone, or the user zone when the vehicle has not been polled yet (its
 *    zone is blank or the literal `UTC` sentinel).
 */
fun resolveZone(
    mode: TzMode,
    vehicleTz: String?,
    userOverride: String?,
    deviceZone: String,
): String {
    val userZone = if (!userOverride.isNullOrBlank()) userOverride.trim() else deviceZone
    return when (mode) {
        TzMode.Utc -> UTC_ZONE
        TzMode.User -> userZone
        TzMode.Vehicle -> if (vehicleTz.isNullOrBlank() || vehicleTz == UTC_ZONE) userZone else vehicleTz
    }
}

/**
 * Parses an ISO-8601 [value] (the API wire shape, always UTC with a `Z`) into an [Instant] — the native
 * analogue of the web `new Date(value)`. Tolerant of a full instant, an offset date-time, a zoneless local
 * date-time (read as UTC, like the backend always emits), or a bare date; a blank, `null`, or unparseable
 * value yields `null` so callers render the [EM_DASH] marker instead of an "Invalid Date".
 */
internal fun parseInstant(value: String?): Instant? {
    if (value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value) }
        .recoverCatching { OffsetDateTime.parse(value).toInstant() }
        .recoverCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC) }
        .recoverCatching { LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant() }
        .getOrNull()
}

/** Resolves an [ZoneId] from an IANA name, degrading to [UTC_ZONE] for an unknown/invalid name (web fallback). */
internal fun safeZone(zone: String): ZoneId = runCatching { ZoneId.of(zone) }.getOrNull() ?: ZoneId.of(UTC_ZONE)

/** Resolves a [Locale] from a BCP-47 tag, degrading to [DEFAULT_LOCALE_TAG] for an unusable tag. */
internal fun safeLocale(tag: String): Locale {
    val parsed = Locale.forLanguageTag(tag)
    return if (parsed.toLanguageTag() == "und") Locale.forLanguageTag(DEFAULT_LOCALE_TAG) else parsed
}

/**
 * The render-ready display token for the surface — a closed set the view switches on so every branch is
 * exhaustively covered and unit-tested off-device. [Empty] is the web em-dash marker (no tooltip); [Rendered]
 * carries the [primary] visible phrase plus the [secondary] alternate-format phrase the view hangs on the
 * tooltip — exactly the web `<Tooltip content={secondary}>{primary}</Tooltip>` pairing.
 */
sealed interface TimeStampDisplay {
    /** The value is null/blank/unparseable — render the [EM_DASH] marker (the surface's empty state). */
    data object Empty : TimeStampDisplay

    /**
     * A renderable value: [primary] is the visible body, [secondary] is the alternate format the tooltip
     * shows so power users can flip perspectives without leaving the surface (web parity).
     */
    data class Rendered(
        val primary: TimePhrase,
        val secondary: TimePhrase,
    ) : TimeStampDisplay
}

/**
 * One of the two format faces of a rendered timestamp. [Absolute] is a fully-formatted, locale-aware string
 * (web `formatDateTime`); [Relative] carries the structured age bucket so the view resolves the localized
 * phrase from the catalog (the relative tokens are i18n, not native literals).
 */
sealed interface TimePhrase {
    /** A pre-formatted absolute string — web `formatDateTime` ("Apr 4, 2026, 2:30 AM"). */
    data class Absolute(
        val value: String,
    ) : TimePhrase

    /** A relative age, carried as a structured bucket so the view localizes it (P1/S10). */
    data class Relative(
        val age: RelativeAge,
    ) : TimePhrase
}

/**
 * The structured result of the relative formatter — the native port of the buckets web `formatRelative`
 * collapses to: under a minute → [JustNow]; under an hour → [Minutes]; under a day → [Hours]; under a week →
 * [Days]; otherwise the absolute medium date ([AbsoluteDate], web's `formatDate` fallback). The count is
 * carried so the view selects the catalog plural.
 */
sealed interface RelativeAge {
    /** Under one minute old — web `'just now'`. */
    data object JustNow : RelativeAge

    /** [count] whole minutes old — web `${minutes}m ago`. */
    data class Minutes(
        val count: Int,
    ) : RelativeAge

    /** [count] whole hours old — web `${hours}h ago`. */
    data class Hours(
        val count: Int,
    ) : RelativeAge

    /** [count] whole days old (still under a week) — web `${days}d ago`. */
    data class Days(
        val count: Int,
    ) : RelativeAge

    /** A week old or more — the pre-formatted absolute medium date (web `formatRelative`'s `formatDate` tail). */
    data class AbsoluteDate(
        val value: String,
    ) : RelativeAge
}

private const val SECOND_MILLIS: Long = 1_000L
private const val SECONDS_PER_MINUTE: Long = 60L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L
private const val DAYS_PER_WEEK: Long = 7L

/**
 * Resolves [value] for the effective [format] in [zoneId] + [localeTag] — the native port of the web
 * `TimeStamp` body. Returns [TimeStampDisplay.Empty] for an unrenderable [value] (web's bare em-dash span).
 * Otherwise builds BOTH faces and pairs them per the resolved [format]: the visible [TimeStampDisplay.Rendered.primary]
 * is the format itself, the tooltip [TimeStampDisplay.Rendered.secondary] is the alternate (web
 * `effective === 'relative' ? formatRelative : formatDateTime` for primary, the other for secondary).
 * [nowMillis] anchors the relative face (web `Date.now()`), threaded in so this stays clock-free under test.
 */
fun resolveTimeStampDisplay(
    value: String?,
    format: TimeFormat,
    zoneId: String,
    localeTag: String,
    nowMillis: Long,
): TimeStampDisplay {
    val instant = parseInstant(value) ?: return TimeStampDisplay.Empty
    val zone = safeZone(zoneId)
    val locale = safeLocale(localeTag)
    val absolute = TimePhrase.Absolute(formatDateTime(instant, zone, locale))
    val relative = TimePhrase.Relative(relativeAgeOf(instant, nowMillis, zone, locale))
    return when (format) {
        TimeFormat.Relative -> TimeStampDisplay.Rendered(primary = relative, secondary = absolute)
        TimeFormat.Absolute -> TimeStampDisplay.Rendered(primary = absolute, secondary = relative)
    }
}

/** Full date + time (web `formatDateTime`: medium date + short time, e.g. "Apr 4, 2026, 2:30 PM"). */
private fun formatDateTime(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String =
    DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .format(instant.atZone(zone))

/** Date only (web `formatDate`: medium date, e.g. "Apr 4, 2026") — the `formatRelative` over-a-week tail. */
private fun formatDate(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(instant.atZone(zone))

/**
 * Buckets the age of [instant] against [nowMillis] — the native port of web `formatRelative`: under a minute
 * → [RelativeAge.JustNow]; under an hour → [RelativeAge.Minutes]; under a day → [RelativeAge.Hours]; under a
 * week → [RelativeAge.Days]; otherwise the absolute medium date ([RelativeAge.AbsoluteDate], web's
 * `formatDate` fallback). A future instant (negative age) buckets to [RelativeAge.JustNow], matching the web
 * `seconds < 60` branch. Each step floors like the web's chained `Math.floor`.
 */
private fun relativeAgeOf(
    instant: Instant,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
): RelativeAge {
    val diffMillis = nowMillis - instant.toEpochMilli()
    val seconds = Math.floorDiv(diffMillis, SECOND_MILLIS)
    val minutes = Math.floorDiv(seconds, SECONDS_PER_MINUTE)
    val hours = Math.floorDiv(minutes, MINUTES_PER_HOUR)
    val days = Math.floorDiv(hours, HOURS_PER_DAY)
    return when {
        seconds < SECONDS_PER_MINUTE -> RelativeAge.JustNow
        minutes < MINUTES_PER_HOUR -> RelativeAge.Minutes(minutes.toInt())
        hours < HOURS_PER_DAY -> RelativeAge.Hours(hours.toInt())
        days < DAYS_PER_WEEK -> RelativeAge.Days(days.toInt())
        else -> RelativeAge.AbsoluteDate(formatDate(instant, zone, locale))
    }
}

/**
 * The zone + locale + format-preference inputs the surface reads from the bound hooks — the projected payload
 * of the combined `useSettings` + `useSelectedVehicle` feeds (the `useTimezone` fold + the
 * `useTimeFormatPreference` read are applied at the render boundary by [effectiveZoneId] / [effectiveTimeFormat]).
 * Always resolvable: a missing settings document / unpolled vehicle degrades each field to its web default so
 * the timestamp still renders.
 *
 * @property tzDisplayDefault the user's default mode (`settings.tz_display_default`), [TzMode.Vehicle] default.
 * @property userTimezone the user's optional IANA override (`settings.timezone_user`); `null` when blank.
 * @property localeTag the resolved BCP-47 locale (`resolveLocale(settings.locale)`).
 * @property vehicleTimezone the active vehicle's reported IANA zone; `null` when no vehicle / blank.
 * @property timeFormatDefault the user's default visible format (`settings.time_format_default`),
 *   [TimeFormat.Relative] default (web `useTimeFormatPreference`).
 */
data class TimeStampSettings(
    val tzDisplayDefault: TzMode,
    val userTimezone: String?,
    val localeTag: String,
    val vehicleTimezone: String?,
    val timeFormatDefault: TimeFormat,
) {
    companion object {
        /** The web defaults used before any settings/vehicle have loaded (`vehicle` zone, `relative` format, …). */
        val DEFAULTS: TimeStampSettings =
            TimeStampSettings(TzMode.Vehicle, null, DEFAULT_LOCALE_TAG, null, TimeFormat.Relative)
    }
}

private const val KEY_TZ_DISPLAY_DEFAULT: String = "tz_display_default"
private const val KEY_TIMEZONE_USER: String = "timezone_user"
private const val KEY_LOCALE: String = "locale"
private const val KEY_TIME_FORMAT_DEFAULT: String = "time_format_default"

private fun JsonObject?.stringField(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

/**
 * Projects the raw `/settings` document + the active [selectedVehicle] onto [TimeStampSettings] — the native
 * analogue of what the web `TimeStamp` reads from `useSettings()` + `useSelectedVehicle()` (via
 * `useTimeFormatPreference` + `useDateFormat`). Mirrors the web key handling: `tz_display_default` parsed
 * (default vehicle), `timezone_user` blank → `null`, `locale` resolved via [resolveLocaleTag],
 * `time_format_default` parsed (default relative), the vehicle's `timezone` carried through (blank → `null`).
 */
fun timeStampSettingsFrom(
    settingsDoc: JsonElement?,
    selectedVehicle: Vehicle?,
): TimeStampSettings {
    val obj = settingsDoc as? JsonObject
    return TimeStampSettings(
        tzDisplayDefault = TzMode.fromWire(obj.stringField(KEY_TZ_DISPLAY_DEFAULT)),
        userTimezone = obj.stringField(KEY_TIMEZONE_USER)?.takeIf { it.isNotBlank() },
        localeTag = resolveLocaleTag(obj.stringField(KEY_LOCALE)),
        vehicleTimezone = selectedVehicle?.timezone?.takeIf { it.isNotBlank() },
        timeFormatDefault = TimeFormat.fromWire(obj.stringField(KEY_TIME_FORMAT_DEFAULT)),
    )
}

/**
 * Resolves the active vehicle from the enrolled [vehicles] + the persisted [storedSelectedId] — the native
 * mirror of the web `useSelectedVehicle` precedence collapsed to "stored choice when still enrolled, else the
 * first vehicle" (native has no URL tier). Returns `null` for an empty fleet.
 */
fun selectedVehicleOf(
    vehicles: List<Vehicle>,
    storedSelectedId: Long?,
): Vehicle? =
    when {
        vehicles.isEmpty() -> null
        storedSelectedId != null && storedSelectedId > 0 && vehicles.any { it.id == storedSelectedId } ->
            vehicles.first { it.id == storedSelectedId }
        else -> vehicles.first()
    }

private fun Resource<*>.fetchedAtOrNull(): Long? =
    when (this) {
        is Resource.Loading -> fetchedAt
        is Resource.Success -> fetchedAt
        is Resource.Error -> fetchedAt
    }

/**
 * Folds the two cache-then-network feeds (`settings` document + enrolled `vehicles`) into a single
 * [Resource] of the projected [TimeStampSettings], preserving the ADR-013 envelope so the downstream
 * [UiState] still drives loading / content / stale / offline / error. The config is always computable (each
 * absent input degrades to its web default), so:
 *  - either feed hard-failed AND neither has any cached value → a hard [Resource.Error] (cold offline start);
 *  - either feed hard-failed WITH some cache → [Resource.Error] carrying the last-known config (offline);
 *  - either feed is loading AND neither has any cache → first-load [Resource.Loading];
 *  - either feed is loading WITH some cache → refreshing [Resource.Loading] over the cached config;
 *  - both succeeded → [Resource.Success].
 *
 * The combined staleness is the OR of the two feeds, and the freshness stamp is the newer of the two — so a
 * stale settings doc taints the whole surface even when the vehicle list is fresh.
 */
fun combineSettings(
    settings: Resource<JsonElement>,
    vehicles: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
): Resource<TimeStampSettings> {
    val config =
        timeStampSettingsFrom(settings.cached, vehicles.cached?.let { selectedVehicleOf(it, storedSelectedId) })
    val bothEmpty = settings.cached == null && vehicles.cached == null
    val combinedStale = settings.stale || vehicles.stale
    val newestFetchedAt = listOfNotNull(settings.fetchedAtOrNull(), vehicles.fetchedAtOrNull()).maxOrNull()
    val failure = (settings as? Resource.Error)?.error ?: (vehicles as? Resource.Error)?.error
    val anyLoading = settings is Resource.Loading || vehicles is Resource.Loading
    return when {
        failure != null && bothEmpty ->
            Resource.Error(cached = null, fetchedAt = newestFetchedAt, stale = combinedStale, error = failure)
        failure != null ->
            Resource.Error(cached = config, fetchedAt = newestFetchedAt, stale = true, error = failure)
        anyLoading && bothEmpty -> Resource.Loading(cached = null, fetchedAt = null, stale = false)
        anyLoading -> Resource.Loading(cached = config, fetchedAt = newestFetchedAt, stale = combinedStale)
        else -> Resource.Success(data = config, fetchedAt = newestFetchedAt ?: 0L, stale = combinedStale)
    }
}

/**
 * The trailing freshness affordance the surface shows beside the timestamp — never hiding the value, only
 * labelling the resolution feed's posture (ADR-013, so cached zones are never presented as live):
 *  - [Failed] a hard error with no cached config (a retry affordance);
 *  - [Offline] cached config shown after a failed refresh (a last-known + retry chip);
 *  - [Updating] a refresh in flight over a cached config;
 *  - [Stale] the cached config passed its TTL;
 *  - [Fresh] live — nothing is shown.
 */
enum class TimeStampFreshness { Fresh, Updating, Stale, Offline, Failed }

/** Selects the [TimeStampFreshness] from the feed's [state] — failure first, then offline, then refresh. */
fun timeStampFreshness(state: UiState<TimeStampSettings>): TimeStampFreshness =
    when {
        state.isError -> TimeStampFreshness.Failed
        state.hasError && state.hasData -> TimeStampFreshness.Offline
        state.refreshing -> TimeStampFreshness.Updating
        state.stale -> TimeStampFreshness.Stale
        else -> TimeStampFreshness.Fresh
    }

/**
 * The effective visible [TimeFormat] for a render — the web `effective = format === 'auto' ? pref : format`:
 * an explicit [TimeStampFormat.Relative] / [TimeStampFormat.Absolute] wins; [TimeStampFormat.Auto] defers to
 * the user's [TimeStampSettings.timeFormatDefault] (web `useTimeFormatPreference`), itself [TimeFormat.Relative]
 * while settings are still loading.
 */
fun effectiveTimeFormat(
    format: TimeStampFormat,
    settings: TimeStampSettings?,
): TimeFormat =
    when (format) {
        TimeStampFormat.Relative -> TimeFormat.Relative
        TimeStampFormat.Absolute -> TimeFormat.Absolute
        TimeStampFormat.Auto -> settings?.timeFormatDefault ?: TimeFormat.Relative
    }

/**
 * The effective [TzMode] for a render — the web `mode ?? settings.tz_display_default ?? 'vehicle'`: the
 * explicit per-call [explicit] (web `in` prop) wins, else the user's [TimeStampSettings.tzDisplayDefault],
 * else [TzMode.Vehicle] while settings are still loading.
 */
fun effectiveTzMode(
    explicit: TzMode?,
    settings: TimeStampSettings?,
): TzMode = explicit ?: settings?.tzDisplayDefault ?: TzMode.Vehicle

/**
 * The effective IANA zone for a render — applies [resolveZone] (the `useTimezone` fold) to the [effectiveTzMode]
 * over the bound [settings] + the platform [deviceZone]. While settings/vehicle are still loading the vehicle
 * + user inputs are absent, so this degrades to the device zone (or literal UTC under [TzMode.Utc]).
 */
fun effectiveZoneId(
    explicit: TzMode?,
    settings: TimeStampSettings?,
    deviceZone: String,
): String = resolveZone(effectiveTzMode(explicit, settings), settings?.vehicleTimezone, settings?.userTimezone, deviceZone)

/** The effective BCP-47 locale — the bound `settings.locale`, else the resolved [deviceLocaleTag] (web browser locale). */
fun effectiveLocaleTag(
    settings: TimeStampSettings?,
    deviceLocaleTag: String,
): String = settings?.localeTag ?: resolveLocaleTag(deviceLocaleTag)

/**
 * Folds the rendered [primary] text and the optional localized [status] word (offline / stale / updating)
 * into the single TalkBack content description the inline element exposes — "{primary}, {status}". Pure so
 * the a11y label is asserted off-device.
 */
fun timeStampContentDescription(
    primary: String,
    status: String?,
): String =
    buildString {
        append(primary)
        if (!status.isNullOrBlank()) append(", ").append(status)
    }

/**
 * Classifies a resolution-feed failure into the recovery-oriented [QueryErrorKind] — the same fold the
 * sibling surfaces use: offline/timeout → not-online; circuit-open → the transient "waiting" state;
 * otherwise the HTTP status selects the copy.
 */
fun timeStampErrorKind(
    errorKind: ErrorKind?,
    httpStatus: Int?,
): QueryErrorKind =
    classifyQueryError(
        status = httpStatus,
        online = errorKind != ErrorKind.Network && errorKind != ErrorKind.Timeout,
        transientWaiting = errorKind == ErrorKind.CircuitOpen,
    )

/**
 * The Android string-resource names the surface resolves through the i18n facade (P1/S10). The web component
 * renders no chrome of its own, so the native states reuse catalog keys the rest of the app already ships:
 * the freshness chips reuse `common.offline` / `mqtt.stale` / `freshness.updating`, the relative phrases reuse
 * the byte-identical `freshness.justNow` (`'just now'`, lowercase, matching web `formatRelative`) +
 * `palette.recent.*` plurals (`%1$dm ago` / `%1$dh ago` / `%1$dd ago` match web verbatim), and the retry
 * affordance reuses `common.retry`. Every name below exists in `values/`, `values-ar/` and `values-he/`
 * (asserted by name in the unit test; resource bytes are not read off-device).
 */
object TimeStampKeys {
    /** Offline chip — web `t('common.offline', 'Offline')`. */
    const val OFFLINE: String = "translation_common_offline"

    /** Stale chip — web `t('mqtt.stale', 'Stale')`. */
    const val STALE: String = "translation_mqtt_stale"

    /** Refreshing chip — web `t('freshness.updating', 'updating…')`. */
    const val UPDATING: String = "translation_freshness_updating"

    /** Loading affordance — web `t('common.loading', 'Loading...')`. */
    const val LOADING: String = "translation_common_loading"

    /** Retry affordance — web `t('common.retry', 'Retry')`. */
    const val RETRY: String = "translation_common_retry"

    /** Relative "just now" — the web `formatRelative` lowercase `'just now'`. */
    const val JUST_NOW: String = "translation_freshness_justNow"

    /** Relative minutes plural — the web `${minutes}m ago` (`%1$dm ago`). */
    const val MINUTES_AGO: String = "translation_palette_recent_minutesAgo"

    /** Relative hours plural — the web `${hours}h ago` (`%1$dh ago`). */
    const val HOURS_AGO: String = "translation_palette_recent_hoursAgo"

    /** Relative days plural — the web `${days}d ago` (`%1$dd ago`). */
    const val DAYS_AGO: String = "translation_palette_recent_daysAgo"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object TimeStampDefaults {
    const val OFFLINE: String = "Offline"
    const val STALE: String = "Stale"
    const val UPDATING: String = "updating…"
    const val JUST_NOW: String = "just now"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [TimeStampRegistration.SLUG]
 * (P1/S11) — never a timestamp, vehicle id, or zone, so a diagnostics line can never leak the operator's
 * data. Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per
 * open.
 */
fun recordTimeStampOpened(logger: Logger) {
    logger.info(TIME_STAMP_VIEW_OPENED_EVENT, mapOf("surface" to TimeStampRegistration.SLUG))
}
