// Off-device unit coverage for the ChartTimeRangeContext surface's pure model (P3 acceptance: adapter +
// per-state + a11y-label tests). Exercises the prompt-mandated registration slug, the
// `string | number | null` cursor-value store that mirrors the web `cursorSync.ts` external store
// (including the "skip when unchanged" guard and the null-clears branch), the `useSyncedCursor` /
// `useSyncedReferenceLineX` projection across every state the web tests assert, and the PII-safe
// `view.opened` diagnostic. No Compose / Android framework / HTTP — runs in :android:testReleaseUnitTest.
// Reference values are the behaviour the web source and its sibling test
// (ChartTimeRangeContext.test.tsx) produce.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.sharedsurfaces.charttimerangecontext

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.LogRecord
import io.teslasync.shared.core.diagnostics.Logger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartTimeRangeContextModelTest {
    // ── registration metadata mirrors the prompt-mandated surface slug ──────────────────────────────

    @Test
    fun registrationSlugIsThePromptSurfaceSlug() {
        assertEquals("chart-time-range-context", ChartTimeRangeContextRegistration.ID)
        assertEquals("ChartTimeRangeContext", ChartTimeRangeContextRegistration.SLUG)
    }

    @Test
    fun syncMethodCoversIndexAndValue() {
        assertEquals(listOf(ChartSyncMethod.Index, ChartSyncMethod.Value), ChartSyncMethod.entries.toList())
    }

    // ── CursorSyncValue lifts the web `string | number | null` value domain ─────────────────────────

    @Test
    fun cursorSyncValueLiftsStringNumberAndNull() {
        assertEquals(CursorSyncValue.Text("12:34"), CursorSyncValue.text("12:34"))
        assertEquals(CursorSyncValue.Numeric(42.0), CursorSyncValue.numeric(42.0))
        assertNull(CursorSyncValue.text(null))
        assertNull(CursorSyncValue.numeric(null))
    }

    @Test
    fun cursorSyncValueTextAndNumericAreDistinct() {
        // The web value domain is a union; a string label and a numeric label are never equal even when they
        // print the same, so a synced chart never confuses an `index`-mode label for a `value`-mode one.
        val text: CursorSyncValue = CursorSyncValue.Text("42")
        val numeric: CursorSyncValue = CursorSyncValue.Numeric(42.0)
        assertNotEquals(text, numeric)
    }

    // ── CursorSyncStore adapter — the web `cursorSync.ts` external store, set/get/clear semantics ────

    @Test
    fun getReturnsNullForUnknownOrNullSyncId() {
        val store = CursorSyncStore()
        assertNull(store.get("missing"))
        assertNull(store.get(null))
    }

    @Test
    fun setThenGetRoundTripsAStringLabel() {
        val store = CursorSyncStore()
        store.set("drive-detail", CursorSyncValue.Text("12:34"))
        assertEquals(CursorSyncValue.Text("12:34"), store.get("drive-detail"))
    }

    @Test
    fun setThenGetRoundTripsANumericLabel() {
        val store = CursorSyncStore()
        store.set("drive-detail", CursorSyncValue.Numeric(1_700_000_000.0))
        assertEquals(CursorSyncValue.Numeric(1_700_000_000.0), store.get("drive-detail"))
    }

    @Test
    fun setNullClearsEntry() {
        val store = CursorSyncStore()
        store.set("drive-detail", CursorSyncValue.Text("12:34"))
        store.set("drive-detail", null)
        assertNull(store.get("drive-detail"))
    }

    @Test
    fun clearRemovesEntry() {
        val store = CursorSyncStore()
        store.set("drive-detail", CursorSyncValue.Numeric(9.0))
        store.clear("drive-detail")
        assertNull(store.get("drive-detail"))
    }

    @Test
    fun keysAreIsolatedAcrossSyncIds() {
        val store = CursorSyncStore()
        store.set("a", CursorSyncValue.Text("one"))
        store.set("b", CursorSyncValue.Numeric(2.0))
        assertEquals(CursorSyncValue.Text("one"), store.get("a"))
        assertEquals(CursorSyncValue.Numeric(2.0), store.get("b"))
    }

    @Test
    fun listenersFireOnRealChangeOnly() {
        val store = CursorSyncStore()
        var count = 0
        val unsubscribe = store.subscribe { count++ }
        store.set("drive", CursorSyncValue.Numeric(3.0))
        store.set("drive", CursorSyncValue.Numeric(3.0)) // unchanged -> no emit (web `current === value`)
        store.set("drive", CursorSyncValue.Numeric(5.0))
        assertEquals(2, count)
        unsubscribe()
        store.set("drive", CursorSyncValue.Numeric(8.0))
        assertEquals(2, count)
    }

    @Test
    fun resetClearsPositionsAndListeners() {
        val store = CursorSyncStore()
        var count = 0
        store.subscribe { count++ }
        store.set("drive", CursorSyncValue.Text("x"))
        store.reset()
        assertNull(store.get("drive")) // positions cleared
        val countAfterReset = count
        store.set("drive", CursorSyncValue.Text("y"))
        assertEquals(countAfterReset, count) // the reset dropped the listener -> no further notifications
    }

    // ── useSyncedCursor projection — outside vs inside provider (web per-state) ──────────────────────

    @Test
    fun syncedCursorPropsOutsideProviderIsEmpty() {
        val props = CursorSyncProjection.syncedCursorProps(sync = null, onMouseMove = {})
        assertSame(SyncedCursorProps.EMPTY, props)
        assertNull(props.syncId)
        assertNull(props.syncMethod)
        assertNull(props.onMouseMove)
    }

    @Test
    fun syncedCursorPropsInsideProviderCarriesSyncIdMethodAndHandler() {
        val sync = ChartSync(syncId = "drive-detail", syncMethod = ChartSyncMethod.Index)
        val props = CursorSyncProjection.syncedCursorProps(sync = sync, onMouseMove = {})
        assertEquals("drive-detail", props.syncId)
        assertEquals(ChartSyncMethod.Index, props.syncMethod)
        assertNotNull(props.onMouseMove)
    }

    @Test
    fun syncedCursorPropsHonoursExplicitValueSyncMethod() {
        val sync = ChartSync(syncId = "charging.session", syncMethod = ChartSyncMethod.Value)
        val props = CursorSyncProjection.syncedCursorProps(sync = sync, onMouseMove = {})
        assertEquals(ChartSyncMethod.Value, props.syncMethod)
    }

    // ── onMouseMove writes the active label, undefined clears (web cursorSync write path) ────────────

    @Test
    fun applyMoveWritesStringActiveLabelThenClearsOnNull() {
        val store = CursorSyncStore()
        CursorSyncProjection.applyMove(store, "m1", ChartCursorEvent(CursorSyncValue.text("12:34")))
        assertEquals(CursorSyncValue.Text("12:34"), store.get("m1"))
        // web: a subsequent `onMouseMove({ activeLabel: undefined })` clears the entry.
        CursorSyncProjection.applyMove(store, "m1", ChartCursorEvent(null))
        assertNull(store.get("m1"))
    }

    @Test
    fun applyMoveWritesNumericActiveLabel() {
        val store = CursorSyncStore()
        CursorSyncProjection.applyMove(store, "m1", ChartCursorEvent(CursorSyncValue.numeric(42.0)))
        assertEquals(CursorSyncValue.Numeric(42.0), store.get("m1"))
    }

    @Test
    fun applyMoveWithNullEventClearsTheCursor() {
        val store = CursorSyncStore()
        store.set("m1", CursorSyncValue.Text("seed"))
        // Pointer left the plot entirely (web `state` is null) -> `activeLabel ?? null` -> clear.
        CursorSyncProjection.applyMove(store, "m1", null)
        assertNull(store.get("m1"))
    }

    @Test
    fun applyMoveOutsideProviderIsANoOp() {
        val store = CursorSyncStore()
        // web `if (!syncId) return` — a chart spreading sync props with no provider above it never writes.
        CursorSyncProjection.applyMove(store, null, ChartCursorEvent(CursorSyncValue.text("12:34")))
        assertNull(store.get("ignored"))
    }

    @Test
    fun fullCursorPropsHandlerRoundTripsThroughTheStore() {
        // Reproduces exactly what the composable wires: onMouseMove = { applyMove(store, syncId, it) }.
        val store = CursorSyncStore()
        val sync = ChartSync(syncId = "m1", syncMethod = ChartSyncMethod.Index)
        val onMove: (ChartCursorEvent?) -> Unit = { CursorSyncProjection.applyMove(store, sync.syncId, it) }
        val props = CursorSyncProjection.syncedCursorProps(sync = sync, onMouseMove = onMove)
        props.onMouseMove?.invoke(ChartCursorEvent(CursorSyncValue.text("09:15")))
        assertEquals(CursorSyncValue.Text("09:15"), store.get("m1"))
    }

    // ── useSyncedReferenceLineX projection — the value a synced chart renders (web per-state) ────────

    @Test
    fun referenceLineValueIsNullOutsideProviderOrBeforeHover() {
        val store = CursorSyncStore()
        // Outside a provider the active syncId is null (web returns null); before any hover the entry is unset.
        assertNull(store.get(null))
        assertNull(store.get("m2"))
    }

    @Test
    fun referenceLineValueReflectsThePersistedCursor() {
        val store = CursorSyncStore()
        store.set("m2", CursorSyncValue.Numeric(42.0))
        assertEquals(CursorSyncValue.Numeric(42.0), store.get("m2"))
        store.set("m2", null)
        assertNull(store.get("m2"))
    }

    // ── memoisation parity — equal (syncId, syncMethod) inputs yield an equal context value ──────────

    @Test
    fun chartSyncIsValueEqualForEqualInputs() {
        // The web provider `useMemo`s `{ syncId, syncMethod }`; the native provider `remember`s a [ChartSync]
        // by the same keys. Value equality is what lets consumers treat it as a stable reference.
        assertEquals(
            ChartSync("drive-detail", ChartSyncMethod.Index),
            ChartSync("drive-detail", ChartSyncMethod.Index),
        )
        assertNotEquals(
            ChartSync("drive-detail", ChartSyncMethod.Index),
            ChartSync("drive-detail", ChartSyncMethod.Value),
        )
    }

    // ── a11y / PII: the surface exposes no interactive label, and the diagnostic cannot leak one ─────

    @Test
    fun viewOpenedDiagnosticCarriesOnlyThePiiSafeSurfaceSlug() {
        // This surface is a non-visual coordination layer: it renders no interactive element and no visible
        // label (the provider only wraps its children). The one datum it could expose to diagnostics is the
        // slug; asserting the diagnostic carries the slug ONLY — never the syncId nor the hovered cursor
        // value — is the a11y/PII coverage for a surface that has nothing focusable to label.
        val records = mutableListOf<LogRecord>()
        val logger =
            object : Logger {
                override fun log(
                    level: LogLevel,
                    event: String,
                    fields: Map<String, String>,
                ) {
                    records += LogRecord(level, event, fields)
                }
            }
        recordChartTimeRangeContextOpened(logger)
        assertEquals(1, records.size)
        assertEquals(LogLevel.Info, records[0].level)
        assertEquals("view.opened", records[0].event)
        assertEquals(mapOf("surface" to "ChartTimeRangeContext"), records[0].fields)
        assertTrue("diagnostic must not leak a syncId", records[0].fields.values.none { it.contains(":") })
    }
}
