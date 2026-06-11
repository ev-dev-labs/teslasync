// The data seam the Infrastructure dev-tools section binds to, plus its production binding over the shared
// resilient HTTP client. Named after the surface bundle (InfrastructureSection*) rather than the single
// interface it declares. The view (composable) performs NO HTTP — it only collects state from the
// ViewModel, which in turn drives this seam, satisfying the "no direct HTTP from the view" contract while
// reproducing the web component's per-tool `useMutation` (an on-demand request, NOT a polling feed).
//
// Why a dedicated seam and not the shared AdminStore (P1/S8): AdminStore exposes db-stats / migration-status
// / runtime-info as cache-then-network *read feeds* (they auto-load), and has no mqtt-test or env-check
// entry at all. The web devtools surface deliberately uses `useMutation` so each tool runs only when the
// operator presses Run. Reproducing that on-demand semantics — and covering all five endpoints — requires a
// command seam over the same shared `ApiHttpClient` every repository builds on, which is exactly what this
// file provides (see `asInfrastructureSectionSource`).
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/feature-views/InfrastructureSection) cannot form a valid Kotlin package.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructure

import io.teslasync.shared.core.net.ApiHttpClient
import io.teslasync.shared.core.net.HttpMethodKind
import io.teslasync.shared.core.net.safeRequest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * The single seam the [InfrastructureSectionViewModel] depends on so it binds to an abstraction (real
 * adapter ↔ test fake), never to a concrete client — the Android analogue of the web component's five
 * `useMutation(apiFetch(endpoint, ...))` calls (P1/S8 state-holder boundary). Each function runs ONE
 * `/dev-tools/{endpoint}` request and returns a non-throwing [Result] (transport faults are
 * `Result.failure`, mirroring the web `apiFetch` catch that yields `{error}`). No HTTP touches the view.
 */
interface InfrastructureSectionSource {
    /** `GET /dev-tools/db-stats` — database size / row statistics (web `BackendTool endpoint="db-stats"`). */
    suspend fun dbStats(): Result<JsonElement>

    /** `GET /dev-tools/migration-status` — applied / pending migration status. */
    suspend fun migrationStatus(): Result<JsonElement>

    /** `POST /dev-tools/mqtt-test` `{topic, message}` — publishes a test MQTT message (web `MqttTestTool`). */
    suspend fun mqttTest(
        topic: String,
        message: String,
    ): Result<JsonElement>

    /** `GET /dev-tools/env-check` — environment / configuration sanity check. */
    suspend fun envCheck(): Result<JsonElement>

    /** `GET /dev-tools/runtime-info` — connection-pool / runtime diagnostics. */
    suspend fun runtimeInfo(): Result<JsonElement>
}

/**
 * Dispatches [tool] to the matching seam call. [topic] and [message] are consumed only by the MQTT tool
 * (every other tool is a bodyless GET), mirroring the web grid wiring each tool to its endpoint.
 */
internal suspend fun InfrastructureSectionSource.execute(
    tool: InfraTool,
    topic: String,
    message: String,
): Result<JsonElement> =
    when (tool) {
        InfraTool.DbStats -> dbStats()
        InfraTool.Migrations -> migrationStatus()
        InfraTool.MqttTest -> mqttTest(topic, message)
        InfraTool.EnvCheck -> envCheck()
        InfraTool.Runtime -> runtimeInfo()
    }

/**
 * Binds the surface to the shared resilient [ApiHttpClient] — the same client every S7 repository builds
 * on (auto `/api/v1` prefix, retry/backoff, circuit breaker, auth seam, [io.teslasync.shared.core.net.ApiError]
 * mapping). A dev-tools host constructs the surface with `api.asInfrastructureSectionSource()`, exactly as
 * the dashboard host binds a widget with `store.as...Source()`. Each call uses the non-throwing
 * [safeRequest], so a transport fault is a `Result.failure` the projection maps to the Failed surface.
 */
fun ApiHttpClient.asInfrastructureSectionSource(): InfrastructureSectionSource {
    val api = this
    return object : InfrastructureSectionSource {
        override suspend fun dbStats(): Result<JsonElement> = api.get(InfraTool.DbStats.endpoint)

        override suspend fun migrationStatus(): Result<JsonElement> = api.get(InfraTool.Migrations.endpoint)

        override suspend fun mqttTest(
            topic: String,
            message: String,
        ): Result<JsonElement> =
            api.safeRequest(
                method = HttpMethodKind.POST,
                path = "/dev-tools/${InfraTool.MqttTest.endpoint}",
                body = mqttBody(topic, message),
            )

        override suspend fun envCheck(): Result<JsonElement> = api.get(InfraTool.EnvCheck.endpoint)

        override suspend fun runtimeInfo(): Result<JsonElement> = api.get(InfraTool.Runtime.endpoint)
    }
}

/** A bodyless `GET /dev-tools/{endpoint}` returning the raw JSON payload (web GET `BackendTool`). */
private suspend fun ApiHttpClient.get(endpoint: String): Result<JsonElement> =
    safeRequest(method = HttpMethodKind.GET, path = "/dev-tools/$endpoint")

/** The MQTT test request body `{topic, message}` — verbatim the web `apiFetch('mqtt-test', 'POST', {...})`. */
private fun mqttBody(
    topic: String,
    message: String,
): JsonObject =
    buildJsonObject {
        put("topic", JsonPrimitive(topic))
        put("message", JsonPrimitive(message))
    }
