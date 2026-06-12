// Pure, framework-free model + projection for the IncidentForm feature view — the native analogue of everything
// the web component derives before it returns JSX (web/src/features/system/components/status/IncidentForm.tsx). No
// Compose, no Android, no HTTP: every declaration here is exercised off-device by the :android:testReleaseUnitTest
// gate, so the composable stays a thin render layer over these pure functions.
//
// The web component is a manual incident-logging dialog: a required title (length 3–200, validated client-side AND
// server-side), a severity selector (minor/major/critical), a status selector
// (investigating/identified/monitoring/resolved), an optional comma-separated affected-components field, and an
// optional initial timeline message. On submit it POSTs to `useCreateIncident` (the shared IncidentsStore, P1/S8)
// and closes; the list query is invalidated by the store. This file owns the data derivations behind that form: the
// title-length validation (web `t.length < 3`), the create-payload assembly (web object literal — trim title, drop a
// blank message to `null`, split + trim + drop-empty the components), and the severity/status option vocabularies.
// Colors, glyphs and localized labels are resolved at the Compose boundary, never here.
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/IncidentForm — the P3 prompt's allowed-files path) cannot form a valid Kotlin package
// (a hyphen and a PascalCase segment are illegal in a package identifier), so the package intentionally diverges from
// the path — exactly as the sibling feature-view surfaces do. `MatchingDeclarationName` is suppressed for the
// co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.incidentform

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.incidents.CreateIncidentInput
import io.teslasync.shared.core.presentation.incidents.Incident
import io.teslasync.shared.core.presentation.incidents.IncidentsStore

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object IncidentFormRegistration {
    /** Stable surface id. */
    const val ID: String = "incident-form"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "IncidentForm"
}

/**
 * The incident severity union the web component offers (`minor | major | critical`). [wire] is the exact lowercase
 * token sent to `POST /status/incidents`; the human label is resolved at the Compose boundary (P1/S10).
 */
enum class IncidentSeverity(
    val wire: String,
) {
    Minor("minor"),
    Major("major"),
    Critical("critical"),
    ;

    companion object {
        /** Resolves a [wire] token back to its case (web select `onChange`); unknown tokens fall back to [Minor]. */
        fun fromWire(wire: String): IncidentSeverity = entries.firstOrNull { it.wire == wire } ?: Minor
    }
}

/**
 * The incident lifecycle-status union the web component offers
 * (`investigating | identified | monitoring | resolved`). [wire] is the exact lowercase token sent to the server;
 * the human label is resolved at the Compose boundary (P1/S10).
 */
enum class IncidentStatus(
    val wire: String,
) {
    Investigating("investigating"),
    Identified("identified"),
    Monitoring("monitoring"),
    Resolved("resolved"),
    ;

    companion object {
        /** Resolves a [wire] token back to its case (web select `onChange`); unknown tokens fall back to [Investigating]. */
        fun fromWire(wire: String): IncidentStatus = entries.firstOrNull { it.wire == wire } ?: Investigating
    }
}

/**
 * The editable form draft the dialog owns — the native mirror of the web component's `useState` fields. Defaults
 * match the web initial state (`severity='minor'`, `status='investigating'`, the rest empty), so a freshly opened
 * dialog is immediately submittable once a title is typed.
 */
data class IncidentDraft(
    val title: String = "",
    val severity: IncidentSeverity = IncidentSeverity.Minor,
    val status: IncidentStatus = IncidentStatus.Investigating,
    val components: String = "",
    val message: String = "",
)

/**
 * The transient toasts the surface raises (web `useToast`), localized + toned at the Compose boundary (P1/S10).
 * Carries no pre-localized sentence and no PII (ADR-016) — [SubmitFailed.detail] holds the server-supplied error
 * text the web shows verbatim (`err.message`), which the boundary falls back to a localized message for when blank.
 */
sealed interface IncidentFormToast {
    /** Web `toast.success('Incident logged.')`. */
    data object Logged : IncidentFormToast

