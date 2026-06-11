// Pure, framework-free model + projection for the Infrastructure dev-tools section — the native
// analogue of everything web/src/features/admin/components/devtools/InfrastructureSection.tsx (and its
// composed BackendTool / MqttTestTool / ResultPanel) derives before returning JSX. No Compose, no
// Android framework, no HTTP: every type here is unit-tested off device in the :android:testReleaseUnitTest
// gate, keeping the composable a thin render layer.
//
// The web surface is a grid of five on-demand dev-tools, each a `useMutation` (NOT a polling query): the
// operator presses Run, a single request fires, and its JSON result OR error is shown. db-stats /
// migration-status / mqtt-test / env-check / runtime-info map 1:1 to the five tools below.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/InfrastructureSection — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling dashboard widgets do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.infrastructure

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.errorKindOf
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The accent color band of a tool card — the native analogue of the web `ICON_COLOR_MAP` keys passed to
 * each tool (`cyan` / `green` / `amber` / `purple`). Kept framework-free here; the render layer maps each
 * band onto a semantic [io.teslasync.android.components.ui.IconBoxTone] so light/dark/high-contrast all
 * resolve correctly (web neon hues have no 1:1 Material token, so they map to the nearest semantic tone).
 */
enum class InfraTone { Cyan, Green, Amber, Purple }

/**
 * The five dev-tools the web `InfrastructureSection` renders, in source order. Each carries the i18n key
 * for its title + description (the exact keys the web `t(...)` calls use), its accent [tone], and the
 * `/dev-tools/{endpoint}` request it issues. [needsInput] marks the MQTT tool, the only one with a body
 * (topic + message) — every other tool is a bodyless GET, mirroring the web `BackendTool` default.
 *
 * @property endpoint the path segment under `/dev-tools/` (web `apiFetch(endpoint, ...)`).
 * @property post whether the request is a POST (web MQTT tool) vs the GET default.
 * @property titleKey i18n key for the card title (web `t(title)`).
 * @property descKey i18n key for the card description (web `t(description)`).
 * @property tone the accent band (web `ICON_COLOR_MAP` color).
 * @property needsInput whether the tool collects a topic + message before running (web `MqttTestTool`).
 */
enum class InfraTool(
    val endpoint: String,
    val post: Boolean,
    val titleKey: String,
    val descKey: String,
    val tone: InfraTone,
    val needsInput: Boolean,
) {
    DbStats("db-stats", post = false, InfraKeys.DB_STATS, InfraKeys.DB_STATS_DESC, InfraTone.Cyan, needsInput = false),
    Migrations("migration-status", post = false, InfraKeys.MIGRATIONS, InfraKeys.MIGRATIONS_DESC, InfraTone.Green, needsInput = false),
    MqttTest("mqtt-test", post = true, InfraKeys.MQTT, InfraKeys.MQTT_DESC, InfraTone.Amber, needsInput = true),
    EnvCheck("env-check", post = false, InfraKeys.ENV_CHECK, InfraKeys.ENV_CHECK_DESC, InfraTone.Purple, needsInput = false),
    Runtime("runtime-info", post = false, InfraKeys.RUNTIME, InfraKeys.RUNTIME_DESC, InfraTone.Amber, needsInput = false),
}

/**
 * The i18n keys the web source passes to `t(...)`, verbatim. The natural-key style (`t('Db Stats')`) is
 * the web app's own convention here; some of these keys exist in the shared P1/S10 catalog (`Mqtt`,
 * `Migrations`, `Runtime`, `Topic`, `Message`, `Run`, `Success`, `Failed`, `Copy`, `Copied`) and the rest
 * fall back to the key text exactly as react-i18next does on the web. The render layer resolves each
 * through the Android resource facade, falling back to the key — reproducing i18next's behaviour 1:1
 * (see `resolveInfraText` in InfrastructureSection.kt) so the on-screen text matches the web verbatim.
 */
object InfraKeys {
    const val DB_STATS = "Db Stats"
    const val DB_STATS_DESC = "Db Stats Desc"
    const val MIGRATIONS = "Migrations"
    const val MIGRATIONS_DESC = "Migrations Desc"
    const val MQTT = "Mqtt"
    const val MQTT_DESC = "Mqtt Desc"
    const val ENV_CHECK = "Env Check"
    const val ENV_CHECK_DESC = "Env Check Desc"
    const val RUNTIME = "Runtime"
    const val RUNTIME_DESC = "Runtime Desc"

    const val TOPIC = "Topic"
    const val MESSAGE = "Message"
    const val SEND_TEST = "Send Test"
    const val RUN = "Run"
    const val SUCCESS = "Success"
    const val FAILED = "Failed"
    const val COPY = "Copy"
    const val COPIED = "Copied"
    const val NO_RESULT = "No result yet"
    const val OFFLINE = "common.offline"
    const val REQUEST_FAILED = "Request failed"
}

/** The lifecycle of a single tool's on-demand run — the native analogue of a web `useMutation` status. */
enum class RunPhase {
    /** Nothing has been run yet (web `!mutation.data && !mutation.isPending`). */
    Idle,

    /** A request is in flight (web `mutation.isPending`) — the Run button shows a spinner. */
    Running,

    /** The request returned a payload with no truthy `error` (web Success badge + result panel). */
    Succeeded,

    /** The request failed — transport error OR a 2xx body carrying a truthy `error` (web Failed badge). */
    Failed,
}

