// The in-process edit-lease coordinator the EditConflictBanner surface binds to — the native analogue of the
// web `useEditLease` hook + its module-level `leases` registry (web/src/hooks/useEditLease.ts). The view
// (composable) performs NO HTTP and opens no stream: it only collects this holder's lease state through the
// [EditLeaseSource] seam, which the ViewModel drives (ADR-002, the P1/S8 boundary). The web hook coordinates
// "I am editing X" across browser tabs of the same origin over a BroadcastChannel bus; its faithful Android
// counterpart is a same-process registry that coordinates multiple in-app holders of the same `resourceKey`
// (the real multi-window / multi-instance scenario where the same resource is open in two places and a save
// in one would clobber the other). It is NOT cross-process and NOT server-coordinated — same scope as the
// web's same-origin handshake.
//
// The election protocol is reproduced verbatim where it is observable: a holder that joins while a peer
// already owns the lease yields as a pure observer (web "a new tab does not claim on mount"); a lone holder
// self-grants; "Take over" bumps the claim past the current owner so the previous owner yields in lockstep
// (web `performClaim` → `now()+1`); releasing the owner promotes a surviving holder (web's release →
// re-election). The owner-resolution arithmetic + tiebreaker live in the framework-free [EditLeaseElection]
// (EditConflictBannerModel.kt) so the whole contract is unit-tested off-device.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory
// (com/teslasync/shared-surfaces/EditConflictBanner) cannot form a valid Kotlin package.
// `MatchingDeclarationName` is suppressed: the mandated `EditConflictBanner*` filename cannot match the
// `EditLeaseSource` seam name.
@file:Suppress("InvalidPackageDeclaration", "MatchingDeclarationName")

package io.teslasync.android.sharedsurfaces.editconflictbanner

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import java.util.concurrent.atomic.AtomicLong

/**
 * A single live edit-lease holder — the native analogue of one `useEditLease(resourceKey)` subscription. The
 * view binds exactly one of these (through the ViewModel) for the lifetime of the surface; the holder joins
 * the election on [EditLeaseSource.acquire] and leaves it on [release] (web acquire / `lease.released`).
 */
interface EditLease {
    /** This holder's live lease state (web `{ isOwner, otherTab }`), re-emitted on every roster change. */
    val state: Flow<EditLeaseSnapshot>

    /** The holder's current lease state, read synchronously for the flow's cold-start seed. */
    fun current(): EditLeaseSnapshot

    /** Forcibly take over the lease for this holder (web "Take over editing" → `claim()`). */
    fun claim()

    /** Leave the election, promoting a surviving holder if this one owned the lease (web `release`). */
    fun release()
}

/**
 * The single seam the ViewModel depends on so it binds to an abstraction (real registry ↔ test fake), never a
 * concrete coordinator — the Android counterpart of the web `useEditLease` import. [acquire] joins the
 * election for a `resourceKey` and returns this holder's live [EditLease]. No HTTP touches the view.
 */
fun interface EditLeaseSource {
    /** Join the edit-lease election for [resourceKey], returning this holder's live lease handle. */
    fun acquire(resourceKey: String): EditLease
}

/**
 * Process-wide, same-origin edit-lease registry — the native port of the web module-level `leases` map plus
 * its BroadcastChannel bus (web/src/hooks/useEditLease.ts). Multiple in-app holders of the same `resourceKey`
 * share one [Group] and observe each other; different keys are independent. All mutations are serialized under
 * a single monitor so the roster a holder observes is always internally consistent.
 *
 * @param now wall-clock source for claim stamps; injectable so the election arithmetic is deterministic in
 *   tests (production uses `System.currentTimeMillis`).
 * @param nextHolderId opaque holder-id generator (web `TAB_ID`); injectable for deterministic tests.
 */
