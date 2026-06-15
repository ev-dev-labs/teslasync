// Pure, framework-free model + projections for the EnergyProductsPage battery surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/battery/pages/EnergyProductsPage.tsx,
// the Powerwalls / Solar / Wall-Connector product-discovery dashboard). No Compose, no Android UI, no HTTP: every
// declaration here is plain Kotlin (it only references the framework-free UiState projection + shared-core Resource),
// so the composable stays a thin render layer and all of this is exercised off-device by the :android:testDebugUnitTest
// gate.
//
// The web page owns these concerns this file ports: (1) the decode of the two raw JSON envelopes the page reads — the
// `/tesla/energy-sites` catalog array and the per-site `/tesla/energy-sites/{id}/site-info` `{ data, fetched_at }`
// envelope — into typed, null-safe models (web optional-chaining → null-safe reads); (2) the four summary counts the
// header tiles show (web `sites.filter(...).length`); (3) the Wh→kWh / W→kW display scaling the web does inline
// (`fmtEnergy`/`fmtPower`), the charge/backup-reserve percentage formatting, and the localized fetched-timestamp
// (web `formatDateTime`); and (4) the inline value labels the web hardcodes (`operationModeLabel`/`resourceLabel`),
// mirrored verbatim so the surfaces agree.
//
// SI-canonical (Phase-48 / unit-conversion.instructions): `nameplate_power` is wire watts and `nameplate_energy` /
// `total_pack_energy` are wire watt-hours; they are scaled to kW / kWh at the display boundary here exactly as the web
// `… / 1000` does. No miles/mph/psi/°F ever appear. The only user preference applied is the locale used for grouped
// number + date formatting (web `fmtNumber`/`formatDateTime` read the active i18n locale).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/battery) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling BatteryHealthPage does.
// `TooManyFunctions` is suppressed for the parity-complete decode + projection set.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.battery.energyproducts

import io.teslasync.android.components.charts.ChartFormat
import io.teslasync.android.data.UnitPreferences
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The em dash shown for a missing value (web `'—'`). */
private const val EM_DASH = "\u2014"

/** Watts → kilowatts and watt-hours → kilowatt-hours (web `… / 1000`). */
private const val KILO = 1000.0

/** Energy + power render with one fraction digit at kW/kWh scale (web `fmtNumber(x / 1000, 1)`). */
private const val SCALED_DECIMALS = 1

/** Raw watt / watt-hour figures render whole (web `fmtNumber(x, 0)`). */
private const val WHOLE_DECIMALS = 0

/** Charge percentage renders with one fraction digit (web `fmtNumber(x, 1)`). */
private const val PERCENT_DECIMALS = 1

/** The wire `resource_type` values the page special-cases (web `resourceIcon`/`resourceLabel`). */
private const val RESOURCE_BATTERY = "battery"
private const val RESOURCE_SOLAR = "solar"

/** Inline resource labels the web hardcodes (`resourceLabel`) — not i18n keys, mirrored verbatim. */
private const val LABEL_POWERWALL = "Powerwall"
private const val LABEL_SOLAR = "Solar"

/** Inline operation-mode labels the web hardcodes (`operationModeLabel`) — not i18n keys, mirrored verbatim. */
private const val MODE_SELF_CONSUMPTION = "self_consumption"
private const val MODE_AUTONOMOUS = "autonomous"
private const val MODE_BACKUP = "backup"
private const val LABEL_SELF_POWERED = "Self-Powered"
private const val LABEL_TIME_BASED = "Time-Based Control"
private const val LABEL_BACKUP_ONLY = "Backup Only"

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `EnergyProductsPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("energyProducts", "/energy-products", …)`, so the host binds this surface to that destination (and its
 * `/energy-products` deep link) without the nav module depending on it.
 */
object EnergyProductsPageRegistration {
    /** The navigation destination id (Destinations.kt `page("energyProducts", "/energy-products", …)`). */
    const val ROUTE_ID: String = "energyProducts"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/energy-products"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no site identity. */
    const val SLUG: String = "EnergyProductsPage"
}

