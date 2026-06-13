// The data layer of the DateGroupedList shared surface — a parity port of the web `DateGroupedList`
// component (web/src/components/data-display/DateGroupedList.tsx). The Compose view lives in
// DateGroupedList.kt.
//
// What the web surface does: it is a generic, purely-presentational list with horizontal-rule date dividers
// and an optional per-group summary on the right. Its parent owns the `groups` array; the component maps each
// group to a header (the bold date label, an optional muted relative-time label, a hairline divider, and an
// optional right-pinned summary) followed by the group's items, each rendered through a caller-supplied
// `renderItem`. It performs NO data fetching and calls NO `useTranslation` — every visible string (dateLabel,
// relativeLabel, summary) is handed in already-formatted by the caller, and the domain-specific aggregation
// (e.g. the "2 drives · 6.2 mi" summary) lives on the caller so the component stays free of unit/format logic.
//
// The native port keeps that contract 1:1:
//   • [DateGroupedListGroup] is the render shape — the faithful port of the web `DateGroupedListGroup<T>`
//     interface (the sortable [dateKey], the visible [dateLabel], the optional [relativeLabel] and [summary],
//     and the group's [items]). The web `summary` is a free-form `ReactNode`; the native field narrows it to a
//     pre-formatted [String] because every web caller passes a formatted string (e.g. "2 drives · 6.2 mi") and
//     the caller still owns the formatting — a documented, faithful native adaptation (Honesty Covenant #9).
//   • [dateGroupHeaderReadout] is the surface's one piece of pure logic: it projects a group's header fields
//     onto the single merged TalkBack readout the view voices for the group heading (the native analogue of the
//     web `<section aria-labelledby>` that labels the section with its header text, the divider excluded). This
//     is the adapter the off-device unit test pins.
//   • [DateGroupedListState] is the P1/S8 state holder the view binds to — the native analogue of the web
//     parent owning the `groups` state. It exposes a hot [StateFlow] of the current groups plus the [submit] /
//     [reset] writers; it owns no networking — a host seeds it with already-built groups.
//   • [DateGroupedListDiagnostics] emits the one PII-safe `view.opened` event (P1/S11), slug `DateGroupedList`.
//
// States — documented, not silently dropped (Honesty Covenant #9): this surface has NO async data source (its
// only input is the parent-owned [DateGroupedListGroup] list, exactly like the accepted AnnouncerRegion /
// AnnotationList ports), so it has no network loading / error / stale / offline lifecycle to model — inventing
// those would fabricate behaviour the web spec does not have. Its real states are the web's two: empty (no
// groups — the web renders an empty container, so the faithful native rendering is "nothing visible") and
// populated (the grouped rows). The view renders both.
//
// i18n: the surface is anonymous — it owns no copy. Every visible string is supplied already-localized by the
// caller, so there is no literal to route through the P1/S10 catalog here.
//
// The mandated surface directory (com/teslasync/shared-surfaces/DateGroupedList — the P3 prompt's allowed-files
// path) cannot form a valid Kotlin package (a hyphen and a capitalized leaf are illegal in a package id), so
// the package intentionally diverges from the path, exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.dategroupedlist

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One date group's render shape — the faithful port of the web `DateGroupedListGroup<T>` interface
 * (web/src/components/data-display/DateGroupedList.tsx). Field order mirrors the web declaration for parity
 * readability; callers construct instances with named arguments.
 *
 * @param T the item type this group holds; the view renders each item through a caller-supplied slot.
 * @param dateKey sortable, stable key (typically `YYYY-MM-DD`) — used as the group's Compose key, the web
 *   `key={group.dateKey}`.
 * @param dateLabel the visible date label, pre-formatted by the caller (e.g. "May 9, 2026").
 * @param relativeLabel an optional secondary relative-time label (e.g. "3 days ago"), rendered muted after the
 *   primary label.
 * @param summary an optional summary rendered right-aligned in the divider row (e.g. "2 drives · 6.2 mi"). The
 *   web type is a free-form `ReactNode`; here it is a pre-formatted string the caller owns.
 * @param items the items belonging to this group, rendered in order beneath the header.
 */
data class DateGroupedListGroup<T>(
    val dateKey: String,
    val dateLabel: String,
    val relativeLabel: String? = null,
    val summary: String? = null,
    val items: List<T>,
)

/**
 * Projects a group's header fields onto the single merged TalkBack readout the view voices for the group
 * heading — the native analogue of the web `<section aria-labelledby={header}>` that labels the section with
 * its header text (the visual divider is `aria-hidden`, so it is excluded here too). The [dateLabel],
 * [relativeLabel], and [summary] are joined in reading order; blank / null parts are dropped so the readout is
 * never "May 9, , " when a group carries no relative label or summary.
 *
 * @param dateLabel the primary visible date label.
 * @param relativeLabel the optional muted relative-time label.
 * @param summary the optional right-pinned summary.
 * @return the comma-joined readout, voiced as one coherent heading sentence.
 */
fun dateGroupHeaderReadout(
    dateLabel: String,
    relativeLabel: String?,
    summary: String?,
): String =
    listOfNotNull(
        dateLabel.takeIf { it.isNotBlank() },
        relativeLabel?.takeIf { it.isNotBlank() },
        summary?.takeIf { it.isNotBlank() },
    ).joinToString(separator = ", ")

/**
 * The P1/S8 state holder the [io.teslasync.android.sharedsurfaces.dategroupedlist] view binds to — the native
 * analogue of the web parent's `groups` state. It exposes a hot [StateFlow] of the current [groups] and the
 * imperative writers a host drives it with ([submit] / [reset]). It performs no networking; a host feeds it
 * already-built groups.
 *
 * @param T the item type the grouped lists hold.
 * @param initial the groups the holder starts with (the web parent's initial `groups` array).
 */
class DateGroupedListState<T>(
    initial: List<DateGroupedListGroup<T>> = emptyList(),
) {
    private val mutableGroups = MutableStateFlow(initial)

    /** The current groups — the web parent's `groups` state. */
    val groups: StateFlow<List<DateGroupedListGroup<T>>> = mutableGroups.asStateFlow()

    /** Replaces the groups with a fresh list (a parent re-render with new data). */
    fun submit(groups: List<DateGroupedListGroup<T>>) {
        mutableGroups.value = groups
    }

    /** Clears every group — lets a fresh surface / test start from a clean slate. */
    fun reset() {
        mutableGroups.value = emptyList()
    }
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Emits only the stable, dot-namespaced `view.opened` event
 * tagged with the surface [SLUG] — never a date label, relative label, or summary, any of which can carry user
 * data (locations, vehicle activity, distances).
 */
object DateGroupedListDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11, prompt-mandated). */
    const val SLUG: String = "DateGroupedList"

    private const val VIEW_OPENED = "view.opened"
    private const val SURFACE_KEY = "surface"

    /** Emits the `view.opened` diagnostic for this surface. Call from the view's first-composition effect. */
    fun recordViewOpened(logger: Logger) {
        logger.info(VIEW_OPENED, mapOf(SURFACE_KEY to SLUG))
    }
}
