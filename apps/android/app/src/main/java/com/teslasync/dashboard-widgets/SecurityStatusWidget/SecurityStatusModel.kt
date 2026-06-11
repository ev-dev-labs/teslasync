// Pure, framework-free model + projection for the Security Status dashboard widget — the native analogue
// of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/SecurityStatusWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/SecurityStatusWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ClimateStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.securitystatus

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

// Security-event fields the web reads off `/security/latest`. `locked` / `sentry_mode` are typed booleans;
// `door_state` and the four window corners arrive as either a string enum or a native boolean depending on
// the protomodel emission (web `string | boolean | null`), so the readers below narrow both kinds.
private const val FIELD_LOCKED = "locked"
private const val FIELD_SENTRY_MODE = "sentry_mode"
private const val FIELD_DOOR_STATE = "door_state"
private val WINDOW_FIELDS: List<String> = listOf("fd_window", "fp_window", "rd_window", "rp_window")

// Web parity tokens: a door string segment is "open" when it contains `open` (case-insensitive); a window
// is open when it is the native boolean `true` or a non-empty string that is not `closed`. The door field
// is comma-separated (web `door_state.split(',')`).
private const val DOOR_DELIMITER = ","
private const val DOOR_OPEN_TOKEN = "open"
private const val WINDOW_CLOSED = "closed"

/**
 * The widget grid footprint (columns × rows). The web `SecurityStatusWidget` destructures only `vehicleId`
 * from `WidgetProps` and never reads `size`, so the surface renders identically at every footprint; this
 * type exists to mirror the registry's size contract (consumed by the grid host), not to branch the layout.
 */
