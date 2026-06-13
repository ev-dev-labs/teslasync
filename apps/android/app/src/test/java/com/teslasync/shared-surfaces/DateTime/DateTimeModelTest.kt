// Off-device unit coverage for the DateTime surface's pure model (P3 acceptance: adapter + per-state + a11y
// label tests). Exercises the timezone / locale resolution that mirrors web `resolveTimezone` / `resolveLocale`,
// the five variant formatters + the universal em-dash marker (web `dateFormat.ts`), the relative-time bucketing
// (web `formatRelativeTime`), the settings + vehicle → zone-config projection (the adapter), the combined
// cache-then-network resource mapped through the shared `toUiState` (per-state coverage: loading / content /
// stale / offline / error), the freshness classifier, the accessibility content-description fold (a11y label
// coverage), the recovery error-kind mapper, the reused i18n key/default contract, and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.datetime

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

class DateTimeModelTest {
    private companion object {
        const val UTC_VALUE = "2026-04-04T14:30:00Z"
        const val LA_ZONE = "America/Los_Angeles"
        const val NY_ZONE = "America/New_York"
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
    ): JsonElement =
        buildJsonObject {
            if (tzDefault != null) put("tz_display_default", tzDefault)
            if (timezoneUser != null) put("timezone_user", timezoneUser)
            if (locale != null) put("locale", locale)
        }

    private fun baseMillis(): Long = requireNotNull(parseInstant(UTC_VALUE)).toEpochMilli()

