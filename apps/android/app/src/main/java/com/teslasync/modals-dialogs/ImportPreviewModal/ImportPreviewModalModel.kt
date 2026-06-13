// Pure, framework-free model + projection for the ImportPreviewModal modal/dialog surface — the native analogue of
// everything the web component derives before it returns JSX (web/src/features/dashboard/components/ImportPreviewModal.tsx,
// plus the feature-local hook web/src/features/dashboard/hooks/validateImport.ts it leans on). No Compose, no Android,
// no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is a three-tab dashboard importer (From File / Paste JSON / From URL) that funnels a raw JSON
// string through `validateImportData`, then either shows a validation preview (errors, warnings, a layout thumbnail,
// and a per-widget availability list) or surfaces a localized parse error. Its data dependency is `useTranslation`
// only — it binds no fetch and owns no store, so (exactly like the sibling Modal / ConfirmDialog / AddAnnotationPopover
// surfaces) the cache-then-network lifecycle (loading / empty / error / stale / offline) belongs to the OWNING surface
// that raises the importer, never here; modelling those phases would invent behaviour the web spec does not have
// (drift). The branches the web source actually defines are the complete state set this surface renders, and each is
// projected here: the JSON validation pipeline ([ImportValidator.validateImportData], a 1:1 port of `validateImport.ts`),
// the share-link decode ([ImportUrlCodec.parseImportUrl] / [ImportUrlCodec.fromUrlSafeBase64], the web `handleUrlImport`),
// and the validated-dashboard → layout-thumbnail projection ([SavedDashboardImport.toMiniGridDashboard], feeding the
// shared `MiniGridPreview` surface the web `<MiniGridPreview>` maps onto).
//
// The web `validateImportData` checks each parsed widget against the global `WIDGET_REGISTRY`. The registry is a
// separate dashboard concern (its own prompt — exactly as the sibling `MiniGridPreview` defers icon resolution to a
// host-supplied resolver), so the native port receives the known widget ids as a host-provided `Set<String>` input
// (P1/S8 "host owns data"): with no registry wired the validator marks every widget unavailable, which is the web's
// own behaviour when the registry contains none of the imported ids. Likewise the widget DISPLAY names/icons the
// preview shows are resolved at the Compose boundary through host resolvers (the web `getWidgetDef(id)?.name ?? id` /
// `?.icon` fallback).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs/ImportPreviewModal — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling modal/dialog surfaces do. `MatchingDeclarationName` is suppressed
// for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.importpreviewmodal

import io.teslasync.android.featureviews.minigridpreview.MiniGridDashboard
import io.teslasync.android.featureviews.minigridpreview.MiniGridLayoutItem
import io.teslasync.android.featureviews.minigridpreview.MiniGridWidget
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.net.URI
import java.time.Instant
import java.util.Base64

/** The widest accepted dashboard name length — the web `String(data.name).slice(0, 100)`. */
private const val MAX_NAME_LENGTH: Int = 100

/** The tallest a single widget may span, in grid rows — the web `clamp(item.h, 1, 8)`. */
private const val MAX_ROW_SPAN: Int = 8

/** The `lg` react-grid-layout breakpoint key — the only layout the thumbnail reads. */
private const val LG_BREAKPOINT: String = "lg"

/** The share-link parameter name carrying the encoded payload — the web `searchParams.get('import')`. */
private const val IMPORT_KEY: String = "import"

/** The `#import=`/`import=` prefix the web `handleUrlImport` strips off the URL fragment. */
private const val IMPORT_PREFIX: String = "import="

/**
 * The per-breakpoint column counts the web `validateImportData` sanitises layouts against
 * (`{ lg: 4, md: 3, sm: 2, xs: 1 }`). Iterated in this fixed order so the projection is deterministic.
 */
private val BREAKPOINT_COLS: Map<String, Int> = linkedMapOf("lg" to 4, "md" to 3, "sm" to 2, "xs" to 1)

/** The shared JSON reader for the untyped import payload (the web `JSON.parse`). */
private val ImportJson: Json = Json { ignoreUnknownKeys = true }

/**
 * The three import sources the web component exposes as tabs (`activeTab: 'file' | 'paste' | 'url'`). [File] reads a
 * picked `.json` document, [Paste] validates raw textarea JSON, and [Url] decodes a share link. Pure render input.
 */
enum class ImportTab {
    File,
    Paste,
    Url,
}