    /** Web `toast.error('Title must be at least 3 characters.')`. */
    data object ValidationTitleTooShort : IncidentFormToast

    /** Web `toast.error(err.message ?? 'Failed to log incident')`. */
    data class SubmitFailed(
        val detail: String?,
    ) : IncidentFormToast
}

/**
 * The pure derivations the composable renders over — the native mirror of the web component's inline submit logic.
 * Stateless and side-effect-free, so it is fully covered by the off-device unit gate.
 */
object IncidentFormProjection {
    /** Minimum trimmed title length the client enforces before submit (web `t.length < 3`). */
    const val MIN_TITLE_LENGTH: Int = 3

    /** Maximum title length the input accepts (web `maxLength={200}`), mirrored by the server bound. */
    const val MAX_TITLE_LENGTH: Int = 200

    /** Maximum initial-message length the textarea accepts (web `maxLength={4000}`). */
    const val MAX_MESSAGE_LENGTH: Int = 4000

    /** Whether [title] satisfies the client-side minimum once trimmed (web submit guard). */
    fun isTitleValid(title: String): Boolean = title.trim().length >= MIN_TITLE_LENGTH

    /** Clamps a title edit to the accepted maximum (web `maxLength={200}`). */
    fun clampTitle(title: String): String = title.take(MAX_TITLE_LENGTH)

    /** Clamps an initial-message edit to the accepted maximum (web `maxLength={4000}`). */
    fun clampMessage(message: String): String = message.take(MAX_MESSAGE_LENGTH)

    /**
     * Splits the comma-separated affected-components field into trimmed, non-empty tokens — the web
     * `components.split(',').map((c) => c.trim()).filter(Boolean)`. An all-blank field yields an empty list, exactly
     * as the web sends `affected_components: []`.
     */
    fun parseComponents(raw: String): List<String> = raw.split(',').map { it.trim() }.filter { it.isNotEmpty() }

    /**
     * Assembles the `POST /status/incidents` body from [draft] — the web `create.mutateAsync({...})` object literal.
     * The title is trimmed; the message is trimmed and dropped to `null` when blank (web `message.trim() ||
     * undefined`); the components are split + trimmed + de-blanked; the description is never sent by the dialog.
     */
    fun buildCreateInput(draft: IncidentDraft): CreateIncidentInput =
        CreateIncidentInput(
            title = draft.title.trim(),
            severity = draft.severity.wire,
            status = draft.status.wire,
            affectedComponents = parseComponents(draft.components),
            initialMessage = draft.message.trim().ifBlank { null },
        )
}

/**
 * The narrow write seam the dialog binds to — the native analogue of the web `useCreateIncident` mutation. A
 * production binding routes to the shared [IncidentsStore] (see [bindIncidentFormSource]); tests pass a fake. Keeping
 * the seam this small means the dialog never sees the store, the cache, or HTTP.
 */
interface IncidentFormSource {
    /** Creates an incident, returning the non-throwing [Result] the store exposes (web `mutateAsync`). */
    suspend fun createIncident(input: CreateIncidentInput): Result<Incident>
}

/**
 * Binds the dialog's write seam to the shared **S8** [IncidentsStore] (web `useCreateIncident`). The store refreshes
 * every observed incidents feed on success, so a successful log updates the status-page list with no extra wiring.
 */
fun bindIncidentFormSource(store: IncidentsStore): IncidentFormSource =
    object : IncidentFormSource {
        override suspend fun createIncident(input: CreateIncidentInput): Result<Incident> = store.createIncident(input)
    }

/**
 * Emits the one PII-safe `view.opened` diagnostic with the surface [IncidentFormRegistration.SLUG] (P1/S11). Kept
 * free of Compose so it is unit-tested with a recording [Logger]; the composable calls it from its first-composition
 * effect.
 */
fun recordIncidentFormOpened(logger: Logger) {
    logger.info("view.opened", mapOf("surface" to IncidentFormRegistration.SLUG))
}
