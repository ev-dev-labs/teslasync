// Pure, framework-free model + projection for the GeneralSettings feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/GeneralSettings.tsx). No Compose, no Android, no HTTP: every
// declaration here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// GeneralSettings is the application-preferences panel. The web component reads the `/settings` document
// (a ~40-field, frequently-extended preferences blob), hydrates an editable form from it, and PUTs the
// whole document back on save (full-replace) — so the form must preserve EVERY server key, not just the
// ones it edits. This file owns exactly that: the typed [GeneralSettingsForm] (the 14 fields the panel
// edits) plus [GeneralSettingsFormCodec], which decodes the known fields from the raw [JsonElement]
// (falling back to the web `DEFAULT_FORM`) AND re-encodes them over the original document so unknown
// server keys round-trip byte-for-byte. The "Sync from Car" derivation, the read-only car-pref parsing
// (the web `parseSettingEnum` / `isSettingMiles` helpers), the decimal-precision preview, and the
// cache-then-network lifecycle (delegated to the canonical [toUiState] so loading / content / error /
// stale-offline is interpreted in exactly one place — DRY) all live here so the composable only renders.
//
// No field here is unit-bearing telemetry — the cost/efficiency preferences are user-entered values
// stored verbatim (the Phase-48 SI rule does not apply: these are not SI measurements), so there is no
// unit conversion at this layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/GeneralSettings — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling AdvancedSettings / WhyEndedPanel surfaces
// do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.generalsettings

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settings.CarPreferences
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put
import java.util.Locale

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no preference value,
 * VIN, or vehicle id, so a diagnostics line can never leak a user's settings.
 */
const val GENERAL_SETTINGS_SLUG: String = "GeneralSettings"

/** The decimal-precision preview seed — the web `(14.248539).toFixed(decimal_precision)`. */
internal const val PREVIEW_SEED: Double = 14.248539

/** The web `decimal_precision` clamp bounds (`Math.max(0, Math.min(20, …))`). */
internal const val MIN_PRECISION: Int = 0
internal const val MAX_PRECISION: Int = 20

// ── Editable form ────────────────────────────────────────────────────────────────────────────────────

/**
 * The 14 preferences the panel edits — the typed projection of the fields the web `GeneralSettings` form
 * binds (the rest of the `/settings` document is preserved verbatim by [GeneralSettingsFormCodec], never
 * modelled here). Unit/range/timezone tokens are locale-invariant wire strings ("km"/"mi", "C"/"F",
 * "bar"/"psi", "rated"/"ideal", "vehicle"/"user"/"utc", "gallon"/"liter"); the cost/MPG values are
 * user-entered numbers stored verbatim. Pure data so the codec + sync derivation are unit-tested without a
 * UI host. [DEFAULT] mirrors the web `DEFAULT_FORM` for exactly these fields.
 */
data class GeneralSettingsForm(
    val distanceUnit: String,
    val temperatureUnit: String,
    val pressureUnit: String,
    val preferredRange: String,
    val decimalPrecision: Int,
    val language: String,
    val currencySymbol: String,
    val locale: String,
    val tzDisplayDefault: String,
    val timezoneUser: String,
    val baseCostPerKwh: Double,
    val gasPricePerUnit: Double,
    val gasUnit: String,
    val gasEfficiencyMpg: Double,
) {
    companion object {
        /** The web `DEFAULT_FORM` values for the panel's fields (the cold-start / no-server-data form). */
        val DEFAULT: GeneralSettingsForm =
            GeneralSettingsForm(
                distanceUnit = "km",
                temperatureUnit = "C",
                pressureUnit = "bar",
                preferredRange = "rated",
                decimalPrecision = 2,
                language = "en",
                currencySymbol = "$",
                locale = "en-US",
                tzDisplayDefault = "vehicle",
                timezoneUser = "",
                baseCostPerKwh = 0.12,
                gasPricePerUnit = 3.50,
                gasUnit = "gallon",
                gasEfficiencyMpg = 25.0,
            )
    }
}

/**
 * The stable snake_case keys the form reads from / writes to the `/settings` document — the exact wire
 * keys the web form binds (`form.unit_of_length`, `form.base_cost_per_kwh`, …). Kept in one object so the
 * decoder and encoder can never drift.
 */
