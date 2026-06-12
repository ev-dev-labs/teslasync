// Pure, framework-light model + logic for the SettingsExportImport feature view — the native analogue of
// everything the web component derives outside JSX (web/src/features/settings/components/SettingsExportImport.tsx
// + its co-located lib web/src/lib/settingsImportSchema.ts). Every declaration here is exercised off-device by
// the `:android:testReleaseUnitTest` gate, keeping the composable a thin render layer that only collects state
// and renders.
//
// The web component is the Settings → "Backup & Restore" surface: an Export button that fetches the bundle and
// drops it into downloads, and an Import flow (pick/drop a JSON bundle → local schema validation → dry-run
// preview of the per-section {added, updated, skipped} diff → Apply). This file owns the parity-critical bits
// that have nothing to do with Compose: the import stage machine, the local bundle validation (web
// `validateSettingsBundle` — reject anything the backend would, so a known-bad upload never round-trips), the
// per-section diff projection + count formatting (web `SectionDiffList`), the bundle JSON encoding for the
// download, the summary fold (web `summariseImportResult`), and the PII-safe `view.opened` diagnostic (P1/S11).
//
// `InvalidPackageDeclaration`/`MatchingDeclarationName`/`filename` are suppressed because the mandated surface
// directory (com/teslasync/feature-views/SettingsExportImport — the P3 prompt's allowed-files path) cannot form
// a valid Kotlin package and hosts several co-located declarations, exactly as the sibling surfaces do.
@file:Suppress("InvalidPackageDeclaration", "ktlint:standard:filename", "MatchingDeclarationName")

package io.teslasync.android.featureviews.settingsexportimport

import io.teslasync.shared.core.data.repo.summariseImportResult
import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsbackup.ImportSummary
import io.teslasync.shared.core.presentation.settingsbackup.SettingsBundle
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportResult
import io.teslasync.shared.core.presentation.settingsbackup.SettingsImportSectionResult
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object SettingsExportImportViewRegistration {
    /** Stable surface id. */
    const val ID: String = "settings-export-import"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "SettingsExportImport"
}

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [SettingsExportImportViewRegistration.SLUG]
 * (P1/S11). Kept free of Compose so it is unit-tested with a recording [Logger]; the view-model calls it from
 * the first-composition effect. It carries no filename, byte count, or section counts, so a diagnostics line can
 * never leak what a user backed up or imported (ADR-016).
 */
fun recordSettingsExportImportViewOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to SettingsExportImportViewRegistration.SLUG))
}

/** The schema_version this build emits + accepts (web `SETTINGS_BUNDLE_SCHEMA_VERSION`). */
const val SETTINGS_BUNDLE_SCHEMA_VERSION: Int = 1

/** Hard cap on an uploaded bundle — matches the backend `MaxSettingsImportBodyBytes` (web `MAX_IMPORT_FILE_BYTES`). */
const val MAX_IMPORT_FILE_BYTES: Long = 1L shl 20

internal const val SECTION_KEY_SETTINGS = "settings"
internal const val SECTION_KEY_ALERT_RULES = "alert_rules"
internal const val SECTION_KEY_GEOFENCES = "geofences"
internal const val SECTION_KEY_QUIET_HOURS = "quiet_hours"

/** Section keys carried in the bundle, in render order (web `SETTINGS_BUNDLE_SECTION_KEYS`). */
val SETTINGS_BUNDLE_SECTION_KEYS: List<String> =
    listOf(SECTION_KEY_SETTINGS, SECTION_KEY_ALERT_RULES, SECTION_KEY_GEOFENCES, SECTION_KEY_QUIET_HOURS)

/**
 * The import flow's state machine — the type-safe replacement for the web `'idle' | 'parsing' | 'preview' |
 * 'applied'` union. [Idle] shows the drop zone; [Parsing] shows the "Reading…" affordance; [Preview] renders the
 * dry-run diff with Apply/Cancel; [Applied] renders the final result with Done.
 */
