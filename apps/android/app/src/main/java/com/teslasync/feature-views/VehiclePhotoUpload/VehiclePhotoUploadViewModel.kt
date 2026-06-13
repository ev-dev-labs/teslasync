// UI-thread-free state holder backing the Compose [VehiclePhotoUpload] feature view — the native port of the
// vehicle-photo hook composition the web component owns (web/src/features/vehicles/components/
// VehiclePhotoUpload.tsx). It binds the shared cache-then-network [VehiclePhotoUploadSource] (P1/S8), projects
// the `/vehicles/{id}/photo` read onto the shared [UiState] surface (loading / content / stale / offline /
// error), tracks each write's in-flight flag, runs the two mutations (web `startUpload` over
// `useUploadVehiclePhoto` / `handleRemove` over `useDeleteVehiclePhoto`) raising typed [PhotoToast]s, and emits
// the PII-safe `view.opened` diagnostic. The view never performs HTTP or file IO — it only collects state and
// calls these methods with the platform-provided [PickedPhoto].
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/VehiclePhotoUpload) cannot form a valid Kotlin package.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclephotoupload

import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.teslasync.android.data.BaseFeedViewModel
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoMeta
import io.teslasync.shared.core.presentation.vehiclephoto.VehiclePhotoStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update

/**
 * The in-flight write flags the action controls bind to — the native analogue of the web mutations' `isPending`
 * flags (web `upload.isPending` / `remove.isPending`), split per action so each control gates its own
 * loading/disabled state and a double-tap can't re-fire an in-flight call.
 *
 * @property uploading an upload write is in flight (web `upload.isPending` over `startUpload`).
 * @property removing a remove write is in flight (web `remove.isPending` over `handleRemove`).
 */
data class PhotoActions(
    val uploading: Boolean = false,
    val removing: Boolean = false,
)

/**
 * Lifecycle-aware state holder backing the Compose [VehiclePhotoUpload]. It consumes the cache-then-network
 * [VehiclePhotoUploadSource] (P1/S8) and re-shares the photo-metadata read as a [UiState] stream, so the screen
 * stays a stateless Composable that only renders. A resolved read always maps to content (the panel always
 * renders its chrome — the absent-photo read IS the friendly drop-zone, there is no empty branch — web parity),
 * surfaced by the model's `Resource → UiState` projection with a `false` emptiness predicate; loading (no cache),
 * hard error (no cache), and the stale/offline cached view are all surfaced by that same projection.
 *
 * It owns no networking or file IO. [retry] re-fetches the photo feed; [upload] reads then uploads a picked
 * photo (web `startUpload`) and [remove] deletes the current one (web `handleRemove`), each raising a typed
 * [PhotoToast] (and, on success, the shared store refreshes the read exactly as the web invalidates the photo +
 * vehicle queries). [recordViewOpened] emits the one-shot `view.opened` diagnostic (P1/S11).
 *
 * @param source the cache-then-network photo seam (a shared-layer adapter in production, a fake in tests).
 * @param vehicleId the vehicle whose photo this surface manages (web `vehicleId` prop).
 * @param logger the single sanctioned redacting logger (ADR-016); receives `view.opened` + refresh events.
 * @param scope test seam; production passes nothing and uses `viewModelScope`.
 */
