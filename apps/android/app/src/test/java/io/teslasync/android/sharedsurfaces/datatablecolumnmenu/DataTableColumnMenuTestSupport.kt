// Shared off-device test fixtures for the DataTableColumnMenu surface (the :android:testReleaseUnitTest gate): a
// recording [Logger] that captures the PII-safe `view.opened` diagnostic, and a fake [ColumnLayoutStore] that
// records every applied layout + reset and exposes its current value, so the view-model's open + layout wiring runs
// without a UI. Co-located with the surface's tests so the model and view-model tests reuse one set of fixtures.

package io.teslasync.android.sharedsurfaces.datatablecolumnmenu

import io.teslasync.shared.core.diagnostics.LogLevel
import io.teslasync.shared.core.diagnostics.Logger
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** A [Logger] that records every emitted record, so tests can assert the diagnostics contract (P1/S11). */
internal class RecordingLogger : Logger {
    val events = mutableListOf<Pair<String, Map<String, String>>>()

    override fun log(
        level: LogLevel,
        event: String,
        fields: Map<String, String>,
    ) {
        events += event to fields
    }
}

/**
 * A [ColumnLayoutStore] that records every applied layout + reset and republishes the applied value as the current
 * one — the controllable fake for the view-model's layout-delegation tests (no Compose, no persistence). The
 * production [InMemoryColumnLayoutStore]'s round-trip is covered separately by the model + view-model tests.
 */
internal class FakeColumnLayoutStore(
    initial: ColumnLayout? = null,
) : ColumnLayoutStore {
    val applied = mutableListOf<ColumnLayout>()
    var resetCount = 0
    private val layoutState = MutableStateFlow(initial)

    override val layout: StateFlow<ColumnLayout?> = layoutState.asStateFlow()

    override fun apply(next: ColumnLayout) {
        applied += next
        layoutState.value = next
    }

    override fun reset() {
        resetCount += 1
        layoutState.value = null
    }
}

/** A small, deterministic column set the model + view-model tests project + mutate. */
internal fun sampleColumns(): List<ColumnDescriptor> =
    listOf(
        ColumnDescriptor(key = "select", header = "", required = true),
        ColumnDescriptor(key = "name", header = "Name"),
        ColumnDescriptor(key = "vin", header = "VIN"),
        ColumnDescriptor(key = "battery", header = "Battery", defaultVisible = false),
    )
