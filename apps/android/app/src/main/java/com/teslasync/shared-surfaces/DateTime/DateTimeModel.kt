// Pure, framework-free model + projection + diagnostics for the DateTime shared surface — the native
// analogue of everything web/src/components/data-display/format/DateTime.tsx derives before returning its
// `<span>`, plus the pure helpers that component leans on (web/src/lib/dateFormat.ts, web/src/lib/timezone.ts,
// web/src/lib/locale.ts). No Compose, no Android framework, no HTTP: every declaration here is exercised
// off-device by the :android:testReleaseUnitTest gate, keeping the composable a thin render layer over these
// functions.
//
// The web DateTime is a locale + timezone aware timestamp renderer. Its `value` (the instant to render) is a
// PROP — never fetched — and the five `variant`s (full / date / time / relative / short) each map onto a pure
// formatter that returns the universal em-dash marker "—" for a null/garbage value (web `FALLBACK`). Its
// optional timezone-aware path (`in` / `showTz`) resolves an IANA zone + BCP-47 locale from three hooks —
// `useSelectedVehicle` (the vehicle's reported zone), `useSettings` (the user's `tz_display_default` mode,
// `timezone_user` override, and `locale`), and `useTimezone` (the `resolveTimezone` fold over the two). Those
// three are cache-then-network feeds (P1/S8), so this file projects their combined [Resource] onto the shared
// [UiState] so the render boundary can show every freshness state the ADR-013 contract carries.
//
// Parity-with-honesty (Honesty Covenant #9, documented not silent): the web component degrades gracefully —
// while settings/vehicle load it renders immediately against sensible defaults and refines once data arrives,
// and it never blanks. The P3 contract additionally requires every state of the bound feeds to render a
// non-blank affordance. Both are honored at once: the timestamp text is ALWAYS rendered (cached → fresh →
// device-default zone fallback), and only the zone-resolution feed's non-fresh states surface as a compact
// trailing chip (updating / stale / offline / a retry affordance). The surface's own "empty" state is the
// web FALLBACK marker shown for a null/invalid `value`, not a feed branch. The web `formatRelativeTime`
// English tokens ("Just now", "{n}m ago", "{n}h ago") are routed through the i18n catalog (P1/S10) via the
// byte-identical `translation_palette_recent_*` keys rather than reproduced as native literals.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/DateTime — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen is illegal in a package identifier), so the package intentionally diverges from the path,
// exactly as the sibling ChartContainer / VisuallyHidden surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

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
 * Canonical registry metadata for the DateTime surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`DateTime`).
 */
object DateTimeRegistration {
    /** Stable surface id (also the `viewModel` key the host binds the tz-aware surface with). */
    const val ID: String = "date-time"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DateTime"
}

/** The stable, dot-namespaced diagnostics event emitted once when the surface opens (P1/S11). */
const val DATE_TIME_VIEW_OPENED_EVENT: String = "view.opened"

/**
 * The universal fallback marker every formatter returns for an unrenderable `value` — the native port of the
 * web `FALLBACK = '—'` em dash (web/src/lib/dateFormat.ts). Shown for a null, blank, or unparseable value so
 * the inline element never collapses to nothing (the surface's "empty" state).
 */
const val EM_DASH: String = "\u2014"

/** The literal IANA name for Coordinated Universal Time — the web `'UTC'` sentinel. */
const val UTC_ZONE: String = "UTC"

/** The BCP-47 fallback locale tag — the web `resolveLocale` default (`'en-US'`). */
const val DEFAULT_LOCALE_TAG: String = "en-US"

/**
 * The render variants of the surface — the native port of the web `DateTimeVariant`
 * (`'full' | 'date' | 'time' | 'relative' | 'short'`). Each selects a pure formatter in [resolveDisplay].
 */
