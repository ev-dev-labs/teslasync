// Off-device unit tests for the framework-free EditConflictBanner model: the lease-election arithmetic +
// tiebreaker ([EditLeaseElection]) and the render projection ([EditConflictProjection]). These mirror the web
// component's `if (isOwner || otherTab === null) return null` guard and the `useEditLease` owner resolution
// (web/src/hooks/useEditLease.ts), and run in the :android:testReleaseUnitTest gate.
package io.teslasync.android.sharedsurfaces.editconflictbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EditConflictBannerModelTest {
    // ── EditLeaseElection.ownerOf ───────────────────────────────────────────────────────────────────────

    @Test
    fun ownerIsTheNewestClaimer() {
        val holders = listOf(HolderInput("a", 100L), HolderInput("b", 200L))
        assertEquals("b", EditLeaseElection.ownerOf(holders)?.id)
    }

    @Test
    fun ownerTieBreaksToTheLowerId() {
        // Equal claim stamps → the lexicographically lower id wins (web `peer.tabId < mine`).
        val holders = listOf(HolderInput("b", 100L), HolderInput("a", 100L))
        assertEquals("a", EditLeaseElection.ownerOf(holders)?.id)
    }

    @Test
    fun observersWithoutAClaimAreNeverOwner() {
        // A holder that joined but never claimed (claimedAt == null) cannot be the owner; the sole claimer is.
        val holders = listOf(HolderInput("a", null), HolderInput("b", 50L))
        assertEquals("b", EditLeaseElection.ownerOf(holders)?.id)
    }

    @Test
    fun noClaimerYieldsNoOwner() {
        assertNull(EditLeaseElection.ownerOf(listOf(HolderInput("a", null), HolderInput("b", null))))
        assertNull(EditLeaseElection.ownerOf(emptyList()))
    }

    // ── EditLeaseElection.snapshotFor ───────────────────────────────────────────────────────────────────

    @Test
    fun snapshotForTheOwnerHasNoPeer() {
        val snap = EditLeaseElection.snapshotFor("a", listOf(HolderInput("a", 100L)))
        assertTrue(snap.isOwner)
        assertNull(snap.otherTab)
    }

    @Test
    fun snapshotForANonOwnerExposesTheOwnerAsPeer() {
        val snap = EditLeaseElection.snapshotFor("b", listOf(HolderInput("a", 100L), HolderInput("b", null)))
        assertFalse(snap.isOwner)
        assertEquals(OtherHolder("a", 100L), snap.otherTab)
    }

    @Test
    fun snapshotForAnEmptyRosterIsNeutral() {
        val snap = EditLeaseElection.snapshotFor("a", emptyList())
        assertEquals(EditLeaseSnapshot.none(), snap)
    }

    // ── EditConflictProjection.project ──────────────────────────────────────────────────────────────────

    @Test
    fun ownerRendersNothing() {
        val display = EditConflictProjection.project(EditLeaseSnapshot(isOwner = true, otherTab = null))
        assertEquals(EditConflictPhase.Hidden, display.phase)
        assertFalse(display.visible)
    }

    @Test
    fun noPeerObservedRendersNothing() {
        val display = EditConflictProjection.project(EditLeaseSnapshot(isOwner = false, otherTab = null))
        assertEquals(EditConflictPhase.Hidden, display.phase)
    }

    @Test
    fun peerHoldingTheLeaseRendersTheConflictBanner() {
        val display =
            EditConflictProjection.project(
                EditLeaseSnapshot(isOwner = false, otherTab = OtherHolder("peer-tab-aaa", 100L)),
            )
        assertEquals(EditConflictPhase.Conflict, display.phase)
        assertTrue(display.visible)
        assertEquals("peer-tab-aaa", display.otherTabId)
    }

    @Test
    fun ownerNeverShowsTheBannerEvenWithAPeerPresent() {
        // Defensive — brief during a take-over hand-off; the banner must never appear on the owning view
        // (web "renders nothing when isOwner is true even if otherTab is non-null").
        val display =
            EditConflictProjection.project(
                EditLeaseSnapshot(isOwner = true, otherTab = OtherHolder("peer", 1L)),
            )
        assertEquals(EditConflictPhase.Hidden, display.phase)
    }
}
