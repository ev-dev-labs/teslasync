// UI-thread-free state holder backing the VehiclePaintPicker surface — the native port of the web
// `useVehiclePaint` hook composed into web/src/components/vehicles/VehiclePaintPicker.tsx. It binds the
// [VehiclePaintSource] seam (P1/S8), projects the persisted per-vehicle override layered over the Tesla
// `exterior_color` onto the typed [VehiclePaintPickerData] (via [projectVehiclePaintPicker]), exposes
// setPaint / reset (web `setPaint` / `reset`), and emits the PII-safe one-shot `view.opened` diagnostic. The
// view never performs work of its own — it only collects [state] and calls [setPaint] / [reset] /
// [onViewOpened].
//
// There is deliberately no loading / error / stale / offline lifecycle: the override is read synchronously
// from a device-local store and the palette is a fixed five-entry constant, so the projection is total and
// always content-shaped (the same rationale the accepted VisuallyHidden local-state port documents). The
// surface's real states — auto-detected vs overridden, and each swatch's selected / inferred flags — are all
// carried by [VehiclePaintPickerData].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/VehiclePaintPicker) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.vehiclepaintpicker

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * State holder backing the Compose [VehiclePaintPicker] surface — the Android port of the web
 * `VehiclePaintPicker` component over its `useVehiclePaint` hook.
 *
 * It binds the injected [VehiclePaintSource] (the P1/S8 seam) to a lifecycle-aware [StateFlow] of the
 * projected [VehiclePaintPickerData]: the persisted override for [vehicleId] is mapped through
 * [projectVehiclePaintPicker], layered over the static Tesla [exteriorColor], so the swatch row, the active
 * paint label and the reset affordance all re-resolve whenever the user picks a colour (web `useVehiclePaint`
 * re-render). The feed is collected only while the UI observes it ([SharingStarted.WhileSubscribed]); the
 * initial value is the projection of the seam's current override so the first frame is never blank. The view
 * stays a thin renderer (ADR-002).
 *
 * [setPaint] writes the override (web `setPaint`, clearing it when the inferred colour is re-picked); [reset]
 * reverts to the auto-detected paint (web `reset`); [onViewOpened] emits the P1/S11 `view.opened` diagnostics
 * event exactly once per surface open.
 *
 * @param source the shared per-vehicle paint-override seam (the process store in production, a fake in tests).
 * @param vehicleId the vehicle whose override this picker edits; `<= 0` / `null` disables persistence.
 * @param exteriorColor the Tesla `exterior_color` code used to compute the auto-detected paint.
 * @param logger the single sanctioned redacting logger (ADR-016).
 * @param scope test seam; production uses `viewModelScope`.
 */
class VehiclePaintPickerViewModel(
    private val source: VehiclePaintSource,
    private val vehicleId: Long?,
    private val exteriorColor: String?,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private var viewOpenedRecorded = false

    /** The projected swatch row + active-paint label + override flag (web `useVehiclePaint` return value). */
    val state: StateFlow<VehiclePaintPickerData> =
        source
            .overrideFor(vehicleId)
            .map { override -> projectVehiclePaintPicker(override, exteriorColor) }
            .stateIn(
                scope = stateScope,
                started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                initialValue = projectVehiclePaintPicker(source.overrideFor(vehicleId).value, exteriorColor),
            )

    /**
     * Sets the paint override to [id] (web `setPaint`). Picking the auto-detected colour clears the override
     * (via [normalizeOverride]) so the picker re-syncs if Tesla later reports a paint. Logs only the surface
     * slug and the chosen paint id — a non-PII cosmetic enum, never the vehicle id or VIN.
     */
    fun setPaint(id: PaintPaletteId?) {
        val inferred = inferPaintIdFromTesla(exteriorColor)
        val normalized = normalizeOverride(id, inferred)
        source.setOverride(vehicleId, normalized)
        logger.info(
            EVENT_PAINT_SET,
            mapOf(SURFACE_KEY to VehiclePaintPickerRegistration.SLUG, PAINT_KEY to (normalized ?: inferred).wireId),
        )
    }

    /** Clears the override, reverting to the auto-detected paint (web `reset` ⇒ `setPaint(null)`). */
    fun reset() {
        source.setOverride(vehicleId, null)
        logger.info(EVENT_PAINT_RESET, mapOf(SURFACE_KEY to VehiclePaintPickerRegistration.SLUG))
    }

    /** Records the one-shot `view.opened` diagnostics event (P1/S11) — PII-safe, slug only. */
    fun onViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehiclePaintPickerOpened(logger)
    }

    companion object {
        /** Keep the override feed alive briefly across config changes / fast re-subscribes. */
        private const val STOP_TIMEOUT_MILLIS = 5_000L

        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel. */
        fun factory(
            source: VehiclePaintSource,
            vehicleId: Long?,
            exteriorColor: String?,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehiclePaintPickerViewModel(source, vehicleId, exteriorColor, logger) }
            }
    }
}
