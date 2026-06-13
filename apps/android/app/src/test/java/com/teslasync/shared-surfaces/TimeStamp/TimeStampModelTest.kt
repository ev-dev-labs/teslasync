// Off-device unit coverage for the TimeStamp surface's pure model (P3 acceptance: adapter + per-state + a11y
// label tests). Exercises the timezone / locale resolution that mirrors web `resolveTimezone` / `resolveLocale`,
// the absolute + relative format faces (web `formatDateTime` + `formatRelative`, including the lowercase
// "just now", the days bucket, and the over-a-week absolute-date fall through), the format-preference
// resolution (web `useTimeFormatPreference` + the `format === 'auto' ? pref : format` fold), the primary /
// tooltip pairing (web `<Tooltip content={secondary}>{primary}</Tooltip>`), the settings + vehicle → config
// projection (the adapter), the combined cache-then-network resource mapped through the shared `toUiState`
// (per-state coverage: loading / content / stale / offline / error), the freshness classifier, the
// accessibility content-description fold (a11y label coverage), the recovery error-kind mapper, the reused
// i18n key/default contract, and the PII-safe `view.opened` diagnostic. No Compose / Android framework / HTTP —
// runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.timestamp

import io.teslasync.android.components.feedback.QueryErrorKind
import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.time.Instant

class TimeStampModelTest {
    private companion object {
        const val UTC_VALUE = "2026-04-04T14:30:00Z"
        const val LA_ZONE = "America/Los_Angeles"
        const val NY_ZONE = "America/New_York"
        const val HOUR_MILLIS = 60L * 60L * 1000L
        const val DAY_MILLIS = 24L * HOUR_MILLIS
    }

    private fun vehicle(
        id: Long,
        tz: String = "UTC",
        name: String = "Car $id",
    ): Vehicle =
        Vehicle(
            createdAt = Instant.parse("2026-01-01T00:00:00Z"),
            displayName = name,
            enrolledAt = Instant.parse("2026-01-01T00:00:00Z"),
            id = id,
            teslaId = 1000 + id,
            timezone = tz,
            updatedAt = Instant.parse("2026-01-01T00:10:00Z"),
            vin = "VIN$id",
        )

    private fun settingsDoc(
        tzDefault: String? = null,
        timezoneUser: String? = null,
        locale: String? = null,
        timeFormat: String? = null,
    ): JsonElement =
        buildJsonObject {
            if (tzDefault != null) put("tz_display_default", tzDefault)
            if (timezoneUser != null) put("timezone_user", timezoneUser)
            if (locale != null) put("locale", locale)
            if (timeFormat != null) put("time_format_default", timeFormat)
        }

    private fun baseMillis(): Long = requireNotNull(parseInstant(UTC_VALUE)).toEpochMilli()

    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("time-stamp", TimeStampRegistration.ID)
        assertEquals("TimeStamp", TimeStampRegistration.SLUG)
        assertEquals("view.opened", TIME_STAMP_VIEW_OPENED_EVENT)
        assertEquals("\u2014", EM_DASH)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        assertEquals("translation_common_offline", TimeStampKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", TimeStampKeys.STALE)
        assertEquals("translation_freshness_updating", TimeStampKeys.UPDATING)
        assertEquals("translation_common_loading", TimeStampKeys.LOADING)
        assertEquals("translation_common_retry", TimeStampKeys.RETRY)
        assertEquals("translation_freshness_justNow", TimeStampKeys.JUST_NOW)
        assertEquals("translation_palette_recent_minutesAgo", TimeStampKeys.MINUTES_AGO)
        assertEquals("translation_palette_recent_hoursAgo", TimeStampKeys.HOURS_AGO)
        assertEquals("translation_palette_recent_daysAgo", TimeStampKeys.DAYS_AGO)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Offline", TimeStampDefaults.OFFLINE)
        assertEquals("Stale", TimeStampDefaults.STALE)
        assertEquals("updating…", TimeStampDefaults.UPDATING)
        assertEquals("just now", TimeStampDefaults.JUST_NOW)
    }

    // ── resolveLocale / TzMode / TimeFormat parsing (web resolveLocale + settings tokens) ──

