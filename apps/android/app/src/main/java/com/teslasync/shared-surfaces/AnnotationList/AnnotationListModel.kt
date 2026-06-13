// The data layer of the AnnotationList shared surface — a parity port of the web
// `AnnotationList` component (web/src/components/charts/AnnotationList.tsx) together with the annotation
// domain types it consumes (web/src/types/annotations.ts: `DataAnnotation`, `AnnotationCategory`,
// `ANNOTATION_COLORS`, `ChartAnnotationRow`, `toDataAnnotation`). The Compose view lives in AnnotationList.kt.
//
// What the web surface does: it is a presentational list rendered beneath a chart. Its parent owns the
// annotations array and a remove callback; the component maps each `DataAnnotation` to a row (a category-
// coloured dot, the label, an optional description, the timestamp, and a remove button) and renders NOTHING
// when the array is empty (`if (annotations.length === 0) return null`). It performs no data fetching — the
// only hook it calls is `useTranslation`.
//
// The native port keeps that contract 1:1:
//   • [AnnotationCategory] is the port of the web `AnnotationCategory` union; [AnnotationCategory.argbColor]
//     reproduces `ANNOTATION_COLORS` verbatim so the dot colour matches the web pixel-for-pixel, in every
//     theme, independent of the Material scheme (the web colours are fixed hex, not theme tokens).
//   • [AnnotationEntry] is the render shape — the subset of `DataAnnotation` the list actually consumes.
//   • [ChartAnnotationRow] + [toAnnotationEntry] port the web wire/cache row and its `toDataAnnotation`
//     projection, so an offline-cached backend row maps onto the render shape exactly as the web does. This
//     is the adapter the off-device unit test pins ("cached -> projection").
//   • [AnnotationListState] is the P1/S8 state holder the view binds to: a hot [StateFlow] of the current
//     entries (the web parent's annotations state) plus the [remove] writer (the web parent's `onRemove`).
//     It owns no networking — a host seeds it with already-projected entries or cached rows.
//   • [AnnotationListDiagnostics] emits the one PII-safe `view.opened` event (P1/S11), slug `AnnotationList`.
//
// States — documented, not silently dropped (Honesty Covenant #9): this surface has NO async data source (its
// only input is the parent-owned list, exactly like the accepted AnnouncerRegion port), so it has no network
// loading / error / stale / offline lifecycle to model — inventing those would fabricate behaviour the web
// spec does not have. Its real states are the web's two: empty (the list is absent — `return null`) and
// populated (the rows). The view renders both; the empty state's faithful rendering is "absent", because a
// visible empty box would contradict the web spec and clutter every chart that mounts the surface.
//
// The mandated surface directory (com/teslasync/shared-surfaces/AnnotationList — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen and a capitalised leaf are illegal in a package id), so
// the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.annotationlist

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * The annotation category — the native port of the web `AnnotationCategory` union
 * (web/src/types/annotations.ts). [argbColor] is the 0xAARRGGBB colour the dot is painted with, reproducing
 * the web `ANNOTATION_COLORS` map verbatim (fixed hex, theme-independent) so the native dot matches the web.
 */
enum class AnnotationCategory(
    val argbColor: Long,
) {
    Milestone(0xFF3B82F6L),
    Maintenance(0xFFF59E0BL),
    Trip(0xFF22C55EL),
    Issue(0xFFEF4444L),
    Upgrade(0xFFA855F7L),
    Custom(0xFF94A3B8L),
    ;

    companion object {
        /**
         * Maps a backend `category` wire string onto the enum, case-insensitively (the web keys are
         * lower-case: `milestone`, `maintenance`, …). An unrecognised value falls back to [Custom] — the
         * web's neutral catch-all colour — so a future server-side category never crashes the list.
         */
        fun fromWire(value: String): AnnotationCategory = entries.firstOrNull { it.name.equals(value, ignoreCase = true) } ?: Custom
    }
}

/**
 * The render shape for one row — the subset of the web `DataAnnotation` the list consumes: the stable [id]
 * (the remove key), the [label], an optional [description], the display [timestamp] (rendered verbatim, as
 * the web does), and the [category] that drives the dot colour.
 */
data class AnnotationEntry(
    val id: String,
    val label: String,
    val description: String?,
    val timestamp: String,
    val category: AnnotationCategory,
)

/**
 * A backend / offline-cache annotation row — the port of the web `ChartAnnotationRow`
 * (`GET /api/v1/annotations`, snake_case JSON). [toAnnotationEntry] projects it onto the render shape, the
 * native analogue of the web `toDataAnnotation`.
 */
data class ChartAnnotationRow(
    val id: Long,
    val occurredAt: String,
    val category: String,
    val title: String,
    val description: String?,
    val scope: List<String> = emptyList(),
)

/**
 * Projects a cached [ChartAnnotationRow] onto the [AnnotationEntry] render shape — the parity port of the web
 * `toDataAnnotation`: the numeric id is stringified (so it flows through the remove key unchanged), the
 * occurred-at timestamp becomes the display timestamp, the title becomes the label, a null description is
 * preserved as null, and the wire category resolves through [AnnotationCategory.fromWire].
 */
fun ChartAnnotationRow.toAnnotationEntry(): AnnotationEntry =
    AnnotationEntry(
        id = id.toString(),
        label = title,
        description = description,
        timestamp = occurredAt,
        category = AnnotationCategory.fromWire(category),
    )

/**
 * The P1/S8 state holder the [io.teslasync.android.sharedsurfaces.annotationlist] view binds to — the native
 * analogue of the web parent's `annotations` state + `onRemove` handler. It exposes a hot [StateFlow] of the
 * current [entries] and the imperative writers a host drives it with ([submit] / [submitRows] / [remove] /
 * [reset]). It performs no networking; a host feeds it already-projected entries or cached rows.
 *
 * @param initial the entries the holder starts with (the web parent's initial annotations array).
 */
class AnnotationListState(
    initial: List<AnnotationEntry> = emptyList(),
) {
    private val mutableEntries = MutableStateFlow(initial)

    /** The current annotation rows — the web parent's `annotations` state. */
    val entries: StateFlow<List<AnnotationEntry>> = mutableEntries.asStateFlow()

    /** Replaces the list with already-projected [entries] (a parent re-render with fresh data). */
    fun submit(entries: List<AnnotationEntry>) {
        mutableEntries.value = entries
    }

    /** Replaces the list with cached [rows], projecting each through [toAnnotationEntry]. */
    fun submitRows(rows: List<ChartAnnotationRow>) {
        mutableEntries.value = rows.map { it.toAnnotationEntry() }
    }

    /**
     * Removes the entry whose id is [id] — the web parent's optimistic `onRemove` list mutation. A no-op when
     * no entry matches, so a double-tap or a stale id never throws.
     */
    fun remove(id: String) {
        mutableEntries.update { current -> current.filterNot { it.id == id } }
    }

    /** Clears every entry — lets a fresh surface / test start from a clean slate. */
    fun reset() {
        mutableEntries.value = emptyList()
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never a label, description, or timestamp, any of which can carry user data.
 */
object AnnotationListDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "AnnotationList"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the view's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
