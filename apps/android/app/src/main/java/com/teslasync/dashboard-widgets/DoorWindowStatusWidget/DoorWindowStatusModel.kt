// Pure, framework-free model + projection for the Door & Window Status dashboard widget — the native
// analogue of the data the web component derives before returning JSX
// (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx). No Compose, no Android framework, no
// HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/DoorWindowStatusWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling SecurityStatusWidget does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.doorwindowstatus

import io.teslasync.shared.core.api.generated.Vehicle
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull

// Security-event fields the web reads off `/security/latest`. `door_state` arrives as either a string enum
// (comma-separated corner segments) or a native boolean, and each of the four window corners as either a
// string enum or a native boolean (web `string | boolean | null`), so the readers below narrow both kinds.
private const val FIELD_DOOR_STATE = "door_state"
private const val FIELD_FD_WINDOW = "fd_window"
private const val FIELD_FP_WINDOW = "fp_window"
private const val FIELD_RD_WINDOW = "rd_window"
private const val FIELD_RP_WINDOW = "rp_window"

// Web parity tokens. The door field is comma-separated (web `door_state.split(',')`); a segment opens a
// corner when it contains `open` plus the corner keywords, and `all_closed`/`allclosed` closes every corner.
private const val DOOR_DELIMITER = ","
private const val DOOR_OPEN_TOKEN = "open"
private const val DOOR_ALL_CLOSED = "all_closed"
private const val DOOR_ALL_CLOSED_ALT = "allclosed"
private const val SIDE_DRIVER = "driver"
private const val SIDE_PASSENGER = "passenger"
private const val SIDE_LEFT = "left"
private const val SIDE_RIGHT = "right"
private const val ROW_FRONT = "front"
private const val ROW_REAR = "rear"

// Window parity tokens: a window string is `closed` exactly, `partial`/`vent` partial, else open.
private const val WINDOW_CLOSED = "closed"
private const val WINDOW_VENT = "vent"
private const val WINDOW_PARTIAL = "partial"

/** The em dash the web renders for an unknown door/window value (`'—'`). */
internal const val EM_DASH = "\u2014"

/**
 * The widget grid footprint (columns × rows). The web `DoorWindowStatusWidget` destructures `size` from
 * `WidgetProps` and branches its layout on it ([isCompact] → two summary badges, otherwise the two status
 * grids; [isTall] → looser section spacing), so this type drives the render exactly as the web `size` does.
 */
data class DoorWindowStatusSize(
    val cols: Int,
    val rows: Int,
) {
    /** Web `size.cols === 1 && size.rows === 1`: collapse to the two summary badges. */
    val isCompact: Boolean get() = cols == 1 && rows == 1

    /** Web `size.rows >= 2`: use the looser inter-section spacing. */
    val isTall: Boolean get() = rows >= 2
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/security.ts (`door-window-status`). A dashboard grid host
 * binds this surface with the same [ID] and honours the same min/max footprint, so the native + web grids
 * stay in lockstep.
 */
object DoorWindowStatusRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "door-window-status"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "security"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "DoorWindowStatusWidget"

    /** Default footprint: 2 columns × 2 rows. */
    val DEFAULT_SIZE: DoorWindowStatusSize = DoorWindowStatusSize(cols = 2, rows = 2)

    /** Minimum footprint: 1 column × 2 rows. */
    val MIN_SIZE: DoorWindowStatusSize = DoorWindowStatusSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val MAX_SIZE: DoorWindowStatusSize = DoorWindowStatusSize(cols = 4, rows = 40)

    /** True when [size] falls within the inclusive min/max footprint constraints. */
    fun isWithinBounds(size: DoorWindowStatusSize): Boolean =
        size.cols in MIN_SIZE.cols..MAX_SIZE.cols && size.rows in MIN_SIZE.rows..MAX_SIZE.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: DoorWindowStatusSize): DoorWindowStatusSize =
        DoorWindowStatusSize(
            cols = size.cols.coerceIn(MIN_SIZE.cols, MAX_SIZE.cols),
            rows = size.rows.coerceIn(MIN_SIZE.rows, MAX_SIZE.rows),
        )
}