class VehiclePhotoUploadViewModel(
    private val source: VehiclePhotoUploadSource,
    val vehicleId: Long,
    logger: Logger,
    scope: CoroutineScope? = null,
) : BaseFeedViewModel(logger, scope) {
    private val vehicleKey: String = vehicleId.toString()
    private val actionState = MutableStateFlow(PhotoActions())
    private val toastChannel = Channel<PhotoToast>(Channel.BUFFERED)
    private var viewOpenedRecorded = false

    /**
     * The photo metadata as cache-then-network UI state: loading / content / stale / offline / error, carrying
     * the freshness stamp + error kind. The emptiness predicate is `false` (web parity — the surface always
     * renders content) so a resolved read always renders the drop-zone, never an empty box.
     */
    val photoState: StateFlow<UiState<VehiclePhotoMeta>> = source.vehiclePhoto(vehicleKey).asUiState { false }

    /** The in-flight flags the action controls bind to (web `mutation.isPending`). */
    val actions: StateFlow<PhotoActions> = actionState.asStateFlow()

    /** Typed toasts the composable maps to localized [io.teslasync.android.components.feedback.ToastItem]s (web `useToast`). */
    val toasts: Flow<PhotoToast> = toastChannel.receiveAsFlow()

    /** Re-fetches the cache-then-network photo read (web `refetch()`); backs the hard-error + offline retry affordance. */
    fun retry() {
        logger.info(EVENT_REFRESH, mapOf(FIELD_SURFACE to VehiclePhotoUploadRegistration.SLUG))
        source.refreshPhoto(vehicleKey)
    }

    /**
     * Uploads [picked] as the vehicle's new photo (web `startUpload`): reads the bytes off the main thread, then
     * routes through the shared store, which runs the authoritative size/MIME validation (a rejected file
     * short-circuits to a failure carrying the byte-identical web message and never hits the network) and, on
     * success, writes the fresh meta through the cache + refreshes the read. Raises [PhotoToast.Uploaded] on
     * success (web `toast.success`) or [PhotoToast.UploadFailed] carrying the reason on failure (web
     * `toast.error(message || …)`). Tracks [PhotoActions.uploading]; a second tap while busy is ignored.
     */
    fun upload(picked: PickedPhoto) {
        if (actionState.value.uploading) return
        actionState.update { it.copy(uploading = true) }
        launch {
            try {
                val bytes = runCatching { picked.readBytes() }.getOrNull()
                if (bytes == null) {
                    toastChannel.trySend(PhotoToast.UploadFailed(null))
                    return@launch
                }
                source.uploadVehiclePhoto(vehicleKey, bytes, picked.name, picked.mimeType).fold(
                    onSuccess = { toastChannel.trySend(PhotoToast.Uploaded) },
                    onFailure = { error -> toastChannel.trySend(PhotoToast.UploadFailed(error.message?.ifBlank { null })) },
                )
            } finally {
                actionState.update { it.copy(uploading = false) }
            }
        }
    }

    /**
     * Removes the vehicle's current photo (web `handleRemove`): routes through the shared store, which deletes
     * then writes a `has_photo:false` meta through the cache + refreshes the read on success. Raises
     * [PhotoToast.Removed] on success (web `toast.success`) or [PhotoToast.RemoveFailed] carrying the reason on
     * failure (web `toast.error(message || …)`). Tracks [PhotoActions.removing]; a second tap while busy is
     * ignored.
     */
    fun remove() {
        if (actionState.value.removing) return
        actionState.update { it.copy(removing = true) }
        launch {
            try {
                source.deleteVehiclePhoto(vehicleKey).fold(
                    onSuccess = { toastChannel.trySend(PhotoToast.Removed) },
                    onFailure = { error -> toastChannel.trySend(PhotoToast.RemoveFailed(error.message?.ifBlank { null })) },
                )
            } finally {
                actionState.update { it.copy(removing = false) }
            }
        }
    }

    /**
     * Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11), at most once per holder.
     * Carries no vehicle id, filename, or bytes, so a diagnostics line can never leak which photo was viewed.
     */
    fun recordViewOpened() {
        if (viewOpenedRecorded) return
        viewOpenedRecorded = true
        recordVehiclePhotoUploadOpened(logger)
    }

    companion object {
        /** A [ViewModelProvider.Factory] a host uses to construct this surface's ViewModel from a [source]. */
        fun factory(
            source: VehiclePhotoUploadSource,
            vehicleId: Long,
            logger: Logger,
        ): ViewModelProvider.Factory =
            viewModelFactory {
                initializer { VehiclePhotoUploadViewModel(source, vehicleId, logger) }
            }

        /** Wire the surface from the shared **S8** [VehiclePhotoStore] (the production binding). */
        fun create(
            store: VehiclePhotoStore,
            vehicleId: Long,
            logger: Logger,
            scope: CoroutineScope? = null,
        ): VehiclePhotoUploadViewModel = VehiclePhotoUploadViewModel(vehiclePhotoUploadSource(store), vehicleId, logger, scope)
    }
}
