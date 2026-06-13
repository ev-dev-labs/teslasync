// Pure, framework-free model + decision logic + diagnostics for the GuardedLink shared surface — the
// native analogue of web/src/components/feedback/GuardedLink.tsx together with its data source
// web/src/components/feedback/NavigationGuardProvider.tsx (the `useNavigationGuardContext` seam). No
// Compose, no Android framework, no coroutines: every declaration here is exercised off-device in the
// :android:testReleaseUnitTest gate, keeping the composable a thin render layer (ADR-002).
//
// The web source is a NAVIGATION-GUARD WRAPPER, not a data-fetching view: `GuardedLink` /
// `GuardedNavLink` are drop-in replacements for react-router's `<Link>` / `<NavLink>` that run the
// caller's `onClick`, bail out for modifier / middle clicks and `target="_blank"` (so opening in a new
// tab still works), and otherwise `await confirmIfDirty()` before navigating — cancelling navigation
// when the user chooses "Keep editing". Its bound data sources are `useNavigate` (the navigation
// action, modelled here as a caller-supplied `navigate` lambda) and `useNavigationGuardContext` (the
// dirty-guard registry + confirm round-trip, modelled by the [NavigationGuard] seam in
// GuardedLinkSource.kt).
//
// Because the guard is an imperative interaction and NOT an async cache-then-network feed, the surface
// has no loading / empty / error / stale / offline lifecycle to render; modelling those would fabricate
// behaviour the web spec does not have (the same rationale the accepted VisuallyHidden / BulkActionsToolbar
// ports document). The surface's real states are reproduced instead: a clean navigation (no dirty
// guard), a guard-bypassing navigation (web modifier / middle-click / `target="_blank"`), a pending
// confirmation while a dirty guard blocks, the discard / keep-editing outcomes, and the in-flight
// de-dup that reuses a single confirmation across racing clicks. The web source renders no static copy
// of its own (its content is the caller-supplied `children`), so the surface carries no i18n keys — the
// confirmation chrome is supplied as already-localized data ([NavGuardChrome]) by the host, exactly as
// the BulkActionsToolbar port resolves its dialog strings at the render boundary (P1/S10).
//
// `InvalidPackageDeclaration` is suppressed because the mandated surface directory
// (com/teslasync/shared-surfaces/GuardedLink — the P3 prompt's allowed-files path) cannot form a valid
// Kotlin package (a hyphen segment and a PascalCase leaf are illegal in a package identifier), so the
// package intentionally diverges from the path — exactly as the sibling surfaces do.
// `MatchingDeclarationName` is suppressed for the co-located supporting declarations.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import io.teslasync.shared.core.diagnostics.Logger
import java.util.UUID

/**
 * Canonical registry metadata for the GuardedLink surface. The diagnostics [SLUG] is emitted with the
 * one-shot `view.opened` event (P1/S11) and is the surface slug the prompt mandates (`GuardedLink`); the
 * test tags name the nodes the on-device UI test drives.
 */
object GuardedLinkRegistration {
    /** Stable surface id, also the `viewModel` key prefix the composable binds each placement with. */
    const val ID: String = "guarded-link"

    /** Diagnostics surface slug emitted with the `view.opened` / navigate events (P1/S11). */
    const val SLUG: String = "GuardedLink"

    /** Test tag for the clickable link node. */
    const val ROOT_TEST_TAG: String = "guarded-link"

    /** Test tag for the hosted confirmation dialog (web `NavigationGuardProvider`'s `ConfirmDialog`). */
    const val CONFIRM_DIALOG_TEST_TAG: String = "guarded-link-confirm"
}

/**
 * One registered "form is dirty" guard — the native analogue of the web `NavigationGuardEntry` created
 * by `useNavigationGuard`. [isDirty] reports whether the consumer has unsaved edits; [getMessage]
 * returns the caller-localized prompt body shown when THIS guard blocks navigation (web `getMessage`),
 * or `null` to fall back to the host's generic [NavGuardChrome.fallbackMessage].
 *
 * @property id stable per-mount id (web `useId()`); registering the same id twice replaces the entry.
 */
data class NavigationGuardEntry(
    val id: String,
    val isDirty: () -> Boolean,
    val getMessage: () -> String? = { null },
)

/**
 * The already-localized confirmation chrome the host overlays on a pending prompt — the native analogue
 * of the strings the web `NavigationGuardProvider` resolves from i18n (`forms.unsavedTitle`,
 * `forms.unsavedWarning`, `forms.discard`, `forms.keepEditing`). The surface itself hardcodes none of
 * these; the host resolves them through the P1/S10 catalog and hands them in as data, exactly as the
 * BulkActionsToolbar port does for its dialog.
 *
 * @property title the dialog title (web `forms.unsavedTitle`).
 * @property fallbackMessage the body shown when the blocking guard supplies no message (web
 *   `forms.unsavedWarning`).
 * @property discardLabel the confirm-button label that discards edits and navigates (web `forms.discard`).
 * @property keepEditingLabel the cancel-button label that keeps editing (web `forms.keepEditing`).
 */
data class NavGuardChrome(
    val title: String,
    val fallbackMessage: String,
    val discardLabel: String,
    val keepEditingLabel: String,
)