    @Test
    fun resolveLocaleTagFallsBackForBlankAndTrimsOtherwise() {
        assertEquals("en-US", resolveLocaleTag(null))
        assertEquals("en-US", resolveLocaleTag(""))
        assertEquals("en-US", resolveLocaleTag("   "))
        assertEquals("fr-FR", resolveLocaleTag("fr-FR"))
        assertEquals("de-DE", resolveLocaleTag("  de-DE  "))
    }

    @Test
    fun tzModeFromWireMirrorsWebTokensAndDefaultsToVehicle() {
        assertEquals(TzMode.Utc, TzMode.fromWire("utc"))
        assertEquals(TzMode.User, TzMode.fromWire("user"))
        assertEquals(TzMode.Vehicle, TzMode.fromWire("vehicle"))
        assertEquals(TzMode.Vehicle, TzMode.fromWire("weird"))
        assertEquals(TzMode.Vehicle, TzMode.fromWire(null))
        assertEquals(TzMode.Utc, TzMode.fromWire(" UTC "))
    }

    @Test
    fun timeFormatFromWireOnlyAbsoluteSwitchesElseRelative() {
        assertEquals(TimeFormat.Absolute, TimeFormat.fromWire("absolute"))
        assertEquals(TimeFormat.Absolute, TimeFormat.fromWire("  ABSOLUTE  "))
        assertEquals(TimeFormat.Relative, TimeFormat.fromWire("relative"))
        assertEquals(TimeFormat.Relative, TimeFormat.fromWire("weird"))
        assertEquals(TimeFormat.Relative, TimeFormat.fromWire(""))
        assertEquals(TimeFormat.Relative, TimeFormat.fromWire(null))
    }

    // ── resolveTimezone fold (web resolveTimezone) ───────────────────────────────────

    @Test
    fun resolveZoneUtcModeIsAlwaysUtc() {
        assertEquals("UTC", resolveZone(TzMode.Utc, LA_ZONE, NY_ZONE, "Europe/Paris"))
    }

    @Test
    fun resolveZoneUserModePrefersOverrideThenDevice() {
        assertEquals(NY_ZONE, resolveZone(TzMode.User, LA_ZONE, NY_ZONE, "Europe/Paris"))
        assertEquals("Europe/Paris", resolveZone(TzMode.User, LA_ZONE, null, "Europe/Paris"))
        assertEquals("Europe/Paris", resolveZone(TzMode.User, LA_ZONE, "  ", "Europe/Paris"))
    }

    @Test
    fun resolveZoneVehicleModeFallsBackWhenVehicleZoneIsBlankOrUtc() {
        assertEquals(LA_ZONE, resolveZone(TzMode.Vehicle, LA_ZONE, NY_ZONE, "Europe/Paris"))
        assertEquals(NY_ZONE, resolveZone(TzMode.Vehicle, null, NY_ZONE, "Europe/Paris"))
        assertEquals(NY_ZONE, resolveZone(TzMode.Vehicle, "UTC", NY_ZONE, "Europe/Paris"))
        assertEquals("Europe/Paris", resolveZone(TzMode.Vehicle, "", null, "Europe/Paris"))
    }

    // ── parseInstant (web new Date(value)) ───────────────────────────────────────────

    @Test
    fun parseInstantToleratesEveryShapeAndRejectsGarbage() {
        assertEquals(Instant.parse(UTC_VALUE).toEpochMilliseconds(), requireNotNull(parseInstant(UTC_VALUE)).toEpochMilli())
        assertTrue(parseInstant("2026-04-04T14:30:00+02:00") != null)
        assertTrue(parseInstant("2026-04-04T14:30:00") != null)
        assertTrue(parseInstant("2026-04-04") != null)
        assertNull(parseInstant(null))
        assertNull(parseInstant(""))
        assertNull(parseInstant("   "))
        assertNull(parseInstant("not-a-date"))
    }

    // ── empty marker + format-face pairing (web bare span + Tooltip pairing) ──────────

    @Test
    fun nullOrInvalidValueResolvesToEmptyForEveryFormat() {
        listOf(TimeFormat.Relative, TimeFormat.Absolute).forEach { format ->
            assertEquals(TimeStampDisplay.Empty, resolveTimeStampDisplay(null, format, "UTC", "en-US", baseMillis()))
            assertEquals(TimeStampDisplay.Empty, resolveTimeStampDisplay("garbage", format, "UTC", "en-US", baseMillis()))
        }
    }