internal object SettingsKeys {
    const val DISTANCE = "unit_of_length"
    const val TEMP = "unit_of_temp"
    const val PRESSURE = "unit_of_pressure"
    const val RANGE = "preferred_range"
    const val PRECISION = "decimal_precision"
    const val LANGUAGE = "language"
    const val CURRENCY = "currency_symbol"
    const val LOCALE = "locale"
    const val TZ_DISPLAY = "tz_display_default"
    const val TZ_USER = "timezone_user"
    const val COST_KWH = "base_cost_per_kwh"
    const val GAS_PRICE = "gas_price_per_unit"
    const val GAS_UNIT = "gas_unit"
    const val GAS_MPG = "gas_efficiency_mpg"
}

/**
 * Decodes the editable [GeneralSettingsForm] from the raw `/settings` [JsonElement] and re-encodes it back
 * over the original document — the native analogue of the web `setForm(settings)` hydrate and the
 * `settingsMut.mutate(form)` full-replace save. [encode] overlays ONLY the 14 known fields onto the
 * original object so every other server key (theme, quiet hours, alert digest, …) round-trips unchanged —
 * the web relies on JS spreading the whole server object into the form; here that preservation is explicit.
 */
object GeneralSettingsFormCodec {
    /** Reads the known fields from [json] (falling back to [GeneralSettingsForm.DEFAULT] per field). */
    fun decode(json: JsonElement?): GeneralSettingsForm {
        val obj = json as? JsonObject ?: return GeneralSettingsForm.DEFAULT
        val d = GeneralSettingsForm.DEFAULT
        return GeneralSettingsForm(
            distanceUnit = obj.str(SettingsKeys.DISTANCE, d.distanceUnit),
            temperatureUnit = obj.str(SettingsKeys.TEMP, d.temperatureUnit),
            pressureUnit = obj.str(SettingsKeys.PRESSURE, d.pressureUnit),
            preferredRange = obj.str(SettingsKeys.RANGE, d.preferredRange),
            decimalPrecision = obj.int(SettingsKeys.PRECISION, d.decimalPrecision).coerceIn(MIN_PRECISION, MAX_PRECISION),
            language = obj.str(SettingsKeys.LANGUAGE, d.language),
            currencySymbol = obj.str(SettingsKeys.CURRENCY, d.currencySymbol),
            locale = obj.str(SettingsKeys.LOCALE, d.locale),
            tzDisplayDefault = obj.str(SettingsKeys.TZ_DISPLAY, d.tzDisplayDefault),
            timezoneUser = obj.strAllowingBlank(SettingsKeys.TZ_USER, d.timezoneUser),
            baseCostPerKwh = obj.dbl(SettingsKeys.COST_KWH, d.baseCostPerKwh),
            gasPricePerUnit = obj.dbl(SettingsKeys.GAS_PRICE, d.gasPricePerUnit),
            gasUnit = obj.str(SettingsKeys.GAS_UNIT, d.gasUnit),
            gasEfficiencyMpg = obj.dbl(SettingsKeys.GAS_MPG, d.gasEfficiencyMpg),
        )
    }

    /**
     * Produces the full document to PUT: every key of [base] (the last-known server document) preserved,
     * with the 14 editable fields overwritten from [form]. A null/non-object [base] yields a document of
     * just the known fields (the cold-start save).
     */
    fun encode(
        form: GeneralSettingsForm,
        base: JsonElement?,
    ): JsonObject =
        buildJsonObject {
            (base as? JsonObject)?.forEach { (key, value) -> put(key, value) }
            put(SettingsKeys.DISTANCE, form.distanceUnit)
            put(SettingsKeys.TEMP, form.temperatureUnit)
            put(SettingsKeys.PRESSURE, form.pressureUnit)
            put(SettingsKeys.RANGE, form.preferredRange)
            put(SettingsKeys.PRECISION, form.decimalPrecision)
            put(SettingsKeys.LANGUAGE, form.language)
            put(SettingsKeys.CURRENCY, form.currencySymbol)
            put(SettingsKeys.LOCALE, form.locale)
            put(SettingsKeys.TZ_DISPLAY, form.tzDisplayDefault)
            put(SettingsKeys.TZ_USER, form.timezoneUser)
            put(SettingsKeys.COST_KWH, form.baseCostPerKwh)
            put(SettingsKeys.GAS_PRICE, form.gasPricePerUnit)
            put(SettingsKeys.GAS_UNIT, form.gasUnit)
            put(SettingsKeys.GAS_MPG, form.gasEfficiencyMpg)
        }

