package io.teslasync.android.widgets

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.SizeMode

/**
 * The home-screen sizes the TeslaSync widgets respond to (P3/A8). Glance renders the layout for the
 * closest declared size and reports the actual cell via `LocalSize`; [widgetSizeClassOf] then snaps it
 * to a [WidgetSizeClass]. Three sizes give every widget a true compact (≈2x1) and medium (≈4x2)
 * layout plus a roomy large (≈4x3) one — satisfying the vehicle-status compact/medium requirement and
 * letting the data-dense quick-stats / charging widgets expand gracefully.
 */
object WidgetSizes {
    private val COMPACT = DpSize(140.dp, 100.dp)
    private val MEDIUM = DpSize(250.dp, 110.dp)
    private val LARGE = DpSize(250.dp, 220.dp)

    /** The responsive size set every TeslaSync widget declares. */
    fun responsive(): SizeMode = SizeMode.Responsive(setOf(COMPACT, MEDIUM, LARGE))
}