    private fun rendered(
        format: TimeFormat,
        value: String? = UTC_VALUE,
        zone: String = "UTC",
        now: Long = baseMillis(),
    ): TimeStampDisplay.Rendered = resolveTimeStampDisplay(value, format, zone, "en-US", now) as TimeStampDisplay.Rendered

    @Test
    fun relativeFormatShowsRelativeWithAbsoluteOnTheTooltip() {
        val display = rendered(TimeFormat.Relative, now = baseMillis() + 2L * HOUR_MILLIS)
        assertTrue(display.primary is TimePhrase.Relative)
        assertTrue(display.secondary is TimePhrase.Absolute)
    }

    @Test
    fun absoluteFormatShowsAbsoluteWithRelativeOnTheTooltip() {
        val display = rendered(TimeFormat.Absolute, now = baseMillis() + 2L * HOUR_MILLIS)
        assertTrue(display.primary is TimePhrase.Absolute)
        assertTrue(display.secondary is TimePhrase.Relative)
    }

    // ── absolute face (web formatDateTime: medium date + short time) ──────────────────

    private fun absoluteFace(
        value: String? = UTC_VALUE,
        zone: String = "UTC",
    ): String = (rendered(TimeFormat.Absolute, value = value, zone = zone).primary as TimePhrase.Absolute).value

    @Test
    fun absoluteFaceRendersDateAndTime() {
        val absolute = absoluteFace()
        assertTrue(absolute, absolute.contains("Apr"))
        assertTrue(absolute, absolute.contains("2026"))
        assertTrue(absolute, absolute.contains(":"))
    }

    @Test
    fun zoneChangesTheRenderedWallClock() {
        assertTrue(absoluteFace(zone = "UTC") != absoluteFace(zone = NY_ZONE))
    }

    // ── relative buckets (web formatRelative thresholds) ─────────────────────────────

    private fun relativeAge(now: Long): RelativeAge = (rendered(TimeFormat.Relative, now = now).primary as TimePhrase.Relative).age

    @Test
    fun relativeUnderAMinuteIsJustNow() {
        assertEquals(RelativeAge.JustNow, relativeAge(baseMillis() + 30_000L))
    }

    @Test
    fun relativeFutureInstantIsJustNow() {
        assertEquals(RelativeAge.JustNow, relativeAge(baseMillis() - 5L * 60_000L))
    }

    @Test
    fun relativeUnderAnHourIsMinutes() {
        assertEquals(RelativeAge.Minutes(5), relativeAge(baseMillis() + 5L * 60_000L))
    }

    @Test
    fun relativeUnderADayIsHours() {
        assertEquals(RelativeAge.Hours(2), relativeAge(baseMillis() + 2L * HOUR_MILLIS))
    }

    @Test
    fun relativeUnderAWeekIsDays() {
        assertEquals(RelativeAge.Days(3), relativeAge(baseMillis() + 3L * DAY_MILLIS))
    }

    @Test
    fun relativeOverAWeekIsAbsoluteMediumDate() {
        val age = relativeAge(baseMillis() + 8L * DAY_MILLIS)
        assertTrue(age is RelativeAge.AbsoluteDate)
        val value = (age as RelativeAge.AbsoluteDate).value
        assertTrue(value, value.contains("Apr"))
        assertTrue(value, value.contains("2026"))
        assertFalse(value, value.contains(":"))
    }

    // ── settings projection adapter (cached doc + vehicle → config) ───────────────────

    @Test
    fun timeStampSettingsFromReadsEveryFieldFromTheDocument() {
        val doc = settingsDoc(tzDefault = "user", timezoneUser = "Europe/Paris", locale = "fr-FR", timeFormat = "absolute")
        val settings = timeStampSettingsFrom(doc, vehicle(1, tz = LA_ZONE))
        assertEquals(TzMode.User, settings.tzDisplayDefault)
        assertEquals("Europe/Paris", settings.userTimezone)
        assertEquals("fr-FR", settings.localeTag)
        assertEquals(LA_ZONE, settings.vehicleTimezone)
        assertEquals(TimeFormat.Absolute, settings.timeFormatDefault)
    }

