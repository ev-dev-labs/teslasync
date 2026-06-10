package io.teslasync.android.components.charts

/**
 * Chart annotation model, mirroring the web `types/annotations`. Annotations are
 * point-in-time notes (a battery swap, a road trip, a firmware upgrade) anchored
 * to an x-axis [index] on a chart. Kept framework-free; category colors resolve
 * from design tokens at render time via `annotationColor` in `ChartColors.kt`.
 */
enum class AnnotationCategory { Milestone, Maintenance, Trip, Issue, Upgrade, Custom }

/** A single annotation. [index] is the x position; [timestampLabel] is shown in the list. */
data class DataAnnotation(
    val id: String,
    val index: Int,
    val label: String,
    val category: AnnotationCategory = AnnotationCategory.Milestone,
    val description: String? = null,
    val timestampLabel: String = "",
)

/** Projects annotations onto the [ChartVerticalMarker]s the chart wrappers render as a rail. */
fun annotationMarkers(annotations: List<DataAnnotation>): List<ChartVerticalMarker> =
    annotations.map { ann ->
        ChartVerticalMarker(
            index = ann.index,
            label = ann.label,
            severity = ann.category.toSeverity(),
            id = ann.id,
        )
    }

private fun AnnotationCategory.toSeverity(): MarkerSeverity =
    when (this) {
        AnnotationCategory.Issue -> MarkerSeverity.Critical
        AnnotationCategory.Maintenance -> MarkerSeverity.Warn
        AnnotationCategory.Trip -> MarkerSeverity.Success
        else -> MarkerSeverity.Info
    }
