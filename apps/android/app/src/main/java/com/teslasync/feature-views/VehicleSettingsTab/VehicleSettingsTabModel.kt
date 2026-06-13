// Pure, framework-free model + projection for the VehicleSettingsTab feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/vehicles/components/VehicleSettingsTab.tsx). No Compose, no Android UI, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// VehicleSettingsTab is the per-vehicle settings section mounted inside <VehicleDetailPage>. The web
// component renders one row per supported key (a static whitelist mirroring vehicleSettingDefs in
// internal/database/settings/vehicle_repo.go) with: the human-readable label + help, the current effective
// value rendered through a typed input, a "source" pill (Override | User default | Vehicle name | System
// default), a Save button (enabled only when the local draft differs from the effective value), and a
// "Reset to default" button (enabled only when the source is an override). This file owns exactly the pure
// logic behind that: the typed [VehicleSettingDescriptor] whitelist, the effective-value -> draft codec
// (with the web's datetime-local <-> RFC3339 conversion), the draft validation (the web `parseDraft`), and
// the cache-then-network -> display projection (delegated to the canonical [toUiState] so loading / content
// / error / stale-offline is interpreted in exactly one place — DRY).
//
// The web source has no separate "empty" surface: the whitelist is a static non-empty constant, so the
// section always renders its rows. A key with no resolved value renders its row with an empty input and a
// "System default" pill (the web `findEffectiveSetting(...) ?? source 'default'` path) — that is the
// surface's faithful "no value" handling, never a blank box. No field is unit-bearing telemetry (a value is
// carried verbatim as the backend serves it), so the Phase-48 SI rule does not apply and there is no unit
// conversion at this layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/VehicleSettingsTab — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling GeneralSettings / BatteryTab surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.vehiclesettingstab

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSetting
import io.teslasync.shared.core.presentation.vehiclesettings.EffectiveSettingSource
import io.teslasync.shared.core.presentation.vehiclesettings.VehicleSettingsResponse
import io.teslasync.shared.core.presentation.vehiclesettings.findEffectiveSetting
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.Instant
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no setting value, VIN, or
 * vehicle id, so a diagnostics line can never leak a user's per-vehicle settings.
 */
const val VEHICLE_SETTINGS_TAB_SLUG: String = "VehicleSettingsTab"

// ── Mutation feedback i18n keys (ADR-014) ──────────────────────────────────────────────────────────────
// One-shot toast keys the view-model emits and the render boundary resolves — the native analogue of the
// web `useMutationToast` success/error toasts. They carry the i18n key only (never localized text, never a
// value), exactly as the [io.teslasync.android.data.UiEvent.Message] contract requires.

/** Success toast after an override save (web `useUpsertVehicleSetting` success toast). */
const val VEHICLE_SETTINGS_SAVED_KEY: String = "vehicleSettings.toasts.saved"

/** Success toast after a reset-to-default (web `useResetVehicleSetting` success toast). */
const val VEHICLE_SETTINGS_RESET_KEY: String = "vehicleSettings.toasts.reset"

/** Error toast after a failed save (web `useUpsertVehicleSetting` error toast). */
const val VEHICLE_SETTINGS_SAVE_FAILED_KEY: String = "vehicleSettings.errors.save"

/** Error toast after a failed reset (web `useResetVehicleSetting` error toast). */
const val VEHICLE_SETTINGS_RESET_FAILED_KEY: String = "vehicleSettings.errors.reset"

// ── Whitelist + per-key UI metadata ────────────────────────────────────────────────────────────────────

/** The kind of typed input a setting renders through, mirroring the web `VehicleSettingKind`. */
enum class VehicleSettingKind { Text, Timestamp, Select }

/** A single option for a [VehicleSettingKind.Select] key — a stable [value] and a literal display [label]. */
data class VehicleSettingOption(
    val value: String,
    val label: String,
)

/**
 * Per-key UI metadata, the native port of the web `VehicleSettingDescriptor`. The list order drives row
 * rendering order and must mirror the web whitelist exactly.
 *
 * @property key the setting's stable identifier (the resolver whitelist key).
 * @property kind the typed input the key renders through.
 * @property options the static option set for a [VehicleSettingKind.Select] key.
 * @property maxLength the optional character cap for a [VehicleSettingKind.Text] key.
 */
data class VehicleSettingDescriptor(
    val key: String,
    val kind: VehicleSettingKind,
    val options: List<VehicleSettingOption> = emptyList(),
    val maxLength: Int? = null,
)

