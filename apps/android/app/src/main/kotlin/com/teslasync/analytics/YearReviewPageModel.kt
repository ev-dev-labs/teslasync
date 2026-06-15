// Pure, framework-free model + projections for the YearReviewPage analytics surface — the native analogue of
// everything the web page derives before it composes its full-screen story deck
// (web/src/features/analytics/pages/YearReviewPage.tsx). No Compose, no Android UI, no HTTP: every declaration
// here is plain Kotlin (it references only the framework-free child-slide @Serializable models, the shared-core
// JSON codec, and the diagnostics Logger), so the composable stays a thin render layer and all of this is
// exercised off-device by the :android:testDebugUnitTest gate.
//
// The web page owns these concerns this file ports: (1) the `useVehicles` -> selector option list
// (`vehicles.map(v => ({ value: String(v.id), label: v.display_name }))`) and the auto-select-first default
// (`vehicleList[0].id`); (2) the page's three render states — the loading screen (`isLoading || !data`), the
// no-data screen (`total_drives === 0 && total_charge_sessions === 0`), and the slide deck; (3) the recap year
// read off the loaded document (`data.year`) for the no-data string; and (4) the per-slide decode of the single
// `/analytics/year-review` document into each child slide's typed model, exactly as the web `SlideRenderer`
// threads `data` to each `<*Slide data={data} />`.
//
// SI-canonical (Phase-48 / unit-conversion.instructions): every distance/energy/efficiency value stays SI on the
// wire and is converted ONLY at the display boundary inside the child slide surfaces (via their own `useUnits`
// ports); nothing is stored or computed in non-SI units here. This model only routes the raw SI document to the
// right child model.
//
// The ten child slides (TitleSlide … SummarySlide) and the SlideRenderer are SEPARATE surfaces (each its own P3
// prompt); this page composes them. The one exception is the Comparisons slide, whose feature-view does not yet
// exist in the repo: its data shape is decoded here (`comparisonsFrom`) and rendered by a page-local composable
// so the eleventh slide is never a blank or empty region (ADR-011), staying inside this page's allowed-files
// scope rather than authoring an out-of-scope feature-view.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/analytics) diverges
// from the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling analytics pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.analytics.yearreview

import io.teslasync.android.featureviews.chargingbreakdownslide.ChargingBreakdownData
import io.teslasync.android.featureviews.drivehighlightslide.DriveHighlight
import io.teslasync.android.featureviews.environmentslide.EnvironmentSlideData
import io.teslasync.android.featureviews.savingsslide.SavingsData
import io.teslasync.android.featureviews.titleslide.TitleSlideData
import io.teslasync.shared.core.api.generated.Vehicle
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.net.defaultApiJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * Identity of the surface for the navigation registry + diagnostics (P1/S11) — the native mirror of the web
 * `YearReviewPage` route. [ROUTE_ID] matches the [io.teslasync.android.navigation.Destinations] entry
 * `standalone("yearReview", "/year-review/:year", …)`, so the host binds this surface to that destination (and
 * its `/year-review/{year}` deep link) without the nav module depending on it.
 */
object YearReviewPageRegistration {
    /** The navigation destination id (Destinations.kt `standalone("yearReview", "/year-review/:year", …)`). */
    const val ROUTE_ID: String = "yearReview"

    /** The route path argument carrying the recap year (Destinations.kt `args = listOf("year")`). */
    const val ARG_YEAR: String = "year"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/year-review/:year"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no vehicle id. */
    const val SLUG: String = "YearReviewPage"
}

/**
 * One entry of the vehicle scope picker — the native mirror of the web `vehicleOptions` row
 * (`{ value: String(v.id), label: v.display_name }`). [value] is the vehicle id as the string the
 * `/analytics/year-review?vehicle_id=…` query carries; [label] is the display name shown in the dropdown.
 */
data class YearReviewVehicleOption(
    val value: String,
    val label: String,
    val id: Long,
)

/**
 * Projects the enrolled-vehicle list onto the selector options — the web
 * `vehicleList.map((v) => ({ value: String(v.id), label: v.display_name }))`, preserving order. A blank display
 * name falls back to the id so the dropdown never renders an empty row.
 */
fun vehicleOptionsFrom(vehicles: List<Vehicle>): List<YearReviewVehicleOption> =
    vehicles.map { v ->
        YearReviewVehicleOption(
            value = v.id.toString(),
            label = v.displayName.ifBlank { v.id.toString() },
            id = v.id,
        )
    }

/**
 * Whether the loaded year-review [json] carries renderable data — the native gate behind the web no-data screen
 * (`data.total_drives === 0 && data.total_charge_sessions === 0`). A null / non-object / empty payload also
 * resolves to "no data" (the web loading branch's `!data`), so the page routes it to the empty surface rather
 * than a blank deck. Any positive drive OR charge count yields the slide deck.
 */