/** The discovered resource kind, mapped from the wire `resource_type` (web `resourceIcon`/`resourceLabel`). */
enum class EnergyResourceKind { Battery, Solar, Other }

/**
 * One decoded `/tesla/energy-sites` catalog row — the native analogue of the web `TeslaEnergySite` fields the page
 * reads. [packEnergyWh] + [percentageCharged] are nullable so an absent/JSON-null wire value collapses to the em-dash
 * exactly like the web optional-chaining; the capability booleans default to `false` (web `!!site.has_*`).
 */
data class EnergySite(
    val id: Long,
    val energySiteId: Long,
    val resourceType: String,
    val siteName: String,
    val packEnergyWh: Double?,
    val percentageCharged: Double?,
    val batteryType: String?,
    val backupCapable: Boolean,
    val stormModeEnabled: Boolean,
    val stormModeCapable: Boolean,
    val hasSolar: Boolean,
    val hasBattery: Boolean,
    val hasGrid: Boolean,
    val touCapable: Boolean,
    val fetchedAt: String?,
) {
    /** The resource kind driving the header icon + the "Type" label (web `resourceIcon`/`resourceLabel`). */
    val kind: EnergyResourceKind
        get() =
            when (resourceType) {
                RESOURCE_BATTERY -> EnergyResourceKind.Battery
                RESOURCE_SOLAR -> EnergyResourceKind.Solar
                else -> EnergyResourceKind.Other
            }
}

/** One boolean component flag from `site_info.components` — the web `Object.entries(components)` boolean badges. */
data class EnergyComponentFlag(
    val label: String,
    val active: Boolean,
)

/**
 * The decoded per-site `…/site-info` payload — the native analogue of the web `TeslaEnergySiteInfo` fields the
 * SiteInfoSection reads. All numerics are SI/raw on the wire (watts, watt-hours, whole percent); scaling to kW/kWh
 * happens at the render boundary. Each field is nullable so an absent / JSON-null wire value collapses to the em-dash
 * exactly like the web optional-chaining.
 */
data class EnergySiteInfo(
    val defaultRealMode: String?,
    val backupReservePercent: Double?,
    val batteryCount: Int?,
    val nameplatePowerW: Double?,
    val nameplateEnergyWh: Double?,
    val version: String?,
    val installationTimeZone: String?,
    val components: List<EnergyComponentFlag>,
    val touCapable: Boolean,
    val tariffName: String?,
    val fetchedAt: String?,
)

/**
 * The four header summary counts — the native analogue of the web `sites.length` + three `sites.filter(...).length`
 * tiles. Derived purely from the decoded catalog so the projection is unit-testable off-device.
 */
data class EnergyProductsSummary(
    val totalSites: Int,
    val withSolar: Int,
    val withBattery: Int,
    val backupCapable: Int,
) {
    companion object {
        /** The all-zero summary, surfaced before the catalog loads / when no site is discovered. */
        val EMPTY: EnergyProductsSummary = EnergyProductsSummary(0, 0, 0, 0)

        /** Folds the decoded [sites] into the four header counts (web `sites.filter(...).length`). */
        fun from(sites: List<EnergySite>): EnergyProductsSummary =
            EnergyProductsSummary(
                totalSites = sites.size,
                withSolar = sites.count { it.hasSolar },
                withBattery = sites.count { it.hasBattery },
                backupCapable = sites.count { it.backupCapable },
            )
    }
}

/**
 * The user's display preferences this surface needs — a deliberately narrow slice of the web `useFormatting` reads
 * from the `/settings` document: only the [locale] used for grouped-number + localized-date formatting (the page does
 * no unit conversion — energy/power are scaled W→kW / Wh→kWh verbatim, exactly like the web `fmtEnergy`/`fmtPower`).
 */