enum class DateTimeVariant { Full, Date, Time, Relative, Short }

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
 * analogue of the web `new Date(iso)`. Tolerant of a full instant, an offset date-time, a zoneless local
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
 * exhaustively covered and unit-tested off-device. [Empty] is the web FALLBACK marker; [Text] is a
 * fully-formatted absolute value (full/date/time/short); [Relative] carries the structured relative bucket so
 * the view resolves the localized phrase from the catalog (the relative variant's strings are i18n, not
 * native literals).
 */
sealed interface DateTimeDisplay {
    /** The value is null/blank/unparseable — render the [EM_DASH] marker (the surface's empty state). */
    data object Empty : DateTimeDisplay

    /** A fully-formatted absolute timestamp (full / date / time / short variants). */
    data class Text(
        val value: String,
    ) : DateTimeDisplay

    /** A relative timestamp, carried as a structured bucket so the view localizes it (P1/S10). */
    data class Relative(
        val time: RelativeTime,
    ) : DateTimeDisplay
}

/**
 * The structured result of the relative formatter — the native port of the buckets web `formatRelativeTime`
 * collapses to: under a minute → [JustNow]; under an hour → [Minutes]; under a day → [Hours]; otherwise the
 * absolute short date + time ([Absolute]). The count is carried so the view selects the catalog plural.
 */
sealed interface RelativeTime {
    /** Under one minute old — web `'Just now'`. */
    data object JustNow : RelativeTime

    /** [count] whole minutes old — web `${diffMin}m ago`. */
    data class Minutes(
        val count: Int,
    ) : RelativeTime

    /** [count] whole hours old — web `${diffHrs}h ago`. */
    data class Hours(
        val count: Int,
    ) : RelativeTime

    /** Over a day old — the pre-formatted absolute short date + time (web's `toLocaleDateString` fallback). */
    data class Absolute(
        val value: String,
    ) : RelativeTime
}

private const val MINUTE_MILLIS: Long = 60_000L
private const val MINUTES_PER_HOUR: Long = 60L
private const val HOURS_PER_DAY: Long = 24L

/**
 * Formats [instant] in [zone] + [locale] for [variant] — the native port of the web `dateFormat.ts` helpers
 * the component's `renderSpan` dispatches to. Returns [DateTimeDisplay.Empty] for an unrenderable [value]
 * (web every formatter's `if (!iso) return '—'`). [nowMillis] anchors the relative variant (web `Date.now()`),
 * threaded in so this stays clock-free and deterministic under test.
 */
fun resolveDisplay(
    value: String?,
    variant: DateTimeVariant,
    zoneId: String,
    localeTag: String,
    nowMillis: Long,
): DateTimeDisplay {
    val instant = parseInstant(value) ?: return DateTimeDisplay.Empty
    val zone = safeZone(zoneId)
    val locale = safeLocale(localeTag)
    return when (variant) {
        DateTimeVariant.Relative -> DateTimeDisplay.Relative(relativeTimeOf(instant, nowMillis, zone, locale))
        DateTimeVariant.Date -> DateTimeDisplay.Text(formatAbsoluteDate(instant, zone, locale))
        DateTimeVariant.Time -> DateTimeDisplay.Text(formatAbsoluteTime(instant, zone, locale))
        DateTimeVariant.Short -> DateTimeDisplay.Text(formatShort(instant, zone, locale))
        DateTimeVariant.Full -> DateTimeDisplay.Text(formatFull(instant, zone, locale))
    }
}

