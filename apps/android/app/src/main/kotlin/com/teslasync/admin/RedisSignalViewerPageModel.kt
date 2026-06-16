// Pure, framework-free model + projections for the RedisSignalViewerPage admin surface — the native analogue of
// everything the web page derives before composing its panels (web/src/features/admin/pages/RedisSignalViewerPage.tsx).
// No Compose, no Android UI, no HTTP: every declaration here is plain Kotlin (it only references the framework-free
// shared-core Resource/ApiError, the kotlinx JSON model, and the co-located RedisDiagnosticEmptyState data types),
// so the composable stays a thin render layer and the projection is unit-testable off-device.
//
// The web page owns these concerns this file ports: (1) the signal categorization regex ladder
// (categorizeSignal) + the location-mask predicate (isLocationSignal); (2) the `GET /dev-tools/redis-signals`
// document → render-ready rows / counts / meta projection (web `rows`/`categoryCounts` + the `meta` block);
// (3) the `GET /dev-tools/redis-signals/keys` document → "other vehicles" key list (web `getRedisSignalKeys`);
// (4) the page's local interaction snapshot (web `useState` group: vehicle + search + category + auto-refresh +
// the two-mode purge dialog) and the filter/sort derivations; and (5) the cache-then-network Resource re-shaping
// + the upstream-error → DiagnosticError fold the diagnostic banner consumes (web `errorBannerProps`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/admin) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling admin pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.admin.redissignals

import io.teslasync.android.featureviews.redisdiagnosticemptystate.DiagnosticError
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisSignalKeyEntry
import io.teslasync.android.featureviews.redisdiagnosticemptystate.RedisSignalsMeta
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.ApiError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `RedisSignalViewerPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("redisSignals", "/redis-signals", …)`, so [io.teslasync.android.navigation.PageHosts] binds this surface
 * to that destination (and its `/redis-signals` deep link) without the nav module depending on it.
 */
object RedisSignalViewerPageRegistration {
    /** The navigation destination id (Destinations.kt `page("redisSignals", "/redis-signals", …)`). */
    const val ROUTE_ID: String = "redisSignals"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/redis-signals"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "RedisSignalViewerPage"

    /** Web `getRedisSignalKeys(limit = 50)` — the "other vehicles with cached signals" key list cap. */
    const val KEYS_LIMIT: Int = 50

    /** Web `pagination={{ defaultPageSize: 50 }}` page size for the signals table. */
    const val PAGE_SIZE: Int = 50

    /** Web `refetchInterval: INTERVALS.REALTIME` auto-refresh cadence (5s) when the toggle is on. */
    const val AUTO_REFRESH_INTERVAL_MS: Long = 5_000L
}

/* ─── signal categorization (web SignalCategory + categorizeSignal) ───────────────────────────────────────── */

/** The five signal buckets the web colors + filters by (web `SignalCategory`). */
enum class SignalCategory { Battery, Charging, Driving, Climate, Other }

/** Stable display label for [SignalCategory] (web uses the enum literal as the chip text + filter value). */
val SignalCategory.label: String
    get() =
        when (this) {
            SignalCategory.Battery -> "Battery"
            SignalCategory.Charging -> "Charging"
            SignalCategory.Driving -> "Driving"
            SignalCategory.Climate -> "Climate"
            SignalCategory.Other -> "Other"
        }

private val BATTERY_RE = Regex("^(battery|bms|pack|brick|module)")
private val CHARGING_RE = Regex("^(ac|dc|charge|charger)")
private val DRIVING_RE = Regex("^(vehicle|odometer|latitude|longitude|gps)")
private val CLIMATE_RE = Regex("(temp|hvac|inside|outside|climate)")
private val LOCATION_RE =
    Regex("^(latitude|longitude|gps_lat|gps_lng|gps_latitude|gps_longitude|location_lat|location_lng)$")

