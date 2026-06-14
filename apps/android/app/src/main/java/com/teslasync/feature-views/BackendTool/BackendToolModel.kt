// Pure, framework-free model + projection for the BackendTool feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/admin/components/devtools/BackendTool.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :app:testReleaseUnitTest gate, keeping the composable a thin
// render layer.
//
// The web component is a GENERIC, reusable tool wrapper: it renders a `ToolCard` (caller-supplied
// icon/color/title/description) around its `children`, a primary `Run` button bound to a TanStack
// `useMutation` over `apiFetch(endpoint, method, bodyBuilder?.())`, a success/failed `Badge`, and a
// `ResultPanel`. It binds NO `useQuery`, so there is no cache-then-network freshness lifecycle here —
// modelling loading/stale/offline as query freshness would invent behaviour the source does not have
// (drift), exactly as the sibling ToolCard / ResultPanel / helpers ports avoid. The branches the source
// actually defines map onto a single mutation lifecycle:
//
//   • web `mutation` idle (no run yet)          → [BackendToolActionState.Idle]   (the prompt's empty
//                                                  state: a friendly "no result yet" panel, never blank)
//   • web `mutation.isPending`                  → [BackendToolActionState.Running] (the loading state:
//                                                  the Run button shows its spinner)
//   • web `mutation.data` with `data.error`     → [BackendToolActionState.Done] + failure (the error
//                                                  state: a "Failed" badge + the error result panel)
//   • web `mutation.data` without `data.error`  → [BackendToolActionState.Done] + success
//
// `apiFetch` never throws — it catches transport failures into `{ error }` — so the "offline" branch is
// not separate query-freshness chrome: a no-connectivity run resolves to a [BackendToolResponse] whose
// [BackendToolResponse.error] is set (see [BackendToolResponse.ofError]) and renders the failure branch,
// faithful to the web. Success vs. failure is therefore decided by the payload's `error` field
// (`typeof data.error === 'string'`), never by a thrown exception — exactly like the sibling
// FleetApiSection `ToolActionState`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/BackendTool — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as every sibling feature-view surface does.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.backendtool

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object BackendToolRegistration {
    /** Stable surface id. */
    const val ID: String = "backend-tool"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "BackendTool"
}

/**
 * One decoded dev-tools API response — the native analogue of the web `apiFetch` return value
 * (`Record<string, unknown>`, possibly carrying an `error` string). [payload] is the decoded JSON object
 * (the mutation's `data`); [error] is the upstream/transport error string when the call failed (web
 * `data.error`).
 *
 * The producing port never throws: a transport failure surfaces through [ofError] so the result panel
 * renders its error branch exactly as the web `apiFetch` catch → `{ error }` path does, rather than
 * crashing the view.
 */
data class BackendToolResponse(
    val payload: JsonObject,
    val error: String?,
) {
    /**
     * True when this response represents a failure — the web truthiness check the component uses for
     * both the badge (`mutation.data.error ? 'danger' : 'success'`) and the result panel
     * (`typeof mutation.data.error === 'string'`). An empty `error` string is falsy on the web, so it is
     * treated as success here too.
     */
    val isError: Boolean get() = !error.isNullOrEmpty()

    companion object {
        private val EMPTY_PAYLOAD = JsonObject(emptyMap())

        /**
         * A resolved response carrying [payload]; [error] is read from the payload's own `error` field
         * (web `data.error`, counted only when it is a JSON string).
         */
        fun of(payload: JsonObject): BackendToolResponse = BackendToolResponse(payload, errorField(payload))

        /** A transport/decode failure carrying only the [message] (web `apiFetch` catch → `{ error }`). */
        fun ofError(message: String): BackendToolResponse = BackendToolResponse(EMPTY_PAYLOAD, message)

        /**
         * Parse a raw JSON body into a response — the native analogue of `apiFetch` decoding the fetch
         * body. A body that is not a JSON object, or invalid JSON, becomes an error response carrying the
         * decoder's own message (the web `err.message`), never a crash.
         */
        fun parse(rawJson: String): BackendToolResponse =
            runCatching { Json.parseToJsonElement(rawJson) }
                .fold(
                    onSuccess = { element -> (element as? JsonObject)?.let(::of) ?: ofError(element.toString()) },
                    onFailure = { throwable -> ofError(throwable.message ?: throwable.toString()) },
                )

        /** Read a top-level string `error` field (web `typeof data.error === 'string'`), else `null`. */
        private fun errorField(payload: JsonObject): String? = (payload["error"] as? JsonPrimitive)?.takeIf { it.isString }?.content
    }
}

