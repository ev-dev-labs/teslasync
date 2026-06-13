// Pure, framework-free model + projection for the TOUSettingsModal surface — the native analogue of everything the
// web component derives before it returns JSX (web/src/features/battery/components/TOUSettingsModal.tsx). No Compose,
// no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the
// composable stays a thin render layer over these pure functions.
//
// The web component is the "Update Rate Plan" modal for a Tesla Powerwall site. It offers two ways to supply a
// time-of-use tariff: a Preset Tariff tab (a Select over three built-in utility plans — PG&E EV2-A, SCE TOU-D,
// SDG&E TOU-DR1 — with a JSON preview of the chosen plan) and a Custom JSON tab (a free-text textarea). On submit it
// validates the chosen input, POSTs the `tou_settings` envelope through `useUpdateTOUSettings` and then refreshes the
// site config through `useRefreshTeslaEnergySiteInfo`. This file owns the data derivations behind that form: the three
// preset tariff envelopes (byte-for-byte with the web `PRESETS` literal), the per-tab payload assembly + validation
// (web `getPayload`: no-preset / empty-JSON / not-an-object / invalid-JSON guards, and the "full envelope vs. wrap the
// inner object" branch), and the pretty-printed preview (web `JSON.stringify(settings, null, 2)`). Colors, glyphs, and
// localized labels are resolved at the Compose boundary, never here.
//
// State-set parity (declared, not silent — honesty covenant #2/#9): the web component binds NO cache-then-network
// read — its only hooks are the two write mutations + `useTranslation`. The prompt's generic loading / empty / error /
// stale / offline DATA states therefore do not exist in the source and are NOT fabricated here (that would be drift),
// exactly as the sibling GeofenceDrawer / ReauthDialog models declare. The states this surface actually has — the
// preset vs. custom tab, a chosen-preset (preview) vs. none, the four client-side validation errors, the in-flight
// submit, and the server submit error — are the complete state set, owned by [TOUSettingsModalProjection] +
// [TOUSettingsModalViewModel].
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen is
// illegal in a package identifier), so the package intentionally diverges from the path — exactly as the sibling
// FeedbackModal surface does. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.tousettingsmodal

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.energy.EnergyStore
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object TOUSettingsModalRegistration {
    /** Stable surface id. */
    const val ID: String = "tou-settings-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "TOUSettingsModal"
}

/**
 * The two input modes the web component offers as tabs (`'preset' | 'custom'`). [wire] is the exact tab key the web
 * `activeTab` state holds; the human label is resolved at the Compose boundary (P1/S10 `energy.tou.tabPreset` /
 * `energy.tou.tabCustom`).
 */
enum class TOUTab(
    val wire: String,
) {
    Preset("preset"),
    Custom("custom"),
    ;

    companion object {
        /** Resolves a [wire] token back to its tab (web tab `onChange`); an unknown token falls back to [Preset]. */
        fun fromWire(wire: String): TOUTab = entries.firstOrNull { it.wire == wire } ?: Preset
    }
}

/**
 * One built-in utility rate plan — the native mirror of a web `TOUPreset`. [id] is the stable Select value (web
 * `p.id`), [name] + [utility] are the proper-noun brand strings the option label is composed from (web
 * `${p.name} — ${p.utility}` — data, never translated chrome), and [settings] is the verbatim `tou_settings` envelope
 * POSTed to the backend and shown in the preview (web `p.settings`).
 */
data class TOUPreset(
    val id: String,
    val name: String,
    val utility: String,
    val settings: JsonObject,
)

/** A render-ready Select entry derived from a [TOUPreset] (the web `{ value, label }` option). */
data class TOUPresetOption(
    val value: String,
    val label: String,
)

/**
 * The client-side validation failure surfaced in the form's single error slot — one case per web `getPayload` guard.
 * Each maps to a localized `energy.tou.error*` string at the Compose boundary (the submit-time server error is carried
 * verbatim by the ViewModel, mirroring the web `setError(String(err))`, and is not part of this enum).
 */
