// Pure, framework-free model + projection for the ConfirmDialog modal/dialog — the native analogue of
// everything the web component derives before it returns JSX (web/src/components/ai/ConfirmDialog.tsx, the
// `AiConfirmDialog`). No Compose, no Android, no HTTP: every declaration here is exercised off-device by the
// :android:testReleaseUnitTest gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is the user-facing confirmation prompt for a dispatcher-paused mutating tool call: it
// surfaces what the assistant proposed (the tool name + its description) plus the proposed arguments rendered
// verbatim as pretty-printed JSON, behind explicit Approve / Cancel affordances so nothing fires
// automatically. It binds NO data hook — its only S8/S10 dependency is `useTranslation` — so, exactly like
// the sibling KioskOverlay / IncidentForm surfaces, the cache-then-network lifecycle (loading / empty /
// error / stale / offline) lives on the OWNING surface (the chat/dispatcher view that receives the
// `confirm_request` SSE frame), not here; modelling those phases would invent behaviour the web spec does not
// have (drift). The branches the web source actually defines are the complete state set this surface renders,
// and each is projected here:
//   1. the in-flight (`loading`) state — both buttons disable, Approve shows a spinner, the dialog is not
//      dismissible (carried by the composable; see ConfirmDialog.kt),
//   2. the mutating-vs-read intro copy (web `tool.mutates ? intro.mutates : intro.read`),
//   3. the optional tool description (web `tool.description && …`) — present or omitted,
//   4. the arguments block, pretty-printed as `JSON.stringify(args ?? {}, null, 2)`, including the empty-args
//      case which renders a friendly `{}` rather than a blank box.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ConfirmDialog — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.confirmdialog

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ConfirmDialogRegistration {
    /** Stable surface id. */
    const val ID: String = "confirm-dialog"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ConfirmDialog"
}

/**
 * The tool metadata the dialog surfaces — the native mirror of the web `AiToolPreview`
 * (`{ name, description?, mutates }`) supplied by the dispatcher's `confirm_request` SSE frame.
 *
 * @property name the tool identifier shown verbatim in a monospaced row (web `tool.name`).
 * @property mutates whether the tool changes user data; selects the intro copy (web `tool.mutates`).
 * @property description optional human-readable summary (web `tool.description`); omitted when blank/absent.
 */
data class AiToolPreview(
    val name: String,
    val mutates: Boolean,
    val description: String? = null,
)

/**
 * The fully projected, render-ready view — the native analogue of every value the web component computes
 * before returning JSX. Pure data (no Compose types) so the projection is unit-tested without a UI host; each
 * field is exactly one piece of the web render tree.
 *
 * @property toolName the tool identifier (web `tool.name`).
 * @property toolDescription the tool summary, or `null` when the web `tool.description &&` guard omits it
 *   (absent or blank).
 * @property mutates whether the mutating intro copy is shown (web `tool.mutates`).
 * @property argsJson the proposed arguments pretty-printed as `JSON.stringify(args ?? {}, null, 2)` — a
 *   two-space indent, `": "` separators, one entry per line; an empty/absent payload renders `{}`.
 */
data class ConfirmDialogDisplay(
    val toolName: String,
    val toolDescription: String?,
    val mutates: Boolean,
    val argsJson: String,
)

/**
 * Pure projection from the surface's inputs to its render-ready [ConfirmDialogDisplay] — a 1:1 port of the
 * derivations the web component performs: the `tool.description` truthiness guard and the
 * `JSON.stringify(args ?? {}, null, 2)` argument formatting. No Compose or formatting beyond the JSON encode.
 */
object ConfirmDialogProjection {
    // Web `JSON.stringify(args, null, 2)`: pretty-printed with a two-space indent.
    private val prettyJson =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    private val emptyArgs = JsonObject(emptyMap())

    /**
     * Projects the [tool] + [args] into the render-ready [ConfirmDialogDisplay].
     *
     * @param tool the tool metadata (web `tool` prop).
     * @param args the proposed arguments object, or `null` for a tool with no input (web `args` prop).
     */
    fun project(
        tool: AiToolPreview,
        args: JsonObject?,
    ): ConfirmDialogDisplay =
        ConfirmDialogDisplay(
            toolName = tool.name,
            toolDescription = tool.description?.takeIf { it.isNotBlank() },
            mutates = tool.mutates,
            argsJson = formatArgs(args),
        )

    /**
     * Pretty-prints the proposed arguments exactly as the web `JSON.stringify(args ?? {}, null, 2)`: a
     * two-space indent with `": "` separators and one entry per line. A `null` or empty payload yields `{}`
     * (one line), mirroring `JSON.stringify({}, null, 2)` so the arguments block is never an empty box.
     */
    fun formatArgs(args: JsonObject?): String {
        val obj = args ?: emptyArgs
        if (obj.isEmpty()) return "{}"
        return prettyJson.encodeToString(JsonObject.serializer(), obj)
    }
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ConfirmDialogRegistration.SLUG] (P1/S11).
 * Carries only the slug — never the tool name or the proposed arguments — so a diagnostics line can never
 * leak what the assistant is about to do. Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the composable calls it from its first-composition effect.
 */
fun recordConfirmDialogOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to ConfirmDialogRegistration.SLUG))
}
