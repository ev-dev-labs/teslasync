// Pure, framework-free model + projection for the Reset-to-defaults feature view — the native analogue of
// everything the web component derives before returning JSX
// (web/src/features/settings/components/ResetSection.tsx) plus its local `useSectionRows` / `useDeniedRows`
// helpers. No Compose, no Android, no HTTP: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer.
//
// The web component is MUTATION-ONLY: it renders a STATIC, localized list of resettable sections, a static
// read-only deny-list, and a Danger-zone button. It owns no `useQuery` feed — the only dynamic state is the
// two `pending` / `resetAllOpen` confirm dialogs, the per-mutation in-flight flag, and the success/error
// toasts the `useResetSection` / `useResetAllSettings` hooks raise. This file owns exactly that derivation:
// the canonical section order + wire names ([ResetSectionCatalog]), the dialog state machine
// ([ResetDialog] / [ResetSectionUiState]), the success-toast argument build ([ResetSectionCatalog.successToastArgs]),
// the registry + PII-safe diagnostics ids, and the i18n key constants. The label resolution itself is a
// render concern the composable owns (each [ResetSectionId] maps to its catalog `stringResource`).
//
// `InvalidPackageDeclaration` is suppressed because this surface's mandated directory
// (com/teslasync/feature-views/ResetSection — the P3 prompt's allowed-files path) cannot form a valid Kotlin
// package (a hyphen and a PascalCase segment are illegal in a package identifier), so the package
// intentionally diverges from the path — exactly as the sibling feature-view surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting types.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.featureviews.resetsection

import io.teslasync.shared.core.diagnostics.Logger
import io.teslasync.shared.core.presentation.settingsreset.SettingsResetResult

/** Diagnostics + registry identifiers for the surface (P1/S11). */
object ResetSectionRegistration {
    /** Stable surface id. */
    const val ID: String = "reset-section"

    /** Diagnostics surface slug emitted with the `view.opened` event (P1/S11). */
    const val SLUG: String = "ResetSection"
}

/**
 * PII-safe diagnostics for the surface (P1/S11). Every event carries ONLY the surface slug — never a section
 * id, count, or receipt — so a diagnostics line can never leak which preferences a user just wiped. Kept free
 * of Compose so it is unit-tested with a recording [Logger].
 */
object ResetSectionDiagnostics {
    /** The one-shot view-open diagnostic event name. */
    const val EVENT_VIEW_OPENED: String = "view.opened"

    /** Logged when a single-section reset is confirmed (web `useResetSection.mutateAsync`). */
    const val EVENT_RESET_SECTION: String = "settingsReset.section"

    /** Logged when the Danger-zone "reset everything" is confirmed (web `useResetAllSettings.mutateAsync`). */
    const val EVENT_RESET_ALL: String = "settingsReset.all"

    /** The diagnostics field carrying the surface slug. */
    const val FIELD_SURFACE: String = "surface"

    /** Emits the one-shot `view.opened` diagnostic with the surface slug and nothing else. */
    fun recordViewOpened(logger: Logger) {
        logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to ResetSectionRegistration.SLUG))
    }

    /** Emits the PII-safe reset diagnostic for [event] (surface slug only — never the section/receipt). */
    fun recordReset(
        logger: Logger,
        event: String,
    ) {
        logger.info(event, mapOf(FIELD_SURFACE to ResetSectionRegistration.SLUG))
    }
}

/**
 * The i18n catalog key for the success toast detail (web `settingsReset.toasts.successDetail`,
 * "{{count}} item(s) reset across {{sections}} section(s)."). The render boundary resolves it (ADR-014) with
 * the [ResetSectionCatalog.successToastArgs] positional arguments.
 */
const val SUCCESS_DETAIL_KEY: String = "settingsReset.toasts.successDetail"

/**
 * The i18n catalog key for the mutation-failure toast. The web hook raises a reset-specific
 * `toast.settings.reset.error` ("Failed to reset section") via `useMutationToast`, but that key is not in the
 * P1/S10 Android catalog yet and `strings.xml` is outside this surface's allowed files, so the surface raises
 * the existing localized generic server-error copy (`error.serverError.message`) — fully localized, no
 * hardcoded English, and behaviourally faithful (a failure surfaces a toast).
 */
const val ERROR_KEY: String = "error.serverError.message"

/**
 * The literal confirmation token the Danger-zone dialog requires the user to type (web
 * `requireTypedConfirmation="RESET"`). A protocol token, not display copy — identical in every locale (the
 * user types the same five characters); the surrounding label is localized.
 */
const val RESET_CONFIRMATION: String = "RESET"