/**
 * One react-grid-layout item — the native mirror of the web `RGLLayout` (`{ i, x, y, w, h, minW?, minH?, maxW?,
 * maxH? }`). [i] is the widget-instance id; ([x], [y]) the grid origin and ([w], [h]) the span. The optional bounds
 * are carried verbatim for the owning surface (the preview itself reads only the placement).
 */
data class RglLayoutItem(
    val i: String,
    val x: Int,
    val y: Int,
    val w: Int,
    val h: Int,
    val minW: Int? = null,
    val minH: Int? = null,
    val maxW: Int? = null,
    val maxH: Int? = null,
)

/**
 * One imported widget instance — the native mirror of the web `WidgetInstance` (`{ id, widgetId, config? }`). [id] is
 * the layout key, [widgetId] the registry id resolved to a name/icon at the render boundary, and [config] the opaque
 * per-widget settings passed straight through to the owning surface on confirm.
 */
data class ImportWidgetInstance(
    val id: String,
    val widgetId: String,
    val config: JsonObject? = null,
)

/**
 * The sanitised dashboard a successful import yields — the native mirror of the web `SavedDashboard`. Handed back to
 * the owning surface through the modal's `onConfirm` (web `onConfirm(validation.dashboard)`); the preview reads only
 * [name], [widgets], and [layouts]. [createdAt]/[updatedAt] are ISO instants and [isDefault] is always `false` for an
 * import (web `isDefault: false`).
 */
data class SavedDashboardImport(
    val id: String,
    val name: String,
    val widgets: List<ImportWidgetInstance>,
    val layouts: Map<String, List<RglLayoutItem>>,
    val createdAt: String,
    val updatedAt: String,
    val isDefault: Boolean = false,
)

/**
 * The full validation outcome — the native mirror of the web `ImportValidation`. [errors]/[warnings] are the raw
 * messages the validator emits (see [ImportPreviewMessages]); [dashboard] is the sanitised result (or `null` when the
 * import cannot be previewed); [availableWidgets]/[missingWidgets] are the registry-split widget ids the preview lists.
 */
data class ImportValidation(
    val isValid: Boolean,
    val errors: List<String>,
    val warnings: List<String>,
    val dashboard: SavedDashboardImport?,
    val missingWidgets: List<String>,
    val availableWidgets: List<String>,
)

/**
 * The outcome of decoding a share link — the three branches the web `handleUrlImport` resolves to. [Decoded] carries
 * the recovered JSON to validate; [NoParam] is a parseable URL with no `import` parameter (web `noImportParam`); and
 * [InvalidUrl] is an unparseable URL or undecodable payload (web `invalidUrl`).
 */
sealed interface ImportUrlResult {
    /** A share link whose `import` payload decoded to [json]. */
    data class Decoded(
        val json: String,
    ) : ImportUrlResult

    /** A parseable URL that carried no `import` parameter (web `import.noImportParam`). */
    data object NoParam : ImportUrlResult

    /** An unparseable URL or an undecodable payload (web `import.invalidUrl`). */
    data object InvalidUrl : ImportUrlResult
}

/**
 * The clock seam the validator stamps the sanitised dashboard's id/timestamps with — the web `Date.now()` /
 * `new Date().toISOString()`. Abstracted so the model stays pure and off-device testable with a fixed fake; the
 * production [SystemImportClock] reads the wall clock at the Compose boundary.
 */
interface ImportClock {
    /** Epoch milliseconds for the dashboard id (web `import-${Date.now()}`). */
    fun epochMillis(): Long

    /** The ISO-8601 instant for the created/updated stamps (web `new Date().toISOString()`). */
    fun nowIso(): String
}

/** The wall-clock [ImportClock] used in production — the default for [ImportValidator.validateImportData]. */
object SystemImportClock : ImportClock {
    override fun epochMillis(): Long = System.currentTimeMillis()

    override fun nowIso(): String = Instant.ofEpochMilli(epochMillis()).toString()
}

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ImportPreviewModalRegistration {
    /** Stable surface id. */
    const val ID: String = "import-preview-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ImportPreviewModal"
}

/**
 * The raw validation messages the web `validateImportData` returns as plain English data (it does NOT route them
 * through i18n — they are the hook's algorithm output, surfaced verbatim in the preview's alert banners). They are
 * ported here verbatim so the native validator is behaviourally identical and the unit gate can pin them; they are
 * NOT localizable UI chrome (all of THAT — titles, tabs, buttons, the empty/`Not available` copy — resolves through
 * the P1/S10 catalog at the Compose boundary), and a framework-free model has no access to `R.string` regardless.
 */
