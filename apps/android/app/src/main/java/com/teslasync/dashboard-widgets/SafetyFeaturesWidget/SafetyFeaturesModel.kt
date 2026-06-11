// Pure, framework-free model + projection for the Safety Features dashboard widget — the native analogue
// of the data the web component derives via `buildCells` before returning JSX
// (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer. Safety ADAS fields are plain enums/toggles — not unit-bearing — so
// there is no SI conversion at this layer; the only formatting is the localized labels + the
// web-parity enum normalization (lib/safetyEnum.ts) the surface folds in, exactly as the web does.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SafetyFeaturesWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget /
// GuardModeWidget do. `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.safetyfeatures

import io.teslasync.android.components.datadisplay.FreshnessAge
import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** Em dash shown for a missing reading — the web `'—'` fallback and the shared formatter's empty value. */
internal const val EM_DASH: String = "\u2014"

// Web `SafetySnapshot` field names read by `buildCells` (the typed contract from /safety/latest).
private const val FIELD_FCW = "forward_collision_warning"
private const val FIELD_AEB_OFF = "automatic_emergency_braking_off"
private const val FIELD_LDA = "lane_departure_avoidance"
private const val FIELD_ELDA = "emergency_lane_departure_avoidance"
private const val FIELD_BSC = "automatic_blind_spot_camera"
private const val FIELD_BSCW = "blind_spot_collision_warning"
private const val FIELD_SLW = "speed_limit_warning"
private const val FIELD_CFD = "cruise_follow_distance"

// Web cleanSafetyEnum literals: a boolean renders "On"/"Off"; SpeedAssistLevelNone collapses to "Off".
private const val ENUM_ON = "On"
private const val ENUM_OFF = "Off"
private const val ENUM_NONE = "None"

// Web isSafetyEnumActive "disabled" classification set (compared case-insensitively).
private val INACTIVE_TOKENS: Set<String> = setOf("off", "none", "disabled", "0")

/**
 * The four `string | boolean | number`-typed safety enum fields and their Tesla raw-enum prefixes — the
 * native port of the web `SAFETY_ENUM_PREFIXES` map (lib/safetyEnum.ts). Old `signal_log` rows ship the
 * full typed enum (e.g. `"FollowDistance3"`); the codec-stripped suffix (`"3"`); a native boolean (a
 * disabled ADAS toggle); or a native number (a pre-codec numeric). [prefix] is stripped when present.
 */
enum class SafetyEnumField(
    val prefix: String,
) {
    ForwardCollisionWarning("ForwardCollisionSensitivity"),
    LaneDepartureAvoidance("LaneAssistLevel"),
    SpeedLimitWarning("SpeedAssistLevel"),
    CruiseFollowDistance("FollowDistance"),
}

/**
 * The status of one safety cell — the native mirror of the web `StatusCell['status']` union
 * (`'ok' | 'warning' | 'error' | 'inactive' | 'unknown'`). The Safety widget's projection only ever emits
 * [Ok] / [Inactive] / [Unknown]; [Warning] / [Error] complete the shared status contract so the render
 * layer's tone mapping matches the web `WidgetStatusGrid.statusStyles` table exactly.
 */
enum class SafetyStatus { Ok, Warning, Error, Inactive, Unknown }

/**
 * One projected, render-ready safety cell — the native analogue of a web `StatusCell`. Pure data (no
 * Compose types): the stable [id], the localized [label], the normalized display [value] (web
 * `cleanSafetyEnum` / Enabled / Disabled / em dash), and the semantic [status] that drives the cell's
 * tone + status dot.
 */
data class SafetyCell(
    val id: String,
    val label: String,
    val value: String,
    val status: SafetyStatus,
)

/**
 * Localized labels + the relative-time formatter the surface folds into its output. The pure
 * [SafetyFeaturesProjection] reads the eight cell labels plus the [enabled] / [disabled] words and
 * [emDash]; the composable chrome additionally reads [title] / [activeFeatures] / [noData] /
 * [refreshLabel] / [refreshingLabel] / [offlineLabel] / [formatRelative]. The composable builds this from
 * `stringResource`; tests pass a deterministic instance. Keeping i18n out of the projection lets it stay
 * a pure, locale-stable function.
 */