/** Web `categorizeSignal`: a name-prefix/substring ladder, first match wins, default [SignalCategory.Other]. */
fun categorizeSignal(name: String): SignalCategory {
    val n = name.lowercase()
    return when {
        BATTERY_RE.containsMatchIn(n) -> SignalCategory.Battery
        CHARGING_RE.containsMatchIn(n) -> SignalCategory.Charging
        DRIVING_RE.containsMatchIn(n) -> SignalCategory.Driving
        CLIMATE_RE.containsMatchIn(n) -> SignalCategory.Climate
        else -> SignalCategory.Other
    }
}

/**
 * Web `isLocationSignal`: true for lat/lng/gps names whose value should be masked by default so a casual
 * screen-share or screenshot does not leak the parking spot (the operator can still reveal it).
 */
fun isLocationSignal(name: String): Boolean = LOCATION_RE.matches(name.lowercase())

/* ─── render-ready row (web SignalRow) ───────────────────────────────────────────────────────────────────── */

/** Signal value kinds the web tags each entry with (web `entry.type`). */
enum class SignalType { Number, StringType, Boolean, Other }

/** Stable wire token for [SignalType] — the web `type` string ("number" | "string" | "boolean"). */
val SignalType.wire: String
    get() =
        when (this) {
            SignalType.Number -> "number"
            SignalType.StringType -> "string"
            SignalType.Boolean -> "boolean"
            SignalType.Other -> "other"
        }

private fun signalTypeOf(wire: String?): SignalType =
    when (wire) {
        "number" -> SignalType.Number
        "string" -> SignalType.StringType
        "boolean" -> SignalType.Boolean
        else -> SignalType.Other
    }

/**
 * One normalized table row — the native mirror of the web `SignalRow`. [value] is the already-rendered display
 * string; [type] is the wire token used for the type Badge + the Numbers/Strings/Booleans counts; [category] is
 * the categorization bucket; [isLocation] routes the value through the masked-coordinate cell.
 */
data class SignalRow(
    val name: String,
    val value: String,
    val type: SignalType,
    val category: SignalCategory,
    val isLocation: Boolean,
)

/* ─── vehicle picker option (web vehicleOptions) ─────────────────────────────────────────────────────────── */

/** The slice of the API [Vehicle] the picker reads — the native mirror of the web `vehicleOptions` map. */
data class RedisVehicleOption(
    val id: Long,
    val displayName: String,
    val vin: String,
) {
    /** Web `v.display_name || v.vin || \`Vehicle ${v.id}\`` label fold. */
    val label: String
        get() = displayName.ifBlank { vin.ifBlank { "Vehicle $id" } }
}

/** Projects an API [Vehicle] onto the picker option (web reads `id`, `display_name`, `vin`). */
fun Vehicle.toRedisOption(): RedisVehicleOption = RedisVehicleOption(id = id, displayName = displayName, vin = vin)

/* ─── parsed redis-signals document (web RedisSignalsResponse) ───────────────────────────────────────────── */

/**
 * The decoded `GET /dev-tools/redis-signals` document — the native mirror of the web `RedisSignalsResponse`
 * after the `rows`/`categoryCounts`/`meta` derivations. [rows] are sorted by name ascending (web
 * `.sort((a,b) => a.name.localeCompare(b.name))`); the per-type counts back the Numbers/Strings/Booleans stat
 * cards; [meta] backs the diagnostic chips + the structured diagnostic banner.
 */
data class RedisSignalsData(
    val vehicleId: Long,
    val signalCount: Int,
    val rows: List<SignalRow>,
    val meta: RedisSignalsMeta?,
) {
    /** Web `rows.filter(r => r.type === 'number').length`. */
    val numberCount: Int get() = rows.count { it.type == SignalType.Number }

    /** Web `rows.filter(r => r.type === 'string').length`. */
    val stringCount: Int get() = rows.count { it.type == SignalType.StringType }

    /** Web `rows.filter(r => r.type === 'boolean').length`. */
    val booleanCount: Int get() = rows.count { it.type == SignalType.Boolean }

    /** True when the cache held no signals for this vehicle (the diagnostic/empty branch). */
    val isEmpty: Boolean get() = rows.isEmpty()

    /** Web `categoryCounts`: a count per [SignalCategory], including zero buckets. */
    val categoryCounts: Map<SignalCategory, Int>
        get() {
            val counts = SignalCategory.entries.associateWith { 0 }.toMutableMap()
            for (row in rows) counts[row.category] = (counts[row.category] ?: 0) + 1
            return counts
        }
}

