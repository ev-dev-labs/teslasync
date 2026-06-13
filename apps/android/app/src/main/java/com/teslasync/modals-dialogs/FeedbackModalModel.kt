// Pure, framework-free model + projection for the FeedbackModal surface — the native analogue of everything the web
// component derives before it returns JSX (web/src/components/feedback/FeedbackModal.tsx). No Compose, no Android, no
// HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest gate, so the composable
// stays a thin render layer over these pure functions.
//
// The web component is the in-app feedback / bug-report modal: a category selector (bug/feature/other), a required
// title (zod min 5 / max 120), a required body (zod min 20 / max 4000), and two consent toggles that attach
// auto-collected diagnostic context — the recent frontend error ring buffer (default ON) and the recent console tail
// (default OFF for privacy). On submit it POSTs to `useSubmitFeedback` (the shared FeedbackStore, P1/S8) and closes.
// This file owns the data derivations behind that form: the per-field length validation, the maxLength clamps, the
// `recent_errors` JSON-array assembly (snake_case wire keys, `stack` dropped when absent), the console-tail cap, and
// the create-payload assembly (web object literal — trim title/body, always carry page_route/user_agent/app_version,
// attach the optional diagnostics only when toggled on AND non-empty). Colors, glyphs and localized labels are
// resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/modals-dialogs — the P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen is
// illegal in a package identifier), so the package intentionally diverges from the path — exactly as the sibling
// feature-view surfaces do. `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.modalsdialogs.feedbackmodal

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.feedback.FeedbackEntry
import io.teslasync.shared.core.presentation.feedback.FeedbackStore
import io.teslasync.shared.core.presentation.feedback.FeedbackSubmitInput
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.put

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object FeedbackModalRegistration {
    /** Stable surface id. */
    const val ID: String = "feedback-modal"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "FeedbackModal"
}

/**
 * The feedback-category union the web component offers (`bug | feature | other`). [wire] is the exact lowercase token
 * sent to `POST /feedback`; the human label is resolved at the Compose boundary (P1/S10).
 */
enum class FeedbackCategory(
    val wire: String,
) {
    Bug("bug"),
    Feature("feature"),
    Other("other"),
    ;

    companion object {
        /** Resolves a [wire] token back to its case (web select `onChange`); unknown tokens fall back to [Bug]. */
        fun fromWire(wire: String): FeedbackCategory = entries.firstOrNull { it.wire == wire } ?: Bug
    }
}

/**
 * The editable form draft the dialog owns — the native mirror of the web component's `useState` fields. Defaults
 * match the web `initialValues` (`category='bug'`, empty title/body, recent-errors ON, console-tail OFF), so a freshly
 * opened dialog presents exactly the web's initial form.
 */
data class FeedbackDraft(
    val category: FeedbackCategory = FeedbackCategory.Bug,
    val title: String = "",
    val body: String = "",
    val includeRecentErrors: Boolean = true,
    val includeConsoleTail: Boolean = false,
)

/**
 * One captured frontend error in the shape the web feedback modal attaches to a report (web `FeedbackErrorReport`,
 * lib/errorReporter.ts). The field names mirror the snake_case JSONB the backend persists into
 * `user_feedback.recent_errors`; [occurredAt] serializes as `occurred_at` and [stack] is dropped from the wire when
 * null (web optional `stack?`). Vendor-agnostic and PII-free at this layer — the diagnostics seam supplies it.
 */
data class FeedbackErrorReport(
    val name: String,
    val message: String,
    val route: String,
    val occurredAt: String,
    val source: String,
    val stack: String? = null,
)

/**
 * The auto-collected context the dialog shows before submit (so nothing ships without consent) and attaches to the
 * report — the native analogue of the web component's `useLocation().pathname`, `navigator.userAgent`,
 * `import.meta.env.VITE_APP_VERSION`, the errorReporter ring buffer, and the captured console tail. Host-supplied (the
 * nav route, BuildConfig version, a device descriptor, and the diagnostics buffers) so the view performs no platform
 * reads itself; tests/previews pass a literal.
 *
 * @property pageRoute the current route (web `useLocation().pathname`).
 * @property appVersion the build version name (web `VITE_APP_VERSION`).
 * @property userAgent a device/app descriptor (web `navigator.userAgent`, labelled "Browser" in the web copy).
 * @property recentErrors the most-recent captured errors available to attach (web `getRecentReportsForFeedback()`).
 * @property consoleTail the captured console/log tail available to attach (web `getConsoleTail()`).
 */
data class FeedbackContext(
    val pageRoute: String = "",
    val appVersion: String = "",
    val userAgent: String = "",
    val recentErrors: List<FeedbackErrorReport> = emptyList(),
    val consoleTail: String = "",
)

