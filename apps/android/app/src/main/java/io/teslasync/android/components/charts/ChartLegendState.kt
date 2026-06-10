package io.teslasync.android.components.charts

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * Holder for legend-driven series visibility — the Android counterpart of the web
 * `useChartLegendState`. The web persists the hidden set in `localStorage`; the
 * Android-native equivalent is `rememberSaveable`, which survives configuration
 * changes and process death without a storage dependency. The toggle math lives
 * in the pure, JVM-tested [toggleKey].
 */
@Stable
class ChartLegendState internal constructor(
    initialHidden: Set<String>,
) {
    var hidden: Set<String> by mutableStateOf(initialHidden)
        private set

    fun isHidden(key: String): Boolean = key in hidden

    fun toggle(key: String) {
        hidden = toggleKey(hidden, key)
    }

    fun setHidden(
        key: String,
        value: Boolean,
    ) {
        hidden = if (value) hidden + key else hidden - key
    }

    fun reset() {
        hidden = emptySet()
    }
}

/** Remembers a [ChartLegendState], restoring the hidden set across recreation. */
@Composable
fun rememberChartLegendState(initialHidden: Set<String> = emptySet()): ChartLegendState =
    rememberSaveable(saver = ChartLegendStateSaver) { ChartLegendState(initialHidden) }

private val ChartLegendStateSaver =
    listSaver<ChartLegendState, String>(
        save = { it.hidden.toList() },
        restore = { ChartLegendState(it.toSet()) },
    )
