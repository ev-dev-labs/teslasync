package io.teslasync.shared.core.presentation.vehiclephoto

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.data.repo.VehiclePhotoRepository
import io.teslasync.shared.core.data.repo.validateVehiclePhotoUpload
import io.teslasync.shared.core.data.repo.vehiclePhotoCacheKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update

/**
 * UI-free shared state holder for the vehicle-photo surface — the cross-platform port of the web
 * `useVehiclePhoto` hook domain (web/src/api/hooks/useVehiclePhoto.ts). Every native photo screen
 * (the hero card + the upload control; Android/Apple via KMP, Windows via the C# port) binds to this
 * single holder rather than re-implementing the endpoint, the cache key, the upload validation, or
 * the per-vehicle invalidation rules.
 *
 * The one read is exposed as a hot [StateFlow] of a cache-then-network [Resource] (ADR-013), scoped
 * to one vehicle and lazily created on first access, then shared so every observer of the same
 * vehicle folds into one upstream collection:
 *  - [vehiclePhoto] mirrors the web `useVehiclePhoto(vehicleId)` — the metadata query.
 *
 * The two mutations are non-throwing suspend [Result]s, mirroring the web mutations exactly:
 *  - [uploadVehiclePhoto] mirrors `useUploadVehiclePhoto`: it first runs the client-side size/mime
 *    check ([validateVehiclePhotoUpload]) — the web `mutationFn`'s `throw new Error(...)` becomes a
 *    `Result.failure` here, so a rejected file never hits the network — then uploads. On success it
 *    refreshes that vehicle's photo feed and fires [onVehicleChanged] (the web pairs
 *    `setQueryData(detail, data)` + `invalidateQueries(vehiclePhotoKeys.detail(id))` +
 *    `invalidateQueries(vehicleKeys.detail(id))`).
 *  - [deleteVehiclePhoto] mirrors `useDeleteVehiclePhoto`: on success it refreshes that vehicle's
 *    photo feed and fires [onVehicleChanged] (the web `setQueryData(detail, { has_photo:false })` +
 *    the same two `invalidateQueries`).
 *
 * A failed mutation refreshes nothing and fires nothing (the web `onSuccess` never runs on error).
 * The repository (S7) writes the new meta through the same key on the same success, so each refresh
 * shows an instant optimistic value before the cache-then-network refetch confirms it. The
 * cross-domain `vehicleKeys.detail(id)` invalidation is delegated to [onVehicleChanged] (default
 * no-op) so the photo holder stays decoupled from the vehicle-list domain; the platform wires it to
 * that feed's refresh. Toasts are a render-layer concern and are intentionally NOT reproduced here.
 * The holder makes no network calls itself.
 *
 * This holder mirrors the web hook's single-threaded usage and is not internally synchronised;
 * create and drive it from one confinement (the platform main scope).
 *
 * @property repo the S7 data port the feed and both mutations are routed through.
 * @property scope the coroutine scope the shared feed runs in; cancelling it stops it.
 * @property onVehicleChanged the holder-side analogue of the web `invalidateQueries(vehicleKeys
 *   .detail(id))` — invoked with the affected `vehicleId` after a successful upload/delete so the
 *   platform can refresh that vehicle's own feed. Defaults to a no-op.
 */
@OptIn(ExperimentalCoroutinesApi::class)
public class VehiclePhotoStore(
    private val repo: VehiclePhotoRepository,
    private val scope: CoroutineScope,
    private val onVehicleChanged: (vehicleId: String) -> Unit = {},
) {
    private val photoTriggers = mutableMapOf<String, MutableStateFlow<Int>>()
    private val photoFeeds = mutableMapOf<String, StateFlow<Resource<VehiclePhotoMeta>>>()

    // ---- Read ---------------------------------------------------------------------

    /**
     * Shared, refreshable `GET /vehicles/{vehicleId}/photo` feed for [vehicleId] (web
     * `useVehiclePhoto`). The same `vehicleId` always returns the same feed; bumping its trigger
     * (via [refreshPhotoFeed]) restarts its cache-then-network collection.
     */
    public fun vehiclePhoto(vehicleId: String): StateFlow<Resource<VehiclePhotoMeta>> {
        val key = vehiclePhotoCacheKey(vehicleId)
        return photoFeeds.getOrPut(key) {
            trigger(key)
                .flatMapLatest { repo.vehiclePhoto(vehicleId) }
                .stateIn(
                    scope = scope,
                    started = SharingStarted.WhileSubscribed(STOP_TIMEOUT_MILLIS),
                    initialValue = PHOTO_INITIAL,
                )
        }
    }

    // ---- Mutations ----------------------------------------------------------------

    /**
     * Validates then uploads a new photo for [vehicleId] (web `useUploadVehiclePhoto`). The
     * client-side [validateVehiclePhotoUpload] check runs first — an invalid file short-circuits to
     * a `Result.failure(IllegalArgumentException(message))` and never touches the network, exactly as
     * the web `mutationFn` throws before `fetch`. On success that vehicle's photo feed is refreshed
     * and [onVehicleChanged] fires; a failed upload (validation or network) does neither.
     *
     * @param bytes the raw image bytes.
     * @param fileName the upload's part filename.
     * @param mimeType the declared image MIME type, or `null` when unknown.
     */
    public suspend fun uploadVehiclePhoto(
        vehicleId: String,
        bytes: ByteArray,
        fileName: String,
        mimeType: String?,
    ): Result<VehiclePhotoMeta> {
        val validation = validateVehiclePhotoUpload(bytes.size.toLong(), mimeType)
        if (validation != null) {
            return Result.failure(IllegalArgumentException(validation.message))
        }
        return repo
            .uploadVehiclePhoto(vehicleId, bytes, fileName, mimeType)
            .onSuccess {
                refreshPhotoFeed(vehicleId)
                onVehicleChanged(vehicleId)
            }
    }

    /**
     * Removes the photo for [vehicleId] (web `useDeleteVehiclePhoto`). On success that vehicle's
     * photo feed is refreshed and [onVehicleChanged] fires; a failed delete does neither. Idempotent
     * on the backend, so it is safe to call without pre-checking existence.
     */
    public suspend fun deleteVehiclePhoto(vehicleId: String): Result<Unit> =
        repo
            .deleteVehiclePhoto(vehicleId)
            .onSuccess {
                refreshPhotoFeed(vehicleId)
                onVehicleChanged(vehicleId)
            }

    // ---- Refresh (invalidation analogue) ------------------------------------------

    /**
     * Re-fetches the photo feed for [vehicleId] — the holder-side analogue of invalidating
     * `vehiclePhotoKeys.detail(id)`. Bumping the vehicle's trigger restarts its cache-then-network
     * collection. A vehicle nobody is observing is a no-op.
     */
    public fun refreshPhotoFeed(vehicleId: String) {
        photoTriggers[vehiclePhotoCacheKey(vehicleId)]?.update { n -> n + 1 }
    }

    // ---- Internals ----------------------------------------------------------------

    private fun trigger(key: String): MutableStateFlow<Int> = photoTriggers.getOrPut(key) { MutableStateFlow(0) }

    private companion object {
        // Keep a feed's upstream alive briefly across config changes / fast re-subscribes.
        const val STOP_TIMEOUT_MILLIS = 5_000L
        val PHOTO_INITIAL: Resource<VehiclePhotoMeta> =
            Resource.Loading(cached = null, fetchedAt = null, stale = false)
    }
}
