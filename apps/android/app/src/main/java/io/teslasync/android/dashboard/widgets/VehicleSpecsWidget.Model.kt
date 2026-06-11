@file:Suppress("MatchingDeclarationName")

package io.teslasync.android.dashboard.widgets

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The combined vehicle-configuration payload behind the Vehicle Specs surface — the native union of
 * the three web hooks the widget composes (`useVehicleSpecs`, `useVehicleOptions`,
 * `useVehicleConfigLatest`). [specs] and [options] are the unwrapped `data` objects of the
 * `GET /vehicles/{id}/specs` and `/options` info-envelopes (web `envelope?.data`); [config] is the
 * raw `GET /vehicle-config/latest` snapshot (web `configData`). Any of the three may be `null` when
 * its endpoint returned no body / a non-object.
 *
 * [hasAnyData] mirrors the web `hasAnyData` gate (`specs !== null || options !== null || config !==
 * null`): the surface renders its detail card only when at least one source resolved, otherwise the
 * outer "No specs available" empty state.
 */
data class VehicleSpecsData(
    val specs: JsonObject?,
    val options: JsonObject?,
    val config: JsonObject?,
) {
    /** True when at least one of the three configuration sources resolved (web `hasAnyData`). */
    val hasAnyData: Boolean get() = specs != null || options != null || config != null

    companion object {
        /** The no-source fallback — every source absent; renders the outer empty state. */
        val EMPTY: VehicleSpecsData = VehicleSpecsData(null, null, null)
    }
}

/**
 * The widget's grid footprint (columns × rows). Mirrors the web `WidgetProps.size` plus the
 * `isCompact` logic in web/src/features/dashboard/widgets/VehicleSpecsWidget.tsx.
 */
data class VehicleSpecsSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `isCompact = size.cols <= 1`): hide title, show Model + Trim only. */
    val isCompact: Boolean get() = cols <= COMPACT_MAX_COLS

    private companion object {
        const val COMPACT_MAX_COLS = 1
    }
}

/**
 * One projected, render-ready detail row — the native analogue of the web `DetailEntry`. Holds the
 * already-localized [label], the resolved [value] (the em-dash fallback when a source field was
 * absent, web `?? '—'`), a [mono] flag (the Car Version renders monospaced, web `mono: true`), and an
 * optional neutral [badge] caption (each decoded option code carries the localized "Option" chip).
 */
data class SpecEntry(
    val label: String,
    val value: String,
    val mono: Boolean = false,
    val badge: String? = null,
)

/**
 * The localized strings the projection needs, resolved through the i18n facade (P1/S10) at the
 * Compose boundary and passed in so [VehicleSpecsProjection.project] stays framework-free and
 * JVM-testable. Each field maps to a `widget.specs.*` / `widget.vehicleSpecs` key from the web source.
 */
@Suppress("LongParameterList")
data class VehicleSpecsStrings(
    val title: String,
    val model: String,
    val trim: String,
    val paint: String,
    val wheels: String,
    val interior: String,
    val auxBattery: String,
    val carVersion: String,
    val option: String,
    val noData: String,
)

/**
 * The fully projected, render-ready view of the configuration payload for one footprint — the native
 * analogue of everything the web component computes via `useMemo` before returning JSX. Pure data so
 * the projection is unit-tested without a Compose host.
 */
data class VehicleSpecsDisplay(
    val isCompact: Boolean,
    val entries: List<SpecEntry>,
    val compactModel: String,
    val compactTrim: String,
)

/**
 * Pure projection from a raw [VehicleSpecsData] to the display model — the native port of the
 * `entries` `useMemo` and the `CompactView` field resolution in the web source. Every label is
 * supplied already-localized via [VehicleSpecsStrings]; spec/option values are plain configuration
 * strings (no SI unit conversion applies).
 */
object VehicleSpecsProjection {
    /** Maximum decoded option chips shown in the non-compact detail card (web `slice(0, 8)`). */
    const val MAX_OPTIONS: Int = 8

    /** The em-dash shown for an absent source field (web `?? '—'`). */
    const val EM_DASH: String = "\u2014"

    /** Trailing fraction an integral [Double] renders with — trimmed to match JS `String(number)`. */
    private const val INTEGRAL_SUFFIX: String = ".0"

    /** Project [data] for [size], labelling every row via [strings]. */
    fun project(
        data: VehicleSpecsData,
        size: VehicleSpecsSize,
        strings: VehicleSpecsStrings,
    ): VehicleSpecsDisplay {
        val model = resolveModel(data)
        val trim = resolveTrim(data)
        return VehicleSpecsDisplay(
            isCompact = size.isCompact,
            entries = buildEntries(data, size.isCompact, strings, model, trim),
            compactModel = model ?: EM_DASH,
            compactTrim = trim ?: EM_DASH,
        )
    }