/**
 * A user-resettable settings section — the native mirror of one web `useSectionRows` entry. [wire] is the
 * canonical lower-snake-case name `POST /settings/reset` expects (web `id`, as listed in the backend's
 * `AllSettingsResetSections()`); the order of the entries mirrors the web list exactly.
 */
enum class ResetSectionId(
    val wire: String,
) {
    General("general"),
    Appearance("appearance"),
    AlertRules("alert_rules"),
    Geofences("geofences"),
    NotificationChannels("notification_channels"),
    DashboardLayout("dashboard_layout"),
    Automations("automations"),
    QuietHours("quiet_hours"),
}

/**
 * One render-ready resettable-section row — the [id] paired with its resolved, localized [title] and
 * [description]. Pure data (no Compose types) so the dialog copy + ordering are unit-tested without a UI host.
 */
data class ResetSectionRow(
    val id: ResetSectionId,
    val title: String,
    val description: String,
)

/**
 * One render-ready deny-list row — a section that is NOT user-resettable (web `useDeniedRows`). [key] is the
 * stable id (`tariffs` / `sound_prefs`), [title] the localized name, and [reason] the localized explanation +
 * alternative path.
 */
data class ResetDeniedRow(
    val key: String,
    val title: String,
    val reason: String,
)

/**
 * Which confirm dialog the surface is showing — the native analogue of the web `pending` (per-section) +
 * `resetAllOpen` (Danger-zone) state. Exactly one dialog can be open at a time.
 */
sealed interface ResetDialog {
    /** No dialog is open (web `pending === null && !resetAllOpen`). */
    data object None : ResetDialog

    /** The per-section confirm dialog for [row] (web `pending !== null`). */
    data class Section(
        val row: ResetSectionRow,
    ) : ResetDialog

    /** The Danger-zone typed-confirmation dialog (web `resetAllOpen`). */
    data object All : ResetDialog
}

/**
 * The immutable interaction state the surface renders — which [dialog] is open and whether a reset is in
 * flight ([busy]). There is no data-feed state (the section + deny lists are static localized constants and
 * the web domain has no `useQuery`), so loading / empty / stale / offline do not apply here; the only
 * lifecycle is the confirm-then-run mutation.
 *
 * @property dialog the currently-open confirm dialog (none / per-section / danger-zone).
 * @property busy whether a reset mutation is in flight — the dialog stays open + loading and its row button is disabled.
 */
data class ResetSectionUiState(
    val dialog: ResetDialog = ResetDialog.None,
    val busy: Boolean = false,
) {
    /** The section whose dialog is open, or null (web `pending`). */
    val pendingSection: ResetSectionRow? get() = (dialog as? ResetDialog.Section)?.row

    /** True while the per-section confirm dialog is open. */
    val isSectionDialogOpen: Boolean get() = dialog is ResetDialog.Section

    /** True while the Danger-zone typed-confirmation dialog is open. */
    val isAllDialogOpen: Boolean get() = dialog is ResetDialog.All

    /**
     * Whether the [id] row's "Reset" button should be disabled — only the section currently being confirmed
     * while its mutation is in flight (web `busy={sectionBusy && pending?.id === row.id}`).
     */
    fun isSectionBusy(id: ResetSectionId): Boolean = busy && pendingSection?.id == id
}

/**
 * The static structural truth of the surface — the canonical section order + wire names and the deny-list
 * keys (the parts of `useSectionRows` / `useDeniedRows` that are NOT localized text) plus the success-toast
 * argument build. Pure + side-effect-free so it is fully covered by the off-device unit gate; the localized
 * labels are resolved at the Compose boundary and zipped onto these ids.
 */
object ResetSectionCatalog {
    /** The deny-list key for per-vehicle charge-cost tariffs (web `tariffs`). */
    const val DENIED_TARIFFS: String = "tariffs"

    /** The deny-list key for browser-local notification sound preferences (web `sound_prefs`). */
    const val DENIED_SOUND_PREFS: String = "sound_prefs"

    /** Every resettable section, in the exact order the web `useSectionRows` lists them. */
    val SECTIONS: List<ResetSectionId> = ResetSectionId.entries.toList()

    /** Every deny-list key, in the exact order the web `useDeniedRows` lists them. */
    val DENIED: List<String> = listOf(DENIED_TARIFFS, DENIED_SOUND_PREFS)

    /**
     * The positional arguments for the success toast (web `{ count: result.reset, sections: result.sections.length }`)
     * — `[reset-count, sections-count]` as strings, matching the catalog `%1$s … %2$s` template.
     */
    fun successToastArgs(result: SettingsResetResult): List<String> = listOf(result.reset.toString(), result.sections.size.toString())
}
