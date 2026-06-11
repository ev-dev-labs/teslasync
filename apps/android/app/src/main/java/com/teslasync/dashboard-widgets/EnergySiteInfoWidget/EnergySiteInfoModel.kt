// Pure, framework-free model + projection for the Energy Site dashboard widget — the native analogue
// of everything the web component derives before returning JSX
// (web/src/features/dashboard/widgets/EnergySiteInfoWidget.tsx). No Compose, no Android, no HTTP: every
// type here is unit-tested off-device in the :android:testReleaseUnitTest gate, keeping the composable a
// thin render layer. Both feeds arrive as raw SI JSON (`/tesla/energy-sites` + `…/site-info`), so this
// file owns the decode (web optional-chaining → null-safe reads) plus the watts→kW / watt-hours→kWh
// display scaling the web does inline (`nameplate_power / 1000`, `nameplate_energy / 1000`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/dashboard-widgets/EnergySiteInfoWidget — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the co-located
// supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.dashboard.widgets.energysiteinfo

import io.teslasync.android.components.charts.ChartFormat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import java.util.Locale

private const val EM_DASH = "\u2014"
private const val MULTIPLY_SIGN = "\u00d7"

/** Solar capacity + Powerwall energy render with one fraction digit (web `fmtNumber(x / 1000, 1)`). */
private const val CAPACITY_DECIMALS = 1

/** Watts → kilowatts and watt-hours → kilowatt-hours (web `… / 1000`). */
private const val KILO = 1000.0

/**
 * The widget grid footprint (columns × rows) — the native mirror of the web `WidgetProps.size`. The
 * `isCompact` flag reproduces the web `size.cols <= 1` test that drops the panel title + icon and caps the
 * detail list, leaving the bare label/value rows for the single-column footprint.
 */
data class EnergySiteInfoSize(
    val cols: Int,
    val rows: Int,
) {
    /** True at a single column (web `size.cols <= 1`): hide the title/icon and cap the visible rows. */
    val isCompact: Boolean get() = cols <= 1
}

/**
 * Canonical registry metadata for this surface — the native mirror of the web registry entry in
 * web/src/features/dashboard/widgets/registry/energy.ts (`energy-site-info`). A dashboard grid host binds
 * this surface with the same [ID] and honours the same min/max footprint, so the native + web grids stay
 * in lockstep.
 */
object EnergySiteInfoRegistration {
    /** Stable registry id (matches the web registry). */
    const val ID = "energy-site-info"

    /** Widget category (matches the web registry). */
    const val CATEGORY = "energy"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG = "EnergySiteInfoWidget"

    /** Default footprint: 2 columns × 4 rows (web `defaultSize`). */
    val defaultSize = EnergySiteInfoSize(cols = 2, rows = 4)

    /** Minimum footprint: 1 column × 2 rows (web `minSize`). */
    val minSize = EnergySiteInfoSize(cols = 1, rows = 2)

    /** Maximum footprint: 4 columns × 40 rows (web `maxSize`). */
    val maxSize = EnergySiteInfoSize(cols = 4, rows = 40)

    /** True when [size] already lies within the inclusive min/max footprint (clamping is a no-op). */
    fun isWithinBounds(size: EnergySiteInfoSize): Boolean = clamp(size) == size

    /** Clamp [size] into the supported min/max footprint. */
    fun clamp(size: EnergySiteInfoSize): EnergySiteInfoSize =
        EnergySiteInfoSize(
            cols = size.cols.coerceIn(minSize.cols, maxSize.cols),
            rows = size.rows.coerceIn(minSize.rows, maxSize.rows),
        )
}

/**
 * Localized labels the surface folds into its output (the seven web `t('widget.energySiteInfo.…')` keys).
 * The pure [EnergySiteInfoProjection] reads these to assemble each row + its TalkBack content description;
 * the composable builds this from `stringResource`, while tests pass a deterministic instance. Keeping
 * i18n out of the projection lets the projection stay a pure, locale-stable function.
 */