class EditLeaseRegistry(
    private val now: () -> Long = { System.currentTimeMillis() },
    private val nextHolderId: () -> String = { defaultHolderId() },
) : EditLeaseSource {
    private val lock = Any()
    private val groups = mutableMapOf<String, Group>()

    /** One holder's mutable election record. `claimedAt == null` means "joined but never claimed" (observer). */
    private class MutableHolder(
        val id: String,
        var claimedAt: Long?,
    )

    /** The shared election state for one `resourceKey`: the live holder roster as an observable snapshot. */
    private class Group {
        val holders = mutableListOf<MutableHolder>()
        val roster = MutableStateFlow<List<HolderInput>>(emptyList())
    }

    override fun acquire(resourceKey: String): EditLease {
        val holderId = nextHolderId()
        val group =
            synchronized(lock) {
                val g = groups.getOrPut(resourceKey) { Group() }
                g.holders += MutableHolder(holderId, null)
                ensureOwner(g)
                publish(g)
                g
            }
        return RegistryLease(resourceKey, holderId, group)
    }

    private fun claim(
        resourceKey: String,
        holderId: String,
    ) = synchronized(lock) {
        val group = groups[resourceKey] ?: return@synchronized
        val holder = group.holders.firstOrNull { it.id == holderId } ?: return@synchronized
        holder.claimedAt = nextClaimStamp(group)
        publish(group)
    }

    private fun release(
        resourceKey: String,
        holderId: String,
    ) = synchronized(lock) {
        val group = groups[resourceKey] ?: return@synchronized
        group.holders.removeAll { it.id == holderId }
        if (group.holders.isEmpty()) {
            groups.remove(resourceKey)
        } else {
            ensureOwner(group)
            publish(group)
        }
    }

    /**
     * Guarantees the group has exactly one effective owner: when no holder has claimed (a fresh lone holder or
     * a group whose owner just released to a roster of observers), the lowest-id survivor self-grants — the
     * web "fresh election → the surviving tab promotes itself". A group that still has a claimer is left
     * untouched so the deterministic [EditLeaseElection.ownerOf] tiebreaker decides.
     */
    private fun ensureOwner(group: Group) {
        if (group.holders.any { it.claimedAt != null }) return
        group.holders.minByOrNull { it.id }?.let { it.claimedAt = nextClaimStamp(group) }
    }

    /** A claim stamp strictly newer than any current claim (web `now()+1`), robust to same-millisecond clocks. */
    private fun nextClaimStamp(group: Group): Long {
        val highest = group.holders.mapNotNull { it.claimedAt }.maxOrNull() ?: 0L
        return maxOf(now(), highest + 1)
    }

    /** Recompute the immutable, observable roster from the live holders so every holder's flow re-emits. */
    private fun publish(group: Group) {
        group.roster.value = group.holders.map { HolderInput(it.id, it.claimedAt) }
    }

    /** The live [EditLease] handed back to one holder; delegates claim/release to the registry under the lock. */
    private inner class RegistryLease(
        private val resourceKey: String,
        private val holderId: String,
        private val group: Group,
    ) : EditLease {
        override val state: Flow<EditLeaseSnapshot> =
            group.roster
                .map { EditLeaseElection.snapshotFor(holderId, it) }
                .distinctUntilChanged()

        override fun current(): EditLeaseSnapshot = EditLeaseElection.snapshotFor(holderId, group.roster.value)

        override fun claim() = claim(resourceKey, holderId)

        override fun release() = release(resourceKey, holderId)
    }

    companion object {
        /**
         * The process-wide shared registry every in-app holder coordinates through — the native singleton
         * analogue of the web module-level `leases` map. The composable binds it by default.
         */
        val process: EditLeaseRegistry = EditLeaseRegistry()

        private val holderSequence = AtomicLong(0L)

        /** An opaque, monotonically-unique holder id for the process (web `TAB_ID`). */
        private fun defaultHolderId(): String = "holder-" + holderSequence.incrementAndGet()
    }
}
