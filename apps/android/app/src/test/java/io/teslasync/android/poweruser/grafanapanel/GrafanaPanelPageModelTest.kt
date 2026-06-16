package io.teslasync.android.poweruser.grafanapanel

import io.teslasync.android.data.NoopLogger
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaDatasourceRef
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelDraft
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelEnvelope
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelGridPos
import io.teslasync.android.sharedsurfaces.ainlgrafanapanel.GrafanaPanelTarget
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Off-device coverage of the GrafanaPanelPage model + view-model — the pure derivations the composable renders:
 * the verbatim curated catalogs and their name sort (web `sortedPanelTypes` / `sortedDatasourceTypes` /
 * `sortedTables`), the apply-to-editor JSON projection (web `JSON.stringify(draft.panel, null, 2)`), and the
 * local editor state machine (type → persist, clear, apply, copy status) the [GrafanaPanelPageViewModel] drives
 * over the [GrafanaDraftStore] persistence seam (web localStorage `'ai.grafanaPanel.draft'`).
 */
class GrafanaPanelPageModelTest {
    private class FakeDraftStore(
        initial: String = "",
    ) : GrafanaDraftStore {
        var stored: String = initial
        override fun load(): String = stored

        override fun save(value: String) {
            stored = value
        }
    }

    private fun envelope(
        targets: List<GrafanaPanelTarget> = listOf(GrafanaPanelTarget(refId = "A", rawSql = "SELECT 1")),
    ): GrafanaPanelEnvelope =
        GrafanaPanelEnvelope(
            title = "Drives per day",
            type = "timeseries",
            datasource = GrafanaDatasourceRef(type = "postgres", uid = "tesla-postgres"),
            targets = targets,
            gridPos = GrafanaPanelGridPos(x = 0, y = 0, w = 12, h = 8),
        )

    private fun viewModel(store: GrafanaDraftStore = FakeDraftStore()): GrafanaPanelPageViewModel =
        GrafanaPanelPageViewModel(draftStore = store, logger = NoopLogger)

    // ── curated catalogs ──────────────────────────────────────────────────────────

    @Test
    fun catalogSizesMatchWeb() {
        assertEquals(8, CURATED_PANEL_TYPES.size)
        assertEquals(2, CURATED_DATASOURCE_TYPES.size)
        assertEquals(5, CURATED_TABLES.size)
    }

    @Test
    fun panelTypesSortedByName() {
        assertEquals(CURATED_PANEL_TYPES.map { it.name }.sorted(), SORTED_PANEL_TYPES.map { it.name })
        assertEquals("barchart", SORTED_PANEL_TYPES.first().name)
    }

    @Test
    fun datasourceTypesSortedByName() {
        assertEquals(listOf("postgres", "prometheus"), SORTED_DATASOURCE_TYPES.map { it.name })
    }

    @Test
    fun tablesSortedByNameAndColumnsKeepDeclaredOrder() {
        assertEquals(
            listOf("alerts", "charging_sessions", "drives", "signal_log_view", "vehicles"),
            SORTED_TABLES.map { it.name },
        )
        val drives = SORTED_TABLES.first { it.name == "drives" }
        assertEquals("id", drives.columns.first().name)
        assertEquals("max_speed_mps", drives.columns.last().name)
    }

    // ── apply-to-editor JSON projection ───────────────────────────────────────────

    @Test
    fun prettyPrintEmitsWireKeysAndRoundTrips() {
        val json = prettyPrintPanelEnvelope(envelope())
        assertTrue(json.contains("\"grid_pos\""))
        assertTrue(json.contains("\"ref_id\""))
        assertTrue(json.contains("\"raw_sql\""))

        val obj = Json.parseToJsonElement(json).jsonObject
        assertEquals("Drives per day", obj["title"]!!.jsonPrimitive.content)
        assertEquals("timeseries", obj["type"]!!.jsonPrimitive.content)
        assertEquals("postgres", obj["datasource"]!!.jsonObject["type"]!!.jsonPrimitive.content)
        assertEquals("tesla-postgres", obj["datasource"]!!.jsonObject["uid"]!!.jsonPrimitive.content)
        val grid = obj["grid_pos"]!!.jsonObject
        assertEquals(12, grid["w"]!!.jsonPrimitive.int)
        assertEquals(8, grid["h"]!!.jsonPrimitive.int)
        val target = obj["targets"]!!.jsonArray.single().jsonObject
        assertEquals("A", target["ref_id"]!!.jsonPrimitive.content)
        assertEquals("SELECT 1", target["raw_sql"]!!.jsonPrimitive.content)
    }

    @Test
    fun prettyPrintOmitsAbsentOptionalTargetFields() {
        val json = prettyPrintPanelEnvelope(envelope(targets = listOf(GrafanaPanelTarget(refId = "A"))))
        val target = Json.parseToJsonElement(json).jsonObject["targets"]!!.jsonArray.single().jsonObject
        assertEquals("A", target["ref_id"]!!.jsonPrimitive.content)
        assertNull(target["raw_sql"])
        assertNull(target["expr"])
        assertNull(target["format"])
    }

    // ── ui state ──────────────────────────────────────────────────────────────────

    @Test
    fun canCopyReflectsTrimmedContent() {
        assertFalse(GrafanaPanelUiState(panelJson = "   ").canCopy)
        assertTrue(GrafanaPanelUiState(panelJson = "{}").canCopy)
    }

    // ── view-model ────────────────────────────────────────────────────────────────

    @Test
    fun initialStateLoadsPersistedDraft() {
        val vm = viewModel(FakeDraftStore(initial = "{\"type\":\"stat\"}"))
        assertEquals("{\"type\":\"stat\"}", vm.state.value.panelJson)
    }

    @Test
    fun setPanelJsonUpdatesAndPersists() {
        val store = FakeDraftStore()
        val vm = viewModel(store)
        vm.setPanelJson("{\"type\":\"gauge\"}")
        assertEquals("{\"type\":\"gauge\"}", vm.state.value.panelJson)
        assertEquals("{\"type\":\"gauge\"}", store.stored)
    }

    @Test
    fun clearEmptiesEditorAndRemovesPersistedEntry() {
        val store = FakeDraftStore(initial = "{\"type\":\"table\"}")
        val vm = viewModel(store)
        vm.reportCopyStatus(GrafanaCopyStatus.Success)
        vm.clear()
        assertEquals("", vm.state.value.panelJson)
        assertNull(vm.state.value.status)
        assertEquals("", store.stored)
    }

    @Test
    fun applyAiDraftRendersPrettyJsonAndClearsStatus() {
        val store = FakeDraftStore()
        val vm = viewModel(store)
        vm.reportCopyStatus(GrafanaCopyStatus.Empty)
        vm.applyAiDraft(
            GrafanaPanelDraft(prompt = "p", panel = envelope(), rationale = "r", referencedTables = listOf("drives")),
        )
        assertNull(vm.state.value.status)
        assertTrue(vm.state.value.panelJson.contains("\"title\": \"Drives per day\""))
        assertEquals(vm.state.value.panelJson, store.stored)
    }

    @Test
    fun reportCopyStatusSurfacesOutcome() {
        val vm = viewModel()
        vm.reportCopyStatus(GrafanaCopyStatus.Failed)
        assertEquals(GrafanaCopyStatus.Failed, vm.state.value.status)
    }
}
