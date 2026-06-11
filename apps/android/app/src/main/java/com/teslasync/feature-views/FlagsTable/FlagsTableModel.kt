// Pure, framework-free model + projections for the FlagsTable feature view — the native analogue of
// every decision the web component makes before returning JSX
// (web/src/features/admin/components/feature-flags/FlagsTable.tsx): the JSON value preview, the
// sort-by-key ordering, and the loading/empty body message. No Compose, no Android, no HTTP — every
// declaration here is exercised off-device in the :android:testReleaseUnitTest gate, keeping the
// composable a thin render layer.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/FlagsTable — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen and a PascalCase segment are illegal in a package identifier), so the
// package intentionally diverges from the path. `MatchingDeclarationName` is suppressed for the
// co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.flagstable

import io.teslasync.android.components.ui.SortDirection
import io.teslasync.android.components.ui.SortState
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no flag key or
 * value, so a diagnostics line can never leak the server's feature-flag posture.
 */
const val FLAGS_TABLE_SLUG: String = "FlagsTable"

/** The single sortable column key — the web `useSortToggle('key', 'asc')` default + only sort field. */
const val SORT_KEY_KEY: String = "key"

/** Web `previewValue` truncates the compact JSON once it exceeds this length. */
const val PREVIEW_MAX_LENGTH: Int = 120

/** …keeping this many leading characters before the ellipsis (web `json.slice(0, 117)`). */
const val PREVIEW_SLICE: Int = 117

private const val EM_DASH: String = "\u2014"
private const val ELLIPSIS: String = "\u2026"

/** Compact (no-whitespace) encoder mirroring the web `JSON.stringify(value)` used by `previewValue`. */
private val COMPACT_JSON: Json = Json

/**
 * A single feature-flag registry row — the native mirror of the web `FeatureFlagEntry`
 * (`web/src/types/admin-diagnostics.ts`). The flag value is stored as JSON in Postgres and surfaces
 * as `unknown` on the web; here it is a nullable [JsonElement] where a Kotlin `null` models the web
 * `undefined` (absent) and [JsonNull] models a JSON `null`.
 */
data class FeatureFlagEntry(
    val key: String,
    val value: JsonElement?,
)

/**
 * The already-localized strings the table renders. The web component resolves these itself via
 * `t('admin.flags.*')`; the composable resolves the matching `translation_admin_flags_*` resources at
 * the Compose boundary (P1/S10) and passes them in, keeping the stateless content free of any English
 * literal and unit-testable without an Android string host.
 */
data class FlagsTableLabels(
    val keyHeader: String,
    val valueHeader: String,
    val actionsHeader: String,
    val editLabel: String,
    val deleteLabel: String,
    val loadingMessage: String,
    val emptyMessage: String,
)

/**
 * Compact JSON preview for a single table cell — a 1:1 port of the web `previewValue(value)`:
 * a JSON `null` renders `null`, an absent value renders an em dash, a string is JSON-quoted, a
 * boolean/number is rendered bare, and any object/array is compact-stringified then truncated to
 * [PREVIEW_SLICE] characters + an ellipsis once it passes [PREVIEW_MAX_LENGTH]. Any encode failure
 * falls back to the em dash, matching the web `catch` branch.
 */
fun previewValue(value: JsonElement?): String =
    when {
        value == null -> EM_DASH
        value is JsonNull -> "null"
        // Web: a string goes through JSON.stringify (so it stays quoted/escaped); a boolean or number
        // goes through String(value) (bare, no quotes). JsonPrimitive.toString() yields the quoted form
        // for strings; .content yields the bare token for everything else.
        value is JsonPrimitive -> if (value.isString) value.toString() else value.content
        else ->
            runCatching {
                val json = COMPACT_JSON.encodeToString(JsonElement.serializer(), value)
                if (json.length > PREVIEW_MAX_LENGTH) json.take(PREVIEW_SLICE) + ELLIPSIS else json
            }.getOrDefault(EM_DASH)
    }

/**
 * Order the rows for display — a port of the web `[...rows].sort((a, b) => …)`: when the active sort
 * column is [SORT_KEY_KEY] the rows are ordered by their key (ascending or descending per
 * [SortState.direction]); any other column key is a no-op that preserves the incoming order (the web
 * comparator returns `0`). Flag keys are unique, so a reversed ascending order equals a descending
 * sort. Natural String ordering matches `localeCompare` for the lower-case, dotted ASCII flag-key
 * domain.
 */
fun sortFlags(
    rows: List<FeatureFlagEntry>,
    sortState: SortState,
): List<FeatureFlagEntry> {
    if (sortState.key != SORT_KEY_KEY) return rows
    val ascending = rows.sortedWith(compareBy { it.key })
    return if (sortState.direction == SortDirection.Asc) ascending else ascending.reversed()
}

/**
 * The single message the table body shows while it has no rows — the web
 * `emptyMessage={loading ? t('…table.loading') : t('…table.empty')}`.
 */
fun emptyMessageFor(
    loading: Boolean,
    labels: FlagsTableLabels,
): String = if (loading) labels.loadingMessage else labels.emptyMessage

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FLAGS_TABLE_SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its
 * first-composition effect.
 */
fun recordFlagsTableOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FLAGS_TABLE_SLUG))
}