    @Test
    fun timeStampSettingsFromDegradesToWebDefaults() {
        val settings = timeStampSettingsFrom(null, null)
        assertEquals(TimeStampSettings.DEFAULTS, settings)
        assertEquals(TzMode.Vehicle, settings.tzDisplayDefault)
        assertNull(settings.userTimezone)
        assertEquals("en-US", settings.localeTag)
        assertNull(settings.vehicleTimezone)
        assertEquals(TimeFormat.Relative, settings.timeFormatDefault)
    }

    @Test
    fun timeStampSettingsFromBlankOverridesDropToNullAndDefault() {
        val settings = timeStampSettingsFrom(settingsDoc(timezoneUser = "  ", locale = "", timeFormat = " "), vehicle(1, tz = "  "))
        assertNull(settings.userTimezone)
        assertEquals("en-US", settings.localeTag)
        assertNull(settings.vehicleTimezone)
        assertEquals(TimeFormat.Relative, settings.timeFormatDefault)
    }

    @Test
    fun selectedVehicleResolutionMirrorsStoreThenFirst() {
        val fleet = listOf(vehicle(5), vehicle(6))
        assertEquals(6L, selectedVehicleOf(fleet, storedSelectedId = 6L)?.id)
        assertEquals(5L, selectedVehicleOf(fleet, storedSelectedId = 99L)?.id)
        assertEquals(5L, selectedVehicleOf(fleet, storedSelectedId = null)?.id)
        assertEquals(5L, selectedVehicleOf(fleet, storedSelectedId = 0L)?.id)
        assertNull(selectedVehicleOf(emptyList(), storedSelectedId = 5L))
    }

    // ── combined cache-then-network projection per state (web feeds → UiState) ───────

    private fun loading(): Resource<JsonElement> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    private fun vehiclesLoading(): Resource<List<Vehicle>> = Resource.Loading(cached = null, fetchedAt = null, stale = false)