    /** Model from specs `car_type`/`model`, falling back to the config snapshot (web order). */
    private fun resolveModel(data: VehicleSpecsData): String? =
        firstOf(data.specs, "car_type") ?: firstOf(data.specs, "model") ?: firstOf(data.config, "car_type")

    /** Trim from specs `trim_badging`/`trim`, falling back to the config snapshot (web order). */
    private fun resolveTrim(data: VehicleSpecsData): String? =
        firstOf(data.specs, "trim_badging") ?: firstOf(data.specs, "trim") ?: firstOf(data.config, "trim")

    private fun buildEntries(
        data: VehicleSpecsData,
        isCompact: Boolean,
        strings: VehicleSpecsStrings,
        model: String?,
        trim: String?,
    ): List<SpecEntry> {
        val paint = firstOf(data.specs, "exterior_color") ?: firstOf(data.config, "exterior_color")
        val wheels = firstOf(data.specs, "wheel_type") ?: firstOf(data.config, "wheel_type")
        val interior = firstOf(data.specs, "interior") ?: firstOf(data.specs, "interior_color")
        val auxBattery = firstOf(data.specs, "aux_battery_type")
        val carVersion = firstOf(data.config, "version") ?: firstOf(data.specs, "car_version")

        val items = mutableListOf<SpecEntry>()
        items += SpecEntry(strings.model, model ?: EM_DASH)
        items += SpecEntry(strings.trim, trim ?: EM_DASH)
        items += SpecEntry(strings.paint, paint ?: EM_DASH)
        items += SpecEntry(strings.wheels, wheels ?: EM_DASH)
        items += SpecEntry(strings.interior, interior ?: EM_DASH)
        items += SpecEntry(strings.auxBattery, auxBattery ?: EM_DASH)
        items += SpecEntry(strings.carVersion, carVersion ?: EM_DASH, mono = true)
        appendOptions(items, data.options, isCompact, strings.option)
        return items
    }

    /** Append the decoded option chips (web `Object.keys(options).slice(0, isCompact ? 0 : 8)`). */
    private fun appendOptions(
        items: MutableList<SpecEntry>,
        options: JsonObject?,
        isCompact: Boolean,
        optionBadge: String,
    ) {
        if (options == null) return
        val limit = if (isCompact) 0 else MAX_OPTIONS
        for (key in options.keys.take(limit)) {
            items += SpecEntry(label = key, value = jsonString(options[key]) ?: key, badge = optionBadge)
        }
    }

    private fun firstOf(
        obj: JsonObject?,
        key: String,
    ): String? = jsonString(obj?.get(key))

    /**
     * Extract a display string from a JSON value exactly as the web `asString` helper does: a
     * non-empty string yields its content; a number yields its shortest decimal form (web
     * `String(number)` — integral values drop the `.0`); JSON-null, booleans, objects, arrays, and
     * empty strings all yield `null` so the caller falls through to the next source / em-dash.
     */
    internal fun jsonString(element: JsonElement?): String? {
        val primitive = element as? JsonPrimitive
        if (primitive == null || primitive is JsonNull) return null
        return when {
            primitive.isString -> primitive.content.ifEmpty { null }
            primitive.booleanOrNull != null -> null
            else -> primitive.doubleOrNull?.let(::renderNumber)
        }
    }

    /** Render a numeric value as JS `String(number)` does — trimming the `.0` of an integral value. */
    private fun renderNumber(value: Double): String {
        val rendered = value.toString()
        return if (rendered.endsWith(INTEGRAL_SUFFIX)) rendered.dropLast(INTEGRAL_SUFFIX.length) else rendered
    }
}

/**
 * Canonical registry metadata for the Vehicle Specs surface — the native mirror of the web registry
 * entry (web/src/features/dashboard/widgets/registry/vehicle.ts). A dashboard grid host binds this
 * surface with the same [ID] and honours the same min/max footprint constraints.
 */
object VehicleSpecsRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID: String = "vehicle-specs"

    /** Widget category (matches the web registry). */
    const val CATEGORY: String = "vehicle"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "VehicleSpecsWidget"

    /** Registry description copy (registry metadata; not rendered in the widget body). */
    const val DESCRIPTION: String = "Configuration reference: model, trim, paint, wheels, options"

    /** Default footprint: 2 columns × 4 rows. */
    val defaultSize: VehicleSpecsSize = VehicleSpecsSize(2, 4)

    /** Minimum footprint: 1 column × 2 rows. */
    val minSize: VehicleSpecsSize = VehicleSpecsSize(1, 2)

    /** Maximum footprint: 4 columns × 40 rows. */
    val maxSize: VehicleSpecsSize = VehicleSpecsSize(4, 40)

    /** True when [size] falls within the supported min/max footprint constraints. */
    fun withinBounds(size: VehicleSpecsSize): Boolean = size.cols in minSize.cols..maxSize.cols && size.rows in minSize.rows..maxSize.rows

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: VehicleSpecsSize): VehicleSpecsSize =
        VehicleSpecsSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}
