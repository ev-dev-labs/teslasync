// Pure, framework-free model + data adapter + projection + diagnostics for the VehicleHeader feature view — the
// native analogue of everything the web component derives before returning JSX
// (web/src/features/vehicles/components/VehicleHeader.tsx). No Compose, no Android UI, no HTTP: every declaration
// here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a thin render
// layer.
//
// VehicleHeader is the vehicle-detail page header. The web component renders a back affordance, an identity block
// (a bold title beside a status chip, over a muted "model trim · VIN" subtitle), and a Wake action. Its web hooks
// are `useTranslation` (mapped here to the P1/S10 i18n catalog), `useWakeVehicle` (the wake mutation, mapped to
// the shared command runner the host binds), and the `useVehicles` family that feeds the `vehicle`/`state` props.
// What this pure file owns is every value the web component computes before rendering:
//   • the status token — web `vehicle ? getVehicleStatus(state) : 'offline'` (web `deriveVehicleStatus`), reproduced
//     verbatim in [VehicleHeaderAdapter.deriveVehicleStatus] (charging ⇒ `charging`, moving ⇒ `driving`, a known
//     FSM token passes through, anything else ⇒ `online`, and a missing vehicle/state ⇒ `offline`). The token is
//     handed to the shared `StatusBadge`, which derives its own dot + capitalization — so no tone is computed here;
//   • the title — web `vehicle?.display_name || vehicle?.vin || t('common.vehicle', 'Vehicle')`, exposed as a
//     nullable [VehicleHeaderUiModel.title] (null ⇒ the composable resolves the `common.vehicle` catalog fallback);
//   • the descriptor — web `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}`, exposed as a nullable
//     [VehicleHeaderUiModel.descriptor] (null ⇒ the composable omits the subtitle prefix);
//   • the VIN — web `vehicle?.vin ?? ''`, exposed as a nullable [VehicleHeaderUiModel.vin] (null ⇒ omitted).
// The back affordance, the title, the status chip, and the Wake action render in every state, so the header is
// never a blank box even before the vehicle resolves.
//
// The status TOKEN is handed to `StatusBadge` and shown raw (capitalized by the chip), exactly as the web renders
// `<StatusBadge status={status} />` with no `t()` call — it is a derived FSM token, not prose, and the catalog
// carries no key for it. The only i18n keys this surface uses are `common.vehicle` and `common.wakeUp`.
//
// Field mapping: the web `vehicle.trim_badging` (the trim/badge shown after the model) maps to the native
// OpenAPI-generated `Vehicle.trimLevel` (`trim_level`), the field the backend actually exposes for the trim.
//
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations; `InvalidPackageDeclaration`
// because this surface's mandated directory (com/teslasync/feature-views/VehicleHeader — the P3 prompt's
// allowed-files path) cannot form a valid Kotlin package (a hyphen segment is illegal in a package identifier), so
// the package intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehicleheader

import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.api.generated.VehicleState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehicles.VehicleStateEnvelope
import java.util.Locale

/**
 * The raw header inputs — the native analogue of the web `VehicleHeaderProps` plus the inline-derived `status`.
 * Pure data so the projection is fully covered by the off-device unit gate; every vehicle-derived field is
 * nullable and tolerated, exactly as the web reads `vehicle?.display_name` / `vehicle?.model` /
 * `vehicle?.trim_badging` / `vehicle?.vin` defensively for the not-yet-loaded vehicle.
 *
 * @property displayName the vehicle display name, or null/blank until the vehicle loads (web `vehicle?.display_name`).
 * @property vin the vehicle VIN, or null/blank until the vehicle loads (web `vehicle?.vin`).
 * @property model the vehicle model name, or null/blank until the vehicle loads (web `vehicle?.model`).
 * @property trim the trim badge, or null/blank until the vehicle loads (web `vehicle?.trim_badging`, native `trimLevel`).
 * @property status the derived FSM status token (web `status`), rendered raw through the shared status chip.
 */
data class VehicleHeaderData(
    val displayName: String?,
    val vin: String?,
    val model: String?,
    val trim: String?,
    val status: String,
)

/**
 * The fully projected, render-ready header — the native analogue of the values the web component computes inline
 * before returning JSX. Pure data (no Compose/Android types) so it is asserted directly in the unit gate; the
 * composable only resolves the i18n title/Wake strings, hands [status] to the shared status chip, and paints the
 * projected strings.
 *
 * @property title the bold title text (web `display_name || vin`), or null when neither is present so the
 *   composable resolves the `common.vehicle` fallback (web `|| t('common.vehicle', 'Vehicle')`).
 * @property status the raw status token shown in the status chip (web `{status}`), trimmed.
 * @property descriptor the "model trim" subtitle prefix, or null when no vehicle is loaded so the composable omits
 *   it (web `${model ?? ''} ${trim ?? ''}` collapsed to nothing).
 * @property vin the monospace VIN subtitle, or null when no vehicle is loaded so the composable omits it.
 */
data class VehicleHeaderUiModel(
    val title: String?,
    val status: String,
    val descriptor: String?,
    val vin: String?,
) {
    /**
     * True when there is no vehicle-identity content to show (no title AND no descriptor AND no VIN) — a
     * not-yet-loaded vehicle. The composable still renders the back affordance, the title fallback, the status
     * chip, and the Wake action, so the surface is never a blank box; this flag just records that the identity
     * block collapsed to the fallback title + chip alone.
     */
    val isEmpty: Boolean get() = title == null && descriptor == null && vin == null
}

