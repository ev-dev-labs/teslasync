package io.teslasync.android.components.charts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.ChartPalette
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the chart layer, used by the @Preview entry points below to prove
 * every component renders across the light, dark, and high-contrast themes. Sections
 * exercise the loading / empty / error / data states, legend toggling, the marker
 * rail, the time-range brush, and the Canvas visuals.
 */
@Composable
private fun ChartGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.md),
        ) {
            CartesianSection()
            StateSection()
            MetricAndElevationSection()
            SmallMultiplesSection()
            MicroVisualSection()
            LegendAndTooltipSection()
            MarkersSection()
            BrushSection()
        }
    }
}

private val sampleX = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
private val sampleSpeed =
    ChartSeries("speed", "Speed", listOf(40.0, 55.0, null, 60.0, 52.0, 48.0, 63.0), unit = "km/h")
private val samplePower =
    ChartSeries("power", "Power", listOf(12.0, 18.0, 15.0, 20.0, 17.0, 14.0, 22.0), unit = "kW")
private val sampleSeries = listOf(sampleSpeed, samplePower)

@Composable
private fun CartesianSection() {
    Section("Cartesian charts") {
        ChartContainer(title = "Line", subtitle = "Speed + power") {
            LineChartWrapper(series = sampleSeries, xLabels = sampleX)
        }
        ChartContainer(title = "Area") {
            AreaChartWrapper(series = listOf(sampleSpeed), xLabels = sampleX)
        }
        ChartContainer(title = "Bar") {
            BarChartWrapper(series = listOf(samplePower), xLabels = sampleX)
        }
        ChartContainer(title = "Combo", subtitle = "Columns + trend line") {
            ComboChart(
                series =
                    listOf(
                        samplePower.copy(kind = ChartSeriesKind.Bar),
                        sampleSpeed.copy(kind = ChartSeriesKind.Line),
                    ),
                xLabels = sampleX,
            )
        }
    }
}

@Composable
private fun StateSection() {
    Section("Container states") {
        ChartContainer(title = "Loading", status = ChartStatus.Loading) {}
        ChartContainer(title = "Empty", status = ChartStatus.Empty, emptyMessage = "No data for this range") {}
        ChartContainer(
            title = "Error",
            status = ChartStatus.Error,
            errorMessage = "Could not load chart",
            retryLabel = "Retry",
            onRetry = {},
        ) {}
        ChartContainer(
            title = "With data table",
            dataTableHeader = tableHeader(sampleSeries, "Day"),
            dataTableRows = tableRows(sampleSeries, sampleX),
        ) {
            LineChartWrapper(series = sampleSeries, xLabels = sampleX)
        }
    }
}

@Composable
private fun MetricAndElevationSection() {
    var active by remember { mutableStateOf("speed") }
    Section("Metric switcher + elevation") {
        MetricSwitcherChart(
            metrics =
                listOf(
                    MetricSwitcherMetric("speed", "Speed", sampleSpeed, sampleX),
                    MetricSwitcherMetric("power", "Power", samplePower.copy(kind = ChartSeriesKind.Bar), sampleX),
                ),
            activeKey = active,
            onMetricChange = { active = it },
        )
        ElevationProfile(
            title = "Elevation",
            points =
                listOf(
                    ElevationPoint(0.0, 120.0),
                    ElevationPoint(1.0, 160.0),
                    ElevationPoint(2.0, 140.0),
                    ElevationPoint(3.0, 210.0),
                    ElevationPoint(4.0, 190.0),
                ),
            currentIndex = 2,
        )
    }
}

@Composable
private fun SmallMultiplesSection() {
    Section("Small multiples") {
        SmallMultiplesChart(
            series =
                listOf(
                    sampleSpeed,
                    samplePower,
                    ChartSeries("temp", "Temp", listOf(20.0, 22.0, 21.0, 25.0, 24.0, 23.0, 26.0)),
                ),
            xLabels = sampleX,
            columns = 2,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MicroVisualSection() {
    Section("Micro visuals") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.lg), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            Sparkline(data = listOf(3.0, 7.0, 4.0, 9.0, 6.0, 11.0))
            MiniChart(data = listOf(11.0, 6.0, 9.0, 4.0, 7.0, 3.0))
            RadialGauge(value = 72.0, max = 100.0, label = "Battery", unit = "%")
        }
    }
}

@Composable
private fun LegendAndTooltipSection() {
    val legend = rememberChartLegendState()
    val entries =
        listOf(
            LegendEntry("speed", "Speed", paletteColor(0)),
            LegendEntry("power", "Power", paletteColor(1)),
        )
    Section("Legend + tooltip") {
        ChartLegend(entries = entries, state = legend)
        ChartTooltipContent(
            label = "Wed",
            entries =
                listOf(
                    ChartTooltipEntry("Speed", "60 km/h", paletteColor(0)),
                    ChartTooltipEntry("Power", "18 kW", ChartPalette.power),
                ),
        )
    }
}

@Composable
private fun MarkersSection() {
    val annotations =
        listOf(
            DataAnnotation("1", 1, "Service", AnnotationCategory.Maintenance, timestampLabel = "Tue"),
            DataAnnotation("2", 4, "Road trip", AnnotationCategory.Trip, timestampLabel = "Fri"),
        )
    Section("Markers + annotations") {
        ChartMarkerRail(markers = annotationMarkers(annotations), pointCount = sampleX.size, modifier = Modifier.fillMaxWidth())
        TimeMarker(index = 3, pointCount = sampleX.size, label = "Alert", severity = MarkerSeverity.Critical)
        AnnotationList(annotations = annotations, onRemove = {})
    }
}

@Composable
private fun BrushSection() {
    val range = rememberChartTimeRange(sampleX.size)
    Section("Time-range brush") {
        ChartBrush(
            range = range,
            label = "Range",
            valueText = { start, end -> "$start\u2013$end" },
        )
    }
}

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.sm),
    ) {
        SectionTitle(title)
        content()
    }
}

@Preview(name = "Charts \u00b7 Light", showBackground = true, heightDp = 2400)
@Composable
private fun ChartGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { ChartGallery() }
}

@Preview(name = "Charts \u00b7 Dark", showBackground = true, heightDp = 2400)
@Composable
private fun ChartGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { ChartGallery() }
}

@Preview(name = "Charts \u00b7 High contrast", showBackground = true, heightDp = 2400)
@Composable
private fun ChartGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { ChartGallery() }
}
