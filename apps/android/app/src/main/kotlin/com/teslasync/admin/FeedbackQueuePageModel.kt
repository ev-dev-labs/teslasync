// Pure, framework-free model + derivations for the FeedbackQueuePage admin surface — the native analogue of
// everything the web page computes before it returns JSX
// (web/src/features/admin/pages/FeedbackQueuePage.tsx, the in-app feedback queue). No Compose, no Android
// framework, no HTTP lives here: every type is exercised off-device, keeping the composable a thin render
// layer.
//
// The feed arrives as the shared, already-decoded S8 payload (the KMP `FeedbackStore.feedbackList(params)`
// ▸ `GET /admin/feedback`, a typed `FeedbackListResponse`). So this file owns only the client-side
// derivations the web component does inline: the category / status badge tones (web `CategoryBadge`/
// `StatusBadge` variant maps), the pagination arithmetic (web `Math.ceil(total / PAGE_SIZE)`), and the
// pretty-printed `recent_errors` JSON (web `JSON.stringify(recent_errors, null, 2)`). No feedback field is
// unit-bearing (ids, timestamps, free text, a status enum), so there is no SI conversion here — locale /
// date formatting is applied at the render boundary (S5).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/admin — the P3 prompt's allowed-files path) cannot form the package the rest of the app's
// `io.teslasync.android.*` namespace uses, so the package intentionally diverges from the path — exactly as
// the sibling ApiLogsPage admin surface does. `MatchingDeclarationName` is suppressed for the co-located
// types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.admin.feedback

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackListResponse
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/** Em dash used as the universal "no value" marker, matching the web `'—'` fallback. */
internal const val EM_DASH: String = "\u2014"

/**
 * Canonical metadata for this surface. The web page is a top-level admin route, not a draggable dashboard
 * widget, so there is no web registry row to mirror — this object carries the cross-cutting concerns the
 * surface owes: the navigation [ROUTE_ID] / [WEB_PATH] the host wires, the diagnostics [SLUG] emitted with
 * the one-shot `view.opened` event (P1/S11), and the fixed [PAGE_SIZE] the web uses (`PAGE_SIZE = 25`).
 */
object FeedbackQueueRegistration {
    /** The navigation destination id (Destinations.kt `page("adminFeedback", "/admin/feedback", …)`). */
    const val ROUTE_ID: String = "adminFeedback"

    /** The web route this surface mirrors (deep-link target). */
    const val WEB_PATH: String = "/admin/feedback"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FeedbackQueuePage"

    /** Rows per page — the web `PAGE_SIZE = 25`. */
    const val PAGE_SIZE: Int = 25
}

/** Semantic tone for a feedback badge, mapped to the design-system badge palette at the render boundary. */
enum class FeedbackTone { Info, Success, Warning, Danger, Neutral }

/** The three feedback categories (web `FeedbackCategory`), in the web filter-option order. */
val FEEDBACK_CATEGORIES: List<String> = listOf("bug", "feature", "other")

/** The three feedback statuses (web `FeedbackStatus`), in the web filter-option order. */
val FEEDBACK_STATUSES: List<String> = listOf("new", "triaged", "closed")

/**
 * Category badge tone — the native mirror of the web `CategoryBadge` variant map
 * (`bug → danger`, `feature → info`, `other → neutral`). An unknown category is neutral.
 */
fun categoryTone(category: String): FeedbackTone =
    when (category) {
        "bug" -> FeedbackTone.Danger
        "feature" -> FeedbackTone.Info
        else -> FeedbackTone.Neutral
    }

/**
 * Status badge tone — the native mirror of the web `StatusBadge` variant map
 * (`new → warning`, `triaged → success`, `closed → neutral`). An unknown status is neutral.
 */
fun statusTone(status: String): FeedbackTone =
    when (status) {
        "new" -> FeedbackTone.Warning
        "triaged" -> FeedbackTone.Success
        else -> FeedbackTone.Neutral
    }

/** Whether the queue page returned no rows — gates the native Empty phase (web `items.length === 0`). */
val FeedbackListResponse.isEmptyQueue: Boolean get() = items.isEmpty()

/**
 * Total page count for [total] rows at [pageSize] (web `Math.max(1, Math.ceil(total / PAGE_SIZE))`),
 * at least 1 so the "Page 1 of 1" footer is always coherent.
 */
fun totalPages(
    total: Long,
    pageSize: Int = FeedbackQueueRegistration.PAGE_SIZE,
): Int {
    if (pageSize <= 0) return 1
    val pages = ((total + pageSize - 1) / pageSize).toInt()
    return if (pages < 1) 1 else pages
}

private val prettyJson = Json { prettyPrint = true }

/**
 * Pretty-prints the opaque `recent_errors` blob (web `JSON.stringify(row.recent_errors, null, 2)`) for the
 * expanded-row viewer. The value round-trips shape-preserving as a [JsonElement]; this only re-indents it.
 */
fun prettyErrors(element: JsonElement): String = prettyJson.encodeToString(JsonElement.serializer(), element)

/** Emits the one PII-safe `view.opened` diagnostic with the surface slug (P1/S11); carries no row content. */
internal fun recordFeedbackQueueOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FeedbackQueueRegistration.SLUG))
}