/**
 * Pure projection from the raw [VehicleHeaderData] to the render-ready [VehicleHeaderUiModel] — the native port of
 * the web component's inline prop derivation. Every branch is deterministic and tolerates null/blank input,
 * matching the web's defensive `||` / `?? ''` reads for the vehicle that has not loaded yet.
 */
object VehicleHeaderProjection {
    /** Project [data] into the render-ready model. */
    fun project(data: VehicleHeaderData): VehicleHeaderUiModel =
        VehicleHeaderUiModel(
            title = title(data.displayName, data.vin),
            status = statusToken(data.status),
            descriptor = descriptor(data.model, data.trim),
            vin = clean(data.vin),
        )

    /**
     * The title text — web `vehicle?.display_name || vehicle?.vin || t('common.vehicle', 'Vehicle')`. The web `||`
     * skips a falsy (empty) value, so a blank display name falls through to the VIN; both blank yields null and the
     * composable resolves the `common.vehicle` catalog fallback.
     */
    fun title(
        displayName: String?,
        vin: String?,
    ): String? = clean(displayName) ?: clean(vin)

    /** The raw status token shown in the chip (web `{status}`), trimmed of incidental whitespace. */
    fun statusToken(status: String): String = status.trim()

    /**
     * The "model trim" subtitle prefix — web `${vehicle?.model ?? ''} ${vehicle?.trim_badging ?? ''}`. Each part is
     * trimmed and empty parts are dropped, so a vehicle with only a model (or only a trim) yields a clean single
     * word and a not-yet-loaded vehicle yields null (the composable then omits the prefix rather than show a blank
     * one or a dangling separator).
     */
    fun descriptor(
        model: String?,
        trim: String?,
    ): String? = listOfNotNull(clean(model), clean(trim)).joinToString(" ").ifEmpty { null }

    /** Trim a raw value, collapsing null/blank to null. */
    private fun clean(raw: String?): String? = raw?.trim()?.ifEmpty { null }
}

/**
 * The data adapter — the cached/state-holder shapes (`vehicle` + `state` envelope, P1/S8) folded into the raw
 * [VehicleHeaderData] the projection consumes. Pure so the cached → projection mapping is covered off-device.
 * Mirrors what the owning page passes the web component: the loaded `vehicle` plus the status derived from the
 * live `state` (`const status = vehicle ? getVehicleStatus(state) : 'offline'`).
 */
object VehicleHeaderAdapter {
    /** The fallback token for a vehicle that has not loaded or whose state is unknown (web default `'offline'`). */
    const val STATUS_OFFLINE: String = "offline"

    /**
     * Vehicle operational tokens that pass through verbatim — the native mirror of the web `VEHICLE_STATES` list
     * (web/src/types/fsm/vehicle.ts), the single source the web `deriveVehicleStatus` validates against.
     */
    private val VEHICLE_STATES: Set<String> =
        setOf("online", "driving", "charging", "parked", "updating", "asleep", "offline")

    /**
     * Fold the cached [vehicle] + [state] envelope into [VehicleHeaderData] — the native port of the web parent's
     * `vehicle` prop plus `const status = vehicle ? getVehicleStatus(state) : 'offline'`. A null [vehicle] yields
     * all-null identity fields and the `offline` token (the not-yet-loaded / error / first-load presentation), so
     * the header degrades to its title fallback + status chip rather than a blank box.
     */
    fun from(
        vehicle: Vehicle?,
        state: VehicleStateEnvelope?,
    ): VehicleHeaderData =
        VehicleHeaderData(
            displayName = vehicle?.displayName,
            vin = vehicle?.vin,
            model = vehicle?.model,
            trim = vehicle?.trimLevel,
            status = if (vehicle == null) STATUS_OFFLINE else deriveVehicleStatus(state?.state),
        )

    /**
     * Derive the display status token from live vehicle [state] — the native port of web `deriveVehicleStatus`:
     * no state ⇒ `offline`; an active charge ⇒ `charging`; any motion (speed > 0) ⇒ `driving`; otherwise a known
     * FSM token passes through and anything else falls back to `online`. Comparison is locale-invariant
     * (`Locale.ROOT`) to match the ASCII tokens the backend emits.
     */
    fun deriveVehicleStatus(state: VehicleState?): String =
        when {
            state == null -> STATUS_OFFLINE
            state.isCharging -> "charging"
            state.speed > 0.0 -> "driving"
            else -> stillStatus(state.state)
        }

    /** Map a still (parked/asleep/updating/…) FSM token to itself, or fall back to `online` for anything unknown. */
    private fun stillStatus(raw: String): String {
        val token = raw.trim().lowercase(Locale.ROOT)
        return if (token in VEHICLE_STATES) token else "online"
    }
}

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never the VIN, the
 * display name, the model, or the status — so a diagnostics line can never leak anything about the user or their
 * vehicle.
 */
object VehicleHeaderDiagnostics {
    /** Stable registry id for the surface. */
    const val ID: String = "vehicle-header"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleHeader"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