enum class TOUValidationError {
    /** web `energy.tou.errorNoPreset` — the Preset tab is active but no plan is chosen. */
    NoPreset,

    /** web `energy.tou.errorEmptyJSON` — the Custom tab is active but the textarea is blank. */
    EmptyJson,

    /** web `energy.tou.errorNotObject` — the custom JSON parsed to an array / primitive / null, not an object. */
    NotObject,

    /** web `energy.tou.errorInvalidJSON` — the custom JSON failed to parse. */
    InvalidJson,
}

/**
 * The discriminated result of assembling the submit payload — the native, non-throwing analogue of the web
 * `getPayload()` (which returns the payload or `null` after calling `setError`). [Valid] carries the `tou_settings`
 * envelope to POST; [Invalid] carries the guard that fired.
 */
sealed interface TOUPayloadResult {
    /** The input validated; [payload] is the verbatim `tou_settings` envelope to submit. */
    data class Valid(
        val payload: JsonObject,
    ) : TOUPayloadResult

    /** The input failed a client-side guard; [error] selects the localized message. */
    data class Invalid(
        val error: TOUValidationError,
    ) : TOUPayloadResult
}

/**
 * The pure derivations the composable renders over — the native mirror of the web component's module-scope `PRESETS`
 * literal + inline `getPayload` logic. Stateless and side-effect-free, so it is fully covered by the off-device unit
 * gate.
 */
object TOUSettingsModalProjection {
    /** The envelope key the backend expects (web `tou_settings`); also the "is this already an envelope?" discriminator. */
    const val KEY_TOU_SETTINGS: String = "tou_settings"

    /** Lenient JSON facade for parsing custom input + pretty-printing the preview (web `JSON.parse` / `JSON.stringify`). */
    private val json: Json =
        Json {
            prettyPrint = true
            prettyPrintIndent = "  "
            isLenient = false
        }

    /** The three built-in rate plans, in the web `PRESETS` order (PG&E, SCE, SDG&E). */
    val presets: List<TOUPreset> = buildPresets()

    /** The Select options the Preset tab renders — web `PRESETS.map(p => ({ value: p.id, label: `${name} — ${utility}` }))`. */
    fun presetOptions(): List<TOUPresetOption> =
        presets.map { preset -> TOUPresetOption(value = preset.id, label = "${preset.name} — ${preset.utility}") }

    /** The preset with [id], or `null` when none matches (web `PRESETS.find(p => p.id === selectedPreset)`). */
    fun findPreset(id: String): TOUPreset? = presets.firstOrNull { it.id == id }

    /**
     * The pretty-printed envelope shown in the preview pane for the chosen preset, or `null` when none is chosen — web
     * `JSON.stringify(PRESETS.find(...)?.settings, null, 2)` gated on `selectedPreset`.
     */
    fun previewFor(presetId: String): String? = findPreset(presetId)?.settings?.let(::prettyPrint)

    /** Two-space-indented JSON of [payload] — the native `JSON.stringify(value, null, 2)`. */
    fun prettyPrint(payload: JsonObject): String = json.encodeToString(JsonObject.serializer(), payload)

    /**
     * Assembles + validates the submit payload for the active tab — a 1:1 port of the web `getPayload()`:
     *  - Preset tab: the chosen plan's envelope, or [TOUValidationError.NoPreset] when none is selected.
     *  - Custom tab: the trimmed textarea must be non-blank ([TOUValidationError.EmptyJson]), must parse
     *    ([TOUValidationError.InvalidJson]), and must parse to a JSON object — not an array / primitive / null
     *    ([TOUValidationError.NotObject]). A parsed object that already carries [KEY_TOU_SETTINGS] is submitted
     *    verbatim (web "Allow either the full envelope"); otherwise it is wrapped as `{ tou_settings: obj }`.
     */
    fun buildPayload(
        tab: TOUTab,
        selectedPresetId: String,
        customJson: String,
    ): TOUPayloadResult =
        when (tab) {
            TOUTab.Preset ->
                findPreset(selectedPresetId)
                    ?.let { TOUPayloadResult.Valid(it.settings) }
                    ?: TOUPayloadResult.Invalid(TOUValidationError.NoPreset)

            TOUTab.Custom -> buildCustomPayload(customJson)
        }

