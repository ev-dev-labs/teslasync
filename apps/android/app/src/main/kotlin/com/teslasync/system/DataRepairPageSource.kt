// The data seam the DataRepairPage system surface binds to, plus its production binding over the shared resilient
// API client. The view (composable) performs NO HTTP — it only collects state from the view-model, which drives
// this seam, reproducing the web page's data access:
//   • `useQuery(['stale-sessions'])` GET /data-repair/stale-sessions — the one read feed;
//   • the charging repair mutations (PUT /data-repair/charging/{id}/, POST …/close, DELETE …/);
//   • the drive repair mutations (PUT /data-repair/drive/{id}/, POST …/close, DELETE …/).
//
// There is no shared S7/S8 port for data-repair (the Android DI graph wires none, and the generated client
// exposes the endpoints only as raw descriptors), so — exactly as the sibling GeofencesPage create/update do for
// their portless single-record writes — every read and mutation routes through the SAME shared resilient
// [ApiHttpClient] every repository runs on. The read is wrapped into the one-shot cache-then-network [Resource]
// stream the [io.teslasync.android.data.UiState] projection expects (Loading → Success/Error); the mutation
// bodies are plain `JsonObject`s the client serialises via its JSON content negotiation, so the Android module
// adds no networking of its own. The endpoint paths are the authoritative ones from `internal/api/router.go`
// (`/charging/{id}/` and the singular `/drive/{id}/`, both trailing-slash), matching the generated client
// descriptors. A narrow seam so the view-model depends on an abstraction (real client adapter ↔ test fake),
// never on the network.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/system) diverges from
// the `io.teslasync.android.*` package the rest of the app uses. `MatchingDeclarationName` is suppressed for the
// co-located binding helper.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.system.datarepair

import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.net.ApiError
import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.request
import io.teslasync.shared.core.net.safeRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** `GET /data-repair/stale-sessions` — the single read feed (web `useQuery(['stale-sessions'])`). */
internal const val DATA_REPAIR_STALE_SESSIONS_PATH: String = "/data-repair/stale-sessions"

/**
 * The single seam the [DataRepairPageViewModel] depends on so it binds to an abstraction (the shared resilient
 * client in production, a fake in tests), never to the network. The read is a one-shot cache-then-network
 * `Resource` flow (web `useQuery(['stale-sessions'])`); the six mutations are the page's non-throwing repair
 * actions (web `updateMut`/`closeMut`/`discardMut` for each kind). No HTTP touches the view.
 */
interface DataRepairSource {
    /** The `GET /data-repair/stale-sessions` feed (web `useQuery(['stale-sessions'])`). */
    fun staleSessions(): Flow<Resource<DataRepairStaleData>>

    /** `PUT /data-repair/charging/{id}/` with the repair [body] (web charging `updateMut`). */
    suspend fun updateCharging(
        id: Long,
        body: JsonObject,
    ): Result<Unit>

    /** `POST /data-repair/charging/{id}/close` (web charging `closeMut`). */
    suspend fun closeCharging(id: Long): Result<Unit>

    /** `DELETE /data-repair/charging/{id}/` (web charging `discardMut`). */
    suspend fun discardCharging(id: Long): Result<Unit>

    /** `PUT /data-repair/drive/{id}/` with the repair [body] (web drive `updateMut`). */
    suspend fun updateDrive(
        id: Long,
        body: JsonObject,
    ): Result<Unit>

    /** `POST /data-repair/drive/{id}/close` (web drive `closeMut`). */
    suspend fun closeDrive(id: Long): Result<Unit>

    /** `DELETE /data-repair/drive/{id}/` (web drive `discardMut`). */
    suspend fun discardDrive(id: Long): Result<Unit>
}

/**
 * Binds the surface to the shared resilient [api] — the same client every repository runs on. The read is issued
 * once and wrapped into the [Resource] contract (Loading then a terminal Success/Error carrying the typed
 * [DataRepairStaleData]); a decode failure surfaces as [Resource.Error] rather than crashing the flow. The six
 * mutations are non-throwing [Result]s over `safeRequest`, their `JsonElement` reply discarded to `Unit`. No HTTP
 * touches the view.
 *
 * @param api the shared resilient client (the container's `api`).
 * @param now wall-clock seam for the success freshness stamp; injectable for tests.
 */
fun dataRepairPageSourceOf(
    api: ApiHttpClient,
    now: () -> Long = { System.currentTimeMillis() },
): DataRepairSource =
    object : DataRepairSource {
        override fun staleSessions(): Flow<Resource<DataRepairStaleData>> =
            flow {
                emit(Resource.Loading(cached = null, fetchedAt = null, stale = false))
                emit(readStaleSessions(api, now))
            }

        override suspend fun updateCharging(
            id: Long,
            body: JsonObject,
        ): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.PUT, path = chargingPath(id), body = body).asUnit()

        override suspend fun closeCharging(id: Long): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = chargingClosePath(id)).asUnit()

        override suspend fun discardCharging(id: Long): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.DELETE, path = chargingPath(id)).asUnit()

        override suspend fun updateDrive(
            id: Long,
            body: JsonObject,
        ): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.PUT, path = drivePath(id), body = body).asUnit()

        override suspend fun closeDrive(id: Long): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.POST, path = driveClosePath(id)).asUnit()

        override suspend fun discardDrive(id: Long): Result<Unit> =
            api.safeRequest<JsonElement>(method = HttpMethodKind.DELETE, path = drivePath(id)).asUnit()
    }

/**
 * Issues the stale-sessions read once and folds it into a [Resource]. An [ApiError] (transport/HTTP/circuit) and
 * a [SerializationException] (a 2xx body that no longer matches the DTO) both degrade to [Resource.Error] with no
 * cached fallback; coroutine cancellation is never caught, so it propagates and tears the flow down cleanly.
 */
private suspend fun readStaleSessions(
    api: ApiHttpClient,
    now: () -> Long,
): Resource<DataRepairStaleData> =
    try {
        val element = api.request<JsonElement>(path = DATA_REPAIR_STALE_SESSIONS_PATH)
        val data = dataRepairJson.decodeFromJsonElement(DataRepairStaleData.serializer(), element)
        Resource.Success(data, fetchedAt = now(), stale = false)
    } catch (error: ApiError) {
        Resource.Error(cached = null, fetchedAt = null, stale = false, error = error)
    } catch (error: SerializationException) {
        Resource.Error(cached = null, fetchedAt = null, stale = false, error = error)
    }

/** Discards a mutation's `JsonElement` reply to `Unit` (the view only needs success/failure). */
private fun Result<JsonElement>.asUnit(): Result<Unit> = map { }

private fun chargingPath(id: Long): String = "/data-repair/charging/$id/"

private fun chargingClosePath(id: Long): String = "/data-repair/charging/$id/close"

private fun drivePath(id: Long): String = "/data-repair/drive/$id/"

private fun driveClosePath(id: Long): String = "/data-repair/drive/$id/close"
