// Off-device unit tests for the in-process edit-lease coordinator ([EditLeaseRegistry]) — the adapter the
// surface binds through (the native `useEditLease` analogue, web/src/hooks/useEditLease.ts). They drive the
// registry with a deterministic clock + id generator and assert each holder's synchronous [EditLease.current]
// across the full lifecycle: a lone holder self-grants (owner → no banner); a second holder yields as an
// observer and sees the conflict; "Take over" moves ownership so the previous owner now sees the banner; and
// releasing the owner promotes a surviving holder so the banner clears. Runs in :android:testReleaseUnitTest.
package io.teslasync.android.sharedsurfaces.editconflictbanner

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EditConflictBannerRegistryTest {
    private val key = "settings/general"

    /** A registry with a fixed clock + deterministic ids; claim stamps still advance via the `highest + 1` rule. */
    private fun registry(): EditLeaseRegistry {
        val ids = ArrayDeque(listOf("a", "b", "c"))
        return EditLeaseRegistry(now = { FIXED_CLOCK }, nextHolderId = { ids.removeFirst() })
    }

    @Test
    fun aLoneHolderSelfGrantsAndShowsNoBanner() {
        val a = registry().acquire(key)
        val snap = a.current()
        assertTrue("the only holder owns the lease", snap.isOwner)
        assertNull(snap.otherTab)
        assertEquals(EditConflictPhase.Hidden, EditConflictProjection.project(snap).phase)
    }

    @Test
    fun aSecondHolderYieldsAndSeesTheConflictWhileTheOwnerKeepsTheLease() {
        val reg = registry()
        val a = reg.acquire(key)
        val b = reg.acquire(key)

        // The original holder keeps ownership (web: a new tab does not claim on mount).
        assertTrue(a.current().isOwner)
        assertEquals(EditConflictPhase.Hidden, EditConflictProjection.project(a.current()).phase)

        // The new holder yields and renders the conflict banner pointing at the owner.
        val bSnap = b.current()
        assertFalse(bSnap.isOwner)
        assertEquals("a", bSnap.otherTab?.tabId)
        assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(bSnap).phase)
    }

    @Test
    fun takeOverMovesTheBannerToThePreviousOwnerInLockstep() {
        val reg = registry()
        val a = reg.acquire(key)
        val b = reg.acquire(key)

        b.claim()

        // Ownership flips to b; the previous owner a now renders the banner pointing at b (web lockstep).
        assertTrue(b.current().isOwner)
        val aSnap = a.current()
        assertFalse(aSnap.isOwner)
        assertEquals("b", aSnap.otherTab?.tabId)
        assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(aSnap).phase)
    }

    @Test
    fun releasingTheOwnerPromotesASurvivorAndClearsItsBanner() {
        val reg = registry()
        val a = reg.acquire(key)
        val b = reg.acquire(key)
        // b is in conflict while a owns.
        assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(b.current()).phase)

        a.release()

        // The surviving holder b is promoted to owner; its banner disappears (web re-election).
        val bSnap = b.current()
        assertTrue(bSnap.isOwner)
        assertNull(bSnap.otherTab)
        assertEquals(EditConflictPhase.Hidden, EditConflictProjection.project(bSnap).phase)
    }

    @Test
    fun reclaimAfterTheNewOwnerLeavesRestoresTheOriginalOwner() {
        val reg = registry()
        val a = reg.acquire(key)
        val b = reg.acquire(key)
        b.claim() // b owns, a sees the banner.
        assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(a.current()).phase)

        b.release()

        // a still holds its original claim, so it re-owns the lease and its banner clears (no re-grant needed).
        assertTrue(a.current().isOwner)
        assertEquals(EditConflictPhase.Hidden, EditConflictProjection.project(a.current()).phase)
    }

    @Test
    fun distinctResourceKeysRaceIndependently() {
        val reg = registry()
        val a = reg.acquire("automation/42")
        val b = reg.acquire("alert-rules/list")
        // Different keys never see each other — both are sole owners of their own lease.
        assertTrue(a.current().isOwner)
        assertTrue(b.current().isOwner)
    }

    @Test
    fun theProcessSingletonIsAReusableSource() {
        // The default source the composable binds is the shared process registry, itself an EditLeaseSource.
        val source: EditLeaseSource = EditLeaseRegistry.process
        val lease = source.acquire("process-smoke/${System.nanoTime()}")
        assertTrue(lease.current().isOwner)
        lease.release()
    }

    private companion object {
        const val FIXED_CLOCK = 1_000L
    }
}