/**
 * The lifecycle of the surface's single mutation — the native analogue of a TanStack `useMutation`
 * (idle → pending → data). [Running] carries no response because a fresh `mutate()` resets `mutation.data`
 * to `undefined` while pending, so the badge + populated result panel only appear once a run has
 * completed ([Done]). Mirrors the sibling FleetApiSection `ToolActionState`.
 */
sealed interface BackendToolActionState {
    /** No run yet — web `mutation` idle (`mutation.data === undefined`). */
    data object Idle : BackendToolActionState

    /** A run is in flight — web `mutation.isPending` (drives the Run button spinner). */
    data object Running : BackendToolActionState

    /** A run has completed — web `mutation.data` resolved (success or `{ error }`). */
    data class Done(
        override val response: BackendToolResponse,
    ) : BackendToolActionState

    /** True while a run is in flight (web `mutation.isPending`). */
    val isRunning: Boolean get() = this is Running

    /** The completed response, or `null` when not yet run (web `mutation.data`). */
    val response: BackendToolResponse? get() = (this as? Done)?.response
}

/** Whether a completed run succeeded or failed — drives the success/failed badge (web Badge `variant`). */
enum class BackendToolOutcome { Success, Failure }

/**
 * The fully projected, render-ready view — the native analogue of everything the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host.
 *
 * @property running whether the Run button shows its spinner (web `mutation.isPending`).
 * @property outcome the completed badge outcome, or `null` when no run has completed (web shows the badge
 *   only inside `{mutation.data && …}`).
 * @property resultData the success payload for the result panel, or `null` (web
 *   `data={mutation.data.error ? undefined : mutation.data}`).
 * @property resultError the failure message for the result panel, or `null` (web
 *   `error={typeof mutation.data.error === 'string' ? mutation.data.error : undefined}`).
 */
data class BackendToolDisplay(
    val running: Boolean,
    val outcome: BackendToolOutcome?,
    val resultData: JsonObject?,
    val resultError: String?,
) {
    /** Whether the success/failed badge renders — true once a run has completed (web `mutation.data &&`). */
    val showBadge: Boolean get() = outcome != null
}

/**
 * Pure projection from the mutation [BackendToolActionState] to the render-ready [BackendToolDisplay] —
 * the native port of the handful of derivations the web component performs (the `loading` flag, the
 * `mutation.data &&` badge gate, and the `data`/`error` result-panel split) before returning JSX.
 */
object BackendToolProjection {
    /** Projects the mutation state into the render-ready [BackendToolDisplay]. */
    fun project(state: BackendToolActionState): BackendToolDisplay =
        when (state) {
            BackendToolActionState.Idle ->
                BackendToolDisplay(running = false, outcome = null, resultData = null, resultError = null)

            BackendToolActionState.Running ->
                BackendToolDisplay(running = true, outcome = null, resultData = null, resultError = null)

            is BackendToolActionState.Done -> projectDone(state.response)
        }

    private fun projectDone(response: BackendToolResponse): BackendToolDisplay =
        if (response.isError) {
            BackendToolDisplay(
                running = false,
                outcome = BackendToolOutcome.Failure,
                resultData = null,
                resultError = response.error,
            )
        } else {
            BackendToolDisplay(
                running = false,
                outcome = BackendToolOutcome.Success,
                resultData = response.payload,
                resultError = null,
            )
        }
}
