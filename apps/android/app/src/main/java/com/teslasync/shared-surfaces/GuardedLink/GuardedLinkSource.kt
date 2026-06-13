// The navigation-guard interaction seam the GuardedLink shared surface binds to, plus its process-wide
// production instance — the native port of the web `useNavigationGuardContext`
// (web/src/components/feedback/NavigationGuardProvider.tsx), which exposes `register` + `confirmIfDirty`.
// The view (composable) performs NO work of its own; it only drives this seam through the state holder,
// satisfying the "data flows through the shared state holder" contract (P1/S8, ADR-002).
//
// The web provider is a module-mounted React context: a `Map<id, GuardEntry>` of dirty-state callbacks,
// a `findDirty()` scan, and a `confirmIfDirty()` that resolves `true` immediately when nothing is dirty
// else opens a `ConfirmDialog` and resolves to the user's choice — de-duplicating a confirmation that is
// already in flight (the popstate-vs-click race) by handing back the same promise. This seam mirrors
// that 1:1: [register] tracks entries, [hasDirtyGuard] is `findDirty() != null`, [confirmIfDirty]
// publishes a [NavGuardPrompt] and suspends on a `CompletableDeferred` until [respond] settles it,
// reusing a single in-flight decision across racing callers. The dialog UI itself is the host's
// concern (web: the provider renders it), so this seam stays UI-free and fully unit-testable, exactly
// as the BulkActionsToolbar `BulkConfirmer` does.
//
// The guard is confined to the main dispatcher (Compose interactions + the holder's main-bound scope),
// so the entry map + the single in-flight deferred need no locking — the same single-threaded contract
// the web module relies on and the established `DialogBulkConfirmer` documents.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/GuardedLink) cannot form a valid Kotlin package.
// `ktlint:standard:filename` / `MatchingDeclarationName` are suppressed for the port interface plus its
// co-located production state holder.
@file:Suppress("ktlint:standard:filename", "MatchingDeclarationName", "InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.guardedlink

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The single seam the GuardedLink state holder depends on so it binds to an abstraction (the real
 * process guard ↔ a throwaway test instance), never to a concrete dialog or Android UI — the Android
 * analogue of the web `useNavigationGuardContext` (the P1/S8 boundary for this surface).
 *
 * [register] adds a dirty-state callback and returns its un-register handle (web `register` → cleanup);
 * [hasDirtyGuard] reports whether any registered guard is currently dirty (web `findDirty`);
 * [confirmIfDirty] resolves `true` at once when nothing is dirty, else publishes a [confirmRequest] and
 * suspends until the user [respond]s (web `confirmIfDirty`'s promise); [confirmRequest] is the pending
 * prompt the host renders as a dialog (web `pending`). No HTTP, and no UI, touches this seam.
 */
interface NavigationGuard {
    /** The pending confirmation to render, or `null` when none is open (web provider `pending`). */
    val confirmRequest: StateFlow<NavGuardPrompt?>

    /** Registers [entry] and returns its un-register handle — call it from a disposal effect. */
    fun register(entry: NavigationGuardEntry): () -> Unit

    /** Whether any registered guard currently reports dirty (web `findDirty() != null`). */
    fun hasDirtyGuard(): Boolean

    /**
     * Resolves `true` immediately when no guard is dirty; otherwise opens a confirmation and suspends
     * until the user responds, returning `true` to discard + navigate and `false` to keep editing —
     * web `await confirmIfDirty()`. A call made while a confirmation is already in flight awaits that
     * same decision instead of stacking a second dialog (web `pendingPromiseRef`).
     */
    suspend fun confirmIfDirty(): Boolean

    /** Settles the open confirmation with the user's choice ([discard] = discard + navigate). */
    fun respond(discard: Boolean)
}

/**
 * The production [NavigationGuard]: a small, self-contained state holder backing the web provider's
 * dirty registry + confirm round-trip. [register] tracks entries in registration order; [confirmIfDirty]
 * publishes the blocking guard's message to [confirmRequest] and awaits a [CompletableDeferred] the host
 * completes through [respond], so the suspending call resolves exactly when the user acts. A second
 * [confirmIfDirty] while one is open awaits the same deferred (web's in-flight reuse). Main-confined, so
 * the entry map and the single deferred need no synchronization.
 */
class DefaultNavigationGuard : NavigationGuard {
    private val entries = LinkedHashMap<String, NavigationGuardEntry>()
    private val requestState = MutableStateFlow<NavGuardPrompt?>(null)
    private var awaiting: CompletableDeferred<Boolean>? = null

    override val confirmRequest: StateFlow<NavGuardPrompt?> = requestState.asStateFlow()

    override fun register(entry: NavigationGuardEntry): () -> Unit {
        entries[entry.id] = entry
        return { entries.remove(entry.id) }
    }

    override fun hasDirtyGuard(): Boolean = firstDirtyEntry(entries.values) != null

    override suspend fun confirmIfDirty(): Boolean {
        val inFlight = awaiting
        return if (inFlight != null) inFlight.await() else awaitFreshDecision()
    }

    private suspend fun awaitFreshDecision(): Boolean {
        val dirty = firstDirtyEntry(entries.values)
        return if (dirty == null) true else suspendForResponse(dirty)
    }

    private suspend fun suspendForResponse(dirty: NavigationGuardEntry): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        awaiting = deferred
        requestState.value = NavGuardPrompt(dirty.getMessage())
        return deferred.await()
    }

    override fun respond(discard: Boolean) {
        requestState.value = null
        val pending = awaiting
        awaiting = null
        pending?.complete(discard)
    }
}

/**
 * The process-wide guard singleton — the native analogue of the web module-mounted
 * `NavigationGuardProvider` every `GuardedLink` shares. A host mounts one `NavigationGuardHost` over this
 * instance and any number of links consult it; a test constructs a throwaway [DefaultNavigationGuard] so
 * the singleton is never polluted across cases.
 */
val ProcessNavigationGuard: NavigationGuard = DefaultNavigationGuard()