/** A single door/window position — the four corners the web `parseDoorStates`/window map key on. */
enum class Corner {
    /** Front left (web `fl`, door driver-front / window `fd_window`). */
    FL,

    /** Front right (web `fr`, door passenger-front / window `fp_window`). */
    FR,

    /** Rear left (web `rl`, door driver-rear / window `rd_window`). */
    RL,

    /** Rear right (web `rr`, door passenger-rear / window `rp_window`). */
    RR,
}

/** The decoded state of one door or window — the native analogue of the web `DoorWindowState` union. */
enum class OpenState {
    /** Closed (web `'closed'`). */
    Closed,

    /** Fully open (web `'open'`). */
    Open,

    /** Vented / partially open (web `'partial'`). */
    Partial,

    /** No reading available (web `'unknown'`). */
    Unknown,
}

/**
 * The tone of a [DoorWindowCell] — the native analogue of the web `StatusCell.status` the shared
 * `WidgetStatusGrid` colours via `toGridStatus`. The render layer maps each onto a theme status colour.
 */
enum class CellStatus {
    /** All-good (web `'ok'`) — success tint (closed). */
    Ok,

    /** Attention (web `'warning'`) — warning tint (open or partial). */
    Warning,

    /** No reading (web `'unknown'`) — muted tint. */
    Unknown,
}

/**
 * One render-ready status cell — the native analogue of a web `StatusCell`. Pure data (no Compose types) so
 * every branch is unit-tested directly.
 *
 * @property corner which position this represents (drives the section + grid placement).
 * @property status the cell tone (drives the wash + dot colour).
 * @property label the localized position label (web `cell.label`, e.g. "Front Left").
 * @property value the localized state value (web `cell.value`, e.g. "Closed" / "Open" / "Partial" / "—").
 */
data class DoorWindowCell(
    val corner: Corner,
    val status: CellStatus,
    val label: String,
    val value: String,
)

/**
 * A compact-mode summary chip — the native analogue of the two web `<Badge>`s rendered when `isCompact`.
 *
 * @property isWarning web `variant='warning'` (some open) vs `variant='success'` (all closed).
 * @property text the localized summary (web "Doors ✓" / "{n} door(s) open" and the window equivalent).
 */
data class DoorWindowBadge(
    val isWarning: Boolean,
    val text: String,
)

/**
 * The localized strings this surface needs — the native mirror of the fifteen `t('widget.doorWindow.…')`
 * calls the web component makes. Resolved once at the render boundary (P1/S10) and passed into
 * [DoorWindowStatusProjection] so the projection stays framework-free yet fully localized, exactly as the
 * sibling SecurityStatusWidget does.
 */
data class DoorWindowStatusStrings(
    val title: String,
    val doors: String,
    val windows: String,
    val closed: String,
    val open: String,
    val partial: String,
    val frontLeft: String,
    val frontRight: String,
    val rearLeft: String,
    val rearRight: String,
    val doorsAllClosed: String,
    val doorsOpen: String,
    val windowsAllClosed: String,
    val windowsOpen: String,
    val noData: String,
)

/**
 * The pure decoded door/window state — the "data adapter" output the web `useMemo`s derive before they map
 * to cells. No strings, no Compose: just the per-corner states and the open counts, so the parsing rules
 * (reproduced from the web source, including the native boolean vs. string-enum forms) are unit-tested in
 * isolation.
 *
 * @property hasData whether a security object was decoded (web `securityData` truthy).
 * @property doors the four door states keyed by [Corner] (web `doors`).
 * @property windows the four window states keyed by [Corner] (web `windows`).
 * @property openDoorCount doors in the [OpenState.Open] state (web `openDoorCount`).
 * @property openWindowCount windows that are neither closed nor unknown — open or partial (web
 *   `openWindowCount`).
 */