    @Test
    fun bothLoadingWithNoCacheIsLoadingPhase() {
        val state = combineSettings(loading(), vehiclesLoading(), null).toUiState { false }
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun bothSuccessIsContentWithResolvedConfig() {
        val settings = Resource.Success(settingsDoc(locale = "fr-FR", timeFormat = "absolute"), fetchedAt = 10L, stale = false)
        val vehicles = Resource.Success(listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 12L, stale = false)
        val state = combineSettings(settings, vehicles, storedSelectedId = 1L).toUiState { false }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals("fr-FR", state.data?.localeTag)
        assertEquals(LA_ZONE, state.data?.vehicleTimezone)
        assertEquals(TimeFormat.Absolute, state.data?.timeFormatDefault)
    }

    @Test
    fun loadingWithCachedSettingsKeepsContentWhileRefreshing() {
        val settings = Resource.Success(settingsDoc(locale = "fr-FR"), fetchedAt = 10L, stale = false)
        val vehicles = Resource.Loading(cached = listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 8L, stale = false)
        val state = combineSettings(settings, vehicles, storedSelectedId = 1L).toUiState { false }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertEquals(LA_ZONE, state.data?.vehicleTimezone)
    }

    @Test
    fun bothErrorWithNoCacheIsHardErrorPhase() {
        val settings = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val vehicles = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val state = combineSettings(settings, vehicles, null).toUiState { false }
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
        assertFalse(state.hasData)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun errorWithCachedConfigStaysContentAsOfflineWithRetry() {
        val settings = Resource.Error(cached = settingsDoc(locale = "fr-FR"), fetchedAt = 10L, stale = true, error = ApiError.Network())
        val vehicles = Resource.Success(listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 12L, stale = false)
        val state = combineSettings(settings, vehicles, storedSelectedId = 1L).toUiState { false }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals("fr-FR", state.data?.localeTag)
        assertTrue(state.stale)
        assertTrue(state.isOffline)
        assertTrue(state.canRetry)
    }

    // ── freshness classifier + effective resolution + a11y fold ──────────────────────

    private fun contentState(
        stale: Boolean = false,
        refreshing: Boolean = false,
        errorKind: ErrorKind? = null,
    ): UiState<TimeStampSettings> =
        UiState(
            phase = UiPhase.Content,
            data = TimeStampSettings.DEFAULTS,
            fetchedAt = 0L,
            stale = stale,
            refreshing = refreshing,
            errorKind = errorKind,
        )

    @Test
    fun freshnessClassifierCoversEveryState() {
        assertEquals(TimeStampFreshness.Failed, timeStampFreshness(UiState(UiPhase.Error, errorKind = ErrorKind.Http)))
        assertEquals(TimeStampFreshness.Offline, timeStampFreshness(contentState(stale = true, errorKind = ErrorKind.Network)))
        assertEquals(TimeStampFreshness.Updating, timeStampFreshness(contentState(refreshing = true)))
        assertEquals(TimeStampFreshness.Stale, timeStampFreshness(contentState(stale = true)))
        assertEquals(TimeStampFreshness.Fresh, timeStampFreshness(contentState()))
    }

    @Test
    fun effectiveTimeFormatAppliesWebPrecedence() {
        assertEquals(TimeFormat.Relative, effectiveTimeFormat(TimeStampFormat.Relative, TimeStampSettings.DEFAULTS))
        assertEquals(TimeFormat.Absolute, effectiveTimeFormat(TimeStampFormat.Absolute, TimeStampSettings.DEFAULTS))
        assertEquals(
            TimeFormat.Absolute,
            effectiveTimeFormat(TimeStampFormat.Auto, TimeStampSettings.DEFAULTS.copy(timeFormatDefault = TimeFormat.Absolute)),
        )
        assertEquals(TimeFormat.Relative, effectiveTimeFormat(TimeStampFormat.Auto, TimeStampSettings.DEFAULTS))
        assertEquals(TimeFormat.Relative, effectiveTimeFormat(TimeStampFormat.Auto, null))
    }

    @Test
    fun effectiveTzModeAppliesWebPrecedence() {
        assertEquals(TzMode.User, effectiveTzMode(TzMode.User, TimeStampSettings.DEFAULTS))
        assertEquals(TzMode.Utc, effectiveTzMode(null, TimeStampSettings.DEFAULTS.copy(tzDisplayDefault = TzMode.Utc)))
        assertEquals(TzMode.Vehicle, effectiveTzMode(null, null))
    }

    @Test
    fun effectiveZoneAppliesResolveTimezoneOverTheFeed() {
        assertEquals("UTC", effectiveZoneId(TzMode.Utc, TimeStampSettings.DEFAULTS, "Europe/Paris"))
        val withVehicle = TimeStampSettings(TzMode.Vehicle, null, "en-US", NY_ZONE, TimeFormat.Relative)
        assertEquals(NY_ZONE, effectiveZoneId(null, withVehicle, "Europe/Paris"))
        val withUser = TimeStampSettings(TzMode.Vehicle, "Asia/Tokyo", "en-US", null, TimeFormat.Relative)
        assertEquals("Asia/Tokyo", effectiveZoneId(null, withUser, "Europe/Paris"))
        assertEquals("Europe/Paris", effectiveZoneId(null, null, "Europe/Paris"))
    }

    @Test
    fun effectiveLocalePrefersFeedThenDevice() {
        assertEquals("fr-FR", effectiveLocaleTag(TimeStampSettings.DEFAULTS.copy(localeTag = "fr-FR"), "en-US"))
        assertEquals("de-DE", effectiveLocaleTag(null, "de-DE"))
        assertEquals("en-US", effectiveLocaleTag(null, ""))
    }

    @Test
    fun contentDescriptionFoldsPrimaryAndStatus() {
        assertEquals("2h ago, Offline", timeStampContentDescription("2h ago", "Offline"))
        assertEquals("Apr 4, 2026, 2:30 PM", timeStampContentDescription("Apr 4, 2026, 2:30 PM", null))
        assertEquals("\u2014", timeStampContentDescription("\u2014", ""))
    }

    @Test
    fun errorKindMapsFailuresToRecoveryCopy() {
        assertEquals(QueryErrorKind.Offline, timeStampErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, timeStampErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, timeStampErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, timeStampErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, timeStampErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, timeStampErrorKind(ErrorKind.Unknown, null))
    }

    // ── diagnostics: one PII-safe view.opened ────────────────────────────────────────

    @Test
    fun recordViewOpenedEmitsPiiSafeSurfaceSlug() {
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordTimeStampOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        assertEquals(mapOf("surface" to "TimeStamp"), records[0].fields)
    }
}
