// The framework-free model backing the native GeofencesPage maps surface (P3/A7) — the Kotlin mirror of the
// derivation + form logic in web/src/features/maps/pages/GeofencesPage.tsx and its zod schema
// (web/src/features/maps/schemas/geofence.ts). It owns the surface identity ([GeofencesPageRegistration]), the
// alert-type derivation + summary statistics the metric cards read, the search filter + pinned-first ordering the
// list reads (web `useFilteredList` + `usePinned` sort), the create/edit form snapshot + validation (the zod
// `geofenceFormSchema` bounds), the `POST/PUT /geofences` request body (web `toGeofencePayload`), and the one-shot
// `view.opened` diagnostic (P1/S11). Everything here is plain Kotlin (no Compose, no Android, no coroutines) so it
// is covered by fast JVM unit tests and reused unchanged by the stateless screen + the state holder.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/maps) diverges from the
// `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.maps.geofences

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.locations.Geofence
import io.teslasync.shared.core.presentation.pinned.PinnedItem
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `GeofencesPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `page("geofences", "/geofences", NavGroup.Maps)`, so [io.teslasync.android.navigation.PageHosts] binds this
 * surface to that destination (and its `/geofences` deep link) without the nav module depending on it.
 */
object GeofencesPageRegistration {
    /** The navigation destination id (Destinations.kt `page("geofences", "/geofences", …)`). */
    const val ROUTE_ID: String = "geofences"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/geofences"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no geofence id. */
    const val SLUG: String = "GeofencesPage"

    /** The zod `name.max(120)` bound (web schema) — also the inline-rename limit (`geofences.error.nameTooLong`). */
    const val NAME_MAX: Int = 120

    /** The zod radius bounds (web `numericString('Radius', { min: 10, max: 50000 })`), SI meters. */
    const val RADIUS_MIN: Double = 10.0
    const val RADIUS_MAX: Double = 50000.0

    /** The zod latitude/longitude bounds (web `numericString` envelopes), degrees. */
    const val LAT_MIN: Double = -90.0
    const val LAT_MAX: Double = 90.0
    const val LNG_MIN: Double = -180.0
    const val LNG_MAX: Double = 180.0

    /** The web `EMPTY_FORM.radius` default, SI meters. */
    const val DEFAULT_RADIUS: String = "100"
}

// ── Alert type (web getAlertType / alertBadge*) ───────────────────────────────────────────────────────────────

/**
 * The four alert dispositions a geofence can carry — the port of the web `GeofenceAlertType` union
 * (`entry` | `exit` | `both` | `none`). [wire] is the form value used by the alert-type select; the persisted
 * geofence carries the orthogonal [Geofence.alertOnEntry]/[Geofence.alertOnExit] flags this folds to/from.
 */
enum class GeofenceAlertType(val wire: String) {
    Both("both"),
    Entry("entry"),
    Exit("exit"),
    None("none"),
    ;

    /** Whether this disposition arms the entry alert (web `alertOnEntry = type === 'entry' || 'both'`). */
    val alertOnEntry: Boolean get() = this == Both || this == Entry

    /** Whether this disposition arms the exit alert (web `alertOnExit = type === 'exit' || 'both'`). */
    val alertOnExit: Boolean get() = this == Both || this == Exit

    companion object {
        /** Parses a form [wire] value back to the enum, defaulting to [Both] (the web `EMPTY_FORM.alertType`). */
        fun fromWire(wire: String): GeofenceAlertType = entries.firstOrNull { it.wire == wire } ?: Both
    }
}

/** Derives the alert disposition from a persisted geofence's flags (web `getAlertType`). */
fun alertTypeOf(geofence: Geofence): GeofenceAlertType =
    when {
        geofence.alertOnEntry && geofence.alertOnExit -> GeofenceAlertType.Both
        geofence.alertOnEntry -> GeofenceAlertType.Entry
        geofence.alertOnExit -> GeofenceAlertType.Exit
        else -> GeofenceAlertType.None
    }

// ── Summary statistics (web stats useMemo) ────────────────────────────────────────────────────────────────────

/** The four summary metrics the stat cards read (web `stats`). */
data class GeofenceStats(
    val total: Int,
    val active: Int,
    val entryAlerts: Int,
    val exitAlerts: Int,
)

/** Folds the geofence list into its summary metrics (web `stats` useMemo). */
fun deriveGeofenceStats(geofences: List<Geofence>): GeofenceStats =
    GeofenceStats(
        total = geofences.size,
        active = geofences.count { it.enabled },
        entryAlerts = geofences.count { it.alertOnEntry },
        exitAlerts = geofences.count { it.alertOnExit },
    )

// ── List shaping (web useFilteredList + usePinned sort) ───────────────────────────────────────────────────────

/** Filters geofences by a case-insensitive name match (web `useFilteredList(geofences, search, ['name'])`). */
fun filterGeofences(
    geofences: List<Geofence>,
    query: String,
): List<Geofence> {
    val needle = query.trim().lowercase()
    if (needle.isEmpty()) return geofences
    return geofences.filter { it.name.lowercase().contains(needle) }
}

/**
 * Sorts the filtered list pinned-first by pin position (web `sortedGeofences`): geofences with a pin keep their
 * relative pin order ahead of the rest, which retain their incoming order. A no-pin input returns the list
 * unchanged, exactly as the web memo short-circuits on an empty pin set.
 */
fun sortGeofencesByPins(
    geofences: List<Geofence>,
    pins: List<PinnedItem>,
): List<Geofence> {
    if (pins.isEmpty()) return geofences
    val order = pins.associate { it.itemId to it.position }
    return geofences.sortedWith(
        compareBy(
            { order[it.id.toString()] == null },
            { order[it.id.toString()] ?: Int.MAX_VALUE },
        ),
    )
}

// ── Form (web GeofenceFormData + EMPTY_FORM) ──────────────────────────────────────────────────────────────────

/** Where the create modal's coordinates are sourced from (web `LocationSource`). */
enum class GeofenceLocationSource { Vehicle, Browser, Map }

/**
 * The controlled create/edit form snapshot (web `GeofenceFormData`) — lat/lng/radius are held as strings exactly
 * as the web `<input type="number">` cells are, parsed only on submit by [geofenceRequestBody] / validation.
 */
data class GeofenceFormData(
    val name: String = "",
    val latitude: String = "",
    val longitude: String = "",
    val radius: String = GeofencesPageRegistration.DEFAULT_RADIUS,
    val alertType: GeofenceAlertType = GeofenceAlertType.Both,
    val enabled: Boolean = true,
) {
    companion object {
        /** The web `EMPTY_FORM`. */
        val EMPTY: GeofenceFormData = GeofenceFormData()

        /** Snapshots an existing geofence into an editable form (web `openEdit`). */
        fun fromGeofence(geofence: Geofence): GeofenceFormData =
            GeofenceFormData(
                name = geofence.name,
                latitude = geofence.latitude.toString(),
                longitude = geofence.longitude.toString(),
                radius = geofence.radius.toLong().toString(),
                alertType = alertTypeOf(geofence),
                enabled = geofence.enabled,
            )
    }
}

/** Per-field validation outcome (web zod `safeParse` issue map, reduced to the catalog-backed display cases). */
data class GeofenceFormErrors(
    val nameRequired: Boolean = false,
    val nameTooLong: Boolean = false,
    val latitude: Boolean = false,
    val longitude: Boolean = false,
    val radius: Boolean = false,
) {
    /** True when any field fails (web `!parsed.success` ⇒ the `forms.validationFailed` banner). */
    val hasError: Boolean
        get() = nameRequired || nameTooLong || latitude || longitude || radius
}

private fun Double.inClosed(
    min: Double,
    max: Double,
): Boolean = this in min..max

/**
 * Parses a trimmed numeric form field to a [Double], or null when blank/non-numeric — the web `Number(value)`
 * guarded by the zod `Number.isNaN` refine. The single numeric-parse site for the surface.
 */
fun parseFormNumber(raw: String): Double? = raw.trim().toDoubleOrNull() // parity:allow Kotlin stdlib numeric parse, not a stub marker

/** Validates the form against the zod `geofenceFormSchema` bounds (web `geofenceFormSchema.safeParse`). */
fun validateGeofenceForm(form: GeofenceFormData): GeofenceFormErrors {
    val name = form.name.trim()
    val lat = parseFormNumber(form.latitude)
    val lng = parseFormNumber(form.longitude)
    val radius = parseFormNumber(form.radius)
    return GeofenceFormErrors(
        nameRequired = name.isEmpty(),
        nameTooLong = name.length > GeofencesPageRegistration.NAME_MAX,
        latitude = lat == null || !lat.inClosed(GeofencesPageRegistration.LAT_MIN, GeofencesPageRegistration.LAT_MAX),
        longitude = lng == null || !lng.inClosed(GeofencesPageRegistration.LNG_MIN, GeofencesPageRegistration.LNG_MAX),
        radius = radius == null || !radius.inClosed(GeofencesPageRegistration.RADIUS_MIN, GeofencesPageRegistration.RADIUS_MAX),
    )
}

/**
 * Whether the submit button is enabled — the web `hasMinimalInput` heuristic: every required string is non-blank
 * so the button feels responsive, with the full range check deferred to [validateGeofenceForm] on submit.
 */
fun hasMinimalInput(form: GeofenceFormData): Boolean =
    form.name.isNotBlank() &&
        form.latitude.isNotBlank() &&
        form.longitude.isNotBlank() &&
        form.radius.isNotBlank()

/**
 * Builds the `POST/PUT /geofences` request body, mirroring the web
 * `{ ...toGeofencePayload(parsed.data), costPerKwh: null }`: the numeric coordinates + radius, the two alert
 * flags folded from the form's [GeofenceAlertType], the enabled flag, and the always-null `costPerKwh` the web
 * sends. Coordinates/radius are SI (degrees, meters) and round-trip verbatim. Caller guarantees the form has
 * already passed [validateGeofenceForm], so the numeric parses below cannot fail.
 */
fun geofenceRequestBody(form: GeofenceFormData): JsonObject =
    buildJsonObject {
        put("name", form.name.trim())
        put("latitude", parseFormNumber(form.latitude) ?: 0.0)
        put("longitude", parseFormNumber(form.longitude) ?: 0.0)
        put("radius", parseFormNumber(form.radius) ?: 0.0)
        put("alertOnEntry", form.alertType.alertOnEntry)
        put("alertOnExit", form.alertType.alertOnExit)
        put("enabled", form.enabled)
        put("costPerKwh", JsonNull)
    }

// ── Interaction state (web useState cells) ────────────────────────────────────────────────────────────────────

/** A WGS-84 coordinate resolved from a vehicle's latest position (web `Get Location` ▸ reverse-geocode source). */
data class GeoCoordinate(
    val latitude: Double,
    val longitude: Double,
)

/**
 * The create/edit modal's local state (web `modalOpen` + `editingId` + `form` + `fieldErrors` + `formError` +
 * `locationSource` + `selectedVehicleId` + `locationLoading` + the saving flag). A null [GeofencesInteraction.modal]
 * means the modal is closed; [editingId] null means a create, non-null an edit.
 */
data class GeofenceModalState(
    val editingId: Long? = null,
    val form: GeofenceFormData = GeofenceFormData.EMPTY,
    val errors: GeofenceFormErrors = GeofenceFormErrors(),
    val showValidationBanner: Boolean = false,
    val locationSource: GeofenceLocationSource = GeofenceLocationSource.Vehicle,
    val selectedVehicleId: Long = 0L,
    val locationLoading: Boolean = false,
    val saving: Boolean = false,
)

/**
 * The page's local interaction snapshot — the native mirror of the web page's `useState` cells: the list search
 * query, the bulk-selection set, the AI pick-location raw input, the open create/edit [modal], the pending
 * [deleteTarget], and whether a delete is in flight ([deleting]).
 */
data class GeofencesInteraction(
    val search: String = "",
    val selectedIds: Set<Long> = emptySet(),
    val aiLocationRaw: String = "",
    val modal: GeofenceModalState? = null,
    val deleteTarget: Geofence? = null,
    val deleting: Boolean = false,
)

// ── Outcomes (web toast.success / toast.error) ────────────────────────────────────────────────────────────────

/**
 * The terminal outcome of a geofence mutation, carrying the web i18n key the render boundary resolves into a
 * transient message (web `toast.success(t('Geofence created'))` / `toast.error(t('Failed to …'))`). The
 * ViewModel emits these through the one-shot event channel; the screen maps [messageKey] to a `stringResource`.
 */
enum class GeofenceOutcome(
    val messageKey: String,
    val isError: Boolean,
) {
    Created("Geofence created", false),
    Updated("Geofence updated", false),
    Deleted("Geofence deleted", false),
    CreateFailed("Failed to create geofence", true),
    UpdateFailed("Failed to update geofence", true),
    ToggleFailed("Failed to toggle geofence", true),
    DeleteFailed("Failed to delete geofence", true),
}

// ── Diagnostics (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────

/** Emits the one PII-safe `view.opened` diagnostic with the surface [GeofencesPageRegistration.SLUG] (P1/S11). */
fun recordGeofencesPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to GeofencesPageRegistration.SLUG))
}