data class DoorWindowReadout(
    val hasData: Boolean,
    val doors: Map<Corner, OpenState>,
    val windows: Map<Corner, OpenState>,
    val openDoorCount: Int,
    val openWindowCount: Int,
) {
    companion object {
        /** The no-snapshot readout (web `securityData == null`): the surface shows its empty state. */
        val EMPTY: DoorWindowReadout =
            DoorWindowReadout(
                hasData = false,
                doors = allCorners(OpenState.Unknown),
                windows = allCorners(OpenState.Unknown),
                openDoorCount = 0,
                openWindowCount = 0,
            )

        /**
         * Decode [snapshot] into the pure readout — the native port of the field reads + door/window
         * parsing in `DoorWindowStatusWidget.tsx`. A `null`/`JsonNull`/non-object snapshot yields [EMPTY]
         * (web's falsy `securityData` branch).
         */
        fun from(snapshot: JsonElement?): DoorWindowReadout {
            val obj = snapshot as? JsonObject ?: return EMPTY
            val doors = parseDoorStates(obj[FIELD_DOOR_STATE])
            val windows =
                mapOf(
                    Corner.FL to parseWindowState(obj[FIELD_FD_WINDOW]),
                    Corner.FR to parseWindowState(obj[FIELD_FP_WINDOW]),
                    Corner.RL to parseWindowState(obj[FIELD_RD_WINDOW]),
                    Corner.RR to parseWindowState(obj[FIELD_RP_WINDOW]),
                )
            return DoorWindowReadout(
                hasData = true,
                doors = doors,
                windows = windows,
                openDoorCount = doors.values.count { it == OpenState.Open },
                openWindowCount = windows.values.count { it != OpenState.Closed && it != OpenState.Unknown },
            )
        }
    }
}

/**
 * The fully projected, render-ready view — the native analogue of the values the web component computes
 * before returning JSX. Pure data (no Compose types) so every branch is unit-tested directly.
 *
 * @property hasData whether a security snapshot was decoded; when false the surface renders its empty state
 *   (the web `securityData ? … : <EmptyState/>` branch).
 * @property compact web `isCompact` — render the two summary badges instead of the grids.
 * @property tall web `isTall` — use the looser inter-section spacing.
 * @property doorCells the four door status cells (web `doorCells`).
 * @property windowCells the four window status cells (web `windowCells`).
 * @property doorBadge the compact-mode doors summary chip (web first `<Badge>`).
 * @property windowBadge the compact-mode windows summary chip (web second `<Badge>`).
 * @property contentDescription a folded TalkBack phrase summarising the surface for its rendered mode.
 */
data class DoorWindowStatusDisplay(
    val hasData: Boolean,
    val compact: Boolean,
    val tall: Boolean,
    val doorCells: List<DoorWindowCell>,
    val windowCells: List<DoorWindowCell>,
    val doorBadge: DoorWindowBadge,
    val windowBadge: DoorWindowBadge,
    val contentDescription: String,
)

/**
 * Pure projection from a decoded security snapshot [JsonElement] to the render-ready
 * [DoorWindowStatusDisplay] — the native port of the door/window `useMemo`s in `DoorWindowStatusWidget.tsx`.
 * The web builds four door cells + four window cells (each `ok`/`warning`/`unknown` with a localized value),
 * a pair of compact summary badges, and renders the empty state when `securityData` is falsy. This
 * reproduces those exact tones + values against the typed contract.
 */
object DoorWindowStatusProjection {
    private const val SEP = ", "