    private fun buildCustomPayload(customJson: String): TOUPayloadResult {
        val trimmed = customJson.trim()
        if (trimmed.isEmpty()) return TOUPayloadResult.Invalid(TOUValidationError.EmptyJson)
        val parsed = parseCustomJson(trimmed)
        return if (parsed == null) {
            TOUPayloadResult.Invalid(TOUValidationError.InvalidJson)
        } else {
            classifyParsed(parsed)
        }
    }

    /** Parses [trimmed] to a [JsonElement], or `null` when it is not valid JSON (web `JSON.parse` throws). */
    private fun parseCustomJson(trimmed: String): JsonElement? =
        try {
            json.parseToJsonElement(trimmed)
        } catch (_: SerializationException) {
            null
        }

    /**
     * Classifies a successfully-parsed [JsonElement] into the web `getPayload` outcome: an object becomes the (possibly
     * wrapped) envelope; a primitive the web `JSON.parse` would have rejected becomes [TOUValidationError.InvalidJson];
     * every genuine non-object value (array, number, boolean, null, quoted string) becomes [TOUValidationError.NotObject].
     * `parseToJsonElement` is more permissive than `JSON.parse` — it accepts a bare unquoted token (e.g. `economics`) as
     * an unquoted primitive — so that case is reclassified here to preserve the web guard order.
     */
    private fun classifyParsed(parsed: JsonElement): TOUPayloadResult =
        when {
            parsed is JsonObject -> TOUPayloadResult.Valid(envelopeOf(parsed))
            parsed is JsonPrimitive && isUnparseableByJsonParse(parsed) ->
                TOUPayloadResult.Invalid(TOUValidationError.InvalidJson)
            else -> TOUPayloadResult.Invalid(TOUValidationError.NotObject)
        }

    /** A parsed object that already carries [KEY_TOU_SETTINGS] is verbatim; otherwise it is wrapped as `{ tou_settings: obj }`. */
    private fun envelopeOf(obj: JsonObject): JsonObject =
        if (obj.containsKey(KEY_TOU_SETTINGS)) obj else buildJsonObject { put(KEY_TOU_SETTINGS, obj) }

    /**
     * Whether [primitive] is an unquoted token that the web `JSON.parse` would reject — i.e. an unquoted literal that is
     * not `true` / `false` / `null` and not a number. Quoted strings (web valid) and real numeric/boolean/null literals
     * return `false`.
     */
    private fun isUnparseableByJsonParse(primitive: JsonPrimitive): Boolean =
        !primitive.isString &&
            primitive.content !in JSON_ROOT_LITERALS &&
            primitive.doubleOrNull == null

    /** The unquoted root tokens `JSON.parse` accepts besides numbers (web valid non-object primitives). */
    private val JSON_ROOT_LITERALS: Set<String> = setOf("true", "false", "null")
}

/**
 * The narrow write seam the dialog binds to — the native analogue of the two web mutations the component composes
 * (`useUpdateTOUSettings` + `useRefreshTeslaEnergySiteInfo`). A production binding routes both calls to the shared
 * **S8** [EnergyStore] (see [bindTOUSettingsModalSource]); tests pass a fake. Keeping the seam this small means the
 * dialog never sees the store, the cache, or HTTP.
 */