    // ── registration + i18n key/default contract mirrors the web source ──────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("date-time", DateTimeRegistration.ID)
        assertEquals("DateTime", DateTimeRegistration.SLUG)
        assertEquals("view.opened", DATE_TIME_VIEW_OPENED_EVENT)
        assertEquals("\u2014", EM_DASH)
    }

    @Test
    fun i18nKeysMapToCatalogResourceNames() {
        assertEquals("translation_common_offline", DateTimeKeys.OFFLINE)
        assertEquals("translation_mqtt_stale", DateTimeKeys.STALE)
        assertEquals("translation_freshness_updating", DateTimeKeys.UPDATING)
        assertEquals("translation_common_loading", DateTimeKeys.LOADING)
        assertEquals("translation_common_retry", DateTimeKeys.RETRY)
        assertEquals("translation_palette_recent_justNow", DateTimeKeys.JUST_NOW)
        assertEquals("translation_palette_recent_minutesAgo", DateTimeKeys.MINUTES_AGO)
        assertEquals("translation_palette_recent_hoursAgo", DateTimeKeys.HOURS_AGO)
    }

    @Test
    fun defaultsMirrorWebSourceStrings() {
        assertEquals("Offline", DateTimeDefaults.OFFLINE)
        assertEquals("Stale", DateTimeDefaults.STALE)
        assertEquals("updating…", DateTimeDefaults.UPDATING)
        assertEquals("Just now", DateTimeDefaults.JUST_NOW)
    }

    // ── resolveLocale / TzMode parsing (web resolveLocale + tz_display_default) ───────

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

    // ── parseInstant (web new Date(iso)) ─────────────────────────────────────────────

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

    // ── variant formatters + the em-dash empty marker (web dateFormat.ts) ────────────

    private fun text(
        variant: DateTimeVariant,
        zone: String = "UTC",
        value: String? = UTC_VALUE,
    ): String {
        val display = resolveDisplay(value, variant, zone, "en-US", baseMillis())
        return (display as DateTimeDisplay.Text).value
    }

    @Test
    fun nullOrInvalidValueResolvesToEmptyForEveryVariant() {
        DateTimeVariant.entries.forEach { variant ->
            assertEquals(DateTimeDisplay.Empty, resolveDisplay(null, variant, "UTC", "en-US", baseMillis()))
            assertEquals(DateTimeDisplay.Empty, resolveDisplay("garbage", variant, "UTC", "en-US", baseMillis()))
        }
    }

    @Test
    fun fullVariantRendersDateAndTime() {
        val full = text(DateTimeVariant.Full)
        assertTrue(full, full.contains("Apr"))
        assertTrue(full, full.contains("2026"))
        assertTrue(full, full.contains(":"))
    }

    @Test
    fun dateVariantRendersDateWithoutTime() {
        val date = text(DateTimeVariant.Date)
        assertTrue(date, date.contains("Apr"))
        assertTrue(date, date.contains("2026"))
        assertFalse(date, date.contains(":"))
    }

    @Test
    fun timeVariantRendersTimeWithoutYear() {
        val time = text(DateTimeVariant.Time)
        assertTrue(time, time.contains(":"))
        assertFalse(time, time.contains("2026"))
    }

    @Test
    fun shortVariantRendersMonthAndDayOnly() {
        val short = text(DateTimeVariant.Short)
        assertTrue(short, short.contains("Apr"))
        assertFalse(short, short.contains("2026"))
        assertFalse(short, short.contains(":"))
    }

    @Test
    fun zoneChangesTheRenderedWallClock() {
        assertTrue(text(DateTimeVariant.Full, zone = "UTC") != text(DateTimeVariant.Full, zone = NY_ZONE))
    }

    // ── relative buckets (web formatRelativeTime thresholds) ─────────────────────────

    private fun relative(nowMillis: Long): RelativeTime {
        val display = resolveDisplay(UTC_VALUE, DateTimeVariant.Relative, "UTC", "en-US", nowMillis)
        return (display as DateTimeDisplay.Relative).time
    }

    @Test
    fun relativeUnderAMinuteIsJustNow() {
        assertEquals(RelativeTime.JustNow, relative(baseMillis() + 30_000L))
    }

    @Test
    fun relativeFutureInstantIsJustNow() {
        assertEquals(RelativeTime.JustNow, relative(baseMillis() - 5L * 60_000L))
    }

    @Test
    fun relativeUnderAnHourIsMinutes() {
        assertEquals(RelativeTime.Minutes(5), relative(baseMillis() + 5L * 60_000L))
    }

    @Test
    fun relativeUnderADayIsHours() {
        assertEquals(RelativeTime.Hours(2), relative(baseMillis() + 2L * 60L * 60_000L))
    }

    @Test
    fun relativeOverADayIsAbsoluteShortDateTime() {
        val time = relative(baseMillis() + 25L * 60L * 60_000L)
        assertTrue(time is RelativeTime.Absolute)
        assertTrue((time as RelativeTime.Absolute).value.contains("Apr"))
    }

    // ── tzAbbreviation + isoTitle (web tzAbbreviation + title) ───────────────────────

    @Test
    fun tzAbbreviationIsNonBlankForValidZoneAndEmptyForBadInput() {
        assertTrue(tzAbbreviation(UTC_VALUE, LA_ZONE, "en-US").isNotBlank())
        assertEquals("", tzAbbreviation(null, LA_ZONE, "en-US"))
        assertEquals("", tzAbbreviation("garbage", LA_ZONE, "en-US"))
    }

    @Test
    fun isoTitleEmitsCanonicalInstantWithOptionalZoneSuffix() {
        assertEquals("2026-04-04T14:30:00Z", isoTitle(UTC_VALUE))
        assertEquals("2026-04-04T14:30:00Z ($LA_ZONE)", isoTitle(UTC_VALUE, LA_ZONE))
        assertNull(isoTitle(null))
        assertNull(isoTitle("garbage"))
    }

    // ── settings projection adapter (cached doc + vehicle → zone config) ─────────────

    @Test
    fun dateTimeSettingsFromReadsEveryFieldFromTheDocument() {
        val doc = settingsDoc(tzDefault = "user", timezoneUser = "Europe/Paris", locale = "fr-FR")
        val settings = dateTimeSettingsFrom(doc, vehicle(1, tz = LA_ZONE))
        assertEquals(TzMode.User, settings.tzDisplayDefault)
        assertEquals("Europe/Paris", settings.userTimezone)
        assertEquals("fr-FR", settings.localeTag)
        assertEquals(LA_ZONE, settings.vehicleTimezone)
    }

    @Test
    fun dateTimeSettingsFromDegradesToWebDefaults() {
        val settings = dateTimeSettingsFrom(null, null)
        assertEquals(DateTimeSettings.DEFAULTS, settings)
        assertEquals(TzMode.Vehicle, settings.tzDisplayDefault)
        assertNull(settings.userTimezone)
        assertEquals("en-US", settings.localeTag)
        assertNull(settings.vehicleTimezone)
    }

    @Test
    fun dateTimeSettingsFromBlankOverridesDropToNullAndDefault() {
        val settings = dateTimeSettingsFrom(settingsDoc(timezoneUser = "  ", locale = ""), vehicle(1, tz = "  "))
        assertNull(settings.userTimezone)
        assertEquals("en-US", settings.localeTag)
        assertNull(settings.vehicleTimezone)
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
        val state = combineZoneResources(loading(), vehiclesLoading(), null).toUiState { false }
        assertEquals(UiPhase.Loading, state.phase)
        assertNull(state.data)
    }

    @Test
    fun bothSuccessIsContentWithResolvedVehicleZone() {
        val settings = Resource.Success(settingsDoc(locale = "fr-FR"), fetchedAt = 10L, stale = false)
        val vehicles = Resource.Success(listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 12L, stale = false)
        val state = combineZoneResources(settings, vehicles, storedSelectedId = 1L).toUiState { false }
        assertEquals(UiPhase.Content, state.phase)
        assertEquals("fr-FR", state.data?.localeTag)
        assertEquals(LA_ZONE, state.data?.vehicleTimezone)
    }

    @Test
    fun loadingWithCachedSettingsKeepsContentWhileRefreshing() {
        val settings = Resource.Success(settingsDoc(locale = "fr-FR"), fetchedAt = 10L, stale = false)
        val vehicles = Resource.Loading(cached = listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 8L, stale = false)
        val state = combineZoneResources(settings, vehicles, storedSelectedId = 1L).toUiState { false }
        assertEquals(UiPhase.Content, state.phase)
        assertTrue(state.refreshing)
        assertEquals(LA_ZONE, state.data?.vehicleTimezone)
    }

    @Test
    fun bothErrorWithNoCacheIsHardErrorPhase() {
        val settings = Resource.Error<JsonElement>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val vehicles = Resource.Error<List<Vehicle>>(cached = null, fetchedAt = null, stale = false, error = ApiError.Network())
        val state = combineZoneResources(settings, vehicles, null).toUiState { false }
        assertEquals(UiPhase.Error, state.phase)
        assertTrue(state.hasError)
        assertFalse(state.hasData)
        assertEquals(ErrorKind.Network, state.errorKind)
    }

    @Test
    fun errorWithCachedConfigStaysContentAsOfflineWithRetry() {
        val settings = Resource.Error(cached = settingsDoc(locale = "fr-FR"), fetchedAt = 10L, stale = true, error = ApiError.Network())
        val vehicles = Resource.Success(listOf(vehicle(1, tz = LA_ZONE)), fetchedAt = 12L, stale = false)
        val state = combineZoneResources(settings, vehicles, storedSelectedId = 1L).toUiState { false }
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
    ): UiState<DateTimeSettings> =
        UiState(
            phase = UiPhase.Content,
            data = DateTimeSettings.DEFAULTS,
            fetchedAt = 0L,
            stale = stale,
            refreshing = refreshing,
            errorKind = errorKind,
        )

    @Test
    fun freshnessClassifierCoversEveryState() {
        assertEquals(DateTimeFreshness.Failed, dateTimeFreshness(UiState(UiPhase.Error, errorKind = ErrorKind.Http)))
        assertEquals(DateTimeFreshness.Offline, dateTimeFreshness(contentState(stale = true, errorKind = ErrorKind.Network)))
        assertEquals(DateTimeFreshness.Updating, dateTimeFreshness(contentState(refreshing = true)))
        assertEquals(DateTimeFreshness.Stale, dateTimeFreshness(contentState(stale = true)))
        assertEquals(DateTimeFreshness.Fresh, dateTimeFreshness(contentState()))
    }

    @Test
    fun effectiveModeAppliesWebPrecedence() {
        assertEquals(TzMode.User, effectiveTzMode(TzMode.User, DateTimeSettings.DEFAULTS))
        assertEquals(TzMode.Utc, effectiveTzMode(null, DateTimeSettings.DEFAULTS.copy(tzDisplayDefault = TzMode.Utc)))
        assertEquals(TzMode.Vehicle, effectiveTzMode(null, null))
    }

    @Test
    fun effectiveZoneAppliesResolveTimezoneOverTheFeed() {
        assertEquals("UTC", effectiveZoneId(TzMode.Utc, DateTimeSettings.DEFAULTS, "Europe/Paris"))
        val withVehicle = DateTimeSettings(TzMode.Vehicle, null, "en-US", NY_ZONE)
        assertEquals(NY_ZONE, effectiveZoneId(null, withVehicle, "Europe/Paris"))
        val withUser = DateTimeSettings(TzMode.Vehicle, "Asia/Tokyo", "en-US", null)
        assertEquals("Asia/Tokyo", effectiveZoneId(null, withUser, "Europe/Paris"))
        assertEquals("Europe/Paris", effectiveZoneId(null, null, "Europe/Paris"))
    }

    @Test
    fun effectiveLocalePrefersFeedThenDevice() {
        assertEquals("fr-FR", effectiveLocaleTag(DateTimeSettings.DEFAULTS.copy(localeTag = "fr-FR"), "en-US"))
        assertEquals("de-DE", effectiveLocaleTag(null, "de-DE"))
        assertEquals("en-US", effectiveLocaleTag(null, ""))
    }

    @Test
    fun contentDescriptionFoldsDisplayAbbrevAndStatus() {
        assertEquals("Apr 4, 2026 PST, Offline", dateTimeContentDescription("Apr 4, 2026", "PST", "Offline"))
        assertEquals("Apr 4", dateTimeContentDescription("Apr 4", null, null))
        assertEquals("Apr 4", dateTimeContentDescription("Apr 4", "", ""))
    }

    @Test
    fun errorKindMapsFailuresToRecoveryCopy() {
        assertEquals(QueryErrorKind.Offline, dateTimeErrorKind(ErrorKind.Network, null))
        assertEquals(QueryErrorKind.Offline, dateTimeErrorKind(ErrorKind.Timeout, null))
        assertEquals(QueryErrorKind.NotFound, dateTimeErrorKind(ErrorKind.Http, 404))
        assertEquals(QueryErrorKind.ServerError, dateTimeErrorKind(ErrorKind.Http, 500))
        assertEquals(QueryErrorKind.Waiting, dateTimeErrorKind(ErrorKind.CircuitOpen, null))
        assertEquals(QueryErrorKind.Network, dateTimeErrorKind(ErrorKind.Unknown, null))
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
        recordDateTimeOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        assertEquals(mapOf("surface" to "DateTime"), records[0].fields)
    }
}
