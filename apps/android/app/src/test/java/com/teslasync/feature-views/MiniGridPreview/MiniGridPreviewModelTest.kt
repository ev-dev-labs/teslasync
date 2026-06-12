// Off-device unit coverage for the MiniGridPreview feature view's pure model (P3 acceptance: adapter +
// per-state + a11y-relevant projection tests). Exercises the web thumbnail's geometry derivations — the
// `safeMaxY` row-count guard (empty fallback + zero-guard), the `cols / safeMaxY` aspect ratio, and the
// per-widget fractional placement rectangles (the web absolute `left/top/width/height` percentages) including the
// `find`-first widget→icon resolution and the no-match (empty box) miss — plus the web-parity `contentState`
// (empty layout stays Content, never promoted to the empty STATE), the lifecycle classifier the composable switches
// on (per-state coverage incl. offline/stale), and the PII-safe `view.opened` diagnostic. No Compose / Android /
// HTTP — runs in :android:testReleaseUnitTest.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.featureviews.minigridpreview

import io.teslasync.android.data.ErrorKind
import io.teslasync.android.data.UiPhase
import io.teslasync.android.data.UiState
import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MiniGridPreviewModelTest {
    private val sampleDashboard =
        MiniGridDashboard(
            widgets =
                listOf(
                    MiniGridWidget(id = "w-1", widgetId = "vehicle-hero"),
                    MiniGridWidget(id = "w-2", widgetId = "battery-gauge"),
                    MiniGridWidget(id = "w-3", widgetId = "range-bar"),
                    MiniGridWidget(id = "w-4", widgetId = "fleet-stats"),
                ),
            lgLayout =
                listOf(
                    MiniGridLayoutItem("w-1", x = 0, y = 0, w = 2, h = 2),
                    MiniGridLayoutItem("w-2", x = 2, y = 0, w = 1, h = 2),
                    MiniGridLayoutItem("w-3", x = 3, y = 0, w = 1, h = 1),
                    MiniGridLayoutItem("w-4", x = 0, y = 2, w = 2, h = 1),
                ),
        )

    private fun cell(
        result: MiniGridPreviewProjectionResult,
        key: String,
    ): MiniGridCell = result.cells.first { it.key == key }

    // ── Row-count guard (web `maxY` / `safeMaxY`) ────────────────────────────────

    @Test
    fun maxRowIsTheTallestStackedItem() {
        // max(0+2, 0+2, 0+1, 2+1) == 3.
        assertEquals(3, MiniGridPreviewProjection.maxRow(sampleDashboard.lgLayout))
    }

    @Test
    fun emptyLayoutFallsBackToDefaultRows() {
        assertEquals(MINI_GRID_DEFAULT_ROWS, MiniGridPreviewProjection.maxRow(emptyList()))
        assertEquals(MINI_GRID_DEFAULT_ROWS, MiniGridPreviewProjection.safeRows(emptyList()))
        assertEquals(2, MINI_GRID_DEFAULT_ROWS)
    }

    @Test
    fun nonPositiveMaxRowIsGuardedBackToDefault() {
        // A degenerate item with zero height yields maxY == 0; the web `maxY > 0` guard restores the default.
        val degenerate = listOf(MiniGridLayoutItem("w-1", x = 0, y = 0, w = 1, h = 0))
        assertEquals(0, MiniGridPreviewProjection.maxRow(degenerate))
        assertEquals(MINI_GRID_DEFAULT_ROWS, MiniGridPreviewProjection.safeRows(degenerate))
    }

    @Test
    fun safeRowsKeepsAPositiveMax() {
        assertEquals(3, MiniGridPreviewProjection.safeRows(sampleDashboard.lgLayout))
    }

    // ── Aspect ratio (web `${cols} / ${safeMaxY}`) ───────────────────────────────

    @Test
    fun aspectRatioIsColumnsOverRows() {
        assertEquals(MINI_GRID_COLUMNS.toFloat() / 2, MiniGridPreviewProjection.aspectRatio(2), DELTA)
        assertEquals(1f, MiniGridPreviewProjection.aspectRatio(MINI_GRID_COLUMNS), DELTA)
        // Guards a zero row count (never divides by zero).
        assertEquals(MINI_GRID_COLUMNS.toFloat(), MiniGridPreviewProjection.aspectRatio(0), DELTA)
    }

    @Test
    fun projectionAspectRatioMatchesTheGuardedRows() {
        val result = MiniGridPreviewProjection.project(sampleDashboard)
        assertEquals(4, result.columns)
        assertEquals(3, result.rows)
        assertEquals(4f / 3f, result.aspectRatio, DELTA)
    }

    // ── Fractional placement (web absolute `left/top/width/height` percentages) ───

    @Test
    fun projectsEachCellToItsFractionalRectangle() {
        val result = MiniGridPreviewProjection.project(sampleDashboard)
        assertEquals(4, result.cells.size)

        val heroCell = cell(result, "w-1")
        assertEquals(0f, heroCell.leftFraction, DELTA)
        assertEquals(0f, heroCell.topFraction, DELTA)
        assertEquals(0.5f, heroCell.widthFraction, DELTA) // 2 / 4 columns
        assertEquals(2f / 3f, heroCell.heightFraction, DELTA) // 2 / 3 rows

        val rangeCell = cell(result, "w-3")
        assertEquals(0.75f, rangeCell.leftFraction, DELTA) // x 3 / 4 columns
        assertEquals(0f, rangeCell.topFraction, DELTA)
        assertEquals(0.25f, rangeCell.widthFraction, DELTA)
        assertEquals(1f / 3f, rangeCell.heightFraction, DELTA)

        val bottomCell = cell(result, "w-4")
        assertEquals(0f, bottomCell.leftFraction, DELTA)
        assertEquals(2f / 3f, bottomCell.topFraction, DELTA) // y 2 / 3 rows
        assertEquals(0.5f, bottomCell.widthFraction, DELTA)
        assertEquals(1f / 3f, bottomCell.heightFraction, DELTA)
    }

    @Test
    fun resolvesWidgetIdForEachLayoutItem() {
        val result = MiniGridPreviewProjection.project(sampleDashboard)
        assertEquals("vehicle-hero", cell(result, "w-1").widgetId)
        assertEquals("fleet-stats", cell(result, "w-4").widgetId)
    }

    @Test
    fun layoutItemWithNoMatchingWidgetResolvesToNullIcon() {
        // The web `find` miss → `def` null → an empty box (no icon).
        val orphanLayout =
            MiniGridDashboard(
                widgets = listOf(MiniGridWidget(id = "real", widgetId = "vehicle-hero")),
                lgLayout = listOf(MiniGridLayoutItem("ghost", x = 0, y = 0, w = 1, h = 1)),
            )
        val result = MiniGridPreviewProjection.project(orphanLayout)
        assertNull(cell(result, "ghost").widgetId)
    }

    @Test
    fun widgetResolutionUsesFirstMatchLikeTheWebFind() {
        // Two instances share an id (pathological); the web `find` returns the first — so must the projection.
        val duplicated =
            MiniGridDashboard(
                widgets =
                    listOf(
                        MiniGridWidget(id = "dup", widgetId = "first-def"),
                        MiniGridWidget(id = "dup", widgetId = "second-def"),
                    ),
                lgLayout = listOf(MiniGridLayoutItem("dup", x = 0, y = 0, w = 1, h = 1)),
            )
        val result = MiniGridPreviewProjection.project(duplicated)
        assertEquals("first-def", cell(result, "dup").widgetId)
    }

    @Test
    fun emptyLayoutProjectsToAnEmptyFrame() {
        val result = MiniGridPreviewProjection.project(MiniGridDashboard())
        assertTrue(result.isEmpty)
        assertTrue(result.cells.isEmpty())
        assertEquals(MINI_GRID_DEFAULT_ROWS, result.rows)
        assertEquals(MINI_GRID_COLUMNS.toFloat() / MINI_GRID_DEFAULT_ROWS, result.aspectRatio, DELTA)
    }

    @Test
    fun populatedLayoutIsNotFlaggedEmpty() {
        assertFalse(MiniGridPreviewProjection.project(sampleDashboard).isEmpty)
    }

    // ── Web-parity content state (empty layout stays Content, not the empty STATE) ─

    @Test
    fun contentStateIsAlwaysContentEvenForAnEmptyLayout() {
        assertEquals(UiPhase.Content, MiniGridPreviewProjection.contentState(sampleDashboard).phase)
        val emptyLayoutState = MiniGridPreviewProjection.contentState(MiniGridDashboard())
        assertEquals(UiPhase.Content, emptyLayoutState.phase)
        assertEquals(MiniGridDashboard(), emptyLayoutState.data)
    }

    // ── Lifecycle classifier (per-state) ─────────────────────────────────────────

    @Test
    fun surfaceCoversEveryUiStatePhase() {
        assertEquals(MiniGridPreviewSurface.Loading, miniGridPreviewSurface(UiState.loading()))
        assertEquals(
            MiniGridPreviewSurface.Error,
            miniGridPreviewSurface(UiState(UiPhase.Error, errorKind = ErrorKind.Network)),
        )
        assertEquals(MiniGridPreviewSurface.Empty, miniGridPreviewSurface(UiState(UiPhase.Empty)))
        assertEquals(
            MiniGridPreviewSurface.Content,
            miniGridPreviewSurface(UiState(UiPhase.Content, data = sampleDashboard)),
        )
    }

    @Test
    fun offlineCachedStateStaysContentAndIsFlaggedStale() {
        val offline =
            UiState(
                phase = UiPhase.Content,
                data = sampleDashboard,
                stale = true,
                fetchedAt = 1_700_000_000_000L,
                errorKind = ErrorKind.Network,
            )
        assertEquals(MiniGridPreviewSurface.Content, miniGridPreviewSurface(offline))
        assertTrue(offline.isOffline)
        assertTrue(offline.canRetry)
    }

    // ── Diagnostics (P1/S11 `view.opened`) ───────────────────────────────────────

    @Test
    fun recordOpenedEmitsPiiSafeViewOpenedWithSurfaceSlug() {
        val logger = RecordingLogger()
        recordMiniGridPreviewOpened(logger)
        assertEquals(1, logger.records.size)
        val record = logger.records.single()
        assertEquals(LogLevel.Info, record.level)
        assertEquals("view.opened", record.event)
        assertEquals(mapOf("surface" to "MiniGridPreview"), record.fields)
        assertEquals("MiniGridPreview", MiniGridPreviewRegistration.SLUG)
    }

    /** A recording [Logger] capturing emitted records for the diagnostics assertion. */
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

    private companion object {
        const val DELTA: Float = 1e-6f
    }
}