    private fun JsonObject.str(
        key: String,
        default: String,
    ): String = (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() } ?: default

    // The timezone override is an intentionally-blank-able field, so a stored blank survives the round-trip.
    private fun JsonObject.strAllowingBlank(
        key: String,
        default: String,
    ): String = (this[key] as? JsonPrimitive)?.contentOrNull ?: default

    private fun JsonObject.dbl(
        key: String,
        default: Double,
    ): Double = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() } ?: default

    private fun JsonObject.int(
        key: String,
        default: Int,
    ): Int = (this[key] as? JsonPrimitive)?.doubleOrNull?.takeIf { it.isFinite() }?.toInt() ?: default
}

/** Formats the decimal-precision preview — the web `(14.248539).toFixed(precision)` (US grouping). */
fun decimalPreview(precision: Int): String = "%.${precision.coerceIn(MIN_PRECISION, MAX_PRECISION)}f".format(Locale.US, PREVIEW_SEED)

/**
 * Renders a user-entered numeric preference for an editable text field — whole values drop the trailing
 * `.0` (so `25.0` → "25", matching the web `value={form.gas_efficiency_mpg}` render) while fractional
 * values keep their digits (`0.12` → "0.12"). Locale-invariant (the wire uses a `.` decimal point); pure
 * so the field round-trip is unit-tested.
 */
