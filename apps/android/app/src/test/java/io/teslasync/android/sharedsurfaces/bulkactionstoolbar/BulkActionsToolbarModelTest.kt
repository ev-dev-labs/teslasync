// Off-device unit tests for the pure BulkActionsToolbar model: the selection classifier (the web
// `count === 0 ? null : toolbar` split, covering hidden / visible / negative), the per-action pending reducer
// (web `pending` map), the count-noun rule (web `count === 1 ? one : other`), the intent → confirm-severity
// mapping (web `variant === 'danger' ? 'danger' : 'warning'`), the per-action busy accessibility label, the
// i18n key inventory (every web `t(key)` this surface makes), the diagnostics slug, and the PII-safe
// `view.opened` diagnostic. Run by the offline :android:testReleaseUnitTest gate — no Compose, no Android, no
// coroutines.

package io.teslasync.android.sharedsurfaces.bulkactionstoolbar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BulkActionsToolbarModelTest {
    // ── Selection classifier (web count === 0 ? null : toolbar) ─────────────────────────────────────────────────
    @Test
    fun classifyHidesWhenNothingSelected() {
        assertEquals(ToolbarSurface.Hidden, classifyToolbar(selectedCount = 0, total = null))
        assertEquals(ToolbarSurface.Hidden, classifyToolbar(selectedCount = -1, total = 27))
    }

    @Test
    fun classifyShowsCountAndTotalWhenSelected() {
        assertEquals(ToolbarSurface.Visible(count = 3, total = 27), classifyToolbar(selectedCount = 3, total = 27))
        assertEquals(ToolbarSurface.Visible(count = 1, total = null), classifyToolbar(selectedCount = 1, total = null))
    }

    // ── Pending reducer (web pending map) ───────────────────────────────────────────────────────────────────────
    @Test
    fun pendingReducerAddsAndRemovesById() {
        val started = BulkActionsUiState().startPending("delete")
        assertTrue(started.isPending("delete"))
        assertFalse(started.isPending("export"))

        val cleared = started.endPending("delete")
        assertFalse(cleared.isPending("delete"))
    }

    @Test
    fun pendingReducerIsIdempotentPerId() {
        val twice = BulkActionsUiState().startPending("delete").startPending("delete")
        assertEquals(setOf("delete"), twice.pending)
    }

    // ── Count noun (web count === 1 ? one : other) ──────────────────────────────────────────────────────────────
    @Test
    fun itemNounFollowsTheOneOtherRule() {
        val noun = BulkItemNoun(one = "drive", other = "drives")
        assertEquals("drive", noun.forCount(1))
        assertEquals("drives", noun.forCount(2))
        assertEquals("drives", noun.forCount(0))
    }

    // ── Intent → confirm severity (web variant === 'danger' ? 'danger' : 'warning') ─────────────────────────────
    @Test
    fun confirmSeverityMapsIntent() {
        assertEquals(BulkConfirmSeverity.Danger, confirmSeverityFor(BulkActionIntent.Danger))
        assertEquals(BulkConfirmSeverity.Warning, confirmSeverityFor(BulkActionIntent.Default))
    }

    // ── Accessibility (per-action busy label) ───────────────────────────────────────────────────────────────────
    @Test
    fun actionContentDescriptionAppendsBusyLabelOnlyWhenBusy() {
        assertEquals("Delete", actionContentDescription(label = "Delete", busy = false, busyLabel = "Loading"))
        assertEquals("Delete, Loading", actionContentDescription(label = "Delete", busy = true, busyLabel = "Loading"))
    }

    // ── i18n inventory (every web t(key) this surface makes) ────────────────────────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(5, BulkActionsToolbarKeys.ALL.size)
        assertEquals(BulkActionsToolbarKeys.ALL.size, BulkActionsToolbarKeys.ALL.toSet().size)
        assertTrue(BulkActionsToolbarKeys.ALL.all { it.startsWith("bulk.") })
        assertTrue(
            BulkActionsToolbarKeys.ALL.containsAll(
                listOf(
                    BulkActionsToolbarKeys.TOOLBAR_LABEL,
                    BulkActionsToolbarKeys.CLEAR,
                    BulkActionsToolbarKeys.SELECTED,
                    BulkActionsToolbarKeys.OF_TOTAL,
                    BulkActionsToolbarKeys.ITEM_DEFAULT,
                ),
            ),
        )
    }

    // ── Telemetry (P1/S11) ──────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("BulkActionsToolbar", BULK_ACTIONS_TOOLBAR_SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSlugOnly() {
        val logger = RecordingLogger()
        recordBulkActionsToolbarViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("slug" to "BulkActionsToolbar"), opened.second)
    }
}