interface TOUSettingsModalSource {
    /**
     * Saves the site's time-of-use settings (web `useUpdateTOUSettings.mutate({ siteId, settings })`). Returns the
     * non-throwing [Result] the store exposes; on success the store has already refreshed the site's `tesla-site-info`
     * feed (the web hook's `invalidateQueries(['tesla-site-info', siteId])`).
     */
    suspend fun updateTouSettings(
        siteId: Long,
        settings: JsonObject,
    ): Result<JsonElement>

    /**
     * Re-pulls the site config from Tesla after a successful save (web `refreshSiteInfo.mutate(siteId)` fired inside
     * the update's `onSuccess`). Fire-and-forget at the call site: its failure must never block the dialog's close,
     * mirroring the web's non-awaited `mutate`.
     */
    suspend fun refreshSiteInfo(siteId: Long): Result<JsonElement>
}

/**
 * Binds the dialog's write seam to the shared **S8** [EnergyStore] — the cross-platform port of the web `useEnergy`
 * mutation hooks. [TOUSettingsModalSource.updateTouSettings] delegates to [EnergyStore.updateTouSettings] (which
 * refreshes the per-site `tesla-site-info` family on success, the web `invalidateQueries`) and
 * [TOUSettingsModalSource.refreshSiteInfo] to [EnergyStore.refreshTeslaEnergySiteInfo]. No HTTP touches the view.
 */
fun bindTOUSettingsModalSource(store: EnergyStore): TOUSettingsModalSource =
    object : TOUSettingsModalSource {
        override suspend fun updateTouSettings(
            siteId: Long,
            settings: JsonObject,
        ): Result<JsonElement> = store.updateTouSettings(siteId, settings)

        override suspend fun refreshSiteInfo(siteId: Long): Result<JsonElement> = store.refreshTeslaEnergySiteInfo(siteId)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [TOUSettingsModalRegistration.SLUG] (P1/S11).
 * Carries only the slug — never a site id, tariff body, or rate — so a diagnostics line can never leak the operator's
 * pricing config. Kept free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from
 * its first-composition effect.
 */
fun recordTOUSettingsModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to TOUSettingsModalRegistration.SLUG))
}

// ── Preset tariff envelopes — byte-for-byte with the web `PRESETS` literal ──────────────────────────────────────────

private fun buildPresets(): List<TOUPreset> = listOf(pgeEv2a(), sceTouD(), sdgeTouDr1())

/** A single energy-charge window — the web `{ rate, start, end }` literal, keys in source order. */
private fun window(
    rate: Double,
    start: Int,
    end: Int,
): JsonElement =
    buildJsonObject {
        put("rate", rate)
        put("start", start)
        put("end", end)
    }

/** A season's date range — the web `{ fromMonth, fromDay, toMonth, toDay }` literal, keys in source order. */
private fun seasonRange(
    fromMonth: Int,
    fromDay: Int,
    toMonth: Int,
    toDay: Int,
): JsonObject =
    buildJsonObject {
        put("fromMonth", fromMonth)
        put("fromDay", fromDay)
        put("toMonth", toMonth)
        put("toDay", toDay)
    }

/** Wraps a [tariffContent] block into the full `{ tou_settings: { optimization_strategy, tariff_content_v2 } }` envelope. */
private fun envelope(tariffContent: JsonObject): JsonObject =
    buildJsonObject {
        putJsonObject(TOUSettingsModalProjection.KEY_TOU_SETTINGS) {
            put("optimization_strategy", "economics")
            put("tariff_content_v2", tariffContent)
        }
    }