data class EnergyDisplayPrefs(
    val locale: Locale,
) {
    /** Energy as the web `fmtEnergy`: "{kWh} kWh" at ≥1 kWh, else "{Wh} Wh"; null → em-dash. */
    fun energy(wh: Double?): String {
        if (wh == null) return EM_DASH
        return if (wh >= KILO) {
            "${ChartFormat.number(wh / KILO, SCALED_DECIMALS, locale)} kWh"
        } else {
            "${ChartFormat.number(wh, WHOLE_DECIMALS, locale)} Wh"
        }
    }

    /** Power as the web `fmtPower`: "{kW} kW" at ≥1 kW, else "{W} W"; null → em-dash. */
    fun power(w: Double?): String {
        if (w == null) return EM_DASH
        return if (w >= KILO) {
            "${ChartFormat.number(w / KILO, SCALED_DECIMALS, locale)} kW"
        } else {
            "${ChartFormat.number(w, WHOLE_DECIMALS, locale)} W"
        }
    }

    /** Charge state as "{value}%" with one fraction digit (web `fmtNumber(percentage_charged, 1)%`); null → em-dash. */
    fun chargePercent(value: Double?): String =
        if (value == null) EM_DASH else "${ChartFormat.number(value, PERCENT_DECIMALS, locale)}%"

    /** Backup reserve as a whole "{value}%" (web `fmtNumber(backup_reserve_percent, 0)%`); null → em-dash. */
    fun reservePercent(value: Double?): String =
        if (value == null) EM_DASH else "${ChartFormat.number(value, WHOLE_DECIMALS, locale)}%"

    /**
     * A localized medium date + short time for [raw] (web `formatDateTime`), or the em-dash when [raw] is null / blank
     * / unparseable so the line never shows "Invalid Date". Accepts an ISO offset date-time.
     */
    fun dateTime(raw: String?): String {
        if (raw.isNullOrBlank()) return EM_DASH
        val parsed =
            runCatching { OffsetDateTime.parse(raw).toLocalDateTime() }.getOrNull() ?: return EM_DASH
        return parsed.format(
            DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale),
        )
    }

    companion object {
        /** The en-US default used before settings load (matches the web default locale). */
        val DEFAULT: EnergyDisplayPrefs = EnergyDisplayPrefs(locale = Locale.US)

        /** Resolves the display preferences from the raw `/settings` document (web `useFormatting().locale`). */
        fun fromSettings(settings: JsonElement?): EnergyDisplayPrefs {
            val locale =
                UnitPreferences.fromSettings(settings).locale
                    ?.takeIf { it.isNotBlank() }
                    ?.let(Locale::forLanguageTag)
                    ?: Locale.US
            return EnergyDisplayPrefs(locale = locale)
        }
    }
}

/** The inline resource label the web hardcodes (`resourceLabel`): Powerwall / Solar / the raw type. */
fun resourceLabel(resourceType: String): String =
    when (resourceType) {
        RESOURCE_BATTERY -> LABEL_POWERWALL
        RESOURCE_SOLAR -> LABEL_SOLAR
        else -> resourceType
    }

/** The inline operation-mode label the web hardcodes (`operationModeLabel`); an unknown mode renders verbatim. */
fun operationModeLabel(mode: String?): String =
    when (mode) {
        MODE_SELF_CONSUMPTION -> LABEL_SELF_POWERED
        MODE_AUTONOMOUS -> LABEL_TIME_BASED
        MODE_BACKUP -> LABEL_BACKUP_ONLY
        null -> EM_DASH
        else -> mode
    }

/**
 * Decodes the raw `/tesla/energy-sites` [json] array (web `useTeslaEnergySites` + `safeArray`) into typed
 * [EnergySite]s. A non-array payload yields an empty list (web `sites ?? []`); a row missing its `energy_site_id`
 * is skipped so a card never renders without an addressable site.
 */
fun parseEnergySites(json: JsonElement?): List<EnergySite> {
    val array = json as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        val siteId = row.longField("energy_site_id") ?: return@mapNotNull null
        EnergySite(
            id = row.longField("id") ?: siteId,
            energySiteId = siteId,
            resourceType = row.stringField("resource_type").orEmpty(),
            siteName = row.stringField("site_name").orEmpty(),
            packEnergyWh = row.doubleField("total_pack_energy"),
            percentageCharged = row.doubleField("percentage_charged"),
            batteryType = row.stringField("battery_type")?.takeIf { it.isNotBlank() },
            backupCapable = row.boolField("backup_capable"),
            stormModeEnabled = row.boolField("storm_mode_enabled"),
            stormModeCapable = row.boolField("storm_mode_capable"),
            hasSolar = row.boolField("has_solar"),
            hasBattery = row.boolField("has_battery"),
            hasGrid = row.boolField("has_grid"),
            touCapable = row.boolField("tou_capable"),
            fetchedAt = row.stringField("fetched_at"),
        )
    }
}

