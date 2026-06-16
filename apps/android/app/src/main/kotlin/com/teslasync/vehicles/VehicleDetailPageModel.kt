// Pure, framework-free model + projections for the VehicleDetailPage vehicles surface (P3/A7) — the native analogue of
// everything web/src/features/vehicles/pages/VehicleDetailPage.tsx derives before composing its per-vehicle detail
// surface. No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it references only the
// kotlinx-serialization JSON model, the framework-free UnitPreferences locale resolver, the JVM date formatter, and the
// diagnostics Logger), so the composable stays a thin render layer and all of this is exercised off-device by the
// :android:testDebugUnitTest gate.
//
// The page's declared data source is the per-vehicle settings resolver — web `useVehicleSettings(vehicleId)`
// (`GET /vehicles/{vehicleId}/settings`) and the `findEffectiveSetting` selector. This file ports that decode
// ([parseVehicleSettings]) and the selector ([findEffectiveSetting]) verbatim, plus the page's title derivation
// (`effectiveName = nickname-override ?? display_name`, web L94-98) as [effectiveNickname]; the per-key row projection
// ([humanizeKey] / [displaySettingValue]) the web `VehicleSettingsTab` renders; the localized [VehicleDetailSection]
// catalog (the 16 web `SectionErrorBoundary` fallback titles); the wake message-key constants the page resolves at the
// render boundary (web `toast.success`/`toast.error`); recordVehicleDetailPageOpened (view.opened); and mapData.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/vehicles) diverges from the
// `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do. `TooManyFunctions` is
// suppressed for the parity-complete derivation set.
@file:Suppress("InvalidPackageDeclaration", "TooManyFunctions")