/**
 * Pure projection from the raw `Resource<JsonElement>` documents to render-ready models — the native port of the
 * web `rows` `useMemo` + the `meta`/keys field reads. Every read is defensive (a malformed document yields empty
 * data rather than throwing) so a backend shape regression degrades gracefully instead of crashing the screen.
 */
object RedisSignalsProjection {
    private val COMPACT_JSON: Json = Json { encodeDefaults = false }

    /** Web row build: `Object.entries(signals).map(...).sort(byName)` + `signal_count` + the optional `meta`. */
    fun parseSignals(
        vehicleId: Long,
        document: JsonElement,
    ): RedisSignalsData {
        val obj = document as? JsonObject ?: return RedisSignalsData(vehicleId, 0, emptyList(), null)
        val signals = (obj["signals"] as? JsonObject).orEmpty()
        val rows =
            signals.entries
                .map { (name, raw) -> rowFromEntry(name, raw) }
                .sortedBy { it.name.lowercase() }
        val signalCount = obj["signal_count"]?.jsonPrimitive?.intOrNull ?: rows.size
        return RedisSignalsData(
            vehicleId = vehicleId,
            signalCount = signalCount,
            rows = rows,
            meta = parseMeta(obj["meta"]),
        )
    }

    /** Web entry → row: render the value, tag its type, categorize the name, flag location signals. */
    fun rowFromEntry(
        name: String,
        raw: JsonElement,
    ): SignalRow {
        val entry = raw as? JsonObject
        val type = signalTypeOf(entry?.get("type")?.let { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content })
        val value = renderValue(entry?.get("value") ?: raw)
        return SignalRow(
            name = name,
            value = value,
            type = type,
            category = categorizeSignal(name),
            isLocation = isLocationSignal(name),
        )
    }

    /** Web `String(entry.value)`: a JSON scalar renders as its literal; a compound value is compact-JSON-encoded. */
    fun renderValue(value: JsonElement?): String =
        when (value) {
            null, is JsonNull -> ""
            is JsonPrimitive -> value.content
            is JsonObject, is JsonArray ->
                runCatching { COMPACT_JSON.encodeToString(JsonElement.serializer(), value) }.getOrDefault("")
        }

    /** Web `signalData.meta` → [RedisSignalsMeta], or null when the backend omits the block (pre-meta rollback). */
    fun parseMeta(element: JsonElement?): RedisSignalsMeta? {
        val obj = element as? JsonObject ?: return null
        return RedisSignalsMeta(
            liveSignalStoreMode = obj.string("live_signal_store_mode"),
            redisKey = obj.string("redis_key"),
            redisFieldCount = obj.int("redis_field_count"),
            l1SignalCount = obj.int("l1_signal_count"),
            l1LastSeenAt = obj.stringOrNull("l1_last_seen_at"),
            l2LastSeenAt = obj.stringOrNull("l2_last_seen_at"),
            vehicleVin = obj.string("vehicle_vin"),
        )
    }

    /** Web `getRedisSignalKeys` → `keys` array → the "other vehicles" chip entries. */
    fun parseKeys(document: JsonElement): List<RedisSignalKeyEntry> {
        val keys = ((document as? JsonObject)?.get("keys") as? JsonArray) ?: return emptyList()
        return keys.mapNotNull { element ->
            val obj = element as? JsonObject ?: return@mapNotNull null
            val id = obj["vehicle_id"]?.jsonPrimitive?.intOrNull ?: return@mapNotNull null
            RedisSignalKeyEntry(
                vehicleId = id,
                fieldCount = obj.int("field_count"),
                vehicleVin = obj.stringOrNull("vehicle_vin"),
                displayName = obj.stringOrNull("display_name"),
            )
        }
    }