data class SafetyStrings(
    val fcw: String,
    val aeb: String,
    val lda: String,
    val elda: String,
    val bsc: String,
    val bscw: String,
    val slw: String,
    val cfd: String,
    val enabled: String,
    val disabled: String,
    val title: String,
    val activeFeatures: String,
    val noData: String,
    val refreshLabel: String,
    val refreshingLabel: String,
    val offlineLabel: String,
    val formatRelative: (FreshnessAge) -> String,
    val emDash: String = EM_DASH,
)

/**
 * The fully projected, render-ready view of the safety snapshot — the native analogue of everything the
 * web component computes before returning JSX (the `buildCells` array and the `activeCount`). Pure data
 * (no Compose types) so every branch is unit-tested directly.
 *
 * @property hasData whether a safety snapshot object was decoded (web `data` truthy); when false the
 *   surface renders its empty state instead of the grid / compact count.
 * @property cells the eight ordered status cells (web `buildCells`); empty only when [hasData] is false.
 * @property activeCount how many cells are [SafetyStatus.Ok] — the compact-mode hero value (web
 *   `cells.filter((c) => c.status === 'ok').length`).
 */
data class SafetyFeaturesDisplay(
    val hasData: Boolean,
    val cells: List<SafetyCell>,
    val activeCount: Int,
) {
    companion object {
        /** The no-snapshot projection (web `data == null`): the surface shows its empty state. */
        val EMPTY: SafetyFeaturesDisplay = SafetyFeaturesDisplay(hasData = false, cells = emptyList(), activeCount = 0)
    }
}

/**
 * The widget grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the `isCompact`
 * branch in the web source: a single column renders the compact active-count hero, wider footprints
 * render the status grid (2 columns, or 4 when `size.cols >= 3`).
 */