fun displayNumber(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

/**
 * Parses a free-text numeric field to a Double, defaulting to `0.0` on blank / invalid input — the native
 * analogue of the web `parseFloat(e.target.value) || 0`. Pure so the field round-trip is unit-tested.
 */
fun parseNumberOrZero(text: String): Double = runCatching { java.lang.Double.parseDouble(text.trim()) }.getOrDefault(0.0)

// ── Read-only car-preference parsing (web `parseSettingEnum` / `isSettingX`) ───────────────────────────

/**
 * A car-reported unit classification — the native analogue of the web `parseSettingEnum` result. A
 * [Known] unit resolves to a localized label at the render boundary; a [Raw] value renders verbatim (the
 * web forward-compat fallback `return value`); [Dash] is the absent-value em-dash (web `'—'`).
 */
sealed interface CarUnitLabel {
    /** A recognised unit token; the composable maps it to its localized string. */
    data class Known(
        val unit: KnownCarUnit,
    ) : CarUnitLabel

    /** An unrecognised raw value, rendered verbatim (web `parseSettingEnum` fallback). */
    data class Raw(
        val value: String,
    ) : CarUnitLabel

    /** No value reported — the web `'—'` fallback. */
    data object Dash : CarUnitLabel
}

/** The car-reported units the panel can localize — the recognised half of the web `enumMappings`. */
enum class KnownCarUnit { MILES, KILOMETERS, CELSIUS, FAHRENHEIT, PSI, BAR, KPA }

/**
 * Pure port of the web `@/lib/parseSettingEnum` helpers. [classify] mirrors `parseSettingEnum` (strip
 * non-letters, lowercase, map known tokens, else raw / em-dash); [isMiles]/[isFahrenheit]/[isPsi]/[isBar]
 * mirror the substring detectors that drive "Sync from Car".
 */
object CarUnitParsing {
    private val distance =
        mapOf(
            "distanceunitmiles" to KnownCarUnit.MILES,
            "miles" to KnownCarUnit.MILES,
            "mi" to KnownCarUnit.MILES,
            "distanceunitkilometers" to KnownCarUnit.KILOMETERS,
            "distanceunitkm" to KnownCarUnit.KILOMETERS,
            "km" to KnownCarUnit.KILOMETERS,
            "kilometers" to KnownCarUnit.KILOMETERS,
        )
    private val temperature =
        mapOf(
            "temperatureunitcelsius" to KnownCarUnit.CELSIUS,
            "celsius" to KnownCarUnit.CELSIUS,
            "c" to KnownCarUnit.CELSIUS,
            "temperatureunitfahrenheit" to KnownCarUnit.FAHRENHEIT,
            "fahrenheit" to KnownCarUnit.FAHRENHEIT,
            "f" to KnownCarUnit.FAHRENHEIT,
        )
    private val pressure =
        mapOf(
            "pressureunitpsi" to KnownCarUnit.PSI,
            "psi" to KnownCarUnit.PSI,
            "pressureunitbar" to KnownCarUnit.BAR,
            "bar" to KnownCarUnit.BAR,
            "pressureunitkpa" to KnownCarUnit.KPA,
            "kpa" to KnownCarUnit.KPA,
        )

    /** The settings category a raw car value belongs to (web `parseSettingEnum(value, category)`). */
    enum class Category { DISTANCE, TEMPERATURE, PRESSURE }

    /** Classifies a raw car-reported value for [category] (web `parseSettingEnum`). */
    fun classify(
        value: String?,
        category: Category,
    ): CarUnitLabel {
        if (value.isNullOrBlank()) return CarUnitLabel.Dash
        val normalized = value.lowercase(Locale.ROOT).filter { it in 'a'..'z' }
        val table =
            when (category) {
                Category.DISTANCE -> distance
                Category.TEMPERATURE -> temperature
                Category.PRESSURE -> pressure
            }
        return table[normalized]?.let { CarUnitLabel.Known(it) } ?: CarUnitLabel.Raw(value)
    }

    /** Web `isSettingMiles` — the car reports an imperial distance unit. */
    fun isMiles(value: String?): Boolean = value?.lowercase(Locale.ROOT)?.contains("mile") == true

    /** Web `isSettingFahrenheit`. */
    fun isFahrenheit(value: String?): Boolean = value?.lowercase(Locale.ROOT)?.contains("fahr") == true

    /** Web `isSettingPSI`. */
    fun isPsi(value: String?): Boolean = value?.lowercase(Locale.ROOT)?.contains("psi") == true

    /** Web `isSettingBar`. */
    fun isBar(value: String?): Boolean = value?.lowercase(Locale.ROOT)?.contains("bar") == true
}

// ── Sync from Car ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The outcome of applying the car's reported units to the form — the native analogue of the web
 * `syncUnitsFromCar` `updates` build. [changed] is the web `Object.keys(updates).length > 0` guard (any
 * unit was detected); [form] is the result with the detected units applied. When [changed] is false the
 * panel shows the "No changes" feedback (web `toast.info`).
 */
data class SyncFromCarResult(
    val form: GeneralSettingsForm,
    val changed: Boolean,
)

/**
 * Applies [car]'s reported units to [current] exactly as the web `syncUnitsFromCar` does: distance →
 * mi when miles, else km when any distance is reported; temperature → F when Fahrenheit, else C when any
 * is reported; pressure → psi/bar only when explicitly psi/bar. Untouched categories keep [current]'s
 * value. Pure + total so the "Sync from Car" flow is unit-tested without the store.
 */
fun computeSyncFromCar(
    car: CarPreferences,
    current: GeneralSettingsForm,
): SyncFromCarResult {
    var changed = false
    var next = current

    when {
        CarUnitParsing.isMiles(car.distanceUnit) -> {
            next = next.copy(distanceUnit = "mi")
            changed = true
        }
        !car.distanceUnit.isNullOrBlank() -> {
            next = next.copy(distanceUnit = "km")
            changed = true
        }
    }
    when {
        CarUnitParsing.isFahrenheit(car.temperatureUnit) -> {
            next = next.copy(temperatureUnit = "F")
            changed = true
        }
        !car.temperatureUnit.isNullOrBlank() -> {
            next = next.copy(temperatureUnit = "C")
            changed = true
        }
    }
    when {
        CarUnitParsing.isPsi(car.tirePressureUnit) -> {
            next = next.copy(pressureUnit = "psi")
            changed = true
        }
        CarUnitParsing.isBar(car.tirePressureUnit) -> {
            next = next.copy(pressureUnit = "bar")
            changed = true
        }
    }
    return SyncFromCarResult(form = next, changed = changed)
}

// ── Transient feedback (web toasts) ─────────────────────────────────────────────────────────────────────

/** Feedback weight, mapped to a tone color/glyph by the render boundary. */
enum class FeedbackSeverity { Success, Error, Info }

/**
 * The one-shot feedback the panel surfaces after a save / sync — the native analogue of the web
 * `toast.success` / `toast.error` / `toast.info` calls. The composable maps each to its localized title +
 * detail (P1/S10); [UnitsSynced] carries the resulting units so the detail can name them (the web toast's
 * "Distance: …, Temperature: …, Pressure: …" breakdown).
 */
sealed interface GeneralSettingsFeedback {
    /** The visual weight the render boundary maps onto a tone color / glyph. */
    val severity: FeedbackSeverity

    /** Web `toast.success(t('toast.saved'), t('toast.savedDesc'))`. */
    data object Saved : GeneralSettingsFeedback {
        override val severity: FeedbackSeverity get() = FeedbackSeverity.Success
    }

    /** Web `toast.error(t('toast.saveFailed'), t('toast.saveFailedDesc'))`. */
    data object SaveFailed : GeneralSettingsFeedback {
        override val severity: FeedbackSeverity get() = FeedbackSeverity.Error
    }

    /** Web `toast.info(t('toast.noChanges'), t('toast.noChangesDesc'))` — no car units detected. */
    data object NoChanges : GeneralSettingsFeedback {
        override val severity: FeedbackSeverity get() = FeedbackSeverity.Info
    }

    /** Web units-synced success — carries the resulting units for the detail line. */
    data class UnitsSynced(
        val distanceMiles: Boolean,
        val temperatureFahrenheit: Boolean,
        val pressurePsi: Boolean,
    ) : GeneralSettingsFeedback {
        override val severity: FeedbackSeverity get() = FeedbackSeverity.Success
    }
}

// ── Projection ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The mutually-exclusive top-level surface the composable switches on. [Loading] is the first settings
 * fetch with nothing cached (skeleton); [Error] a hard failure with no cached fallback (the web
 * `Skeleton`/error branch becomes a retry); [Ready] the editable form — including the cold-start "no
 * server data" case, which renders the DEFAULT form rather than a blank box (the web always renders the
 * form). The form is never hidden behind a single empty state — that is the surface's never-blank rule.
 */