/**
 * The supported keys, mirroring the web `VEHICLE_SETTING_DESCRIPTORS`. The order here drives row rendering
 * order; do not reorder unless the i18n labels change. The select labels are literal unit symbols (`mi`,
 * `km`, `°C`, `°F`, `kWh`) that are intentionally NOT localized, exactly as the web option labels are.
 */
val VEHICLE_SETTING_DESCRIPTORS: List<VehicleSettingDescriptor> =
    listOf(
        VehicleSettingDescriptor("nickname", VehicleSettingKind.Text, maxLength = NICKNAME_MAX_LENGTH),
        VehicleSettingDescriptor("mute_until", VehicleSettingKind.Timestamp),
        VehicleSettingDescriptor("charge_cost_tariff_id", VehicleSettingKind.Text, maxLength = TARIFF_MAX_LENGTH),
        VehicleSettingDescriptor(
            "units_distance",
            VehicleSettingKind.Select,
            options = listOf(VehicleSettingOption("mi", "mi"), VehicleSettingOption("km", "km")),
        ),
        VehicleSettingDescriptor(
            "units_temperature",
            VehicleSettingKind.Select,
            options = listOf(VehicleSettingOption("C", "\u00b0C"), VehicleSettingOption("F", "\u00b0F")),
        ),
        VehicleSettingDescriptor(
            "units_energy",
            VehicleSettingKind.Select,
            options = listOf(VehicleSettingOption("kWh", "kWh")),
        ),
    )

/** Looks up the descriptor for [key], or null when [key] is not in the whitelist. */
fun descriptorForKey(key: String): VehicleSettingDescriptor? = VEHICLE_SETTING_DESCRIPTORS.firstOrNull { it.key == key }

// ── Draft validation ───────────────────────────────────────────────────────────────────────────────────

/** The reason a draft failed validation, mapped to an i18n key at the render boundary (the web `parseDraft`). */
enum class VehicleSettingValidation { Required, InvalidDate, Invalid }

/** The outcome of validating a draft string for a key — either the typed value to PUT, or a [reason] to show. */
sealed interface DraftParse {
    /** The draft is valid; [value] is the typed value to forward verbatim to the upsert. */
    data class Valid(
        val value: JsonElement,
    ) : DraftParse

    /** The draft is invalid; [reason] selects the inline validation message. */
    data class Invalid(
        val reason: VehicleSettingValidation,
    ) : DraftParse
}

/**
 * Validates [draft] for [descriptor], the native port of the web `parseDraft`. A blank draft is
 * [VehicleSettingValidation.Required]; a timestamp that cannot be parsed is
 * [VehicleSettingValidation.InvalidDate]; a select value outside the option set is
 * [VehicleSettingValidation.Invalid]; anything else is [DraftParse.Valid] carrying the typed value (a
 * `mute_until` draft is converted to an RFC3339 string, as the web does before calling the mutation).
 */
fun parseDraft(
    descriptor: VehicleSettingDescriptor,
    draft: String,
): DraftParse {
    val trimmed = draft.trim()
    if (trimmed.isEmpty()) return DraftParse.Invalid(VehicleSettingValidation.Required)
    return when (descriptor.kind) {
        VehicleSettingKind.Timestamp ->
            localInputToRfc3339(trimmed)
                ?.let { DraftParse.Valid(JsonPrimitive(it)) }
                ?: DraftParse.Invalid(VehicleSettingValidation.InvalidDate)

        VehicleSettingKind.Select ->
            if (descriptor.options.any { it.value == trimmed }) {
                DraftParse.Valid(JsonPrimitive(trimmed))
            } else {
                DraftParse.Invalid(VehicleSettingValidation.Invalid)
            }

        VehicleSettingKind.Text -> DraftParse.Valid(JsonPrimitive(trimmed))
    }
}

/**
 * Derives the initial draft string shown in a row's input from its effective value — the native port of the
 * web `effectiveToDraft`. A timestamp is rendered as the local `YYYY-MM-DDTHH:MM` shape; any other kind is
 * the value's string form, or the empty string when the value is absent (so a "no value" row renders an
 * empty input rather than a blank box).
 */
fun effectiveToDraft(
    descriptor: VehicleSettingDescriptor,
    effective: EffectiveSetting?,
): String {
    val raw = jsonStringOrNull(effective?.value)
    return when (descriptor.kind) {
        VehicleSettingKind.Timestamp -> rfc3339ToLocalInput(raw)
        VehicleSettingKind.Select -> raw.orEmpty()
        VehicleSettingKind.Text -> raw.orEmpty()
    }
}

/** The string content of a JSON value (string or number), or null for JSON null / a structural value. */
private fun jsonStringOrNull(value: JsonElement?): String? =
    when (value) {
        null, JsonNull -> null
        is JsonPrimitive -> value.contentOrNull
        else -> value.toString()
    }