data class SecurityStatusSize(
    val cols: Int,
    val rows: Int,
)

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`security-status`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object SecurityStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "security-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SecurityStatusWidget"

    /** Default footprint: 1 column × 2 rows. */
    val DEFAULT_SIZE: SecurityStatusSize = SecurityStatusSize(cols = 1, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: SecurityStatusSize = SecurityStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 2 columns × 40 rows. */
    val MAX_SIZE: SecurityStatusSize = SecurityStatusSize(cols = 2, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: SecurityStatusSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: SecurityStatusSize): SecurityStatusSize =
        SecurityStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/**
 * Which security reading a [SecurityCell] represents; the render layer resolves its glyph from this. Mirrors
 * the four cells the web `useMemo` builds (lock / sentry / doors / windows).
 */
enum class SecurityCellKind {
    /** Lock state (web `Lock`/`Unlock` icon). */
    Lock,

    /** Sentry-mode state (web `ShieldCheck`/`Shield` icon). */
    Sentry,

    /** Door open/closed summary (web `DoorOpen` icon). */
    Doors,

    /** Window open/closed summary (web `AppWindow` icon). */
    Windows,
}

/**
 * The tone of a [SecurityCell] — the native analogue of the web `StatusCell.status` union the shared
 * `WidgetStatusGrid` colours. The render layer maps each onto a theme status colour for the cell wash + dot.
 */
enum class CellStatus {
    /** All-good (web `'ok'`) — success tint. */
    Ok,

    /** Attention (web `'warning'`) — warning tint (one or more doors/windows open). */
    Warning,

    /** Problem (web `'error'`) — danger tint (unlocked). */
    Error,

    /** Off / not-engaged (web `'inactive'`) — muted tint (sentry off). */
    Inactive,
}

/**
 * One render-ready status cell — the native analogue of a web `StatusCell`. Pure data (no Compose types) so
 * every branch is unit-tested directly.
 *
 * @property kind which reading this represents (drives the icon).
 * @property status the cell tone (drives the wash + dot colour).
 * @property label the localized row label (web `cell.label`).
 * @property value the localized row value (web `cell.value`).
 */
data class SecurityCell(
    val kind: SecurityCellKind,
    val status: CellStatus,
    val label: String,
    val value: String,
)

/**
 * The fully projected, render-ready view of the security snapshot — the native analogue of the `cells`
 * array the web component computes before returning JSX. Pure data (no Compose types) so every branch is
 * unit-tested directly.
 *
 * @property hasData whether a security snapshot object was decoded (web `securityData` truthy); when false
 *   the surface renders its empty state instead of the grid (the web `cells.length === 0` branch).
 * @property cells the ordered status cells to render (lock, sentry, doors, windows), or empty when there is
 *   no snapshot.
 * @property contentDescription a folded TalkBack phrase summarising the grid (title + every label/value),
 *   or the bare title when there is no data.
 */
data class SecurityStatusDisplay(
    val hasData: Boolean,
    val cells: List<SecurityCell>,
    val contentDescription: String,
)

/**
 * The localized strings this surface needs — the native mirror of the twelve `t('widget.…')` calls the web
 * component makes. Resolved once at the render boundary (P1/S10) and passed into [SecurityStatusProjection]
 * so the projection stays framework-free yet fully localized, exactly as the sibling LiveSignalsWidget does.
 */
data class SecurityStatusStrings(
    val security: String,
    val lock: String,
    val locked: String,
    val unlocked: String,
    val sentry: String,
    val active: String,
    val off: String,
    val doors: String,
    val windows: String,
    val allClosed: String,
    val open: String,
)

/**
 * The pure decoded security state — the "data adapter" output the web `useMemo` derives before it maps to
 * cells. No strings, no Compose: just the booleans and open-counts the cell tones/values are computed from,
 * so the parsing rules (door/window open detection reproduced from the web source) are unit-tested in
 * isolation.
 *
 * @property hasData whether a security object was decoded (web `securityData` truthy).
 * @property locked web `securityData.locked` (a missing / non-boolean value reads as unlocked).
 * @property sentryMode web `securityData.sentry_mode` (likewise reads as off when absent).
 * @property openDoorCount the number of open doors (web `openDoors.length`).
 * @property openWindowCount the number of open windows (web `openWindows.length`).
 */
data class SecurityReadout(
    val hasData: Boolean,
    val locked: Boolean,
    val sentryMode: Boolean,
    val openDoorCount: Int,
    val openWindowCount: Int,
) {
    companion object {
        /** The no-snapshot readout (web `securityData == null`): the surface shows its empty state. */
        val EMPTY: SecurityReadout =
            SecurityReadout(
                hasData = false,
                locked = false,
                sentryMode = false,
                openDoorCount = 0,
                openWindowCount = 0,
            )

        /**
         * Decode [snapshot] into the pure readout — the native port of the field reads + open-detection in
         * `SecurityStatusWidget.tsx`. A `null`/`JsonNull`/non-object snapshot yields [EMPTY] (web's falsy
         * `securityData` branch).
         */
        fun from(snapshot: JsonElement?): SecurityReadout {
            val obj = snapshot as? JsonObject ?: return EMPTY
            return SecurityReadout(
                hasData = true,
                locked = obj.boolField(FIELD_LOCKED),
                sentryMode = obj.boolField(FIELD_SENTRY_MODE),
                openDoorCount = openDoorCount(obj[FIELD_DOOR_STATE]),
                openWindowCount = WINDOW_FIELDS.count { windowIsOpen(obj[it]) },
            )
        }
    }
}

/**
 * Pure projection from a decoded security snapshot [JsonElement] to the render-ready
 * [SecurityStatusDisplay] — the native port of the `cells` `useMemo` in `SecurityStatusWidget.tsx`. The web
 * builds four cells (lock / sentry / doors / windows) with an `ok`/`warning`/`error`/`inactive` status and
 * a localized value, and renders the empty state when `securityData` is falsy. This reproduces those exact
 * tones + values against the typed contract.
 */
object SecurityStatusProjection {
    /**
     * Project [snapshot] into the render model using the localized [strings]. A `null`/`JsonNull`/non-object
     * snapshot yields a no-cell display (web's `cells.length === 0` → `<EmptyState/>`).
     */
    fun project(
        snapshot: JsonElement?,
        strings: SecurityStatusStrings,
    ): SecurityStatusDisplay {
        val readout = SecurityReadout.from(snapshot)
        if (!readout.hasData) {
            return SecurityStatusDisplay(hasData = false, cells = emptyList(), contentDescription = strings.security)
        }

        val cells =
            listOf(
                SecurityCell(
                    kind = SecurityCellKind.Lock,
                    status = if (readout.locked) CellStatus.Ok else CellStatus.Error,
                    label = strings.lock,
                    value = if (readout.locked) strings.locked else strings.unlocked,
                ),
                SecurityCell(
                    kind = SecurityCellKind.Sentry,
                    status = if (readout.sentryMode) CellStatus.Ok else CellStatus.Inactive,
                    label = strings.sentry,
                    value = if (readout.sentryMode) strings.active else strings.off,
                ),
                SecurityCell(
                    kind = SecurityCellKind.Doors,
                    status = if (readout.openDoorCount == 0) CellStatus.Ok else CellStatus.Warning,
                    label = strings.doors,
                    value = openSummary(readout.openDoorCount, strings),
                ),
                SecurityCell(
                    kind = SecurityCellKind.Windows,
                    status = if (readout.openWindowCount == 0) CellStatus.Ok else CellStatus.Warning,
                    label = strings.windows,
                    value = openSummary(readout.openWindowCount, strings),
                ),
            )

        return SecurityStatusDisplay(
            hasData = true,
            cells = cells,
            contentDescription = describe(strings.security, cells),
        )
    }

    /** True when [snapshot] carries no security object (web `securityData` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** The doors/windows value: `All Closed` when none are open, else "{n} Open" (web `${n} ${t('open')}`). */
    fun openSummary(
        openCount: Int,
        strings: SecurityStatusStrings,
    ): String = if (openCount == 0) strings.allClosed else "$openCount ${strings.open}"

    /** Folds the title + each cell's label/value into one TalkBack phrase (web's implicit reading order). */
    private fun describe(
        title: String,
        cells: List<SecurityCell>,
    ): String = (listOf(title) + cells.map { "${it.label}, ${it.value}" }).joinToString(", ")
}

/**
 * Counts open doors from the `door_state` value — the native port of the web door logic
 * (`door_state === true ? ['open'] : door_state.split(',').filter(s => s.toLowerCase().includes('open'))`).
 * A native boolean `true` counts as one open door; a comma-separated string contributes one per segment
 * containing `open`; anything else (false / number / null / blank / object) is zero.
 */
internal fun openDoorCount(value: JsonElement?): Int {
    val primitive = value as? JsonPrimitive
    if (primitive != null && !primitive.isString && primitive.booleanOrNull == true) return 1
    // A blank/absent string splits to a single empty segment that the filter drops → zero open doors.
    val raw = primitive?.takeIf { it.isString }?.content.orEmpty()
    return raw
        .split(DOOR_DELIMITER)
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .count { it.contains(DOOR_OPEN_TOKEN, ignoreCase = true) }
}

/**
 * Whether a single window corner is open — the native port of the web window predicate
 * (`typeof w === 'boolean' ? w : (!!asNonEmptyString(w) && w.toLowerCase() !== 'closed')`). A native boolean
 * carries through directly; a non-empty string is open unless it equals `closed`; everything else is closed.
 */
internal fun windowIsOpen(value: JsonElement?): Boolean {
    val primitive = value as? JsonPrimitive ?: return false
    return if (primitive.isString) {
        val text = primitive.content
        text.isNotEmpty() && !text.equals(WINDOW_CLOSED, ignoreCase = true)
    } else {
        primitive.booleanOrNull == true
    }
}

/** Read a boolean field, defaulting to `false` when absent / `JsonNull` / not a JSON boolean (web `value ? …`). */
private fun JsonObject.boolField(key: String): Boolean = (this[key] as? JsonPrimitive)?.booleanOrNull ?: false

/**
 * The active vehicle id the widget reads security for — the native port of the web
 * `id = vehicleId ?? vehicles?.[0]?.id ?? 0`. A positive [preferredVehicleId] wins; otherwise the first
 * enrolled vehicle is used; `null` means neither is available (the surface shows its empty state).
 */
fun resolveVehicleId(
    preferredVehicleId: Long?,
    vehicles: List<Vehicle>?,
): Long? = preferredVehicleId?.takeIf { it > 0L } ?: firstVehicleId(vehicles)

/** The first enrolled vehicle's id, or `null` when the fleet list is absent or empty (web `vehicles?.[0]?.id`). */
fun firstVehicleId(vehicles: List<Vehicle>?): Long? = vehicles?.firstOrNull()?.id?.takeIf { it > 0L }
