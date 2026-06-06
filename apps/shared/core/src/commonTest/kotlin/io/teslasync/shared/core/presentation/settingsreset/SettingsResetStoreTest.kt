package io.teslasync.shared.core.presentation.settingsreset

import io.teslasync.shared.core.data.repo.SettingsResetRepository
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SettingsResetStore] routes each mutation to the right S7 repository call and
 * reproduces the web hooks' `setQueryData(settingsResetKeys.lastReset, …)` caching exactly — both
 * `resetSection` and `resetAll` prime the SAME [SettingsResetStore.lastReset] key — using a fake
 * repository so no network (and no cache) is involved. The invalidate-all flush is the repository's
 * responsibility and is asserted in the contract test, not here.
 */
class SettingsResetStoreTest {
    /**
     * Fake S7 port: records each call's argument, returns a deterministic success keyed by the call,
     * and can be flipped to fail so the on-success cache write can be proven NOT to fire on failure.
     */
    private class FakeSettingsResetRepository : SettingsResetRepository {
        val sectionCalls: MutableList<String> = mutableListOf()
        var resetAllCalls: Int = 0
        var fail: Boolean = false

        override suspend fun resetSection(section: String): Result<SettingsResetResult> {
            sectionCalls += section
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(
                SettingsResetResult(
                    reset = 3,
                    sections = listOf(SettingsResetSectionResult(section = section, reset = 3)),
                ),
            )
        }

        override suspend fun resetAll(): Result<SettingsResetResult> {
            resetAllCalls += 1
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(
                SettingsResetResult(
                    reset = 12,
                    sections =
                        listOf(
                            SettingsResetSectionResult(section = "settings", reset = 5),
                            SettingsResetSectionResult(section = "alert_rules", reset = 7),
                        ),
                ),
            )
        }
    }

    private fun store(repo: SettingsResetRepository = FakeSettingsResetRepository()): SettingsResetStore = SettingsResetStore(repo)

    @Test
    fun lastResetStartsNull() {
        assertNull(store().lastReset.value)
    }

    @Test
    fun resetSectionDelegatesAndCachesLastReset() =
        runTest {
            val repo = FakeSettingsResetRepository()
            val s = store(repo)

            val result = s.resetSection("alert_rules")

            assertTrue(result.isSuccess)
            assertEquals(listOf("alert_rules"), repo.sectionCalls)
            // setQueryData(lastReset, result): the receipt is now observable.
            assertEquals(result.getOrThrow(), s.lastReset.value)
            assertEquals(3, s.lastReset.value?.reset)
            assertEquals(
                "alert_rules",
                s.lastReset.value
                    ?.sections
                    ?.single()
                    ?.section,
            )
        }

    @Test
    fun resetAllDelegatesAndCachesLastReset() =
        runTest {
            val repo = FakeSettingsResetRepository()
            val s = store(repo)

            val result = s.resetAll()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.resetAllCalls)
            assertEquals(result.getOrThrow(), s.lastReset.value)
            assertEquals(12, s.lastReset.value?.reset)
            assertEquals(
                2,
                s.lastReset.value
                    ?.sections
                    ?.size,
            )
        }

    @Test
    fun resetAllAfterResetSectionOverwritesLastReset() =
        runTest {
            val s = store()

            s.resetSection("settings")
            assertEquals(3, s.lastReset.value?.reset)
            s.resetAll()

            // Both hooks write `lastReset`; the global reset receipt supersedes the section one.
            assertEquals(12, s.lastReset.value?.reset)
        }

    @Test
    fun failedMutationsDoNotPrimeLastReset() =
        runTest {
            val repo = FakeSettingsResetRepository().apply { fail = true }
            val s = store(repo)

            assertTrue(s.resetSection("settings").isFailure)
            assertTrue(s.resetAll().isFailure)

            // onSuccess never ran: the last-reset state stays null.
            assertNull(s.lastReset.value)
        }
}