/** Full date + time (web `formatDateTime`: medium date + short time, e.g. "Apr 4, 2026, 2:30 PM"). */
private fun formatFull(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String =
    DateTimeFormatter
        .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
        .withLocale(locale)
        .format(instant.atZone(zone))

/** Date only (web `formatDate`: medium date, e.g. "Apr 4, 2026"). */
private fun formatAbsoluteDate(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String = DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale).format(instant.atZone(zone))

/** Time only (web `formatTime`: short time, e.g. "2:30 PM"). */
private fun formatAbsoluteTime(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String = DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(locale).format(instant.atZone(zone))

/** Short month + day (web `formatDateShort`, e.g. "Apr 4"). */
private fun formatShort(
    instant: Instant,
    zone: ZoneId,
    locale: Locale,
): String = DateTimeFormatter.ofPattern("MMM d", locale).format(instant.atZone(zone))

/**
 * Buckets the age of [instant] against [nowMillis] — the native port of web `formatRelativeTime`: under a
 * minute → [RelativeTime.JustNow]; under an hour → [RelativeTime.Minutes]; under a day → [RelativeTime.Hours];
 * otherwise the absolute short date + time ([RelativeTime.Absolute], web's `toLocaleDateString` fallback). A
 * future instant (negative age) buckets to [RelativeTime.JustNow], matching the web `diffMin < 1` branch.
 */
private fun relativeTimeOf(
    instant: Instant,
    nowMillis: Long,
    zone: ZoneId,
    locale: Locale,
): RelativeTime {
    val diffMinutes = Math.floorDiv(nowMillis - instant.toEpochMilli(), MINUTE_MILLIS)
    val diffHours = diffMinutes / MINUTES_PER_HOUR
    return when {
        diffMinutes < 1 -> RelativeTime.JustNow
        diffMinutes < MINUTES_PER_HOUR -> RelativeTime.Minutes(diffMinutes.toInt())
        diffHours < HOURS_PER_DAY -> RelativeTime.Hours(diffHours.toInt())
        else -> RelativeTime.Absolute("${formatShort(instant, zone, locale)}, ${formatAbsoluteTime(instant, zone, locale)}")
    }
}

/**
 * Returns the short timezone abbreviation (e.g. "PST", "PDT") for [value] in [zoneId] — the native port of web
 * `tzAbbreviation`. DST-aware (it reads the abbreviation at the instant), [localeTag]-localized, and tolerant:
 * a null/invalid value or zone yields an empty string so the trailing abbreviation slot is simply omitted.
 */
fun tzAbbreviation(
    value: String?,
    zoneId: String,
    localeTag: String,
): String {
    val instant = parseInstant(value) ?: return ""
    return runCatching {
        DateTimeFormatter.ofPattern("zzz", safeLocale(localeTag)).format(instant.atZone(safeZone(zoneId)))
    }.getOrDefault("")
}

/**
 * Builds the canonical, unambiguous ISO-8601 label the web component hovers as its `title` attribute
 * (`d.toISOString()`, suffixed `" (tz)"` when a zone is in force). Surfaced by the view as a long-press
 * tooltip. A null/invalid [value] yields `null` (no tooltip), matching the web `if (value) { … }` guard.
 */
fun isoTitle(
    value: String?,
    zoneId: String? = null,
): String? {
    val instant = parseInstant(value) ?: return null
    val iso = DateTimeFormatter.ISO_INSTANT.format(instant)
    return if (zoneId != null) "$iso ($zoneId)" else iso
}

/**
 * The zone-resolution inputs the surface reads from the three bound hooks — the projected payload of the
 * combined `useSettings` + `useSelectedVehicle` feeds (`useTimezone` is applied at the render boundary by
 * [effectiveZoneId]). Always resolvable: a missing settings document / unpolled vehicle degrades each field to
 * its web default so the timestamp still renders.
 *
 * @property tzDisplayDefault the user's default mode (`settings.tz_display_default`), [TzMode.Vehicle] default.
 * @property userTimezone the user's optional IANA override (`settings.timezone_user`); `null` when blank.
 * @property localeTag the resolved BCP-47 locale (`resolveLocale(settings.locale)`).
 * @property vehicleTimezone the active vehicle's reported IANA zone; `null` when no vehicle / blank.
 */
data class DateTimeSettings(
    val tzDisplayDefault: TzMode,
    val userTimezone: String?,
    val localeTag: String,
    val vehicleTimezone: String?,
) {
    companion object {
        /** The web defaults used before any settings/vehicle have loaded (`tz_display_default: 'vehicle'`, …). */
        val DEFAULTS: DateTimeSettings = DateTimeSettings(TzMode.Vehicle, null, DEFAULT_LOCALE_TAG, null)
    }
}

private const val KEY_TZ_DISPLAY_DEFAULT: String = "tz_display_default"
private const val KEY_TIMEZONE_USER: String = "timezone_user"
private const val KEY_LOCALE: String = "locale"

private fun JsonObject?.stringField(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull

/**
 * Projects the raw `/settings` document + the active [selectedVehicle] onto [DateTimeSettings] — the native
 * analogue of what the web `DateTimeWithTz` reads from `useSettings()` + `useSelectedVehicle()`. Mirrors the
 * web key handling: `tz_display_default` parsed (default vehicle), `timezone_user` blank → `null`, `locale`
 * resolved via [resolveLocaleTag], the vehicle's `timezone` carried through (blank → `null`).
 */
fun dateTimeSettingsFrom(
    settingsDoc: JsonElement?,
    selectedVehicle: Vehicle?,
): DateTimeSettings {
    val obj = settingsDoc as? JsonObject
    return DateTimeSettings(
        tzDisplayDefault = TzMode.fromWire(obj.stringField(KEY_TZ_DISPLAY_DEFAULT)),
        userTimezone = obj.stringField(KEY_TIMEZONE_USER)?.takeIf { it.isNotBlank() },
        localeTag = resolveLocaleTag(obj.stringField(KEY_LOCALE)),
        vehicleTimezone = selectedVehicle?.timezone?.takeIf { it.isNotBlank() },
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
 * [Resource] of the projected [DateTimeSettings], preserving the ADR-013 envelope so the downstream [UiState]
 * still drives loading / content / stale / offline / error. The config is always computable (each absent input
 * degrades to its web default), so:
 *  - either feed hard-failed AND neither has any cached value → a hard [Resource.Error] (cold offline start);
 *  - either feed hard-failed WITH some cache → [Resource.Error] carrying the last-known config (offline);
 *  - either feed is loading AND neither has any cache → first-load [Resource.Loading];
 *  - either feed is loading WITH some cache → refreshing [Resource.Loading] over the cached config;
 *  - both succeeded → [Resource.Success].
 *
 * The combined staleness is the OR of the two feeds, and the freshness stamp is the newer of the two — so a
 * stale settings doc taints the whole surface even when the vehicle list is fresh.
 */
fun combineZoneResources(
    settings: Resource<JsonElement>,
    vehicles: Resource<List<Vehicle>>,
    storedSelectedId: Long?,
): Resource<DateTimeSettings> {
    val config =
        dateTimeSettingsFrom(settings.cached, vehicles.cached?.let { selectedVehicleOf(it, storedSelectedId) })
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
 * labelling the zone-resolution feed's posture (ADR-013, so cached zones are never presented as live):
 *  - [Failed] a hard error with no cached config (a retry affordance);
 *  - [Offline] cached config shown after a failed refresh (a last-known + retry chip);
 *  - [Updating] a refresh in flight over a cached config;
 *  - [Stale] the cached config passed its TTL;
 *  - [Fresh] live — nothing is shown.
 */
enum class DateTimeFreshness { Fresh, Updating, Stale, Offline, Failed }

/** Selects the [DateTimeFreshness] from the zone feed's [state] — failure first, then offline, then refresh. */
fun dateTimeFreshness(state: UiState<DateTimeSettings>): DateTimeFreshness =
    when {
        state.isError -> DateTimeFreshness.Failed
        state.hasError && state.hasData -> DateTimeFreshness.Offline
        state.refreshing -> DateTimeFreshness.Updating
        state.stale -> DateTimeFreshness.Stale
        else -> DateTimeFreshness.Fresh
    }

/**
 * The effective [TzMode] for a render — the web `mode ?? settings.tz_display_default ?? 'vehicle'`: the
 * explicit per-call [explicit] (web `in` prop) wins, else the user's [DateTimeSettings.tzDisplayDefault], else
 * [TzMode.Vehicle] while settings are still loading.
 */
fun effectiveTzMode(
    explicit: TzMode?,
    settings: DateTimeSettings?,
): TzMode = explicit ?: settings?.tzDisplayDefault ?: TzMode.Vehicle

/**
 * The effective IANA zone for a render — applies [resolveZone] (the `useTimezone` fold) to the [effectiveTzMode]
 * over the bound [settings] + the platform [deviceZone]. While settings/vehicle are still loading the vehicle
 * + user inputs are absent, so this degrades to the device zone (or literal UTC under [TzMode.Utc]).
 */
fun effectiveZoneId(
    explicit: TzMode?,
    settings: DateTimeSettings?,
    deviceZone: String,
): String = resolveZone(effectiveTzMode(explicit, settings), settings?.vehicleTimezone, settings?.userTimezone, deviceZone)

/** The effective BCP-47 locale — the bound `settings.locale`, else the resolved [deviceLocaleTag] (web browser locale). */
fun effectiveLocaleTag(
    settings: DateTimeSettings?,
    deviceLocaleTag: String,
): String = settings?.localeTag ?: resolveLocaleTag(deviceLocaleTag)

/**
 * Folds the rendered [display] text, the optional [abbrev] timezone tag, and the optional localized [status]
 * word (offline / stale / updating) into the single TalkBack content description the inline element exposes —
 * "{display} {abbrev}, {status}". Pure so the a11y label is asserted off-device.
 */
fun dateTimeContentDescription(
    display: String,
    abbrev: String?,
    status: String?,
): String =
    buildString {
        append(display)
        if (!abbrev.isNullOrBlank()) append(' ').append(abbrev)
        if (!status.isNullOrBlank()) append(", ").append(status)
    }

/**
 * Classifies a zone-feed failure into the recovery-oriented [QueryErrorKind] — the same fold the sibling
 * surfaces use: offline/timeout → not-online; circuit-open → the transient "waiting" state; otherwise the HTTP
 * status selects the copy.
 */
fun dateTimeErrorKind(
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
 * the byte-identical `palette.recent.*` keys (`%1$dm ago` / `%1$dh ago` / `Just now` match web
 * `formatRelativeTime` verbatim), and the retry affordance reuses `common.retry`. Every name below exists in
 * `values/`, `values-ar/` and `values-he/` (asserted by name in the unit test; resource bytes are not read
 * off-device).
 */
object DateTimeKeys {
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

    /** Relative "just now" — the web `formatRelativeTime` `'Just now'`. */
    const val JUST_NOW: String = "translation_palette_recent_justNow"

    /** Relative minutes plural — the web `${diffMin}m ago` (`%1$dm ago`). */
    const val MINUTES_AGO: String = "translation_palette_recent_minutesAgo"

    /** Relative hours plural — the web `${diffHrs}h ago` (`%1$dh ago`). */
    const val HOURS_AGO: String = "translation_palette_recent_hoursAgo"
}

/** The English source strings the web `t(key, default)` calls fall back to (off-device contract). */
object DateTimeDefaults {
    const val OFFLINE: String = "Offline"
    const val STALE: String = "Stale"
    const val UPDATING: String = "updating…"
    const val JUST_NOW: String = "Just now"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [DateTimeRegistration.SLUG]
 * (P1/S11) — never a timestamp, vehicle id, or zone, so a diagnostics line can never leak the operator's data.
 * Kept free of Compose so it is unit-tested with a recording [Logger]; the ViewModel calls it once per open.
 */
fun recordDateTimeOpened(logger: Logger) {
    logger.info(DATE_TIME_VIEW_OPENED_EVENT, mapOf("surface" to DateTimeRegistration.SLUG))
}