/**
 * Immutable result of one tool run — the projection of a single mutation outcome onto render-ready state.
 * Pure data (no Compose) so every branch is unit-tested directly.
 *
 * @property phase the current run phase.
 * @property result the decoded success payload to pretty-print (web `mutation.data`), else `null`.
 * @property errorDetail a verbatim error string when the backend returned `{error: "..."}` on a 2xx
 *   (web `typeof mutation.data.error === 'string' ? mutation.data.error : undefined`), else `null`; for a
 *   transport failure this is `null` and the render layer derives a localized message from [errorKind].
 * @property errorKind the classified transport failure (web's thrown-error branch), else `null`.
 */
data class ToolRun(
    val phase: RunPhase = RunPhase.Idle,
    val result: JsonElement? = null,
    val errorDetail: String? = null,
    val errorKind: ErrorKind? = null,
) {
    val isIdle: Boolean get() = phase == RunPhase.Idle
    val isRunning: Boolean get() = phase == RunPhase.Running
    val isSucceeded: Boolean get() = phase == RunPhase.Succeeded
    val isFailed: Boolean get() = phase == RunPhase.Failed

    /**
     * True when the most recent failure was a connectivity fault (no network / circuit open / timeout) —
     * the surface shows an "offline" chip and the Run button stays available to retry once back online.
     */
    val isOffline: Boolean
        get() =
            phase == RunPhase.Failed &&
                (errorKind == ErrorKind.Network || errorKind == ErrorKind.CircuitOpen || errorKind == ErrorKind.Timeout)

    companion object {
        val IDLE: ToolRun = ToolRun()
    }
}

/**
 * The whole section's state — one [ToolRun] per [InfraTool]. Each tool is independent (its own mutation),
 * exactly as each web tool owns its own `useMutation`.
 */
data class InfrastructureSectionState(
    val runs: Map<InfraTool, ToolRun> = InfraTool.entries.associateWith { ToolRun.IDLE },
) {
    /** The run state for [tool] (never null — defaults to [ToolRun.IDLE]). */
    fun runOf(tool: InfraTool): ToolRun = runs[tool] ?: ToolRun.IDLE

    /** Returns a copy with [tool]'s run replaced by [run]. */
    fun with(
        tool: InfraTool,
        run: ToolRun,
    ): InfrastructureSectionState = copy(runs = runs + (tool to run))

    companion object {
        fun initial(): InfrastructureSectionState = InfrastructureSectionState()
    }
}

/**
 * Canonical registry metadata for the Infrastructure surface — the native mirror of the web devtools
 * section. The diagnostics [SLUG] is emitted with the one-shot `view.opened` event (P1/S11).
 */
object InfrastructureSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "devtools-infrastructure"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "InfrastructureSection"
}

/**
 * Pure projection from a mutation [Result] to render-ready [ToolRun] — the native port of the web
 * `mutation.data.error ? 'Failed' : 'Success'` / `data={...error ? undefined : data}` logic. Side
 * effect free so the gate unit-tests every branch without a device.
 */
object InfrastructureSectionProjection {
    private val PRETTY: Json =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    /**
     * Projects a finished mutation [result] onto a [ToolRun]:
     *  - success whose body carries a truthy `error` → [RunPhase.Failed] with the error string (if a
     *    string) as [ToolRun.errorDetail], no result shown (web hides `data` when `error` is truthy);
     *  - success with no truthy `error` → [RunPhase.Succeeded] with the payload;
     *  - failure (transport) → [RunPhase.Failed] with the classified [ErrorKind] (web's catch branch,
     *    which surfaces `{error: err.message}`).
     */
    fun projectRun(result: Result<JsonElement>): ToolRun =
        result.fold(
            onSuccess = { json ->
                if (hasTruthyError(json)) {
                    ToolRun(phase = RunPhase.Failed, result = null, errorDetail = errorStringOrNull(json), errorKind = null)
                } else {
                    ToolRun(phase = RunPhase.Succeeded, result = json, errorDetail = null, errorKind = null)
                }
            },
            onFailure = { error ->
                ToolRun(phase = RunPhase.Failed, result = null, errorDetail = null, errorKind = errorKindOf(error))
            },
        )

    /**
     * Mirrors JavaScript truthiness of `data.error`: an object body whose `error` field is a non-empty
     * string, a non-zero number, boolean `true`, or any object/array is "failed"; `null`, `""`, `0`,
     * `false` (and a body that is not an object, or has no `error` field) are not.
     */
    fun hasTruthyError(json: JsonElement): Boolean {
        val error = (json as? JsonObject)?.get("error") ?: return false
        return when (error) {
            is JsonNull -> false
            is JsonPrimitive ->
                when {
                    error.isString -> error.content.isNotEmpty()
                    error.booleanOrNull != null -> error.booleanOrNull == true
                    error.doubleOrNull != null -> error.doubleOrNull != 0.0
                    else -> error.content.isNotEmpty()
                }
            is JsonObject -> true
            is JsonArray -> true
        }
    }

    /** The `error` value when it is a JSON string (web `typeof error === 'string'`), else `null`. */
    fun errorStringOrNull(json: JsonElement): String? {
        val error = (json as? JsonObject)?.get("error") as? JsonPrimitive ?: return null
        return if (error.isString && error.content.isNotEmpty()) error.content else null
    }

    /** Two-space pretty JSON, the native analogue of web `JSON.stringify(data, null, 2)`. */
    fun prettyJson(json: JsonElement): String = PRETTY.encodeToString(JsonElement.serializer(), json)
}