data class EnergySiteInfoStrings(
    val title: String,
    val solarSize: String,
    val powerwall: String,
    val firmware: String,
    val timezone: String,
    val noSite: String,
    val noData: String,
)

/**
 * The decoded `…/site-info` payload — the native analogue of the web `TeslaEnergySiteInfo` fields the
 * component reads (`nameplate_power`, `nameplate_energy`, `battery_count`, `version`,
 * `installation_time_zone`). All numerics are SI/raw on the wire (watts, watt-hours); scaling to kW/kWh
 * happens in [EnergySiteInfoProjection]. Each field is nullable so an absent/JSON-null wire value collapses
 * to the em-dash exactly like the web optional-chaining (`?? null`, `!= null ? … : null`).
 */
data class EnergySiteInfo(
    val nameplatePowerW: Double?,
    val nameplateEnergyWh: Double?,
    val batteryCount: Int?,
    val version: String?,
    val installationTimeZone: String?,
)

/**
 * The combined state of the two feeds the widget composes — the native analogue of the web component's
 * `hasSites` + `info` derivation. [hasSites] mirrors web `(sites ?? []).length > 0`; [info] mirrors web
 * `infoResponse?.data ?? null` (an object — even an empty one — means "info present"; `null` means the
 * detail payload was absent). The two together choose which empty message the surface shows.
 */
data class EnergySiteInfoState(
    val hasSites: Boolean,
    val info: EnergySiteInfo?,
) {
    /** Web `else if (info)` — there is decoded site detail to render. */
    val hasInfo: Boolean get() = info != null

    companion object {
        /** No linked site resolved (web `siteId` undefined, `hasSites` false). */
        val NO_SITES = EnergySiteInfoState(hasSites = false, info = null)
    }
}

/**
 * One projected, render-ready detail row — the native analogue of a web `DetailEntry`. Carries the
 * resolved [label], the already-formatted [value] (`null` ⇒ the renderer shows an em-dash, web
 * `value ?? '—'`), and whether the value uses a monospace face ([mono]) — set only for the firmware
 * version, matching the web `mono: true`.
 */
data class EnergySiteEntry(
    val label: String,
    val value: String?,
    val mono: Boolean,
)

/**
 * The fully projected, render-ready view of the energy site for one footprint — the native analogue of
 * everything the web component computes before returning JSX. Pure data (no Compose types) so the
 * projection is unit-tested without a UI host. When [entries] is empty the surface shows [emptyMessage]
 * (web `WidgetDetailCard` empty branch); otherwise it renders the rows. [contentDescription] folds the
 * whole surface into one TalkBack phrase.
 */
data class EnergySiteInfoDisplay(
    val entries: List<EnergySiteEntry>,
    val emptyMessage: String,
    val contentDescription: String,
)

/**
 * Whether the sites feed resolved at least one linked energy site (web `(sites ?? []).length > 0`). A
 * non-array / absent payload is no sites.
 */
fun parseHasSite(sitesJson: JsonElement?): Boolean = (sitesJson as? JsonArray)?.isNotEmpty() == true

/**
 * The first linked site's `energy_site_id` (web `(sites ?? [])[0]?.energy_site_id`), or `null` when the
 * payload is not an array, is empty, or the first entry carries no usable id. Both a JSON number and a
 * numeric string are accepted so a string-encoded id still resolves.
 */
fun parseFirstSiteId(sitesJson: JsonElement?): Long? {
    val id = ((sitesJson as? JsonArray)?.firstOrNull() as? JsonObject)?.get("energy_site_id") as? JsonPrimitive
    return id?.let { it.longOrNull ?: it.contentOrNull?.toLongOrNull() }
}

/**
 * Decodes the raw `…/site-info` [siteInfoJson] (the web `TeslaEnergySiteInfoResponse`) into an
 * [EnergySiteInfo], or `null` when there is no detail object to render (web `infoResponse?.data ?? null`).
 * A non-object response, or a `data` that is absent / JSON-null, yields `null` ("No site info available");
 * a present `data` object — even an empty one — yields an [EnergySiteInfo] whose missing fields collapse to
 * `null`, exactly like the web reading `info.nameplate_power` off a sparse object.
 */