    /**
     * Project [snapshot] at the given [size] into the render model using the localized [strings]. A
     * `null`/`JsonNull`/non-object snapshot yields a no-data display (web's `<EmptyState/>` branch); the
     * door/window cells and summary badges are otherwise always computed so the layout can switch on [size]
     * without re-deriving the contract.
     */
    fun project(
        snapshot: JsonElement?,
        size: DoorWindowStatusSize,
        strings: DoorWindowStatusStrings,
    ): DoorWindowStatusDisplay {
        val readout = DoorWindowReadout.from(snapshot)
        val base =
            DoorWindowStatusDisplay(
                hasData = readout.hasData,
                compact = size.isCompact,
                tall = size.isTall,
                doorCells = Corner.entries.map { cellOf(it, readout.doors.getValue(it), strings) },
                windowCells = Corner.entries.map { cellOf(it, readout.windows.getValue(it), strings) },
                doorBadge = doorBadge(readout.openDoorCount, strings),
                windowBadge = windowBadge(readout.openWindowCount, strings),
                contentDescription = "",
            )
        return base.copy(contentDescription = describe(base, strings))
    }

    /** True when [snapshot] carries no security object (web `securityData` falsy) → render the empty state. */
    fun isEmptySnapshot(snapshot: JsonElement?): Boolean = snapshot !is JsonObject

    /** The doors summary chip: `Doors ✓` when none open, else "{n} door(s) open" (web first `<Badge>`). */
    fun doorBadge(
        openDoorCount: Int,
        strings: DoorWindowStatusStrings,
    ): DoorWindowBadge =
        DoorWindowBadge(
            isWarning = openDoorCount != 0,
            text = if (openDoorCount == 0) strings.doorsAllClosed else "$openDoorCount ${strings.doorsOpen}",
        )

    /** The windows summary chip: `Windows ✓` when none open, else "{n} window(s) open" (web second `<Badge>`). */
    fun windowBadge(
        openWindowCount: Int,
        strings: DoorWindowStatusStrings,
    ): DoorWindowBadge =
        DoorWindowBadge(
            isWarning = openWindowCount != 0,
            text = if (openWindowCount == 0) strings.windowsAllClosed else "$openWindowCount ${strings.windowsOpen}",
        )

    private fun cellOf(
        corner: Corner,
        state: OpenState,
        strings: DoorWindowStatusStrings,
    ): DoorWindowCell =
        DoorWindowCell(
            corner = corner,
            status = toGridStatus(state),
            label = cornerLabel(corner, strings),
            value = toValueLabel(state, strings),
        )

    private fun describe(
        display: DoorWindowStatusDisplay,
        strings: DoorWindowStatusStrings,
    ): String =
        when {
            !display.hasData -> strings.title
            display.compact ->
                listOf(strings.title, display.doorBadge.text, display.windowBadge.text).joinToString(SEP)
            else ->
                buildList {
                    add(strings.title)
                    add(strings.doors)
                    display.doorCells.forEach { add("${it.label}$SEP${it.value}") }
                    add(strings.windows)
                    display.windowCells.forEach { add("${it.label}$SEP${it.value}") }
                }.joinToString(SEP)
        }
}

/** Per-state cell tone — the native mirror of the web `toGridStatus` map (closed→ok, open/partial→warning). */
fun toGridStatus(state: OpenState): CellStatus =
    when (state) {
        OpenState.Closed -> CellStatus.Ok
        OpenState.Open, OpenState.Partial -> CellStatus.Warning
        OpenState.Unknown -> CellStatus.Unknown
    }

/** The localized cell value — the native mirror of the web `toValueLabel` (unknown → the em dash `'—'`). */
fun toValueLabel(
    state: OpenState,
    strings: DoorWindowStatusStrings,
): String =
    when (state) {
        OpenState.Closed -> strings.closed
        OpenState.Open -> strings.open
        OpenState.Partial -> strings.partial
        OpenState.Unknown -> EM_DASH
    }

/**
 * Parse the `door_state` value into the four corner states — the native port of the web `parseDoorStates`.
 * A native boolean opens/closes every corner; a comma-separated string starts every corner closed and opens
 * the corner(s) named by each `open` segment (or all four for a bare `open`), with `all_closed` closing
 * everything; anything else (number / null / blank) yields all-unknown (web's falsy `asNonEmptyString`).
 */
