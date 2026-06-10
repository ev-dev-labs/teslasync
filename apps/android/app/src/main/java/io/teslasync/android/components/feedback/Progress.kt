package io.teslasync.android.components.feedback

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.teslasync.android.components.ui.Badge
import io.teslasync.android.components.ui.BadgeVariant
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Button
import io.teslasync.android.components.ui.ButtonSize
import io.teslasync.android.components.ui.ButtonVariant
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.Card
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.Icon
import io.teslasync.android.components.ui.IconButton
import io.teslasync.android.components.ui.IconSize
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.components.ui.TeslaGlyphs
import io.teslasync.android.ui.theme.generated.Spacing

/*
 * Progress + async-job surfaces mirroring web `TopProgress`, `SuspenseProgressBoundary`, and
 * `JobProgressDrawer`. [TopProgress] is a thin top bar (indeterminate or determinate),
 * [SuspenseProgressBoundary] overlays it while a lazily-loaded region boots, and
 * [JobProgressDrawer] is a floating, minimizable widget that surfaces export/job state.
 */

/** Thin top progress bar. Indeterminate when [progress] is null, else a 0..1 determinate bar. */
@Composable
fun TopProgress(
    modifier: Modifier = Modifier,
    progress: Float? = null,
) {
    if (progress == null) {
        LinearProgressIndicator(modifier = modifier.fillMaxWidth())
    } else {
        LinearProgressIndicator(progress = { progress.coerceIn(0f, 1f) }, modifier = modifier.fillMaxWidth())
    }
}

/**
 * Renders a [TopProgress] bar above [content] while [loading] — the native analogue of the web
 * Suspense fallback that keeps the page visible while a code-split region resolves.
 */
@Composable
fun SuspenseProgressBoundary(
    loading: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        if (loading) {
            TopProgress()
        }
        content()
    }
}

/**
 * Floating, minimizable export/job progress widget mirroring web `JobProgressDrawer`. Controlled
 * via [visibility] + [onVisibilityChange]; a new active job re-surfaces a dismissed drawer (see
 * [resolveDrawerVisibility]) and the whole widget hides only when there is genuinely nothing to
 * show (see [drawerHidden]). Active and recent jobs render in clearly-labelled sections, never blank.
 */
@Composable
fun JobProgressDrawer(
    jobs: List<JobSummary>,
    visibility: DrawerVisibility,
    onVisibilityChange: (DrawerVisibility) -> Unit,
    modifier: Modifier = Modifier,
    loading: Boolean = false,
    maxRecent: Int = 5,
) {
    val active = activeJobs(jobs)
    val recent = recentJobs(jobs, maxRecent)
    val effective = resolveDrawerVisibility(visibility, active.size)
    if (drawerHidden(effective, active.size, jobs.size, loading)) return

    if (effective == DrawerVisibility.Minimized) {
        JobDrawerChip(activeCount = active.size, onExpand = { onVisibilityChange(DrawerVisibility.Open) }, modifier = modifier)
        return
    }

    Card(modifier = modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PanelTitle("Export jobs", modifier = Modifier.weight(1f))
            if (active.isNotEmpty()) {
                Badge("${active.size} active", variant = BadgeVariant.Info)
            }
            IconButton(
                TeslaGlyphs.Minus,
                contentDescription = "Minimize",
                onClick = { onVisibilityChange(DrawerVisibility.Minimized) },
                size = IconSize.Sm,
            )
            IconButton(
                TeslaGlyphs.Close,
                contentDescription = "Dismiss",
                onClick = { onVisibilityChange(DrawerVisibility.Dismissed) },
                size = IconSize.Sm,
            )
        }
        JobSection(label = "In progress", emptyLabel = "No active exports", jobs = active)
        JobSection(label = "Recent", emptyLabel = "No recent exports", jobs = recent)
    }
}

@Composable
private fun JobDrawerChip(
    activeCount: Int,
    onExpand: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val label = if (activeCount > 0) "$activeCount export running" else "Exports"
    Button(
        label,
        onClick = onExpand,
        modifier = modifier,
        variant = ButtonVariant.Secondary,
        size = ButtonSize.Sm,
        leadingIcon = if (activeCount > 0) FeedbackGlyphs.Refresh else FeedbackGlyphs.Download,
    )
}

@Composable
private fun JobSection(
    label: String,
    emptyLabel: String,
    jobs: List<JobSummary>,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Caption(label)
        if (jobs.isEmpty()) {
            BodyText(emptyLabel, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            jobs.forEach { job -> JobRow(job) }
        }
    }
}

@Composable
private fun JobRow(job: JobSummary) {
    GlassPanel {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(Spacing.sm),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(jobStatusGlyph(job.status), contentDescription = null, size = IconSize.Sm, tint = jobStatusColor(job.status))
            Column(modifier = Modifier.weight(1f)) {
                BodyText(job.label)
                Caption(jobSubtitle(job))
            }
        }
    }
}

private fun jobStatusGlyph(status: JobStatus) =
    when (status) {
        JobStatus.Queued -> FeedbackGlyphs.Clock
        JobStatus.Processing -> FeedbackGlyphs.Refresh
        JobStatus.Ready -> TeslaGlyphs.Check
        JobStatus.Failed -> TeslaGlyphs.Octagon
        JobStatus.Expired -> TeslaGlyphs.Warning
    }

private fun jobSubtitle(job: JobSummary): String {
    val parts =
        listOfNotNull(
            job.format,
            formatBytes(job.sizeBytes),
            job.errorMessage,
        )
    return if (parts.isEmpty()) job.status.name else parts.joinToString(" \u00b7 ")
}