    private fun JsonObject?.orEmpty(): JsonObject = this ?: JsonObject(emptyMap())

    private fun JsonObject.string(key: String): String = stringOrNull(key) ?: ""

    private fun JsonObject.stringOrNull(key: String): String? =
        (this[key] as? JsonPrimitive)?.let { if (it is JsonNull) null else it.content }?.takeIf { it.isNotBlank() }

    private fun JsonObject.int(key: String): Int = this[key]?.jsonPrimitive?.intOrNull ?: 0
}

/* ─── interaction snapshot (web useState group) ──────────────────────────────────────────────────────────── */

/** Which destructive path the single purge dialog is serving (web `purgeMode: 'one' | 'all' | null`). */
enum class PurgeMode { One, All }

/**
 * The page's local interaction snapshot — the union of the web component's `useState` cells: the selected
 * [vehicleId] (web `selectedVehicleId`, null until picked), the [search] filter, the [categoryFilter]
 * ("all" or a [SignalCategory] label), the [autoRefresh] toggle, and the purge-dialog group ([purgeMode] +
 * the pinned [purgeTargetId]/[purgeTargetLabel] + the in-flight [isPurging] flag).
 */
data class RedisInteraction(
    val vehicleId: Long? = null,
    val search: String = "",
    val categoryFilter: String = ALL_CATEGORIES,
    val autoRefresh: Boolean = false,
    val purgeMode: PurgeMode? = null,
    val purgeTargetId: Long? = null,
    val purgeTargetLabel: String = "",
    val isPurging: Boolean = false,
) {
    /** True once a vehicle is selected — the web `selectedVehicleId === null` gate. */
    val hasVehicle: Boolean get() = vehicleId != null

    /** True while the purge dialog is open (web `purgeMode !== null`). */
    val isPurgeDialogOpen: Boolean get() = purgeMode != null

    companion object {
        /** The "All Categories" sentinel for [categoryFilter] (web `'all'`). */
        const val ALL_CATEGORIES: String = "all"
    }
}

/* ─── filter / sort derivations (web filteredRows + useSortToggle) ───────────────────────────────────────── */

/** The sortable table columns (web `Column.key`) shared by the header, the sort toggle, and the cells. */
const val COL_NAME: String = "name"
const val COL_VALUE: String = "value"
const val COL_TYPE: String = "type"
const val COL_CATEGORY: String = "category"

/** Web `filteredRows`: name-substring search then category filter; a blank search / "all" category is a pass. */
fun filterRows(
    rows: List<SignalRow>,
    search: String,
    categoryFilter: String,
): List<SignalRow> {
    var result = rows
    val q = search.trim().lowercase()
    if (q.isNotEmpty()) result = result.filter { it.name.lowercase().contains(q) }
    if (categoryFilter != RedisInteraction.ALL_CATEGORIES) {
        result = result.filter { it.category.label == categoryFilter }
    }
    return result
}

/**
 * Web table sort comparator: by `name` / `type` / `category` (the sortable columns), flipped by [ascending].
 * An unsortable / unknown key leaves the (already filtered, name-ascending) order untouched.
 */
fun sortRows(
    rows: List<SignalRow>,
    key: String?,
    ascending: Boolean,
): List<SignalRow> {
    val dir = if (ascending) 1 else -1
    val comparator =
        when (key) {
            COL_NAME -> Comparator<SignalRow> { a, b -> a.name.compareTo(b.name) * dir }
            COL_TYPE -> Comparator { a, b -> a.type.wire.compareTo(b.type.wire) * dir }
            COL_CATEGORY -> Comparator { a, b -> a.category.label.compareTo(b.category.label) * dir }
            else -> return rows
        }
    return rows.sortedWith(comparator)
}

/* ─── Resource re-shaping + upstream-error fold (web errorBannerProps) ───────────────────────────────────── */

/**
 * Maps the value inside a cache-then-network [Resource], preserving its lifecycle case + freshness flags — the
 * native port of the IngestXRay `mapData`. The cached value (present on Loading/Error for an instant cold start)
 * and the fresh Success value are both transformed; the `Throwable` + `fetchedAt`/`stale` stamps pass through.
 */
