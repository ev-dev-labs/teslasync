package io.teslasync.shared.core.presentation.settingsbackup

import io.teslasync.shared.core.cache.FakeClock
import io.teslasync.shared.core.data.repo.SettingsBackupRepository
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Verifies the S8 [SettingsBackupStore] routes each mutation to the right S7 repository call and
 * reproduces the web hooks' `setQueryData` caching exactly — export primes [SettingsBackupStore.lastExport],
 * both import paths prime [SettingsBackupStore.lastImport] — plus the two client-side derivations,
 * using a fake repository so no network is involved.
 */
class SettingsBackupStoreTest {
    /**
     * Fake S7 port: records each call's argument, returns a deterministic success keyed by the call,
     * and can be flipped to fail so the on-success cache write can be proven NOT to fire on failure.
     */
    private class FakeSettingsBackupRepository : SettingsBackupRepository {
        var exportCalls: Int = 0
        val dryRunBundles: MutableList<SettingsBundle> = mutableListOf()
        val applyBundles: MutableList<SettingsBundle> = mutableListOf()
        var fail: Boolean = false

        override suspend fun exportSettings(): Result<SettingsBundle> {
            exportCalls += 1
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(bundle(exportCalls))
        }

        override suspend fun dryRunImport(bundle: SettingsBundle): Result<SettingsImportResult> {
            dryRunBundles += bundle
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(result(dryRun = true, added = 3))
        }

        override suspend fun applyImport(bundle: SettingsBundle): Result<SettingsImportResult> {
            applyBundles += bundle
            if (fail) return Result.failure(IllegalStateException("boom"))
            return Result.success(result(dryRun = false, added = 5))
        }

        companion object {
            fun bundle(version: Int): SettingsBundle =
                SettingsBundle(
                    schemaVersion = version,
                    exportedAt = "2026-01-01T00:00:00Z",
                    sections =
                        SettingsBundleSections(
                            settings = JsonObject(mapOf("theme" to JsonPrimitive("dark"))),
                            alertRules = JsonArray(listOf(JsonPrimitive("rule-1"))),
                        ),
                )

            fun result(
                dryRun: Boolean,
                added: Int,
            ): SettingsImportResult =
                SettingsImportResult(
                    dryRun = dryRun,
                    sections = mapOf("settings" to SettingsImportSectionResult(added = added, updated = 1, skipped = 2)),
                )
        }
    }

    private fun store(repo: SettingsBackupRepository = FakeSettingsBackupRepository()): SettingsBackupStore =
        SettingsBackupStore(repo, FakeClock(now = 0L))

    @Test
    fun lastResultStateStartsNull() {
        val s = store()
        assertNull(s.lastExport.value)
        assertNull(s.lastImport.value)
    }

    @Test
    fun exportDelegatesAndCachesLastExport() =
        runTest {
            val repo = FakeSettingsBackupRepository()
            val s = store(repo)

            val result = s.exportSettings()

            assertTrue(result.isSuccess)
            assertEquals(1, repo.exportCalls)
            // setQueryData(lastExport, bundle): the returned bundle is now observable.
            assertEquals(result.getOrThrow(), s.lastExport.value)
            assertEquals(1, s.lastExport.value?.schemaVersion)
            // Import state is untouched by an export.
            assertNull(s.lastImport.value)
        }

    @Test
    fun dryRunDelegatesAndCachesLastImport() =
        runTest {
            val repo = FakeSettingsBackupRepository()
            val s = store(repo)
            val bundle = FakeSettingsBackupRepository.bundle(1)

            val result = s.dryRunImport(bundle)

            assertTrue(result.isSuccess)
            assertEquals(listOf(bundle), repo.dryRunBundles)
            // setQueryData(lastImport, result): dry-run primes the SAME key apply does.
            assertEquals(result.getOrThrow(), s.lastImport.value)
            assertTrue(s.lastImport.value?.dryRun == true)
            assertNull(s.lastExport.value)
        }

    @Test
    fun applyDelegatesAndCachesLastImport() =
        runTest {
            val repo = FakeSettingsBackupRepository()
            val s = store(repo)
            val bundle = FakeSettingsBackupRepository.bundle(1)

            val result = s.applyImport(bundle)

            assertTrue(result.isSuccess)
            assertEquals(listOf(bundle), repo.applyBundles)
            assertEquals(result.getOrThrow(), s.lastImport.value)
            assertTrue(s.lastImport.value?.dryRun == false)
        }

    @Test
    fun applyAfterDryRunOverwritesLastImport() =
        runTest {
            val s = store()
            val bundle = FakeSettingsBackupRepository.bundle(1)

            s.dryRunImport(bundle)
            assertTrue(s.lastImport.value?.dryRun == true)
            s.applyImport(bundle)

            // Both hooks write `lastImport`; the apply result supersedes the preview.
            assertTrue(s.lastImport.value?.dryRun == false)
        }

    @Test
    fun failedMutationsDoNotPrimeCache() =
        runTest {
            val repo = FakeSettingsBackupRepository().apply { fail = true }
            val s = store(repo)
            val bundle = FakeSettingsBackupRepository.bundle(1)

            assertTrue(s.exportSettings().isFailure)
            assertTrue(s.dryRunImport(bundle).isFailure)
            assertTrue(s.applyImport(bundle).isFailure)

            // onSuccess never ran: the last-result state stays null.
            assertNull(s.lastExport.value)
            assertNull(s.lastImport.value)
        }

    @Test
    fun defaultExportFilenameUsesInjectedClockUtcDate() {
        // 2026-06-05T11:13:58Z → epoch ms 1780658038000.
        val s = SettingsBackupStore(FakeSettingsBackupRepository(), FakeClock(now = 1_780_658_038_000L))
        assertEquals("teslasync-settings-20260605.json", s.defaultExportFilename())
    }

    @Test
    fun summariseFoldsSectionsTotalsExcludingSkipped() {
        val s = store()
        val result =
            SettingsImportResult(
                dryRun = true,
                sections =
                    mapOf(
                        "settings" to SettingsImportSectionResult(added = 2, updated = 1, skipped = 4),
                        "alert_rules" to SettingsImportSectionResult(added = 3, updated = 0, skipped = 1),
                    ),
            )

        val summary = s.summarise(result)

        assertEquals(5, summary.added)
        assertEquals(1, summary.updated)
        assertEquals(5, summary.skipped)
        // total = added + updated (skipped excluded), mirroring the web helper.
        assertEquals(6, summary.total)
    }
}
