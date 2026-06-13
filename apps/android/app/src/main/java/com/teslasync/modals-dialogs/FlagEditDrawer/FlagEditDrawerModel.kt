// Pure, framework-free model + projection for the FlagEditDrawer modal/dialog surface — the native
// analogue of everything the web component derives before it returns JSX
// (web/src/features/admin/components/feature-flags/FlagEditDrawer.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so
// the composable stays a thin render layer over these pure functions.
//
// The web component is a single controlled create/edit form for one typed feature flag. It binds NO
// data hook — its only dependency is `useTranslation` — so, exactly like the sibling ConfirmDialog /
// GeofenceDrawer surfaces, the cache-then-network lifecycle (loading / empty / error / stale /
// offline) lives on the OWNING page (the FeatureFlags page that holds `useSetFlag` + the `saving`
// flag and passes `initial` / `onSave`), not here; modelling those phases would invent behaviour the
// web spec does not have (drift). The branches the web source actually defines are the complete state
// set this surface renders, and each is projected here:
//   1. create vs. edit mode (web `editing = initial !== null`) — selects the title, the key field's
//      editability, and the immutable-key note,
//   2. the seed JSON for the value editor (web `defaultValueJson` = `JSON.stringify(value, null, 2)`),
//   3. the live parse of the value editor (web `parsed` memo): empty → "value required", unparseable
//      → "invalid JSON" + the parser message, otherwise the decoded JSON value,
//   4. the composite save-enabled rule (web `canSave = parsed.ok && keyValid && reasonValid &&
//      !saving`) and the trimmed `{ key, value, reason }` payload handed back through `onSave`.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/FlagEditDrawer — the P3 prompt's allowed-files path) cannot form a
// valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling ConfirmDialog / GeofenceDrawer
// surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.flageditdrawer

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object FlagEditDrawerRegistration {
    /** Stable surface id. */
    const val ID: String = "flag-edit-drawer"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FlagEditDrawer"
}

/**
 * The flag the drawer edits — the native mirror of the web `initial: FeatureFlagEntry | null` prop. A
 * `null` target is the web "create new" mode; a non-null target is "edit existing". [value] is
 * arbitrary JSON (the web `FeatureFlagValue = unknown`, stored as JSONB in Postgres), carried as a
 * nullable [JsonElement] where a Kotlin `null` models the web `undefined` (absent — seeds an empty
 * editor) and a JSON `null` models a literal `null` value (seeds the text `null`).
 *
 * @property key the flag key (web `initial.key`); shown read-only in edit mode.
 * @property value the flag's current JSON value (web `initial.value`), or `null` when absent.
 */
data class FlagEditTarget(
    val key: String,
    val value: JsonElement?,
)

/**
 * The assembled, trimmed write the operator confirms — the native mirror of the object the web hands
 * to `onSave({ key, value, reason })`. The owning page forwards it to the shared `setFlag` mutation
 * (S8); the drawer itself performs no HTTP.
 *
 * @property key the trimmed flag key (web `keyInput.trim()`).
 * @property value the decoded JSON value to store (web `parsed.value`).
 * @property reason the trimmed audit reason (web `reason.trim()`), required by the backend audit row.
 */
data class FlagEditSubmission(
    val key: String,
    val value: JsonElement,
    val reason: String,
)

/**
 * The outcome of parsing the free-form JSON value editor — the native mirror of the web `parsed` memo
 * (`{ ok, value?, error? }`). A pure sum type so the composable maps each case to its localized helper
 * text + the save-enabled rule without re-deriving anything: [Empty] when the editor is blank (web
 * `valueEmpty`), [Invalid] when `JSON.parse` throws (web `valueInvalid` with the parser message), and
 * [Valid] carrying the decoded value when it parses.
 */
sealed interface FlagValueParse {
    /** The editor is blank — the web `valueInput.trim() === ''` branch (renders "Value is required."). */
    data object Empty : FlagValueParse

    /**
     * The editor text is not valid JSON — the web `catch` branch. [message] is the parser's own error
     * text, interpolated into the localized "Invalid JSON: {{msg}}" copy at the Compose boundary.
     */
    data class Invalid(
        val message: String,
    ) : FlagValueParse

    /** The editor parsed cleanly — the web `{ ok: true, value }` branch; [value] is the decoded JSON. */
    data class Valid(
        val value: JsonElement,
    ) : FlagValueParse
}

/**
 * The pure derivations the composable renders over — a 1:1 port of the web component's `editing`
 * flag, `defaultValueJson` helper, `parsed` memo, and `canSave` rule. Stateless and side-effect-free,
 * so the surface is fully covered by the off-device unit gate.
 */