// ── datetime-local <-> RFC3339 helpers (web `rfc3339ToLocalInput` / `localInputToRFC3339`) ───────────────

/** The `YYYY-MM-DDTHH:MM` shape an HTML `datetime-local` input uses; parsed/formatted in the device zone. */
private val LOCAL_INPUT_FORMATTER: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm")

/**
 * Converts an RFC3339 timestamp into the local `YYYY-MM-DDTHH:MM` shape, the native port of the web
 * `rfc3339ToLocalInput`. Returns the empty string when [raw] is null/blank or cannot be parsed, so the input
 * renders as "no value".
 */
fun rfc3339ToLocalInput(raw: String?): String =
    raw
        ?.takeIf { it.isNotBlank() }
        ?.let(::parseInstant)
        ?.atZone(ZoneId.systemDefault())
        ?.toLocalDateTime()
        ?.format(LOCAL_INPUT_FORMATTER)
        ?: ""

/**
 * Converts the local `YYYY-MM-DDTHH:MM` string the user typed back into an RFC3339 (UTC) timestamp, the
 * native port of the web `localInputToRFC3339`. Returns null when [local] is blank or unparseable so the
 * caller can surface an invalid-date validation error.
 */
fun localInputToRfc3339(local: String): String? =
    local
        .takeIf { it.isNotBlank() }
        ?.let { runCatching { LocalDateTime.parse(it, LOCAL_INPUT_FORMATTER) }.getOrNull() }
        ?.atZone(ZoneId.systemDefault())
        ?.toInstant()
        ?.toString()

/** Parses an RFC3339 string (with an offset or trailing `Z`) into an [Instant], or null when malformed. */
private fun parseInstant(raw: String): Instant? =
    runCatching { OffsetDateTime.parse(raw).toInstant() }.getOrNull()
        ?: runCatching { Instant.parse(raw) }.getOrNull()

// ── Surface state + display projection ──────────────────────────────────────────────────────────────────

/**
 * The immutable inputs the [io.teslasync.android.featureviews.vehiclesettingstab] view-model exposes — the
 * cache-then-network settings feed, the user's per-key in-progress draft edits, the per-key inline
 * validation, and the per-key save/reset in-flight sets. The pure [VehicleSettingsTabProjection] turns this
 * into the render-ready [VehicleSettingsTabDisplay].
 *
 * @property settings the `GET /vehicles/{id}/settings` cache-then-network resource.
 * @property drafts the user's edited draft per key (absent = follow the effective value).
 * @property validation the inline validation reason per key (absent = valid / not yet validated).
 * @property savingKeys the keys whose override save is in flight.
 * @property resettingKeys the keys whose reset-to-default is in flight.
 */
data class VehicleSettingsTabState(
    val settings: Resource<VehicleSettingsResponse>,
    val drafts: Map<String, String>,
    val validation: Map<String, VehicleSettingValidation>,
    val savingKeys: Set<String>,
    val resettingKeys: Set<String>,
) {
    companion object {
        /** The pre-collection state: settings loading, no edits, no validation, nothing in flight. */
        val INITIAL: VehicleSettingsTabState =
            VehicleSettingsTabState(
                settings = Resource.Loading(cached = null, fetchedAt = null, stale = false),
                drafts = emptyMap(),
                validation = emptyMap(),
                savingKeys = emptySet(),
                resettingKeys = emptySet(),
            )
    }
}

/** The primary surface a [VehicleSettingsTabDisplay] renders, mirroring the web loading / error / rows split. */
enum class VehicleSettingsTabStatus { Loading, Error, Ready }

/**
 * One render-ready settings row — the projection of a descriptor against the resolver payload + draft state.
 *
 * @property key the setting's stable identifier.
 * @property kind the typed input the row renders through.
 * @property options the option set for a [VehicleSettingKind.Select] row.
 * @property maxLength the character cap for a [VehicleSettingKind.Text] row.
 * @property source the layer that produced the effective value, rendered as the source pill.
 * @property draft the string shown in the input (the user's edit, else the effective value's draft form).
 * @property isDirty whether the shown draft differs from the effective value (the web `dirty`).
 * @property validation the inline validation reason, or null when valid.
 * @property saving whether an override save is in flight for this row.
 * @property resetting whether a reset-to-default is in flight for this row.
 */