/**
 * The pending confirmation the [NavigationGuard] seam publishes while a dirty guard blocks navigation —
 * the native analogue of the web provider's `pending` state. It carries only the blocking guard's
 * optional [message] (web `pending.message`); the host overlays its [NavGuardChrome] to render the full
 * dialog, so the seam never needs to know the localized chrome.
 */
data class NavGuardPrompt(
    val message: String?,
)

/**
 * The render state of a single GuardedLink placement. [isConfirming] is true while this link's
 * `confirmIfDirty` round-trip is in flight (the dialog is open); the render boundary dims the link and
 * suppresses re-taps so a second click cannot stack a second navigation (web's in-flight de-dup).
 */
data class GuardedLinkUiState(
    val isConfirming: Boolean = false,
)

/**
 * The synchronous navigation decision for a tap, derived purely from the inputs so it is unit-tested
 * off-device. Mirrors the web `onClick` branch order: a guard bypass (modifier / middle click /
 * `target="_blank"`) or a clean tree navigates now; a tap while a confirmation is already open is
 * ignored (web reuses the in-flight promise); a dirty tree awaits the confirmation dialog.
 */
enum class NavigationPlan {
    /** Navigate immediately — either [planNavigation] saw a bypass or no guard is dirty. */
    NavigateNow,

    /** A dirty guard blocks; open the confirmation and await the user's choice. */
    AwaitConfirmation,

    /** A confirmation is already in flight for this link; drop the duplicate tap. */
    Ignore,
}

/**
 * The resolved outcome of an attempted navigation, emitted (PII-free) as a diagnostics field so a
 * navigation can be observed without ever recording a destination route or any user content.
 */
enum class NavigationOutcome {
    /** Navigated without consulting the guard (web modifier / middle-click / `target="_blank"`). */
    Bypassed,

    /** The guard permitted navigation — clean tree, or the user chose "Discard changes". */
    Allowed,

    /** The user chose "Keep editing"; navigation was cancelled. */
    Blocked,

    /** A duplicate tap was dropped because a confirmation was already in flight. */
    Deferred,
}

/**
 * The first registered guard reporting dirty, or `null` when none is — the native analogue of the web
 * provider's `findDirty()`. Iteration order is the registration order (a [LinkedHashMap] in the seam),
 * so the message of the earliest-registered dirty form wins, matching the web `for…of` scan.
 */
fun firstDirtyEntry(entries: Collection<NavigationGuardEntry>): NavigationGuardEntry? = entries.firstOrNull { it.isDirty() }

/**
 * Plans a tap from its inputs — the native analogue of the web `onClick` guard branch. [bypassGuard]
 * skips the guard entirely (web `shouldSkipGuard`); a still-open confirmation drops the duplicate;
 * otherwise a dirty tree awaits confirmation and a clean tree navigates now.
 */
fun planNavigation(
    bypassGuard: Boolean,
    alreadyConfirming: Boolean,
    hasDirtyGuard: Boolean,
): NavigationPlan =
    when {
        bypassGuard -> NavigationPlan.NavigateNow
        alreadyConfirming -> NavigationPlan.Ignore
        hasDirtyGuard -> NavigationPlan.AwaitConfirmation
        else -> NavigationPlan.NavigateNow
    }

/**
 * The body the host renders for a [prompt]: the blocking guard's own message when it is non-blank,
 * else the chrome's generic fallback — the native analogue of the web `pending?.message ??
 * t('forms.unsavedWarning')`.
 */
fun resolvePromptMessage(
    prompt: NavGuardPrompt,
    chrome: NavGuardChrome,
): String = prompt.message?.takeIf { it.isNotBlank() } ?: chrome.fallbackMessage

/** A fresh, stable per-placement id so each mounted GuardedLink binds its own keyed state holder. */
fun randomLinkInstanceId(): String = UUID.randomUUID().toString()

/** The stable, dot-namespaced diagnostics event emitted once when a link placement opens (P1/S11). */
const val EVENT_VIEW_OPENED: String = "view.opened"

/** The diagnostics event emitted (PII-free) whenever a link resolves a navigation attempt. */
const val EVENT_NAVIGATE: String = "guardedLink.navigate"

/** The structured-field key carrying the surface slug on every diagnostic. */
const val FIELD_SURFACE: String = "surface"

/** The structured-field key carrying the navigation outcome (never a destination route). */
const val FIELD_OUTCOME: String = "outcome"

/**
 * Emits the one PII-safe `view.opened` diagnostic carrying only the surface
 * [GuardedLinkRegistration.SLUG] (P1/S11). Kept free of Compose so it is unit-tested with a recording
 * [Logger]; the state holder calls it once per placement open.
 */
fun recordGuardedLinkOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to GuardedLinkRegistration.SLUG))
}

/**
 * Emits the PII-safe navigation diagnostic carrying only the surface slug and the resolved [outcome] —
 * never a destination route, query, or any user content, so a diagnostics line can never leak where a
 * user was going.
 */
fun recordGuardedLinkNavigation(
    logger: Logger,
    outcome: NavigationOutcome,
) {
    logger.info(
        EVENT_NAVIGATE,
        mapOf(FIELD_SURFACE to GuardedLinkRegistration.SLUG, FIELD_OUTCOME to outcome.name.lowercase()),
    )
}