enum class ImportStage { Idle, Parsing, Preview, Applied }

/**
 * The metadata of the bundle currently being imported — the native mirror of the web `PendingImport`. Drives the
 * "Previewing {name} ({size} bytes)" header; carries no payload (the bundle itself lives in the view-model).
 */
data class PendingImport(
    val filename: String,
    val sizeBytes: Long,
)

/**
 * A non-throwing classification of why an import intake failed — the type-safe replacement for the web's inline
 * `parseError` string. The render boundary maps each case onto an existing localized resource (P1/S10) so no
 * English literal lives in native code; [InvalidJson.detail] carries a runtime/wire token (an exception message
 * or the offending JSON field/section identifier), exactly as the web passes `err.message` into its `errorJson`.
 */
sealed interface ImportError {
    /** The file exceeds [MAX_IMPORT_FILE_BYTES] (web `errorTooLarge`). */
    data object TooLarge : ImportError

    /** The file bytes could not be read (web `errorRead`). */
    data object Read : ImportError

    /** The file is not valid bundle JSON; [detail] is the wire token shown after the colon (web `errorJson`). */
    data class InvalidJson(
        val detail: String,
    ) : ImportError

    /** The dry-run preview request failed (web `errorPreview`). */
    data object PreviewFailed : ImportError
}

/**
 * The immutable UI state the stateless content renders — the native mirror of the web component's local state
 * (`stage` + `pending` + `parseError` + `previewResult` + `appliedResult` + the export/apply in-flight flags).
 * The view never reads anything else; tests drive each surface by constructing this directly.
 *
 * @property exporting whether an export is in flight (web `exportMut.isPending`).
 * @property stage the import flow stage.
 * @property pending the file being previewed, when [stage] is [ImportStage.Preview].
 * @property error the current intake failure, rendered inline (web `parseError`).
 * @property preview the dry-run diff, when [stage] is [ImportStage.Preview] (web `previewResult`).
 * @property applied the applied diff, when [stage] is [ImportStage.Applied] (web `appliedResult`).
 * @property applying whether the Apply request is in flight (web `applyMut.isPending`).
 */
data class SettingsExportImportUiState(
    val exporting: Boolean = false,
    val stage: ImportStage = ImportStage.Idle,
    val pending: PendingImport? = null,
    val error: ImportError? = null,
    val preview: SettingsImportResult? = null,
    val applied: SettingsImportResult? = null,
    val applying: Boolean = false,
)

/**
 * A one-shot effect the view-model raises for the toast layer — the native analogue of the web `toast.success`
 * calls. Carries no pre-localized text and no PII; the render boundary resolves the message from P1/S10 and
 * applies the section counts (which are aggregate, non-identifying integers).
 */
sealed interface SettingsExportImportEffect {
    /** Export finished and the bundle was written to downloads (web export `toast.success`). */
    data object ExportSucceeded : SettingsExportImportEffect

    /** Export or the download write failed (web `useExportSettings` error toast). */
    data object ExportFailed : SettingsExportImportEffect

    /** Apply succeeded with the given aggregate counts (web import `toast.success`). */
    data class ImportApplied(
        val added: Int,
        val updated: Int,
        val skipped: Int,
    ) : SettingsExportImportEffect

    /** Apply failed; the dry-run preview stays visible so the user can retry (web `useApplyImport` error toast). */
    data object ImportApplyFailed : SettingsExportImportEffect
}

/** One row of the per-section diff list (web `SectionDiffList`): the section [key] and its [counts] (or null). */
data class SectionDiffRow(
    val key: String,
    val counts: SettingsImportSectionResult?,
)

/**
 * Projects an import [result] onto the fixed-order section rows the diff list renders — every section key is
 * always present (an absent section shows "—"), so the list never collapses or reorders (web `SectionDiffList`
 * maps over `SETTINGS_BUNDLE_SECTION_KEYS`).
 */