object ImportPreviewMessages {
    /** Web `'Invalid JSON format'` — the `JSON.parse` failure. */
    const val INVALID_JSON: String = "Invalid JSON format"

    /** Web `'Expected a JSON object'` — a non-object / array / null payload. */
    const val EXPECTED_OBJECT: String = "Expected a JSON object"

    /** Web `'Missing or invalid "name" field'`. */
    const val MISSING_NAME: String = "Missing or invalid \"name\" field"

    /** Web `'Missing or invalid "widgets" array'`. */
    const val MISSING_WIDGETS: String = "Missing or invalid \"widgets\" array"

    /** Web `'Missing or invalid "layouts" object'`. */
    const val MISSING_LAYOUTS: String = "Missing or invalid \"layouts\" object"

    /** Web `'No compatible widgets found in this layout'`. */
    const val NO_COMPATIBLE: String = "No compatible widgets found in this layout"

    /** Web `` `${missing.length} widget(s) not available and will be skipped` ``. */
    fun skipped(count: Int): String = "$count widget(s) not available and will be skipped"
}

/**
 * The JSON validation pipeline — a 1:1 port of the web `validateImportData` (web/src/features/dashboard/hooks/
 * validateImport.ts). Pure and side-effect-free (save for the injected [ImportClock]); split into small stages so the
 * off-device gate covers every branch and each function stays within the complexity / return-count budgets.
 */
object ImportValidator {
    /**
     * Validates and normalises [raw] JSON into a safe import — the web `validateImportData(raw)`. [knownWidgetIds] is
     * the host's widget registry (the web global `WIDGET_REGISTRY` ids); a widget is "available" only when its
     * `widgetId` is in this set. [clock] stamps the sanitised dashboard's id/timestamps.
     */
    fun validateImportData(
        raw: String,
        knownWidgetIds: Set<String>,
        clock: ImportClock = SystemImportClock,
    ): ImportValidation {
        val root = runCatching { ImportJson.parseToJsonElement(raw) }.getOrNull()
        return when (root) {
            null -> invalid(ImportPreviewMessages.INVALID_JSON)
            is JsonObject -> validateObject(root, knownWidgetIds, clock)
            else -> invalid(ImportPreviewMessages.EXPECTED_OBJECT)
        }
    }

    private fun validateObject(
        obj: JsonObject,
        knownWidgetIds: Set<String>,
        clock: ImportClock,
    ): ImportValidation {
        val requiredErrors = requiredFieldErrors(obj)
        if (requiredErrors.isNotEmpty()) {
            return ImportValidation(false, requiredErrors, emptyList(), null, emptyList(), emptyList())
        }
        val widgets = extractValidWidgets(obj["widgets"] as? JsonArray ?: JsonArray(emptyList()))
        val available = widgets.filter { it.widgetId in knownWidgetIds }
        val missing = widgets.filterNot { it.widgetId in knownWidgetIds }
        val warnings = if (missing.isEmpty()) emptyList() else listOf(ImportPreviewMessages.skipped(missing.size))
        return if (available.isEmpty()) {
            ImportValidation(
                isValid = false,
                errors = listOf(ImportPreviewMessages.NO_COMPATIBLE),
                warnings = warnings,
                dashboard = null,
                missingWidgets = missing.map { it.widgetId },
                availableWidgets = emptyList(),
            )
        } else {
            buildValidation(obj, available, missing, warnings, clock)
        }
    }

    /** The three required-field checks (web `name` string, `widgets` array, `layouts` object) as an error list. */
    private fun requiredFieldErrors(obj: JsonObject): List<String> {
        val errors = mutableListOf<String>()
        if (stringField(obj, "name").isNullOrEmpty()) errors += ImportPreviewMessages.MISSING_NAME
        if (obj["widgets"] !is JsonArray) errors += ImportPreviewMessages.MISSING_WIDGETS
        if (!isContainer(obj["layouts"])) errors += ImportPreviewMessages.MISSING_LAYOUTS
        return errors
    }

