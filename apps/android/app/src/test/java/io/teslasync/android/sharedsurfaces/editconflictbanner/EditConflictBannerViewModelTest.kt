// Tests [EditConflictBannerViewModel] against the edit-lease seam — the contract the view depends on: this
// holder's [EditLeaseSnapshot] is re-shared onto a lifecycle-aware flow, the initial value is the holder's
// current state (never an artificial banner), "Take over" forwards to the lease, and the one-shot
// `view.opened` fires exactly once with the surface slug (never a resourceKey or peer id). It also binds the
// real in-process [EditLeaseRegistry] end to end to prove two in-app holders coordinate through the P1/S8
// layer. The framework-free election + projection are covered by EditConflictBannerModelTest /
// EditConflictBannerRegistryTest. Runs in :android:testReleaseUnitTest.
@file:OptIn(ExperimentalCoroutinesApi::class)

package io.teslasync.android.sharedsurfaces.editconflictbanner

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EditConflictBannerViewModelTest {
    private class RecordingLogger : Logger {
        val records = mutableListOf<LogRecord>()

        override fun log(
            level: LogLevel,
            event: String,
            fields: Map<String, String>,
        ) {
            records += LogRecord(level, event, fields)
        }
    }

    private class FakeLease(
        initial: EditLeaseSnapshot,
    ) : EditLease {
        val flow = MutableStateFlow(initial)
        var claims = 0
        var releases = 0

        override val state: Flow<EditLeaseSnapshot> get() = flow

        override fun current(): EditLeaseSnapshot = flow.value

        override fun claim() {
            claims++
        }

        override fun release() {
            releases++
        }
    }

    private val owner = EditLeaseSnapshot(isOwner = true, otherTab = null)
    private val conflict = EditLeaseSnapshot(isOwner = false, otherTab = OtherHolder("peer-tab-aaa", 100L))

    @Test
    fun snapshotSeedsAsTheHoldersCurrentStateBeforeAnyCollection() =
        runTest(UnconfinedTestDispatcher()) {
            val model = EditConflictBannerViewModel(EditLeaseSource { FakeLease(owner) }, "k", RecordingLogger(), backgroundScope)
            // No collector yet → the lifecycle-aware StateFlow exposes the holder's current (owner → hidden) seed.
            assertTrue(model.snapshot.value.isOwner)
        }

    @Test
    fun snapshotReflectsAConflictEmission() =
        runTest(UnconfinedTestDispatcher()) {
            val lease = FakeLease(owner)
            val model = EditConflictBannerViewModel(EditLeaseSource { lease }, "k", RecordingLogger(), backgroundScope)
            backgroundScope.launch { model.snapshot.collect {} }
            advanceUntilIdle()

            lease.flow.value = conflict
            advanceUntilIdle()

            val snap = model.snapshot.value
            assertFalse(snap.isOwner)
            assertEquals("peer-tab-aaa", snap.otherTab?.tabId)
            assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(snap).phase)
        }

    @Test
    fun claimForwardsToTheLease() =
        runTest(UnconfinedTestDispatcher()) {
            val lease = FakeLease(conflict)
            val model = EditConflictBannerViewModel(EditLeaseSource { lease }, "k", RecordingLogger(), backgroundScope)

            model.claim()

            assertEquals(1, lease.claims)
        }

    @Test
    fun viewOpenedEmitsDiagnosticOnceWithSlug() =
        runTest(UnconfinedTestDispatcher()) {
            val logger = RecordingLogger()
            val model = EditConflictBannerViewModel(EditLeaseSource { FakeLease(owner) }, "k", logger, backgroundScope)

            model.onViewOpened()
            model.onViewOpened()

            val opened = logger.records.filter { it.event == "view.opened" }
            assertEquals(1, opened.size)
            assertEquals("EditConflictBanner", opened.first().fields["surface"])
            assertEquals(setOf("surface"), opened.first().fields.keys)
        }

    @Test
    fun twoHoldersCoordinateThroughTheRealRegistry() =
        runTest(UnconfinedTestDispatcher()) {
            val ids = ArrayDeque(listOf("a", "b"))
            val registry = EditLeaseRegistry(now = { 1_000L }, nextHolderId = { ids.removeFirst() })
            val vmA = EditConflictBannerViewModel(registry, "settings/general", RecordingLogger(), backgroundScope)
            val vmB = EditConflictBannerViewModel(registry, "settings/general", RecordingLogger(), backgroundScope)
            backgroundScope.launch { vmA.snapshot.collect {} }
            backgroundScope.launch { vmB.snapshot.collect {} }
            advanceUntilIdle()

            // The first holder owns the lease; the second sees the conflict.
            assertTrue(vmA.snapshot.value.isOwner)
            assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(vmB.snapshot.value).phase)

            vmB.claim()
            advanceUntilIdle()

            // Ownership flips; the banner moves to the previous owner in lockstep.
            assertTrue(vmB.snapshot.value.isOwner)
            assertEquals(EditConflictPhase.Conflict, EditConflictProjection.project(vmA.snapshot.value).phase)
        }
}
