// Pure, framework-free model + arithmetic + projection for the Pagination shared surface — the native analogue
// of every decision the web component makes (web/src/components/ui/Pagination.tsx) before it paints its bar. No
// Compose, no Android, no HTTP: every declaration here is unit-tested off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// What the web source is (and therefore the COMPLETE branch set this surface reproduces): table pagination
// controls. The left cluster shows a localized "Showing {{start}}–{{end}} of {{total}}" summary inside an
// `aria-live="polite"` span, plus an OPTIONAL "Rows per page" `<select>` (rendered only when an
// `onPageSizeChange` handler is supplied) whose options read "{{count}} / page". The right cluster is the
// first / previous / page-indicator / next / last group: the first+previous buttons disable at `page <= 1`, the
// next+last buttons disable at `page >= totalPages`, and the centre shows `{page} / {totalPages}` with a
// localized `aria-label` of "Page {{page}} of {{total}}". The whole control is wrapped in a `<nav>` landmark
// named "Pagination". Every one of those branches is reproduced by the composable in Pagination.kt over this
// model, and every string resolves through the P1/S10 i18n catalog (the `translation_pagination_*` /
// `translation_a11y_pagination` keys already present in res/values/strings.xml) — no English literal lives here.
//
// The arithmetic mirrors the web exactly: `totalPages = max(1, ceil(total / pageSize))`,
// `start = (page - 1) * pageSize + 1`, `end = min(page * pageSize, total)`, and the summary shows `start` only
// when `total > 0` (else 0), matching `{ start: total > 0 ? start : 0, end, total }`. The only divergence is a
// native-safety guard for a non-positive `pageSize` (an invalid input the web would turn into NaN/Infinity):
// it collapses to a single page rather than crashing. The bound flags reproduce the web `disabled` predicates
// (`page <= 1`, `page >= totalPages`) verbatim, deliberately reading the raw `page` — like the web, the summary
// is NOT clamped, so an out-of-range caller sees the same numbers React would render.
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent:
// this surface fetches nothing. Like its web source it receives `page`, `pageSize`, `total`, and the change
// callbacks as props from the owning list/table screen and only ever renders the bar. There is no query to be
// loading, to fail, to go stale, or to be offline, so inventing those states would be dishonest (honesty
// covenant: no scope narrowing, no silent drift). The surface's REAL, fully-reproduced states are the data
// branches the web component actually draws — the EMPTY dataset (`total == 0` → "Showing 0–0 of 0", a single
// page, every button disabled), the first / middle / last page positions (which button pairs disable), and the
// page-size selector present vs absent — each reduced here in [paginationProjection] and asserted off-device,
// doubling as the per-state snapshot. The owning screen that DOES fetch renders its own data surface (with those
// async states) and drops this bar into it. The presentational precedent is the sibling Checkbox surface.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/shared-surfaces/Pagination — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally
// diverges from the path — exactly as the sibling Checkbox / SectionErrorBoundary surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.pagination

import io.teslasync.shared.core.diagnostics.Logger

/**
 * Diagnostics surface slug emitted with the `view.opened` event (P1/S11). Carries no page, page-size, or total
 * — only this constant identifier — so a diagnostics line can never leak how far a user has paged through their
 * data.
 */
const val PAGINATION_SLUG: String = "Pagination"

/**
 * The page-size options the web component defaults to (`pageSizeOptions = [25, 50, 100]`). Shared between the
 * composable's default argument and the off-device tests so the contract stays single-sourced.
 */
val DEFAULT_PAGE_SIZE_OPTIONS: List<Int> = listOf(25, 50, 100)

/**
 * Canonical registry metadata for the Pagination surface. The diagnostics [SLUG] is emitted with the one-shot
 * `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`Pagination`).
 */
object PaginationRegistration {
    /** Stable surface id (kebab-case), also the test tag the composable stamps on its bar. */
    const val ID: String = "pagination"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = PAGINATION_SLUG
}

/**
 * The reduced numbers the bar paints — the native mirror of everything the web component derives from its
 * `page` / `pageSize` / `total` props before rendering.
 *
 * @param totalPages the page count shown after the "/" and used for the last-page jump (web `totalPages`).
 * @param showingStart the first 1-based row index in the summary, or 0 when [total] is 0 (web
 *   `total > 0 ? start : 0`).
 * @param showingEnd the last row index in the summary (web `end = min(page * pageSize, total)`).
 * @param atStart whether the first + previous buttons are disabled (web `page <= 1`).
 * @param atEnd whether the next + last buttons are disabled (web `page >= totalPages`).
 */
data class PaginationProjection(
    val totalPages: Int,
    val showingStart: Int,
    val showingEnd: Int,
    val atStart: Boolean,
    val atEnd: Boolean,
)

/**
 * Reduce the three web inputs (`page`, `pageSize`, `total`) into the [PaginationProjection] the bar paints —
 * pure (no Compose), so every branch is exhaustively covered and unit-tested off-device, doubling as the
 * per-state snapshot. Mirrors the web component's arithmetic exactly for valid input; a non-positive [pageSize]
 * is guarded to a single page (the web would yield NaN/Infinity) rather than dividing by zero.
 */
fun paginationProjection(
    page: Int,
    pageSize: Int,
    total: Int,
): PaginationProjection {
    val safeTotal = maxOf(0, total)
    val totalPages =
        if (pageSize <= 0) {
            1
        } else {
            maxOf(1, (safeTotal + pageSize - 1) / pageSize)
        }
    val rawStart = if (pageSize <= 0) 1 else (page - 1) * pageSize + 1
    val rawEnd = if (pageSize <= 0) safeTotal else minOf(page * pageSize, safeTotal)
    return PaginationProjection(
        totalPages = totalPages,
        showingStart = if (safeTotal > 0) rawStart else 0,
        showingEnd = maxOf(0, rawEnd),
        atStart = page <= 1,
        atEnd = page >= totalPages,
    )
}

/**
 * The PII-safe diagnostics this surface emits (P1/S11). The one `view.opened` event carries only the constant
 * surface [SLUG] — never the page, page-size, or total — so a diagnostics line can never leak how far a user has
 * paged. Kept free of Compose so it is unit-tested with a recording [Logger].
 */
object PaginationDiagnostics {
    /** Diagnostics surface slug emitted with the `view.opened` event. */
    const val SLUG: String = PAGINATION_SLUG

    /** The one-shot event emitted once when the surface opens. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** The structured-field key carrying the surface slug on every diagnostic. */
    const val FIELD_SURFACE: String = "surface"

    /**
     * Emits the one PII-safe `view.opened` diagnostic carrying only the surface [SLUG]. Call from the
     * composable's first-composition effect.
     */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to SLUG))
    }
}
