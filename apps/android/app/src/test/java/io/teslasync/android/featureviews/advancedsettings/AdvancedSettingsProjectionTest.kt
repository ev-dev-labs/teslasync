package io.teslasync.android.featureviews.advancedsettings

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.toUiState
import io.teslasync.shared.core.data.repo.Resource
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device verification of the Advanced Settings surface's pure logic — the native analogue of the web
 * panel's `listSilenced()` canonicalisation, its `useSilenceKeyLabel` key→label mapping, and the
 * `silenced.map(...)` row build (web/src/features/settings/components/AdvancedSettings.tsx,
 * web/src/lib/confirmSilence.ts): the dedupe + sort rule, the known/unknown label resolution, the row
 * projection, and the store-outcome → Resource → UiState folding. Runs in the :android:testReleaseUnitTest
 * gate.
 */
class AdvancedSettingsProjectionTest {
    // ── SilencedPrompts.of (web `[...new Set(load())].sort()`) ───────────────────────

    @Test
    fun ofDedupesSortsAndDropsBlanks() {
        val prompts = SilencedPrompts.of(listOf("unsaved-navigation", "discard-draft", "discard-draft", ""))
        assertEquals(listOf("discard-draft", "unsaved-navigation"), prompts.keys)
        assertEquals(2, prompts.size)
        assertFalse(prompts.isBlank)
    }

    @Test
    fun emptySentinelIsBlank() {
        assertTrue(SilencedPrompts.EMPTY.isBlank)
        assertEquals(0, SilencedPrompts.EMPTY.size)
        assertTrue(SilencedPrompts.of(emptyList()).isBlank)
    }

    // ── labelFor (web `useSilenceKeyLabel`) ──────────────────────────────────────────

    @Test
    fun labelForResolvesKnownKeysAndFallsBackToRawKey() {
        val strings =
            AdvancedSettingsStrings(
                discardDraftLabel = "Discard unsaved draft",
                unsavedNavigationLabel = "Leave page with unsaved changes",
            )
        assertEquals("Discard unsaved draft", strings.labelFor(ConfirmSilenceKeys.DISCARD_DRAFT))
        assertEquals("Leave page with unsaved changes", strings.labelFor(ConfirmSilenceKeys.UNSAVED_NAVIGATION))
        // Forward-compat: an unknown id renders verbatim (web `default: return key`).
        assertEquals("remove-widget", strings.labelFor("remove-widget"))
    }

    // ── project (web `silenced.length > 0` guard + `silenced.map(...)` rows) ──────────

    @Test
    fun projectBuildsLabelResolvedRowsInSortedOrder() {
        val prompts = SilencedPrompts.of(listOf("unsaved-navigation", "remove-widget", "discard-draft"))
        val display = AdvancedSettingsProjection.project(prompts, STRINGS)
        assertTrue(display.hasPrompts)
        assertEquals(
            listOf("discard-draft", "remove-widget", "unsaved-navigation"),
            display.rows.map { it.key },
        )
        assertEquals(
            listOf("Discard unsaved draft", "remove-widget", "Leave page with unsaved changes"),
            display.rows.map { it.label },
        )
    }

    @Test
    fun projectOfEmptyHasNoPromptsAndNoRows() {
        val display = AdvancedSettingsProjection.project(SilencedPrompts.EMPTY, STRINGS)
        assertFalse(display.hasPrompts)
        assertTrue(display.rows.isEmpty())
    }

    // ── data adapter (store outcome → Resource → UiState) ────────────────────────────

    @Test
    fun successFoldsIntoFreshContentUiState() {
        val prompts = SilencedPrompts.of(listOf("discard-draft"))
        val ui =
            silencedResource(Result.success(prompts), cached = null, cachedFetchedAt = null, nowMs = 100L)
                .toUiState { it.isBlank }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(prompts, ui.data)
        assertFalse(ui.stale)
    }

    @Test
    fun successWithEmptyFoldsIntoEmptyUiState() {
        val ui =
            silencedResource(Result.success(SilencedPrompts.EMPTY), cached = null, cachedFetchedAt = null, nowMs = 100L)
                .toUiState { it.isBlank }
        assertEquals(UiPhase.Empty, ui.phase)
        assertTrue(ui.data?.isBlank == true)
    }

    @Test
    fun failureWithNoCacheFoldsIntoHardError() {
        val resource =
            silencedResource(
                Result.failure(IllegalStateException("prefs unavailable")),
                cached = null,
                cachedFetchedAt = null,
                nowMs = 100L,
            )
        assertTrue(resource is Resource.Error)
        assertNull((resource as Resource.Error).cached)

        val ui = resource.toUiState { it.isBlank }
        assertEquals(UiPhase.Error, ui.phase)
        assertEquals(ErrorKind.Unknown, ui.errorKind)
        assertTrue(ui.canRetry)
        assertFalse(ui.hasData)
    }

    @Test
    fun failureWithCacheKeepsLastKnownListStaleWithRetry() {
        val prior = SilencedPrompts.of(listOf("discard-draft"))
        val resource =
            silencedResource(
                Result.failure(IllegalStateException("prefs unavailable")),
                cached = prior,
                cachedFetchedAt = 50L,
                nowMs = 100L,
            )
        assertTrue(resource is Resource.Error)
        assertEquals(prior, (resource as Resource.Error).cached)
        assertEquals(50L, resource.fetchedAt)
        assertTrue(resource.stale)

        val ui = resource.toUiState { it.isBlank }
        assertEquals(UiPhase.Content, ui.phase)
        assertEquals(prior, ui.data)
        assertTrue(ui.stale)
        assertTrue(ui.isOffline)
        assertTrue(ui.canRetry)
    }

    private companion object {
        val STRINGS =
            AdvancedSettingsStrings(
                discardDraftLabel = "Discard unsaved draft",
                unsavedNavigationLabel = "Leave page with unsaved changes",
            )
    }
}