    /**
     * Parses the `widgets` array into unique instances — the web widget loop: each entry must be an object with a
     * string `widgetId`; a missing/duplicate `id` is replaced with a generated unique one (the web `Date.now()` +
     * random, ported to a deterministic index-based scheme that preserves the only observable contract — uniqueness).
     */
    private fun extractValidWidgets(raw: JsonArray): List<ImportWidgetInstance> {
        val seen = mutableSetOf<String>()
        return raw.mapIndexedNotNull { index, element ->
            val obj = element as? JsonObject
            val widgetId = obj?.let { stringField(it, "widgetId") }
            if (obj != null && widgetId != null) {
                ImportWidgetInstance(
                    id = uniqueId(stringField(obj, "id") ?: "w-$index", seen),
                    widgetId = widgetId,
                    config = obj["config"] as? JsonObject,
                )
            } else {
                null
            }
        }
    }

    /** Reserves [base] in [seen], appending a deterministic suffix until unique (web duplicate-id guard). */
    private fun uniqueId(
        base: String,
        seen: MutableSet<String>,
    ): String {
        if (seen.add(base)) return base
        var candidate = "$base-dup-${seen.size}"
        while (!seen.add(candidate)) candidate += "x"
        return candidate
    }

    /** Builds the success outcome: sanitises layouts, clamps the name, and stamps the dashboard via [clock]. */
    private fun buildValidation(
        obj: JsonObject,
        available: List<ImportWidgetInstance>,
        missing: List<ImportWidgetInstance>,
        warnings: List<String>,
        clock: ImportClock,
    ): ImportValidation {
        val layouts = sanitizeLayouts(obj["layouts"], available.map { it.id }.toSet())
        val iso = clock.nowIso()
        val dashboard =
            SavedDashboardImport(
                id = "import-${clock.epochMillis()}",
                name = (stringField(obj, "name") ?: "").take(MAX_NAME_LENGTH),
                widgets = available,
                layouts = layouts,
                createdAt = iso,
                updatedAt = iso,
                isDefault = false,
            )
        return ImportValidation(
            isValid = true,
            errors = emptyList(),
            warnings = warnings,
            dashboard = dashboard,
            missingWidgets = missing.map { it.widgetId },
            availableWidgets = available.map { it.widgetId },
        )
    }

    /** Sanitises every known breakpoint's layout, dropping items that do not reference an available widget. */
    private fun sanitizeLayouts(
        layoutsEl: JsonElement?,
        availableIds: Set<String>,
    ): Map<String, List<RglLayoutItem>> {
        val obj = layoutsEl as? JsonObject ?: return emptyMap()
        val result = linkedMapOf<String, List<RglLayoutItem>>()
        for ((breakpoint, cols) in BREAKPOINT_COLS) {
            val rawBp = obj[breakpoint] as? JsonArray ?: continue
            result[breakpoint] = sanitizeBreakpoint(rawBp, cols, availableIds)
        }
        return result
    }

    private fun sanitizeBreakpoint(
        rawBp: JsonArray,
        cols: Int,
        availableIds: Set<String>,
    ): List<RglLayoutItem> =
        rawBp.mapNotNull { entry ->
            val obj = entry as? JsonObject
            val key = obj?.let { stringField(it, "i") }?.takeIf { it in availableIds }
            if (obj != null && key != null) sanitizeLayoutItem(readLayoutItem(obj, key), cols) else null
        }

    /** Reads one layout item, defaulting non-numeric fields exactly as the web (`x/y → 0`, `w/h → 1`). */
    private fun readLayoutItem(
        obj: JsonObject,
        key: String,
    ): RglLayoutItem =
        RglLayoutItem(
            i = key,
            x = intField(obj, "x", 0),
            y = intField(obj, "y", 0),
            w = intField(obj, "w", 1),
            h = intField(obj, "h", 1),
            minW = intFieldOrNull(obj, "minW"),
            minH = intFieldOrNull(obj, "minH"),
            maxW = intFieldOrNull(obj, "maxW"),
            maxH = intFieldOrNull(obj, "maxH"),
        )

    /** Clamps an item's coordinates to valid grid bounds — the web `sanitizeLayoutItem`. */
    private fun sanitizeLayoutItem(
        item: RglLayoutItem,
        cols: Int,
    ): RglLayoutItem =
        item.copy(
            x = if (item.x >= 0) item.x.coerceIn(0, cols - 1) else 0,
            y = if (item.y >= 0) item.y else 0,
            w = if (item.w >= 0) item.w.coerceIn(1, cols) else 1,
            h = if (item.h >= 0) item.h.coerceIn(1, MAX_ROW_SPAN) else 1,
        )

    private fun invalid(message: String): ImportValidation =
        ImportValidation(
            isValid = false,
            errors = listOf(message),
            warnings = emptyList(),
            dashboard = null,
            missingWidgets = emptyList(),
            availableWidgets = emptyList(),
        )

