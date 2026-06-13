// Pure, framework-free model + coordinator + diagnostics for the NavigationGuardProvider shared surface — the
// native analogue of every decision the web source makes before any UI is involved
// (web/src/components/feedback/NavigationGuardProvider.tsx). No Compose, no Android, no HTTP: every declaration
// here is exercised off-device by the :android:testReleaseUnitTest gate, keeping the composable layer
// (NavigationGuardProvider.kt) a thin binding.
//
// What the web source actually is (and therefore the COMPLETE behaviour this surface reproduces): an in-app
// unsaved-changes GUARD, not a data-fetching view. It owns a `Map<id, NavigationGuardEntry>` of "form is dirty"
// callbacks ([NavigationGuardRegistry]), exposes `register` + `confirmIfDirty` as a React context value
// ([NavigationGuardController]), intercepts browser back/forward (popstate) when any guard is dirty, and resolves
// an awaited promise from the user's choice in a `<ConfirmDialog>` (discard = navigate / keep editing = stay).
// The single in-flight guard the web keeps in `pendingPromiseRef` (so a popstate dialog and a click intercept
// answer through ONE dialog instead of stacking) is reproduced here in [NavigationGuardCoordinator].
//
// Why the generic data-surface states (loading / empty / error / stale / offline) are intentionally absent: this
// surface fetches nothing. Inventing a network lifecycle would add behaviour the web spec does not have (Honesty
// Covenant: no scope narrowing, no silent drift) — exactly as the sibling ChartTimeRangeContext / ConfirmDialog
// surfaces document. Its real, fully-reproduced states are the ones the web source asserts and are modelled as
// [NavigationGuardSurface]: Idle (no dialog), and Confirming with either the dirty guard's own localized message
// or the generic fallback (resolved at the render boundary). The promise lifecycle (resolve-true on discard,
// resolve-false on keep-editing, single in-flight de-duplication) is the coordinator's coverage below.
//
// `MatchingDeclarationName` is suppressed for the co-located declarations; `InvalidPackageDeclaration` is
// suppressed because the mandated surface directory (com/teslasync/shared-surfaces/NavigationGuardProvider — the
// P3 prompt's allowed-files path) cannot form a valid Kotlin package (a hyphen and a PascalCase segment are
// illegal in a package identifier), so the package intentionally diverges from the path, exactly as the sibling
// shared surfaces do.
@file:Suppress("MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.navigationguardprovider

import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One registered "form is dirty" guard — the native port of the web `NavigationGuardEntry`. Created per
 * consuming form and added to the [NavigationGuardRegistry]; the provider reads [isDirty] / [getMessage] lazily
 * at navigation time (the web reads its refs at popstate / click time), so dirtiness is evaluated at the moment
 * the user tries to leave rather than pushed eagerly.
 *
 * @property id stable per-mount id (web `useId()` from the consumer); the registry key.
 * @property isDirty returns true when the consumer has unsaved edits (web `isDirty`).
 * @property getMessage optional caller-localized prompt shown when THIS guard blocks navigation; `null` falls
 *   back to the generic unsaved-changes warning at the render boundary (web `getMessage` / `forms.unsavedWarning`).
 */
data class NavigationGuardEntry(
    val id: String,
    val isDirty: () -> Boolean,
    val getMessage: () -> String? = { null },
)

/**
 * The keyed set of active "form is dirty" guards — the native port of the web provider's
 * `useRef<Map<string, NavigationGuardEntry>>`. Insertion order is preserved (a `LinkedHashMap`) so [findDirty]
 * returns the first-registered dirty guard, matching the web `for (const e of guards.current.values())` order.
 * A plain class (no Compose, no coroutines) so the membership + dirty-scan logic is unit-tested off-device.
 */
class NavigationGuardRegistry {
    private val entries = LinkedHashMap<String, NavigationGuardEntry>()

    /**
     * Registers [entry] (replacing any prior entry with the same id) and returns an unregister function — the
     * web `register` returning a cleanup. Call the returned function from a Compose `DisposableEffect` cleanup.
     */
    fun register(entry: NavigationGuardEntry): () -> Unit {
        entries[entry.id] = entry
        return { entries.remove(entry.id) }
    }

    /** The first registered guard currently reporting dirty, or `null` when none are — the web `findDirty`. */
    fun findDirty(): NavigationGuardEntry? = entries.values.firstOrNull { it.isDirty() }

    /** True when any registered guard is dirty — drives whether a back press needs confirmation. */
    val isAnyDirty: Boolean get() = findDirty() != null

    /** The number of currently-registered guards (test/observability helper). */
    val size: Int get() = entries.size
}

/**
 * The mutually-exclusive render state of the guard surface — the closed set the composable switches on so every
 * branch is exhaustively covered and unit-tested. Maps the web provider's `pending` state (`null` vs a
 * `PendingConfirm`) onto a sealed type.
 */
sealed interface NavigationGuardSurface {
    /** No confirmation in flight — the provider only wraps its children, no dialog (web `pending === null`). */
    data object Idle : NavigationGuardSurface

    /**
     * A confirmation dialog is shown for an attempted navigation away from a dirty form (web `pending != null`).
     *
     * @property message the blocking guard's own localized prompt, or `null` to use the generic unsaved-changes
     *   warning at the render boundary (web `pending?.message ?? t('forms.unsavedWarning')`).
     */
    data class Confirming(
        val message: String?,
    ) : NavigationGuardSurface
}

/**
 * The navigation-guard context value consumers read — the native port of the web `NavigationGuardContextValue`
 * (`{ register, confirmIfDirty }`). Exposed to the Compose tree through `LocalNavigationGuard` and read via
 * `useNavigationGuardContext()`. Deliberately narrow: confirm/cancel + the dialog state belong to the provider
 * that owns the [NavigationGuardCoordinator], not to arbitrary consumers.
 */
interface NavigationGuardController {
    /**
     * Registers a dirty-state callback; returns an unregister function (web `register`). Call the returned
     * function from a `DisposableEffect` cleanup.
     */
    fun register(entry: NavigationGuardEntry): () -> Unit

    /**
     * Resolves immediately to `true` when no guard is dirty; otherwise shows the confirm dialog and resolves to
     * the user's choice (`true` = discard / navigate, `false` = keep editing / cancel) — the native port of the
     * web `confirmIfDirty(): Promise<boolean>`. A confirm already in flight is reused (the same dialog answers
     * both call sites instead of stacking), mirroring the web `pendingPromiseRef`. Must be called on the main
     * thread, like the web's single-threaded provider.
     */
    suspend fun confirmIfDirty(): Boolean
}

/**
 * The no-op context used when no provider is mounted — the native port of the web `NOOP_CTX`. Lets consumers
 * (`useNavigationGuardContext`) and guarded-navigation helpers run inside isolated component tests / previews
 * without forcing the full provider tree: registration is a no-op and navigation is always allowed.
 */
object NoopNavigationGuardController : NavigationGuardController {
    /** No-op registration: returns a no-op unregister (web `NOOP_CTX.register`). */
    override fun register(entry: NavigationGuardEntry): () -> Unit = {}

    /** Always allows navigation (web `NOOP_CTX.confirmIfDirty` resolves `true`). */
    override suspend fun confirmIfDirty(): Boolean = true
}

/**
 * The provider-owned navigation-guard state holder — the framework-free heart of the surface, the native port of
 * the web provider's body (the guards map, the `pending` state, the `confirmIfDirty` promise, and the
 * `handleConfirm` / `handleCancel` resolvers). It owns no Compose and no Android, so the whole promise lifecycle
 * is unit-tested off-device with `runTest`. The composable in NavigationGuardProvider.kt only `remember`s one of
 * these, observes [surface] to draw the dialog, and forwards the user's choice to [confirm] / [cancel].
 *
 * @param registry the guard set; injectable so a test can pre-seed or inspect membership.
 */
class NavigationGuardCoordinator(
    private val registry: NavigationGuardRegistry = NavigationGuardRegistry(),
) : NavigationGuardController {
    private val mutableSurface = MutableStateFlow<NavigationGuardSurface>(NavigationGuardSurface.Idle)

    /** The live render state — [NavigationGuardSurface.Idle] or [NavigationGuardSurface.Confirming]. */
    val surface: StateFlow<NavigationGuardSurface> = mutableSurface.asStateFlow()

    // The single in-flight confirmation; mirrors the web `pendingPromiseRef` so two racing callers share one
    // dialog instead of stacking. Mutated only on the main thread (the web is single-threaded).
    private var pending: CompletableDeferred<Boolean>? = null

    /** True when any registered guard is dirty (web `findDirty() != null`); gates back interception. */
    val isAnyDirty: Boolean get() = registry.isAnyDirty

    override fun register(entry: NavigationGuardEntry): () -> Unit = registry.register(entry)

    override suspend fun confirmIfDirty(): Boolean = (pending ?: startConfirm()).await()

    // Opens a fresh confirmation when a guard is dirty (publishing the Confirming surface), or returns an
    // already-completed `true` when nothing is dirty so navigation proceeds without a dialog (web
    // `if (!dirty) return Promise.resolve(true)`). Only the dirty path stores `pending` for de-duplication.
    private fun startConfirm(): CompletableDeferred<Boolean> {
        val dirty = registry.findDirty() ?: return CompletableDeferred(true)
        val deferred = CompletableDeferred<Boolean>()
        pending = deferred
        mutableSurface.value = NavigationGuardSurface.Confirming(dirty.getMessage())
        return deferred
    }

    /** Resolves the in-flight confirmation as discard/navigate (web `handleConfirm` → `resolve(true)`). */
    fun confirm() = resolve(true)

    /** Resolves the in-flight confirmation as keep-editing/cancel (web `handleCancel` → `resolve(false)`). */
    fun cancel() = resolve(false)

    // Clears the dialog and completes the awaited confirmation; a no-op when nothing is pending (idempotent, so
    // a stray confirm/cancel after the dialog already closed cannot throw or re-resolve).
    private fun resolve(answer: Boolean) {
        val deferred = pending
        pending = null
        mutableSurface.value = NavigationGuardSurface.Idle
        deferred?.complete(answer)
    }
}

/**
 * The stable "Don't ask again" action id passed to the reused [ConfirmDialog] — the native port of the web
 * `silenceKey="unsaved-navigation"`. A storage identifier (not user-facing copy), so it carries no i18n key; it
 * scopes the silence preference to the unsaved-navigation prompt alone.
 */
const val UNSAVED_NAVIGATION_SILENCE_KEY: String = "unsaved-navigation"

/**
 * PII-safe registration for this surface (P1/S11). [SLUG] is the prompt-mandated surface slug emitted with the
 * one-shot `view.opened` diagnostic; [ID] is its stable kebab-case identifier. Only the slug is ever logged —
 * never a guard id, a form's dirty state, nor a prompt message — so a diagnostics line can never leak what the
 * user was editing or where they were navigating.
 */
object NavigationGuardProviderRegistration {
    /** Stable kebab-case surface id. */
    const val ID: String = "navigation-guard-provider"

    /** Diagnostics surface slug emitted with `view.opened` (the prompt-mandated slug). */
    const val SLUG: String = "NavigationGuardProvider"
}

private const val EVENT_VIEW_OPENED = "view.opened"
private const val FIELD_SURFACE = "surface"

/**
 * Emits the one-shot PII-safe `view.opened` diagnostic for this surface (P1/S11). Carries only the surface slug,
 * so the diagnostic can never leak a guard id, a form's dirty state, or a prompt message. Call from the
 * provider's first-composition effect.
 */
fun recordNavigationGuardProviderOpened(logger: Logger) {
    logger.info(EVENT_VIEW_OPENED, mapOf(FIELD_SURFACE to NavigationGuardProviderRegistration.SLUG))
}