fun sectionDiffRows(result: SettingsImportResult): List<SectionDiffRow> =
    SETTINGS_BUNDLE_SECTION_KEYS.map { key -> SectionDiffRow(key, result.sections[key]) }

/** Formats one section's counts as the monospace chip content `+added ~updated =skipped` (web `<Code>`). */
fun formatSectionCounts(counts: SettingsImportSectionResult): String = "+${counts.added} ~${counts.updated} =${counts.skipped}"

/** Folds an import result into its added/updated/skipped/total summary (web `summariseImportResult`). */
fun summariseImport(result: SettingsImportResult): ImportSummary = summariseImportResult(result)

/** The outcome of validating an uploaded file's bytes — either a usable [SettingsBundle] or a typed failure. */
sealed interface BundleParse {
    /** The bytes parsed and validated into a usable [bundle]. */
    data class Valid(
        val bundle: SettingsBundle,
    ) : BundleParse

    /** The bytes were not a usable bundle; [error] is the reason to surface inline. */
    data class Invalid(
        val error: ImportError,
    ) : BundleParse
}

private val bundleJson = Json { ignoreUnknownKeys = true }
private val exportJson = Json { prettyPrint = true }

/**
 * Validates the [text] of an uploaded file the way the web `validateSettingsBundle` does, so anything the
 * backend would reject is rejected here and a known-bad upload never round-trips for a 400. Returns a
 * [BundleParse.Valid] carrying the canonical [SettingsBundle] (which re-serializes byte-stable for the import),
 * or a [BundleParse.Invalid] whose [ImportError.InvalidJson.detail] is a runtime/wire token (never authored UI
 * copy). Mirrors the web checks: valid JSON object, a known section allowlist, a decodable shape, a supported
 * schema_version, and a non-empty exported_at.
 */
@Suppress("ReturnCount")
fun parseBundle(text: String): BundleParse {
    val element =
        runCatching { bundleJson.parseToJsonElement(text) }
            .getOrElse { return BundleParse.Invalid(ImportError.InvalidJson(it.parseDetail())) }

    val sections = (element as? JsonObject)?.get(FIELD_SECTIONS) as? JsonObject
    val unknownSection = sections?.keys?.firstOrNull { it !in SETTINGS_BUNDLE_SECTION_KEYS }
    if (unknownSection != null) {
        return BundleParse.Invalid(ImportError.InvalidJson(unknownSection))
    }

    val bundle =
        runCatching { bundleJson.decodeFromJsonElement(SettingsBundle.serializer(), element) }
            .getOrElse { return BundleParse.Invalid(ImportError.InvalidJson(it.parseDetail())) }

    if (bundle.schemaVersion !in 1..SETTINGS_BUNDLE_SCHEMA_VERSION) {
        return BundleParse.Invalid(ImportError.InvalidJson(bundle.schemaVersion.toString()))
    }
    if (bundle.exportedAt.isBlank()) {
        return BundleParse.Invalid(ImportError.InvalidJson(FIELD_EXPORTED_AT))
    }
    return BundleParse.Valid(bundle)
}

/** Encodes a bundle to indented JSON for the save-as download (web `JSON.stringify(bundle, null, 2)`). */
fun encodeBundleJson(bundle: SettingsBundle): String = exportJson.encodeToString(SettingsBundle.serializer(), bundle)

private fun Throwable.parseDetail(): String = message?.takeIf { it.isNotBlank() } ?: DETAIL_FALLBACK

private const val FIELD_SECTIONS = "sections"
private const val FIELD_EXPORTED_AT = "exported_at"

// The web `validateSettingsBundle` falls back to the literal token "parse error" when a JSON error has no
// message; reproduced verbatim so the inline detail matches the spec rather than inventing new copy.
private const val DETAIL_FALLBACK = "parse error"