/**
 * The pure derivations the composable renders over — the native mirror of the web component's zod schema + inline
 * submit logic. Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object FeedbackModalProjection {
    /** Minimum trimmed title length the client enforces (web `FEEDBACK_TITLE_MIN`). */
    const val MIN_TITLE_LENGTH: Int = 5

    /** Maximum title length the input accepts (web `FEEDBACK_TITLE_MAX`). */
    const val MAX_TITLE_LENGTH: Int = 120

    /** Minimum trimmed body length the client enforces (web `FEEDBACK_BODY_MIN`). */
    const val MIN_BODY_LENGTH: Int = 20

    /** Maximum body length the textarea accepts (web `FEEDBACK_BODY_MAX`). */
    const val MAX_BODY_LENGTH: Int = 4000

    /** Maximum console-tail length attached (web `CONSOLE_TAIL_MAX`). */
    const val MAX_CONSOLE_TAIL: Int = 4000

    /** Clamps a title edit to the accepted maximum (web `maxLength={120}`). */
    fun clampTitle(title: String): String = title.take(MAX_TITLE_LENGTH)

    /** Clamps a body edit to the accepted maximum (web `maxLength={4000}`). */
    fun clampBody(body: String): String = body.take(MAX_BODY_LENGTH)

    /** Whether [title] satisfies the trimmed length bounds (web zod `title`). */
    fun isTitleValid(title: String): Boolean = title.trim().length in MIN_TITLE_LENGTH..MAX_TITLE_LENGTH

    /** Whether [body] satisfies the trimmed length bounds (web zod `body`). */
    fun isBodyValid(body: String): Boolean = body.trim().length in MIN_BODY_LENGTH..MAX_BODY_LENGTH

    /** Whether the whole draft passes validation — drives the disabled submit (web `validation.success`). */
    fun isValid(draft: FeedbackDraft): Boolean = isTitleValid(draft.title) && isBodyValid(draft.body)

    /**
     * Keeps the most-recent [MAX_CONSOLE_TAIL] characters of [tail], newest-last (web `getConsoleTail()` slice), so
     * the operator reading the issue sees the failure context at the bottom.
     */
    fun clampConsoleTail(tail: String): String = if (tail.length <= MAX_CONSOLE_TAIL) tail else tail.takeLast(MAX_CONSOLE_TAIL)

    /**
     * Assembles the `recent_errors` JSON array exactly as the web attaches it — one object per report with snake_case
     * keys (`occurred_at`) and `stack` omitted when absent. Returned as a [JsonElement] so it round-trips through
     * [FeedbackSubmitInput.recentErrors] unchanged onto the wire.
     */
    fun recentErrorsJson(reports: List<FeedbackErrorReport>): JsonElement =
        buildJsonArray {
            reports.forEach { report ->
                addJsonObject {
                    put("name", report.name)
                    put("message", report.message)
                    report.stack?.let { put("stack", it) }
                    put("route", report.route)
                    put("occurred_at", report.occurredAt)
                    put("source", report.source)
                }
            }
        }

    /**
     * Assembles the `POST /feedback` body from [draft] + [context] — the web `submit.mutateAsync({...})` object
     * literal. The title and body are trimmed; page_route / user_agent / app_version are always carried (web always
     * sets them, even when empty); recent_errors is attached only when the toggle is on AND the buffer is non-empty
     * (web `includeRecentErrors && recentErrors.length > 0`); console_tail only when the toggle is on AND non-empty
     * after the cap (web `includeConsoleTail` + `tail.length > 0`). No user_email — the server derives it from auth.
     */
    fun buildSubmitInput(
        draft: FeedbackDraft,
        context: FeedbackContext,
    ): FeedbackSubmitInput {
        val recentErrors =
            if (draft.includeRecentErrors && context.recentErrors.isNotEmpty()) {
                recentErrorsJson(context.recentErrors)
            } else {
                null
            }
        val consoleTail =
            if (draft.includeConsoleTail) {
                clampConsoleTail(context.consoleTail).ifEmpty { null }
            } else {
                null
            }
        return FeedbackSubmitInput(
            category = draft.category.wire,
            title = draft.title.trim(),
            body = draft.body.trim(),
            pageRoute = context.pageRoute,
            userAgent = context.userAgent,
            appVersion = context.appVersion,
            recentErrors = recentErrors,
            consoleTail = consoleTail,
        )
    }
}

/**
 * The narrow write seam the dialog binds to — the native analogue of the web `useSubmitFeedback` mutation. A
 * production binding routes to the shared [FeedbackStore] (see [bindFeedbackModalSource]); tests pass a fake. Keeping
 * the seam this small means the dialog never sees the store, the cache, or HTTP.
 */
interface FeedbackModalSource {
    /** Submits feedback, returning the non-throwing [Result] the store exposes (web `mutateAsync`). */
    suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry>
}

/**
 * Binds the dialog's write seam to the shared **S8** [FeedbackStore] (web `useSubmitFeedback`). The store performs no
 * invalidation on submit — the public feedback modal and the admin queue are independent surfaces — so a successful
 * submit disturbs no observed feed, exactly as the web hook declares.
 */
fun bindFeedbackModalSource(store: FeedbackStore): FeedbackModalSource =
    object : FeedbackModalSource {
        override suspend fun submitFeedback(input: FeedbackSubmitInput): Result<FeedbackEntry> = store.submitFeedback(input)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [FeedbackModalRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition
 * effect.
 */
fun recordFeedbackModalOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to FeedbackModalRegistration.SLUG))
}