data class SafetyFeaturesSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): show the compact count hero, not the grid. */
    val isCompact: Boolean get() = cols <= 1

    /** The status-grid column count (web `size.cols >= 3 ? 4 : 2`). */
    val gridColumns: Int get() = if (cols >= GRID_WIDE_THRESHOLD) GRID_WIDE_COLUMNS else GRID_NARROW_COLUMNS

    companion object {
        private const val GRID_WIDE_THRESHOLD = 3
        private const val GRID_WIDE_COLUMNS = 4
        private const val GRID_NARROW_COLUMNS = 2
    }
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`safety-features`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object SafetyFeaturesRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "safety-features"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SafetyFeaturesWidget"

    /** Default footprint: 2 columns × 4 rows. */
    val DEFAULT_SIZE: SafetyFeaturesSize = SafetyFeaturesSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: SafetyFeaturesSize = SafetyFeaturesSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: SafetyFeaturesSize = SafetyFeaturesSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SafetyFeaturesSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SafetyFeaturesSize): SafetyFeaturesSize =
        SafetyFeaturesSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** The decoded runtime shape of one raw safety field (web's `string | boolean | number | null`). */
private sealed interface SafetyRaw {
    /** Absent / `JsonNull` / empty string / non-scalar — the web `null`/`undefined`/empty case. */
    data object Absent : SafetyRaw

    /** A native JSON boolean (a disabled-by-toggle ADAS field). */
    data class Bool(
        val value: Boolean,
    ) : SafetyRaw

    /** A native finite JSON number (a legacy pre-codec numeric enum). */
    data class Num(
        val value: Double,
    ) : SafetyRaw

    /** A non-empty JSON string (the typed or codec-stripped enum). */
    data class Str(
        val value: String,
    ) : SafetyRaw
}

/**
 * Normalizes a raw safety-enum [JsonElement] into a human-renderable, prefix-stripped string — the native
 * port of the web `cleanSafetyEnum` (lib/safetyEnum.ts), the SINGLE choke point that never coerces a
 * non-string to a string. A boolean renders `"On"`/`"Off"`; a finite number renders its JS decimal form
 * (`3.0 → "3"`); a typed/stripped string has the field [SafetyEnumField.prefix] removed (and a
 * `SpeedAssistLevelNone` collapses to `"Off"`); anything absent returns [fallback].
 */
fun cleanSafetyEnum(
    value: JsonElement?,
    field: SafetyEnumField,
    fallback: String = EM_DASH,
): String =
    when (val raw = classify(value)) {
        SafetyRaw.Absent -> fallback
        is SafetyRaw.Bool -> if (raw.value) ENUM_ON else ENUM_OFF
        is SafetyRaw.Num -> jsNumberToString(raw.value)
        is SafetyRaw.Str -> stripPrefix(raw.value, field)
    }

/**
 * Whether a raw safety-enum value represents an ENABLED feature — the native port of the web
 * `isSafetyEnumActive` (lib/safetyEnum.ts). Centralizes the "off / none / disabled / 0" classification so
 * a stray boolean/number from the backend never crashes a string op and is never coerced (web's
 * `String(false) !== 'off'` trap). A boolean is its own truth; everything else is cleaned, then matched
 * against the inactive token set.
 */
fun isSafetyEnumActive(
    value: JsonElement?,
    field: SafetyEnumField,
): Boolean =
    when (val raw = classify(value)) {
        SafetyRaw.Absent -> false
        is SafetyRaw.Bool -> raw.value
        else -> {
            val cleaned = cleanSafetyEnum(value, field, "")
            cleaned.isNotEmpty() && cleaned.lowercase(Locale.ROOT) !in INACTIVE_TOKENS
        }
    }

/** Maps a safety enum value to its [SafetyStatus] (web `safetyEnumStatus`): null→unknown, active→ok, else inactive. */
fun safetyEnumStatus(
    value: JsonElement?,
    field: SafetyEnumField,
): SafetyStatus =
    when {
        value == null || value is JsonNull -> SafetyStatus.Unknown
        isSafetyEnumActive(value, field) -> SafetyStatus.Ok
        else -> SafetyStatus.Inactive
    }

/** Maps a boolean toggle to its [SafetyStatus] (web `boolStatus`): null→unknown, true→ok, false→inactive. */
fun boolStatus(value: Boolean?): SafetyStatus =
    when (value) {
        null -> SafetyStatus.Unknown
        true -> SafetyStatus.Ok
        false -> SafetyStatus.Inactive
    }

/**
 * Maps an "off" flag to its [SafetyStatus] (web `invertedBoolStatus`): null→unknown, true→inactive,
 * false→ok. The field is a disable flag, so `true` means the feature is OFF.
 */
fun invertedBoolStatus(value: Boolean?): SafetyStatus =
    when (value) {
        null -> SafetyStatus.Unknown
        true -> SafetyStatus.Inactive
        false -> SafetyStatus.Ok
    }

/**
 * Pure projection from a decoded safety snapshot [JsonElement] to the render-ready
 * [SafetyFeaturesDisplay] — the native port of `buildCells` + the `activeCount` derivation in
 * `SafetyFeaturesWidget.tsx`. A `null`/`JsonNull`/non-object snapshot yields [SafetyFeaturesDisplay.EMPTY]
 * (web's falsy `data` branch → the "No safety data" empty state).
 */
object SafetyFeaturesProjection {
    /** Project [snapshot] into the render model using [strings] for the localized labels + Enabled/Disabled words. */
    fun project(
        snapshot: JsonElement?,
        strings: SafetyStrings,
    ): SafetyFeaturesDisplay {
        val obj = snapshot as? JsonObject ?: return SafetyFeaturesDisplay.EMPTY
        val cells = buildCells(obj, strings)
        return SafetyFeaturesDisplay(
            hasData = true,
            cells = cells,
            activeCount = cells.count { it.status == SafetyStatus.Ok },
        )
    }

    /** True when [snapshot] carries no safety object (web `data` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** Locale-stable integer formatter with grouped thousands — the compact active-count value (web `fmtInt`). */
    fun formatCount(value: Int): String = DecimalFormat("#,##0", DecimalFormatSymbols(Locale.US)).format(value.toLong())

    /** The eight ordered cells (web `buildCells`), in source order: fcw, aeb, lda, elda, bsc, bscw, slw, cfd. */
    internal fun buildCells(
        obj: JsonObject,
        s: SafetyStrings,
    ): List<SafetyCell> =
        listOf(
            enumCell("fcw", s.fcw, obj.rawField(FIELD_FCW), SafetyEnumField.ForwardCollisionWarning, s),
            SafetyCell(
                id = "aeb",
                label = s.aeb,
                value = offFlagText(obj.boolField(FIELD_AEB_OFF), s),
                status = invertedBoolStatus(obj.boolField(FIELD_AEB_OFF)),
            ),
            enumCell("lda", s.lda, obj.rawField(FIELD_LDA), SafetyEnumField.LaneDepartureAvoidance, s),
            toggleCell("elda", s.elda, obj.boolField(FIELD_ELDA), s),
            toggleCell("bsc", s.bsc, obj.boolField(FIELD_BSC), s),
            toggleCell("bscw", s.bscw, obj.boolField(FIELD_BSCW), s),
            enumCell("slw", s.slw, obj.rawField(FIELD_SLW), SafetyEnumField.SpeedLimitWarning, s),
            enumCell("cfd", s.cfd, obj.rawField(FIELD_CFD), SafetyEnumField.CruiseFollowDistance, s),
        )

    private fun enumCell(
        id: String,
        label: String,
        raw: JsonElement?,
        field: SafetyEnumField,
        s: SafetyStrings,
    ): SafetyCell =
        SafetyCell(
            id = id,
            label = label,
            value = cleanSafetyEnum(raw, field, s.emDash),
            status = safetyEnumStatus(raw, field),
        )

    private fun toggleCell(
        id: String,
        label: String,
        value: Boolean?,
        s: SafetyStrings,
    ): SafetyCell =
        SafetyCell(
            id = id,
            label = label,
            value = enabledText(value, s),
            status = boolStatus(value),
        )

    /** Enabled/Disabled value for a plain toggle (web `flag ? 'Enabled' : 'Disabled'`, null → em dash). */
    private fun enabledText(
        value: Boolean?,
        s: SafetyStrings,
    ): String =
        when (value) {
            null -> s.emDash
            true -> s.enabled
            false -> s.disabled
        }

    /** Enabled/Disabled value for an "off" flag (web AEB: `off ? 'Disabled' : 'Enabled'`, null → em dash). */
    private fun offFlagText(
        value: Boolean?,
        s: SafetyStrings,
    ): String =
        when (value) {
            null -> s.emDash
            true -> s.disabled
            false -> s.enabled
        }
}

/** Read the raw value at [key] verbatim (the web `string | boolean | number | null` enum field). */
private fun JsonObject.rawField(key: String): JsonElement? = this[key]

/**
 * Read a boolean field, or `null` when absent / `JsonNull` / not a native JSON boolean (web typed
 * `boolean | null`). A quoted `"true"` is a string, not a JS boolean, so it reads as missing — the
 * proper-fix invariant that never coerces a non-boolean.
 */
private fun JsonObject.boolField(key: String): Boolean? =
    (this[key] as? JsonPrimitive)?.let { prim ->
        when {
            prim is JsonNull || prim.isString -> null
            prim.content == "true" -> true
            prim.content == "false" -> false
            else -> null
        }
    }

/**
 * Decode a raw field [JsonElement] into a [SafetyRaw], matching the web `typeof` guards (typeGuards.ts):
 * only a native JSON boolean is a boolean, only a native finite JSON number is a number, only a quoted
 * non-empty JSON string is a string; everything else is [SafetyRaw.Absent].
 */
private fun classify(value: JsonElement?): SafetyRaw {
    val prim = value as? JsonPrimitive
    return when {
        prim == null || prim is JsonNull -> SafetyRaw.Absent
        prim.isString -> if (prim.content.isEmpty()) SafetyRaw.Absent else SafetyRaw.Str(prim.content)
        prim.content == "true" -> SafetyRaw.Bool(true)
        prim.content == "false" -> SafetyRaw.Bool(false)
        else -> prim.doubleOrNull?.takeIf { it.isFinite() }?.let { SafetyRaw.Num(it) } ?: SafetyRaw.Absent
    }
}

/** Strip the field's Tesla enum [SafetyEnumField.prefix]; SpeedAssistLevelNone → "Off" (web parity). */
private fun stripPrefix(
    raw: String,
    field: SafetyEnumField,
): String =
    if (raw.startsWith(field.prefix)) {
        val stripped = raw.substring(field.prefix.length)
        when {
            field == SafetyEnumField.SpeedLimitWarning && stripped == ENUM_NONE -> ENUM_OFF
            stripped.isEmpty() -> raw
            else -> stripped
        }
    } else {
        raw
    }

/** Render a finite double the way JS `String(n)` does: a whole value drops its fraction (`3.0 → "3"`). */
private fun jsNumberToString(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/**
 * The active vehicle id the widget reads safety for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty. */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