enum class GeneralSettingsStatus { Loading, Error, Ready }

/**
 * The fully projected, render-ready panel view — everything the web component computes before returning
 * JSX, plus the ADR-013 freshness flags. Pure data (no Compose types) so the projection is unit-tested
 * without a UI host.
 *
 * @property status the primary surface to render.
 * @property form the editable form to render (the user's edits, else the server doc, else DEFAULT).
 * @property carPreferences the car-reported units (web `carPrefs`), or null when no vehicle/data.
 * @property isDirty whether the form differs from the saved server document (web nav-guard `isDirty`).
 * @property saving whether a save/sync mutation is in flight (web `settingsMut.isPending`).
 * @property feedback the transient post-save/sync feedback, or null.
 * @property stale whether the shown form came from stale/offline cache (never presented as live).
 * @property refreshing whether a settings refresh is running over the shown form.
 * @property offline whether the shown form is cached because the network was unreachable.
 * @property canRetry whether a retry/refresh affordance should be offered.
 * @property fetchedAtMillis the freshness stamp of the shown settings, or null.
 * @property errorKind the classification of the most recent failure, or null.
 */
data class GeneralSettingsDisplay(
    val status: GeneralSettingsStatus,
    val form: GeneralSettingsForm,
    val carPreferences: CarPreferences?,
    val isDirty: Boolean,
    val saving: Boolean,
    val feedback: GeneralSettingsFeedback?,
    val stale: Boolean,
    val refreshing: Boolean,
    val offline: Boolean,
    val canRetry: Boolean,
    val fetchedAtMillis: Long?,
    val errorKind: ErrorKind?,
) {
    /** Web `carPrefs && (setting_distance_unit || setting_temperature_unit)` — show the Sync-from-Car panel. */
    val showSyncPanel: Boolean
        get() = carPreferences?.let { !it.distanceUnit.isNullOrBlank() || !it.temperatureUnit.isNullOrBlank() } == true

    /** Web `carPrefs && carPrefs.setting_24hr_time != null` — show the read-only car-clock panel. */
    val showClockPanel: Boolean
        get() = carPreferences?.use24HourTime != null

    /** The car's 24-hour-clock flag for the read-only panel; only meaningful when [showClockPanel]. */
    val carUses24HourClock: Boolean
        get() = carPreferences?.use24HourTime == true

    /** Whether the shown form is degraded (stale, mid-refresh, or last failed) — gates the freshness chip. */
    val isDegraded: Boolean
        get() = stale || refreshing || errorKind != null
}