package io.teslasync.android.vehicles.vehicledetail

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
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `VehicleDetailPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `hidden("vehicleDetail", "/vehicles/:id", NavGroup.Vehicles, listOf("id"))`, so
 * [io.teslasync.android.navigation.PageHosts] binds this surface to that destination (and its `/vehicles/{id}` deep
 * link) without the nav module depending on it.
 */
object VehicleDetailPageRegistration {
    /** The navigation destination id (Destinations.kt `hidden("vehicleDetail", "/vehicles/:id", …)`). */
    const val ROUTE_ID: String = "vehicleDetail"

    /** The route argument carrying the numeric vehicle id (web `useParams().id`). */
    const val ARG_ID: String = "id"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/vehicles/:id"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle payload. */
    const val SLUG: String = "VehicleDetailPage"

    /** i18n message key for the wake-success toast (web `t('vehicles.detail.wakeSuccess', …)`). */
    const val WAKE_SUCCESS_KEY: String = "vehicles.detail.wakeSuccess"

    /** i18n message key for the wake-failure toast (web `t('vehicles.detail.wakeFailed', …)`). */
    const val WAKE_FAILED_KEY: String = "vehicles.detail.wakeFailed"
}

/** Em dash shown for a missing data value (web `?? '—'`). */
const val VEHICLE_DETAIL_EM_DASH: String = "\u2014"

private const val VEHICLE_DETAIL_DEFAULT_LOCALE = "en-US"
private const val NICKNAME_KEY = "nickname"
private const val TIMESTAMP_KEY = "mute_until"

/* ------------------------------------------------------------------ */
/*  Domain model (the web VehicleSettingsResponse shape)              */
/* ------------------------------------------------------------------ */

/**
 * One resolved per-vehicle setting row — a `{key,value,source}` element of the `GET /vehicles/{id}/settings` payload
 * (web `EffectiveSetting`). [value] is kept as the raw [JsonElement] so the render boundary can format text / number /
 * boolean / timestamp values without the model guessing a kind; [source] is the resolver layer that produced it
 * (`override` | `user` | `vehicle` | `default`).
 */
data class EffectiveSetting(
    val key: String,
    val value: JsonElement?,
    val source: String,
)

/** The decoded `GET /vehicles/{id}/settings` envelope (web `VehicleSettingsResponse { settings }`). */
data class VehicleSettings(
    val settings: List<EffectiveSetting>,
)

/* ------------------------------------------------------------------ */
/*  Display preferences (web useFormatting at the render boundary)     */
/* ------------------------------------------------------------------ */

/**
 * The display-boundary helpers the page applies — the user's locale (web `useFormatting`/`useUnits`) used to format the
 * `mute_until` timestamp row. The settings values are tokens / free text, not SI quantities, so there is no unit
 * conversion here (Phase-48 SI-canonical) — only locale-aware date formatting.
 */
data class VehicleDetailDisplayPrefs(
    val locale: String,
) {
    private val resolvedLocale: Locale get() = Locale.forLanguageTag(locale)

    /** Formats an RFC3339 timestamp in the user's locale (web datetime row); falls back to the raw string. */
    fun dateTime(value: String): String {
        val instant = instantOf(value) ?: return value
        return DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(resolvedLocale)
            .withZone(ZoneId.systemDefault())
            .format(instant)
    }

    companion object {
        /** The metric/en-US default, for previews / cold start before the settings document loads. */
        val DEFAULT: VehicleDetailDisplayPrefs = fromSettings(null)

        /** Resolves the display locale from the raw `/settings` document (web `useFormatting`). */
        fun fromSettings(settings: JsonElement?): VehicleDetailDisplayPrefs =
            VehicleDetailDisplayPrefs(UnitPreferences.fromSettings(settings).locale ?: VEHICLE_DETAIL_DEFAULT_LOCALE)
    }
}

/* ------------------------------------------------------------------ */
/*  JSON decode (web useVehicleSettings queryFn payload)              */
/* ------------------------------------------------------------------ */

/**
 * Decodes the `GET /vehicles/{id}/settings` payload into [VehicleSettings] (web `useVehicleSettings`). Accepts the
 * `{ "settings": [...] }` envelope; a bare array is also tolerated. Anything else is an empty settings list (web's
 * always-present whitelist degrades to nothing to render). Non-object rows are skipped.
 */
fun parseVehicleSettings(payload: JsonElement?): VehicleSettings {
    val array =
        when (payload) {
            is JsonObject -> payload["settings"] as? JsonArray
            is JsonArray -> payload
            else -> null
        } ?: return VehicleSettings(emptyList())
    val rows =
        array.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val key = obj.string("key") ?: return@mapNotNull null
            EffectiveSetting(key = key, value = obj["value"], source = obj.string("source").orEmpty())
        }
    return VehicleSettings(rows)
}

/* ------------------------------------------------------------------ */
/*  Selectors + derivations (web findEffectiveSetting / effectiveName) */
/* ------------------------------------------------------------------ */

/**
 * Pull a single key's effective row from the resolver payload — the verbatim port of the web `findEffectiveSetting`
 * selector (web/src/api/hooks/useVehicleSettings.ts L128-133). Returns the row (so callers can also inspect [source])
 * or `null` when the key is absent.
 */
fun findEffectiveSetting(
    settings: VehicleSettings?,
    key: String,
): EffectiveSetting? = settings?.settings?.firstOrNull { it.key == key }

/**
 * The vehicle's effective display name from the per-vehicle settings (web L94-98): the `nickname` override when it is a
 * non-blank string, else `null` (the web then falls back to `vehicle.display_name`, which is not part of this unit's
 * declared data source — so the page falls through to the localized `vehicles.detail.title`).
 */
fun effectiveNickname(settings: VehicleSettings?): String? {
    val nickname = findEffectiveSetting(settings, NICKNAME_KEY)?.value?.let(::asStringOrNull)
    return nickname?.takeIf { it.isNotBlank() }
}

/** Humanizes a snake_case settings key into a row label (`units_distance` -> `Units distance`); pure data transform. */
fun humanizeKey(key: String): String {
    if (key.isBlank()) return key
    val words = key.split('_').filter { it.isNotBlank() }
    return words.joinToString(" ") { word ->
        word.replaceFirstChar { ch -> ch.titlecase(Locale.ROOT) }
    }
}

/**
 * Formats a setting [EffectiveSetting.value] for display (web `VehicleSettingsTab` typed inputs): a string verbatim
 * (the `mute_until` timestamp is localized via [prefs]), a number without a trailing `.0`, a boolean as-is, and an
 * absent / null value as the em dash.
 */
fun displaySettingValue(
    setting: EffectiveSetting,
    prefs: VehicleDetailDisplayPrefs,
): String {
    val primitive = setting.value as? JsonPrimitive ?: return VEHICLE_DETAIL_EM_DASH
    return formatPrimitive(primitive, setting.key, prefs)
}

private fun formatPrimitive(
    primitive: JsonPrimitive,
    key: String,
    prefs: VehicleDetailDisplayPrefs,
): String =
    when {
        primitive.isString -> formatStringValue(key, primitive.contentOrNull, prefs)
        primitive.booleanOrNull != null -> primitive.booleanOrNull.toString()
        primitive.doubleOrNull != null -> formatNumber(primitive.doubleOrNull ?: 0.0)
        else -> primitive.contentOrNull?.takeIf { it.isNotBlank() } ?: VEHICLE_DETAIL_EM_DASH
    }

private fun formatStringValue(
    key: String,
    text: String?,
    prefs: VehicleDetailDisplayPrefs,
): String {
    if (text.isNullOrBlank()) return VEHICLE_DETAIL_EM_DASH
    return if (key == TIMESTAMP_KEY) prefs.dateTime(text) else text
}

/** The resolver layer that produced a value — `override` | `user` | `vehicle` | `default`, else the em dash. */
fun settingSourceLabel(setting: EffectiveSetting): String =
    setting.source.takeIf { it.isNotBlank() } ?: VEHICLE_DETAIL_EM_DASH

private fun formatNumber(value: Double): String {
    if (!value.isFinite()) return VEHICLE_DETAIL_EM_DASH
    val isWhole = value % 1.0 == 0.0
    return if (isWhole) value.toLong().toString() else value.toString()
}

/* ------------------------------------------------------------------ */
/*  Section catalog (web SectionErrorBoundary cascade)                */
/* ------------------------------------------------------------------ */

/**
 * One resilient section of the detail surface — the native analogue of a web `<SectionErrorBoundary name fallbackTitle>`
 * wrapper (VehicleDetailPage.tsx L195-263). [kind] selects the content the page renders inside the boundary; the
 * `*Failed` fallback title + any `*` label/empty string is resolved at the render boundary (ADR-014).
 */
enum class VehicleDetailSection {
    Header,
    BatteryRange,
    LiveState,
    QuickStats,
    Motor,
    Climate,
    Security,
    Tire,
    ChargingTelemetry,
    BatteryCharts,
    RecentDrives,
    RecentCharges,
    VehicleConfig,
    AiPaintPreview,
    QuickLinks,
    Settings,
}

/**
 * The ordered content sections the web page renders after the header (VehicleDetailPage.tsx L216-263) — the 14
 * `state`-gated sections plus the per-vehicle `Settings` section that binds this unit's declared data source. The
 * `Header` is rendered separately (it is always present, web L195-206), so it is intentionally excluded here.
 */
val VEHICLE_DETAIL_CONTENT_SECTIONS: List<VehicleDetailSection> =
    listOf(
        VehicleDetailSection.BatteryRange,
        VehicleDetailSection.LiveState,
        VehicleDetailSection.QuickStats,
        VehicleDetailSection.Motor,
        VehicleDetailSection.Climate,
        VehicleDetailSection.Security,
        VehicleDetailSection.Tire,
        VehicleDetailSection.ChargingTelemetry,
        VehicleDetailSection.BatteryCharts,
        VehicleDetailSection.RecentDrives,
        VehicleDetailSection.RecentCharges,
        VehicleDetailSection.VehicleConfig,
        VehicleDetailSection.AiPaintPreview,
        VehicleDetailSection.QuickLinks,
        VehicleDetailSection.Settings,
    )

/* ------------------------------------------------------------------ */
/*  Resource mapping + diagnostics                                    */
/* ------------------------------------------------------------------ */

/** Projects a decode over a cache-then-network [Resource] (the sibling A7 page-model helper). */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [VehicleDetailPageRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first composition.
 * Carries no vehicle id, nickname, or settings payload.
 */
fun recordVehicleDetailPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to VehicleDetailPageRegistration.SLUG))
}

/* ------------------------------------------------------------------ */
/*  JSON + timestamp helpers                                          */
/* ------------------------------------------------------------------ */

private fun asStringOrNull(value: JsonElement): String? = (value as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

private fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

/** Parses an ISO-8601 timestamp (with or without an explicit offset, falling back to UTC) to an [Instant]. */
private fun instantOf(value: String): Instant? {
    if (value.isBlank()) return null
    runCatching { return Instant.parse(value) }
    runCatching { return OffsetDateTime.parse(value).toInstant() }
    runCatching { return LocalDateTime.parse(value).atZone(ZoneId.of("UTC")).toInstant() }
    return null
}
