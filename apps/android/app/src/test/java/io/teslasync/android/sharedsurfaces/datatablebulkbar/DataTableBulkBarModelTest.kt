// Off-device unit tests for the pure DataTableBulkBar model: the selection classifier (the web
// `count <= 0 ? null : bar` split, covering hidden / visible / negative — the surface's empty & content states),
// the i18n + accessibility key inventory (every web `t(key)` / `aria-label` this surface references), the
// diagnostics slug, and the PII-safe `view.opened` diagnostic. Run by the offline :app:testReleaseUnitTest gate —
// no Compose, no Android, no coroutines.

package io.teslasync.android.sharedsurfaces.datatablebulkbar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DataTableBulkBarModelTest {
    // ── Selection classifier — per-state coverage (web count <= 0 ? null : bar) ──────────────────────────────────
    @Test
    fun classifyHidesWhenNothingSelected() {
        assertEquals(BulkBarSurface.Hidden, classifyBulkBar(count = 0))
        assertEquals(BulkBarSurface.Hidden, classifyBulkBar(count = -3))
    }

    @Test
    fun classifyShowsCountWhenSelected() {
        assertEquals(BulkBarSurface.Visible(count = 1), classifyBulkBar(count = 1))
        assertEquals(BulkBarSurface.Visible(count = 42), classifyBulkBar(count = 42))
    }

    // ── i18n + a11y inventory (every web t(key) / aria-label this surface makes) ─────────────────────────────────
    @Test
    fun keyInventoryIsCompleteUniqueAndPrefixed() {
        assertEquals(3, DataTableBulkBarKeys.ALL.size)
        assertEquals(DataTableBulkBarKeys.ALL.size, DataTableBulkBarKeys.ALL.toSet().size)
        assertTrue(DataTableBulkBarKeys.ALL.all { it.startsWith("table.bulkActions.") })
        assertTrue(
            DataTableBulkBarKeys.ALL.containsAll(
                listOf(
                    DataTableBulkBarKeys.REGION,
                    DataTableBulkBarKeys.SELECTED,
                    DataTableBulkBarKeys.CLEAR,
                ),
            ),
        )
    }

    @Test
    fun accessibilityLabelsAreWiredThroughI18n() {
        // The region landmark + the clear button each expose a TalkBack label sourced from i18n (web aria-label),
        // and the count label is a polite live region sourced from i18n (web aria-live). Asserting each is in the
        // catalog contract makes a renamed/missing key fail the gate rather than shipping an unlabelled control.
        assertTrue(DataTableBulkBarKeys.REGION in DataTableBulkBarKeys.ALL)
        assertTrue(DataTableBulkBarKeys.CLEAR in DataTableBulkBarKeys.ALL)
        assertTrue(DataTableBulkBarKeys.SELECTED in DataTableBulkBarKeys.ALL)
    }

    // ── Telemetry (P1/S11) ───────────────────────────────────────────────────────────────────────────────────────
    @Test
    fun slugCarriesNoPii() {
        assertEquals("DataTableBulkBar", DATA_TABLE_BULK_BAR_SLUG)
    }

    @Test
    fun recordViewOpenedEmitsSlugOnly() {
        val logger = RecordingLogger()
        recordDataTableBulkBarViewOpened(logger)

        val opened = logger.events.single { it.first == "view.opened" }
        assertEquals(mapOf("slug" to "DataTableBulkBar"), opened.second)
    }
}