/**
 * The immutable inputs the GeneralSettingsViewModel exposes — the cache-then-network settings feed, the
 * user's in-progress form edits (or null = follow the server), the resolved car preferences, the saving
 * flag, and any transient feedback. The pure [GeneralSettingsProjection] turns this into the render-ready
 * [GeneralSettingsDisplay].
 *
 * @property settings the `/settings` cache-then-network resource (null before the first emission).
 * @property formOverride the user's edited form, or null to mirror the server document.
 * @property carPreferences the resolved car-reported units, or null.
 * @property saving whether a save/sync mutation is in flight.
 * @property feedback the transient post-mutation feedback, or null.
 */
data class GeneralSettingsState(
    val settings: Resource<JsonElement>?,
    val formOverride: GeneralSettingsForm?,
    val carPreferences: CarPreferences?,
    val saving: Boolean,
    val feedback: GeneralSettingsFeedback?,
) {
    companion object {
        /** The pre-collection state: settings loading, no edits, no car data. */
        val INITIAL: GeneralSettingsState = GeneralSettingsState(null, null, null, false, null)
    }
}

/**
 * Pure projection from the surface inputs to the render-ready [GeneralSettingsDisplay] — a 1:1 port of the
 * derivations the web component performs before returning JSX, with the cache-then-network lifecycle
 * interpreted by the shared [toUiState] so it is honoured identically here and on every other native
 * surface. Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object GeneralSettingsProjection {
    /**
     * Builds the [GeneralSettingsDisplay] for [state]. The settings resource is folded with
     * `isEmpty = { false }`: a resolved document (even an empty one) is always Content — the form renders
     * with DEFAULT values rather than a blank box, exactly as the web always renders the form. The shown
     * form is the user's edits, else the decoded server doc, else DEFAULT; [GeneralSettingsDisplay.isDirty]
     * is the web nav-guard diff of the edited form against the saved server document.
     */
    fun project(state: GeneralSettingsState): GeneralSettingsDisplay {
        val resource = state.settings ?: Resource.Loading(cached = null, fetchedAt = null, stale = false)
        val ui = resource.toUiState { false }
        val serverForm = GeneralSettingsFormCodec.decode(ui.data)
        val shownForm = state.formOverride ?: serverForm
        val status =
            when (ui.phase) {
                UiPhase.Loading -> GeneralSettingsStatus.Loading
                UiPhase.Error -> GeneralSettingsStatus.Error
                UiPhase.Content, UiPhase.Empty -> GeneralSettingsStatus.Ready
            }
        val dirty = state.formOverride != null && state.formOverride != serverForm && !state.saving
        return GeneralSettingsDisplay(
            status = status,
            form = shownForm,
            carPreferences = state.carPreferences,
            isDirty = dirty,
            saving = state.saving,
            feedback = state.feedback,
            stale = ui.stale,
            refreshing = ui.refreshing,
            offline = ui.isOffline,
            canRetry = ui.canRetry,
            fetchedAtMillis = ui.fetchedAt,
            errorKind = ui.errorKind,
        )
    }
}

// ── Diagnostics ──────────────────────────────────────────────────────────────────────────────────────

/**
 * The one PII-safe diagnostic this surface emits (P1/S11). Carries only the surface [SLUG] — never a
 * preference value, VIN, or vehicle id — so a diagnostics line can never leak a user's settings. Kept free
 * of Compose so it is unit-tested with a recording [Logger]; the view-model calls it once on first
 * composition.
 */
object GeneralSettingsDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = GENERAL_SETTINGS_SLUG

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