private fun pgeEv2a(): TOUPreset =
    TOUPreset(
        id = "pge-ev2a",
        name = "PG&E EV2-A",
        utility = "Pacific Gas & Electric",
        settings =
            envelope(
                buildJsonObject {
                    put("name", "PG&E EV2-A")
                    put("utility", "Pacific Gas & Electric")
                    putJsonArray("daily_charges") {
                        addJsonObject {
                            put("amount", 0.32854)
                            put("name", "Charge")
                        }
                    }
                    putJsonObject("demand_charges") { putJsonObject("ALL") { put("ALL", 0) } }
                    putJsonObject("energy_charges") {
                        putJsonObject("Summer") {
                            putJsonArray("ON_PEAK") { add(window(0.49, 16, 21)) }
                            putJsonArray("OFF_PEAK") {
                                add(window(0.35, 0, 16))
                                add(window(0.35, 21, 24))
                            }
                        }
                        putJsonObject("Winter") {
                            putJsonArray("ON_PEAK") { add(window(0.42, 16, 21)) }
                            putJsonArray("OFF_PEAK") {
                                add(window(0.36, 0, 16))
                                add(window(0.36, 21, 24))
                            }
                        }
                    }
                    putJsonObject("seasons") {
                        put("Summer", seasonRange(6, 1, 9, 30))
                        put("Winter", seasonRange(10, 1, 5, 31))
                    }
                },
            ),
    )

private fun sceTouD(): TOUPreset =
    TOUPreset(
        id = "sce-tou-d",
        name = "SCE TOU-D",
        utility = "Southern California Edison",
        settings =
            envelope(
                buildJsonObject {
                    put("name", "SCE TOU-D")
                    put("utility", "Southern California Edison")
                    putJsonArray("daily_charges") {
                        addJsonObject {
                            put("amount", 0.031)
                            put("name", "Charge")
                        }
                    }
                    putJsonObject("demand_charges") { putJsonObject("ALL") { put("ALL", 0) } }
                    putJsonObject("energy_charges") {
                        putJsonObject("Summer") {
                            putJsonArray("ON_PEAK") { add(window(0.54, 16, 21)) }
                            putJsonArray("MID_PEAK") {
                                add(window(0.41, 8, 16))
                                add(window(0.41, 21, 23))
                            }
                            putJsonArray("OFF_PEAK") {
                                add(window(0.28, 0, 8))
                                add(window(0.28, 23, 24))
                            }
                        }
                        putJsonObject("Winter") {
                            putJsonArray("MID_PEAK") { add(window(0.43, 8, 21)) }
                            putJsonArray("SUPER_OFF_PEAK") {
                                add(window(0.28, 0, 8))
                                add(window(0.28, 21, 24))
                            }
                        }
                    }
                    putJsonObject("seasons") {
                        put("Summer", seasonRange(6, 1, 9, 30))
                        put("Winter", seasonRange(10, 1, 5, 31))
                    }
                },
            ),
    )

private fun sdgeTouDr1(): TOUPreset =
    TOUPreset(
        id = "sdge-tou-dr1",
        name = "SDG&E TOU-DR1",
        utility = "San Diego Gas & Electric",
        settings =
            envelope(
                buildJsonObject {
                    put("name", "SDG&E TOU-DR1")
                    put("utility", "San Diego Gas & Electric")
                    putJsonArray("daily_charges") {
                        addJsonObject {
                            put("amount", 0.546)
                            put("name", "Charge")
                        }
                    }
                    putJsonObject("demand_charges") { putJsonObject("ALL") { put("ALL", 0) } }
                    putJsonObject("energy_charges") {
                        putJsonObject("Summer") {
                            putJsonArray("ON_PEAK") { add(window(0.71, 16, 21)) }
                            putJsonArray("OFF_PEAK") {
                                add(window(0.45, 0, 16))
                                add(window(0.45, 21, 24))
                            }
                        }
                        putJsonObject("Winter") {
                            putJsonArray("ON_PEAK") { add(window(0.57, 16, 21)) }
                            putJsonArray("OFF_PEAK") {
                                add(window(0.45, 0, 16))
                                add(window(0.45, 21, 24))
                            }
                        }
                    }
                    putJsonObject("seasons") {
                        put("Summer", seasonRange(6, 1, 9, 30))
                        put("Winter", seasonRange(10, 1, 5, 31))
                    }
                },
            ),
    )