object FlagEditDrawerProjection {
    // Web `JSON.stringify(value, null, 2)`: pretty-printed with a two-space indent.
    private val prettyJson =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
        }

    // Strict decoder matching `JSON.parse` (no lenient/relaxed parsing): an unquoted key, a trailing
    // token, or a bare word is rejected, exactly as the browser's parser rejects it.
    private val strictJson = Json

    // The parser-detail text shown when a top-level unquoted bareword is rejected (interpolated into the
    // localized "Invalid JSON: {{msg}}" copy, mirroring the web's raw `e.message` engine detail).
    private const val NON_JSON_VALUE_MESSAGE = "Unexpected token in JSON"

    /** Whether the drawer is editing an existing flag vs. creating one — web `initial !== null`. */
    fun isEditing(target: FlagEditTarget?): Boolean = target != null

    /**
     * The text the value editor opens with — a port of the web `defaultValueJson(initial)`: an absent
     * target (create mode) or an absent value seeds an empty editor; otherwise the value is
     * pretty-printed as `JSON.stringify(value, null, 2)`. Any encode failure falls back to an empty
     * editor, mirroring the web `catch { return '' }`.
     */
    fun defaultValueJson(target: FlagEditTarget?): String {
        val value = target?.value ?: return ""
        return runCatching { prettyJson.encodeToString(JsonElement.serializer(), value) }.getOrDefault("")
    }

    /**
     * Parses the value editor exactly as the web `parsed` memo: a blank editor is [FlagValueParse.Empty]
     * (web `valueInput.trim() === ''`), otherwise the raw text is decoded; a decode failure yields
     * [FlagValueParse.Invalid] carrying the parser message (web `catch`), and a clean decode yields
     * [FlagValueParse.Valid] with the JSON value (web `JSON.parse(valueInput)`).
     *
     * Strictness note (no silent drift): kotlinx's lexer accepts a top-level unquoted bareword (e.g.
     * `not-json`) as a non-string primitive, which the browser `JSON.parse` rejects. To keep the surface
     * byte-for-byte faithful to the web — so an operator can never persist a value the web would have
     * blocked — such barewords are re-rejected here via [isJsonParseCompatible].
     */
    fun parseValue(raw: String): FlagValueParse {
        if (raw.isBlank()) return FlagValueParse.Empty
        return try {
            val element = strictJson.parseToJsonElement(raw)
            if (isJsonParseCompatible(element)) {
                FlagValueParse.Valid(element)
            } else {
                FlagValueParse.Invalid(NON_JSON_VALUE_MESSAGE)
            }
        } catch (e: SerializationException) {
            FlagValueParse.Invalid(e.message ?: e.toString())
        }
    }

    /**
     * Whether [element] is something the browser `JSON.parse` would also have accepted. Objects, arrays,
     * and quoted strings always are; a non-string primitive is only valid when it is a recognised JSON
     * literal (`true` / `false` / `null`) or a number — rejecting the unquoted barewords kotlinx's
     * lenient top-level lexer would otherwise admit.
     */
    private fun isJsonParseCompatible(element: JsonElement): Boolean {
        val primitive = element as? JsonPrimitive ?: return true
        val content = primitive.content
        return primitive.isString ||
            content == "true" ||
            content == "false" ||
            content == "null" ||
            primitive.doubleOrNull != null
    }

    /** Whether the flag key is non-blank — the web `keyInput.trim().length > 0` guard. */
    fun isKeyValid(key: String): Boolean = key.trim().isNotEmpty()

    /** Whether the audit reason is non-blank — the web `reason.trim().length > 0` guard. */
    fun isReasonValid(reason: String): Boolean = reason.trim().isNotEmpty()

    /**
     * Whether the Save action is enabled — the web `canSave = parsed.ok && keyValid && reasonValid &&
     * !saving`. The value must parse, the key and reason must be non-blank, and no save may be in
     * flight; otherwise Save stays disabled exactly as the web button does.
     */
    fun canSubmit(
        parse: FlagValueParse,
        key: String,
        reason: String,
        saving: Boolean,
    ): Boolean = parse is FlagValueParse.Valid && isKeyValid(key) && isReasonValid(reason) && !saving

    /**
     * Assembles the trimmed `{ key, value, reason }` write the operator confirms — the web
     * `onSave({ key: keyInput.trim(), value: parsed.value, reason: reason.trim() })`. The caller passes
     * the already-decoded [value] from a [FlagValueParse.Valid], so this never re-parses.
     */
    fun buildSubmission(
        key: String,
        value: JsonElement,
        reason: String,
    ): FlagEditSubmission = FlagEditSubmission(key = key.trim(), value = value, reason = reason.trim())
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FlagEditDrawerRegistration.SLUG]
 * (P1/S11). Carries only the slug — never the flag key, value, or reason — so a diagnostics line can
 * never leak the server's feature-flag posture or an operator's draft. Kept free of Compose so it is
 * unit-tested with a recording [Logger]; the composable calls it from its first-composition effect.
 */
fun recordFlagEditDrawerOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FlagEditDrawerRegistration.SLUG))
}