/**
 * Decodes the raw `…/site-info` [json] envelope (web `TeslaEnergySiteInfoResponse`) into an [EnergySiteInfo], or
 * `null` when there is no detail object to render (web `response?.data ?? null`). A non-object response, or a `data`
 * that is absent / JSON-null, yields `null` (the "no site configuration" empty surface); a present `data` object —
 * even a sparse one — yields an [EnergySiteInfo] whose missing fields collapse to `null`, exactly like the web reading
 * `info.nameplate_power` off a sparse object.
 */
fun parseSiteInfo(json: JsonElement?): EnergySiteInfo? {
    val envelope = json as? JsonObject ?: return null
    val data = envelope["data"] as? JsonObject ?: return null
    val componentsObj = data["components"] as? JsonObject
    return EnergySiteInfo(
        defaultRealMode = data.stringField("default_real_mode"),
        backupReservePercent = data.doubleField("backup_reserve_percent"),
        batteryCount = data.intField("battery_count"),
        nameplatePowerW = data.doubleField("nameplate_power"),
        nameplateEnergyWh = data.doubleField("nameplate_energy"),
        version = data.stringField("version")?.takeIf { it.isNotBlank() },
        installationTimeZone = data.stringField("installation_time_zone")?.takeIf { it.isNotBlank() },
        components = parseComponents(componentsObj),
        touCapable = (componentsObj?.get("tou_capable") as? JsonPrimitive)?.booleanOrNull == true,
        tariffName = parseTariffName(data),
        fetchedAt = envelope.stringField("fetched_at"),
    )
}

/**
 * The boolean component flags from `site_info.components` — the web `Object.entries(components)` badges that render
 * only the boolean entries, with the underscored key spaced (web `key.replace(/_/g, ' ')`). Non-boolean entries are
 * dropped, exactly like the web `typeof val === 'boolean' ? … : null`.
 */
private fun parseComponents(components: JsonObject?): List<EnergyComponentFlag> {
    val obj = components ?: return emptyList()
    return obj.entries.mapNotNull { (key, value) ->
        val flag = (value as? JsonPrimitive)?.booleanOrNull ?: return@mapNotNull null
        EnergyComponentFlag(label = key.replace('_', ' '), active = flag)
    }
}

/**
 * The current tariff / rate-plan name (web's `tariff_content_v2.name` ‖ `tou_settings.tariff_content_v2.name`), or
 * `null` when no plan is configured so the panel shows the "No rate plan configured" line.
 */
private fun parseTariffName(data: JsonObject): String? {
    val direct = (data["tariff_content_v2"] as? JsonObject)?.stringField("name")
    if (!direct.isNullOrBlank()) return direct
    val nested =
        ((data["tou_settings"] as? JsonObject)?.get("tariff_content_v2") as? JsonObject)?.stringField("name")
    return nested?.takeIf { it.isNotBlank() }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [EnergyProductsPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no site id / capacity / location payload, so a diagnostics line can never leak the owner's
 * energy system.
 */
fun recordEnergyProductsOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to EnergyProductsPageRegistration.SLUG))
}

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags. The cached
 * value (present on `Loading`/`Error` for an instant cold start) and the fresh `Success` value are both transformed;
 * the `Throwable` and the `fetchedAt`/`stale` stamps pass through untouched. Pure, so the view-model's
 * `JsonElement → model` projection stays unit-testable off-device.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.longField(key: String): Long? {
    val primitive = this[key] as? JsonPrimitive ?: return null
    return primitive.longOrNull ?: primitive.contentOrNull?.toLongOrNull()
}

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull == true