fun hasYearReviewData(json: JsonElement?): Boolean {
    val obj = json as? JsonObject ?: return false
    if (obj.isEmpty()) return false
    val drives = obj.double("total_drives")
    val charges = obj.double("total_charge_sessions")
    return drives != 0.0 || charges != 0.0
}

/**
 * The recap year shown in the no-data message — the web `data.year` (the loaded document echoes the requested
 * year), falling back to the route's [fallback] year when the field is absent / unparseable.
 */
fun yearOf(
    json: JsonElement?,
    fallback: Int,
): Int = ((json as? JsonObject)?.get("year") as? JsonPrimitive)?.doubleOrNull?.toInt() ?: fallback

/**
 * One playful comparison card — the native mirror of the web `YearReviewComparison` ({ label, value, emoji }).
 * The web `ComparisonsSlide` renders a grid of these; this page does too (the child feature-view does not exist
 * yet), so the type + its decode live here.
 */
data class YearReviewComparison(
    val label: String,
    val value: String,
    val emoji: String,
)

/**
 * Decodes `data.comparisons` into the render list — the web `comparisons ?? []`. A missing / non-array value
 * yields an empty list so the grid simply renders nothing; each row's fields default to empty strings.
 */
fun comparisonsFrom(json: JsonElement?): List<YearReviewComparison> {
    val array = (json as? JsonObject)?.get("comparisons") as? JsonArray ?: return emptyList()
    return array.mapNotNull { element ->
        val row = element as? JsonObject ?: return@mapNotNull null
        YearReviewComparison(
            label = row.string("label"),
            value = row.string("value"),
            emoji = row.string("emoji"),
        )
    }
}

/**
 * Decodes the TitleSlide slice of the year-review [json] — the web `<TitleSlide data={data} />`. Falls back to
 * an empty [TitleSlideData] (its fields default) when the payload is absent / malformed, mirroring the child
 * surface's own null-safe defaults.
 */
fun titleSlideDataOf(json: JsonElement?): TitleSlideData = decodeSlice(json, TitleSlideData.serializer()) ?: TitleSlideData()

/**
 * Decodes the SavingsSlide slice of the year-review [json] — the web `<SavingsSlide data={data} />`. Falls back
 * to an empty [SavingsData] (zeros) when the payload is absent / malformed (the child surface takes a non-null
 * value).
 */
fun savingsDataOf(json: JsonElement?): SavingsData = decodeSlice(json, SavingsData.serializer()) ?: SavingsData()

/**
 * Decodes the EnvironmentSlide slice of the year-review [json] — the web `<EnvironmentSlide data={data} />`.
 * Falls back to an empty [EnvironmentSlideData] (zero CO₂) when the payload is absent / malformed (the child
 * surface takes a non-null value).
 */
fun environmentDataOf(json: JsonElement?): EnvironmentSlideData =
    decodeSlice(json, EnvironmentSlideData.serializer()) ?: EnvironmentSlideData()

/**
 * Decodes the ChargingBreakdownSlide slice of the year-review [json] — the web
 * `<ChargingBreakdownSlide data={data} />`. Returns `null` on an absent / malformed payload so the child surface
 * shows its own empty state (it takes a nullable value).
 */
fun chargingBreakdownDataOf(json: JsonElement?): ChargingBreakdownData? = decodeSlice(json, ChargingBreakdownData.serializer())

/**
 * Decodes the drive a drive-highlight slide shows — the web `slide.field === 'longest' ? data.longest_drive :
 * data.most_efficient_drive`. Returns `null` when that sub-object is absent / JSON-null / malformed (the child
 * `DriveHighlightSlide` renders its "no drive data" state for a null drive).
 */
fun driveHighlightOf(
    json: JsonElement?,
    longest: Boolean,
): DriveHighlight? {
    val key = if (longest) "longest_drive" else "most_efficient_drive"
    val element = (json as? JsonObject)?.get(key) ?: return null
    if (element is JsonNull) return null
    return decodeSlice(element, DriveHighlight.serializer())
}

/** Decodes [json] into [T] via the shared SI-tolerant codec (`ignoreUnknownKeys`), or `null` on any failure. */
private fun <T> decodeSlice(
    json: JsonElement?,
    serializer: kotlinx.serialization.KSerializer<T>,
): T? {
    val element = json ?: return null
    return runCatching { defaultApiJson.decodeFromJsonElement(serializer, element) }.getOrNull()
}

private fun JsonObject.double(key: String): Double = (this[key] as? JsonPrimitive)?.doubleOrNull ?: 0.0

private fun JsonObject.string(key: String): String {
    val primitive = this[key] as? JsonPrimitive ?: return ""
    return if (primitive.isString) primitive.content else ""
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [YearReviewPageRegistration.SLUG] (P1/S11).
 * Kept free of Compose so it is unit-testable with a recording [Logger]; the page calls it from its first
 * composition. Carries no vehicle id, year, distance, or cost payload.
 */
fun recordYearReviewPageOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to YearReviewPageRegistration.SLUG))
}