data class VehicleSettingRowDisplay(
    val key: String,
    val kind: VehicleSettingKind,
    val options: List<VehicleSettingOption>,
    val maxLength: Int?,
    val source: EffectiveSettingSource,
    val draft: String,
    val isDirty: Boolean,
    val validation: VehicleSettingValidation?,
    val saving: Boolean,
    val resetting: Boolean,
) {
    /** Web `disabled={!dirty || isPending}` inverted — the Save button is enabled. */
    val canSave: Boolean get() = isDirty && !saving

    /** Web `disabled={source !== 'override' || isPending}` inverted — the Reset button is enabled. */
    val canReset: Boolean get() = source == EffectiveSettingSource.OVERRIDE && !resetting
}

/**
 * The render-ready surface: the [status] to draw plus, when ready, every settings [row], and the
 * cache-then-network freshness envelope (stale / refreshing / offline / retry) the native layer adds over
 * the web's loading-or-error-only contract.
 *
 * @property status the primary surface to render.
 * @property rows every settings row in whitelist order (always populated; the rows are a static whitelist).
 * @property stale whether the shown rows are older than the TTL or served offline.
 * @property refreshing whether a network refresh is in flight over the shown rows.
 * @property offline whether the shown rows are cached because the network was unreachable.
 * @property canRetry whether a retry / re-read affordance should be offered.
 * @property fetchedAtMillis the freshness stamp of the shown rows, or null.
 * @property errorKind the classification of the most recent failure, or null.
 */
data class VehicleSettingsTabDisplay(
    val status: VehicleSettingsTabStatus,
    val rows: List<VehicleSettingRowDisplay>,
    val stale: Boolean,
    val refreshing: Boolean,
    val offline: Boolean,
    val canRetry: Boolean,
    val fetchedAtMillis: Long?,
    val errorKind: ErrorKind?,
) {
    /** Whether the shown rows are degraded (stale, mid-refresh, or last failed) — gates the freshness chip. */
    val isDegraded: Boolean get() = stale || refreshing || errorKind != null
}

/**
 * Pure projection from the surface inputs to the render-ready [VehicleSettingsTabDisplay] — a 1:1 port of the
 * derivations the web component performs before returning JSX, with the cache-then-network lifecycle
 * interpreted by the shared [toUiState] so it is honoured identically here and on every other native surface.
 * Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object VehicleSettingsTabProjection {
    /**
     * Builds the [VehicleSettingsTabDisplay] for [state]. The settings resource is folded with
     * `isEmpty = { false }`: a resolved payload (even an empty one) is always Content — the rows render with
     * their default/empty values rather than a blank box, exactly as the web always renders the whitelist.
     * Each row's shown draft is the user's edit, else the effective value's draft form; [isDirty] is the web
     * `draft !== initialDraft` diff.
     */
    fun project(state: VehicleSettingsTabState): VehicleSettingsTabDisplay {
        val ui = state.settings.toUiState { false }
        val payload = ui.data
        val status =
            when (ui.phase) {
                UiPhase.Loading -> VehicleSettingsTabStatus.Loading
                UiPhase.Error -> VehicleSettingsTabStatus.Error
                UiPhase.Content, UiPhase.Empty -> VehicleSettingsTabStatus.Ready
            }
        val rows = VEHICLE_SETTING_DESCRIPTORS.map { descriptor -> projectRow(descriptor, payload, state) }
        return VehicleSettingsTabDisplay(
            status = status,
            rows = rows,
            stale = ui.stale,
            refreshing = ui.refreshing,
            offline = ui.isOffline,
            canRetry = ui.canRetry,
            fetchedAtMillis = ui.fetchedAt,
            errorKind = ui.errorKind,
        )
    }

    private fun projectRow(
        descriptor: VehicleSettingDescriptor,
        payload: VehicleSettingsResponse?,
        state: VehicleSettingsTabState,
    ): VehicleSettingRowDisplay {
        val effective = findEffectiveSetting(payload, descriptor.key)
        val source = effective?.source ?: EffectiveSettingSource.DEFAULT
        val effectiveDraft = effectiveToDraft(descriptor, effective)
        val override = state.drafts[descriptor.key]
        return VehicleSettingRowDisplay(
            key = descriptor.key,
            kind = descriptor.kind,
            options = descriptor.options,
            maxLength = descriptor.maxLength,
            source = source,
            draft = override ?: effectiveDraft,
            isDirty = override != null && override != effectiveDraft,
            validation = state.validation[descriptor.key],
            saving = descriptor.key in state.savingKeys,
            resetting = descriptor.key in state.resettingKeys,
        )
    }
}

// ── Diagnostics ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a setting
 * value, VIN, or vehicle id — so a diagnostics line can never leak a user's per-vehicle settings. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the view-model calls it once on first
 * composition.
 */
object VehicleSettingsTabDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = VEHICLE_SETTINGS_TAB_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}

private const val NICKNAME_MAX_LENGTH = 64
private const val TARIFF_MAX_LENGTH = 64