    /** A truthy JSON container (object or array) — the web `typeof x === 'object'` (arrays included). */
    private fun isContainer(el: JsonElement?): Boolean = el is JsonObject || el is JsonArray

    /** The string value of [key], or `null` when absent / non-string (web `typeof === 'string'`). */
    private fun stringField(
        obj: JsonObject,
        key: String,
    ): String? = (obj[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** The integer value of [key], or [default] when absent / non-numeric (web `typeof === 'number' ? v : default`). */
    private fun intField(
        obj: JsonObject,
        key: String,
        default: Int,
    ): Int = intFieldOrNull(obj, key) ?: default

    /** The integer value of [key], or `null` when absent / non-numeric. */
    private fun intFieldOrNull(
        obj: JsonObject,
        key: String,
    ): Int? = (obj[key] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull?.toInt()
}

/**
 * Decodes a TeslaSync share link — a port of the web `handleUrlImport` + `fromUrlSafeBase64`. Pure and off-device
 * testable; the composable maps the [ImportUrlResult] onto a validate call or a localized parse error.
 */
object ImportUrlCodec {
    /**
     * Extracts and decodes the `import` payload from a share [url] — the web `handleUrlImport`. The fragment
     * (`#import=…`) takes precedence over the query (`?import=…`); a relative/garbage URL is [ImportUrlResult.InvalidUrl],
     * a parseable URL with no payload is [ImportUrlResult.NoParam], and a decode failure is also [ImportUrlResult.InvalidUrl].
     */
    fun parseImportUrl(url: String): ImportUrlResult {
        val uri = runCatching { URI(url.trim()) }.getOrNull()
        val encoded = uri?.let(::importParam)
        return when {
            uri == null || uri.scheme == null -> ImportUrlResult.InvalidUrl
            encoded == null -> ImportUrlResult.NoParam
            else -> decode(encoded)
        }
    }

    /** Decodes a URL-safe base64 [encoded] payload to its UTF-8 string — the web `fromUrlSafeBase64`. */
    fun fromUrlSafeBase64(encoded: String): String {
        val padded = encoded.padEnd((encoded.length + PAD_ALIGN - 1) / PAD_ALIGN * PAD_ALIGN, '=')
        return String(Base64.getUrlDecoder().decode(padded), Charsets.UTF_8)
    }

    private fun importParam(uri: URI): String? {
        val fromFragment = uri.rawFragment?.takeIf { it.startsWith(IMPORT_PREFIX) }?.removePrefix(IMPORT_PREFIX)
        return fromFragment ?: queryParam(uri.rawQuery)
    }

    private fun queryParam(rawQuery: String?): String? =
        rawQuery
            ?.split('&')
            ?.firstOrNull { it.startsWith("$IMPORT_KEY=") }
            ?.substringAfter('=')

    private fun decode(encoded: String): ImportUrlResult {
        val json = runCatching { fromUrlSafeBase64(encoded) }.getOrNull()
        return if (json == null) ImportUrlResult.InvalidUrl else ImportUrlResult.Decoded(json)
    }

    /** Base64 quantum — payloads are zero-padded up to a multiple of this before decoding. */
    private const val PAD_ALIGN: Int = 4
}

/**
 * Projects a validated [SavedDashboardImport] into the shared `MiniGridPreview` input — the web `<MiniGridPreview
 * dashboard={dashboard} />`. Only the `lg` breakpoint feeds the thumbnail (the web `dashboard.layouts.lg`).
 */
fun SavedDashboardImport.toMiniGridDashboard(): MiniGridDashboard =
    MiniGridDashboard(
        widgets = widgets.map { MiniGridWidget(id = it.id, widgetId = it.widgetId) },
        lgLayout =
            (layouts[LG_BREAKPOINT] ?: emptyList()).map {
                MiniGridLayoutItem(i = it.i, x = it.x, y = it.y, w = it.w, h = it.h)
            },
    )

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [ImportPreviewModalRegistration.SLUG] (P1/S11).
 * Carries only the slug — never the imported JSON, dashboard name, or widget ids — so a diagnostics line can never
 * leak what the user is importing. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object ImportPreviewModalDiagnostics {
    private const val VIEW_OPENED: String = "view.opened"
    private const val SURFACE_KEY: String = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the composable's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to ImportPreviewModalRegistration.SLUG))
    }
}