fun <T, R> Resource<T>.mapData(transform: (T) -> R): Resource<R> =
    when (this) {
        is Resource.Loading -> Resource.Loading(cached?.let(transform), fetchedAt, stale)
        is Resource.Success -> Resource.Success(transform(data), fetchedAt, stale)
        is Resource.Error -> Resource.Error(cached?.let(transform), fetchedAt, stale, error)
    }

/**
 * Folds a redis-signals [Resource] onto the [DiagnosticError] the structured banner consumes — the native port of
 * the web `errorBannerProps` (`isApiError(error) ? { serverError } : { networkError: true }`). A typed HTTP
 * failure becomes [DiagnosticError.Server] (status + the most-informative body/message so the banner's
 * "not available"/"unreachable" sub-branches can match); any other transport failure becomes
 * [DiagnosticError.Network]; a non-error resource is [DiagnosticError.None].
 */
fun Resource<*>.toDiagnosticError(): DiagnosticError {
    val error = (this as? Resource.Error)?.error ?: return DiagnosticError.None
    return when (error) {
        is ApiError.Http ->
            DiagnosticError.Server(
                status = error.status,
                message = error.body?.takeIf { it.isNotBlank() } ?: error.message.orEmpty(),
            )
        else -> DiagnosticError.Network
    }
}

/* ─── toast message keys (web toast.success/info/warning/error) ──────────────────────────────────────────── */

/**
 * Opaque discriminators for the one-shot purge toasts (web `toast.*`). They are NOT user text — the render
 * boundary maps each to its localized `translation_redis_*` string(s) (ADR-014), so no English literal lives in
 * the view-model. [args] on the emitted event carry the positional interpolation values (vehicle label / counts).
 */
object RedisToastKeys {
    /** Web `toast.success(purgeSuccess, purgeSuccessDetail{vehicle})`. arg0 = vehicle label. */
    const val PURGE_SUCCESS: String = "redis.toast.purgeSuccess"

    /** Web `toast.info(purgeNoOpTitle, purgeNoOpDetail{vehicle})`. arg0 = vehicle label. */
    const val PURGE_NOOP: String = "redis.toast.purgeNoOp"

    /** Web `toast.error(purgeError, msg)`. arg0 = error detail. */
    const val PURGE_ERROR: String = "redis.toast.purgeError"

    /** Web `toast.warning(purgeAllPartial, purgeAllPartialDetail{count,limit})`. arg0 = count, arg1 = limit. */
    const val PURGE_ALL_PARTIAL: String = "redis.toast.purgeAllPartial"

    /** Web `toast.success(purgeAllSuccess, purgeAllSuccessDetail{count})`. arg0 = count. */
    const val PURGE_ALL_SUCCESS: String = "redis.toast.purgeAllSuccess"
}

/* ─── purge response reads (web res.purged / res.has_more / res.purged / res.limit) ──────────────────────── */

/** Web per-vehicle purge `res.purged` boolean. */
fun JsonElement.purgedFlag(): Boolean = (this as? JsonObject)?.get("purged")?.jsonPrimitive?.booleanOrNull ?: false

/** Web purge-all `res.has_more` boolean. */
fun JsonElement.hasMoreFlag(): Boolean = (this as? JsonObject)?.get("has_more")?.jsonPrimitive?.booleanOrNull ?: false

/** Web purge-all `res.purged` count. */
fun JsonElement.purgedCount(): Int = (this as? JsonObject)?.get("purged")?.jsonPrimitive?.intOrNull ?: 0

/** Web purge-all `res.limit` cap. */
fun JsonElement.purgeLimit(): Int = (this as? JsonObject)?.get("limit")?.jsonPrimitive?.intOrNull ?: 0

/* ─── diagnostics ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [RedisSignalViewerPageRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its
 * first composition. Carries no vehicle id, signal name, or value.
 */
fun recordRedisSignalViewerPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to RedisSignalViewerPageRegistration.SLUG))
}