fun parseSiteInfo(siteInfoJson: JsonElement?): EnergySiteInfo? {
    val data = (siteInfoJson as? JsonObject)?.get("data") as? JsonObject ?: return null
    return EnergySiteInfo(
        nameplatePowerW = data.doubleField("nameplate_power"),
        nameplateEnergyWh = data.doubleField("nameplate_energy"),
        batteryCount = data.intField("battery_count"),
        version = data.stringField("version"),
        installationTimeZone = data.stringField("installation_time_zone"),
    )
}

private fun JsonObject.doubleField(key: String): Double? = (this[key] as? JsonPrimitive)?.doubleOrNull

private fun JsonObject.intField(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.stringField(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

/**
 * Pure projection from the combined [EnergySiteInfoState] to the render-ready [EnergySiteInfoDisplay] — the
 * native port of the inline entry-building the web component performs before returning JSX. SI watts /
 * watt-hours are scaled to kW / kWh here; numbers reproduce the web `fmtNumber`/`fmtInt` display contract
 * via the shared [ChartFormat.number] ([locale] drives the grouping/separators — tests pin [Locale.US]).
 */
object EnergySiteInfoProjection {
    /**
     * Project [state] using the localized [strings]. A `null` [EnergySiteInfoState.info] yields an empty
     * display whose message is the web `noSite` ("No Tesla Energy site linked") when no site is linked, or
     * `noData` ("No site info available") when a site is linked but its detail is absent. Otherwise the four
     * detail rows (solar size, Powerwalls, gateway firmware, installation timezone) are built, mirroring the
     * web `entries.push(…)` order.
     */
    fun project(
        state: EnergySiteInfoState,
        strings: EnergySiteInfoStrings,
        locale: Locale = Locale.US,
    ): EnergySiteInfoDisplay {
        val info =
            state.info ?: run {
                val message = if (state.hasSites) strings.noData else strings.noSite
                return EnergySiteInfoDisplay(entries = emptyList(), emptyMessage = message, contentDescription = message)
            }
        val entries =
            listOf(
                EnergySiteEntry(strings.solarSize, solarValue(info, locale), mono = false),
                EnergySiteEntry(strings.powerwall, powerwallValue(info, locale), mono = false),
                EnergySiteEntry(strings.firmware, info.version, mono = true),
                EnergySiteEntry(strings.timezone, info.installationTimeZone, mono = false),
            )
        return EnergySiteInfoDisplay(
            entries = entries,
            emptyMessage = strings.noData,
            contentDescription = entries.joinToString(", ") { "${it.label} ${it.value ?: EM_DASH}" },
        )
    }

    /** Solar nameplate as "{kW} kW" (web `solarKw != null ? \`${solarKw} kW\` : '—'`). */
    fun solarValue(
        info: EnergySiteInfo,
        locale: Locale = Locale.US,
    ): String = info.nameplatePowerW?.let { "${ChartFormat.number(it / KILO, CAPACITY_DECIMALS, locale)} kW" } ?: EM_DASH

    /**
     * Powerwall fleet as "{count} × {kWh} kWh" when at least one battery is present, else an em-dash (web
     * `batteryCount > 0 ? \`${fmtInt(batteryCount)} × ${batteryKwh ?? '—'} kWh\` : '—'`). The per-pack energy
     * itself collapses to an em-dash when the nameplate energy is absent.
     */
    fun powerwallValue(
        info: EnergySiteInfo,
        locale: Locale = Locale.US,
    ): String {
        val count = info.batteryCount ?: 0
        if (count <= 0) return EM_DASH
        val countText = String.format(locale, "%,d", count)
        val kwh = info.nameplateEnergyWh?.let { ChartFormat.number(it / KILO, CAPACITY_DECIMALS, locale) } ?: EM_DASH
        return "$countText $MULTIPLY_SIGN $kwh kWh"
    }
}