internal fun parseDoorStates(value: JsonElement?): Map<Corner, OpenState> {
    val primitive = value as? JsonPrimitive
    return if (primitive != null && !primitive.isString) {
        allCorners(booleanState(primitive.booleanOrNull))
    } else {
        doorsFromString(primitive?.takeIf { it.isString }?.content.orEmpty())
    }
}

/**
 * Parse a single window corner value — the native port of the web `parseWindowState`. A native boolean is
 * open/closed; a string is `closed` only on an exact match, partial when it contains `vent`/`partial`, else
 * open; an empty string (or non-string/non-boolean) is unknown (web's `length > 0` check, no trim).
 */
internal fun parseWindowState(value: JsonElement?): OpenState {
    val primitive = value as? JsonPrimitive ?: return OpenState.Unknown
    return if (primitive.isString) windowStateFromString(primitive.content) else booleanState(primitive.booleanOrNull)
}

private fun doorsFromString(raw: String): Map<Corner, OpenState> {
    val parts = raw.split(DOOR_DELIMITER).map { it.trim().lowercase() }.filter { it.isNotEmpty() }
    return when {
        parts.isEmpty() -> allCorners(OpenState.Unknown)
        parts.any { it == DOOR_ALL_CLOSED || it == DOOR_ALL_CLOSED_ALT } -> allCorners(OpenState.Closed)
        else -> doorsFromParts(parts)
    }
}

private fun doorsFromParts(parts: List<String>): Map<Corner, OpenState> {
    val result = allCorners(OpenState.Closed).toMutableMap()
    for (part in parts) {
        val corner = openedCorner(part)
        when {
            corner != null -> result[corner] = OpenState.Open
            part == DOOR_OPEN_TOKEN -> Corner.entries.forEach { result[it] = OpenState.Open }
        }
    }
    return result
}

// Web `parseDoorStates` corner precedence: the driver/passenger × front/rear rules are matched before the
// front/rear × left/right fallbacks (the order of the web `else if` chain), so the first matching rule in
// this list wins — exactly as the web chain short-circuits on the first satisfied condition.
private val OPEN_CORNER_RULES: List<Triple<String, String, Corner>> =
    listOf(
        Triple(SIDE_DRIVER, ROW_FRONT, Corner.FL),
        Triple(SIDE_PASSENGER, ROW_FRONT, Corner.FR),
        Triple(SIDE_DRIVER, ROW_REAR, Corner.RL),
        Triple(SIDE_PASSENGER, ROW_REAR, Corner.RR),
        Triple(ROW_FRONT, SIDE_LEFT, Corner.FL),
        Triple(ROW_FRONT, SIDE_RIGHT, Corner.FR),
        Triple(ROW_REAR, SIDE_LEFT, Corner.RL),
        Triple(ROW_REAR, SIDE_RIGHT, Corner.RR),
    )

private fun openedCorner(part: String): Corner? {
    if (!part.contains(DOOR_OPEN_TOKEN)) return null
    return OPEN_CORNER_RULES
        .firstOrNull { part.contains(it.first) && part.contains(it.second) }
        ?.third
}

private fun windowStateFromString(raw: String): OpenState =
    when {
        raw.isEmpty() -> OpenState.Unknown
        raw.equals(WINDOW_CLOSED, ignoreCase = true) -> OpenState.Closed
        raw.contains(WINDOW_VENT, ignoreCase = true) || raw.contains(WINDOW_PARTIAL, ignoreCase = true) -> OpenState.Partial
        else -> OpenState.Open
    }

private fun booleanState(value: Boolean?): OpenState =
    when (value) {
        true -> OpenState.Open
        false -> OpenState.Closed
        null -> OpenState.Unknown
    }

private fun cornerLabel(
    corner: Corner,
    strings: DoorWindowStatusStrings,
): String =
    when (corner) {
        Corner.FL -> strings.frontLeft
        Corner.FR -> strings.frontRight
        Corner.RL -> strings.rearLeft
        Corner.RR -> strings.rearRight
    }

private fun allCorners(state: OpenState): Map<Corner, OpenState> = Corner.entries.associateWith { state }

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
