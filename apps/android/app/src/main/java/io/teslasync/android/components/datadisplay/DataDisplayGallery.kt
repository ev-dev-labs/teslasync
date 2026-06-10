@file:OptIn(ExperimentalLayoutApi::class)

package io.teslasync.android.components.datadisplay

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import io.teslasync.android.components.charts.Sparkline
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.SectionTitle
import io.teslasync.android.ui.theme.TeslaSyncTheme
import io.teslasync.android.ui.theme.generated.Spacing

/**
 * Visual gallery of the data-display layer, used by the @Preview entry points below to prove every
 * primitive renders across the light, dark, and high-contrast themes. Sections exercise the
 * nominal, loading, empty, error, stale, selected, and disabled states required by the prompt.
 */
@Composable
private fun DataDisplayGallery() {
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(Spacing.md),
            verticalArrangement = Arrangement.spacedBy(Spacing.lg),
        ) {
            MetricsSection()
            DeltaAndComparisonSection()
            IdentityAndBadgeSection()
            FreshnessSection()
            ListsSection()
            PlaybackSection()
            DomainSection()
            StatesSection()
        }
    }
}

private const val SAMPLE_AVATAR_NAME = "Ada Lovelace"
private val sampleTimeline =
    listOf(
        TimelineEntry("Drive started", "10:02", subtitle = "Home", icon = DataDisplayGlyphs.Play),
        TimelineEntry("Charging started", "11:18", subtitle = "Supercharger", icon = DataDisplayGlyphs.BatteryCharging),
        TimelineEntry("Sentry triggered", "14:45", subtitle = "Parking lot", icon = DataDisplayGlyphs.Shield),
    )

@Composable
private fun Section(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
        SectionTitle(title)
        content()
    }
}

@Composable
private fun MetricsSection() {
    Section("Metrics") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatCard(
                label = "Range",
                value = "248",
                unit = "mi",
                icon = DataDisplayGlyphs.Battery,
                trend = StatTrend(DeltaArrow.Up, "+12%", positive = true),
                sublabel = "rated",
                modifier = Modifier.width(160.dp),
            )
            StatCard(label = "Loading", value = "", loading = true, modifier = Modifier.width(160.dp))
            MetricCard(
                label = "Efficiency",
                value = "241",
                icon = DataDisplayGlyphs.Bolt,
                subtitle = "Wh/mi",
                modifier = Modifier.width(160.dp),
            ) {
                Delta(current = 241.0, previous = 260.0, metric = resolveSemantic("efficiency"), unitSuffix = "Wh/mi")
            }
        }
        ProgressRing(value = 80.0, centerLabel = "80%", centerSubLabel = "SOC", label = "Battery")
        MetricBar(value = 72.0, max = 100.0, label = "Throttle", valueText = "72%")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
            InlineMetric(icon = DataDisplayGlyphs.Clock, value = "1h 23m", label = "duration")
            AnimatedNumber(value = 1_234.0, decimals = 0)
            BatteryDelta(startPct = 79.0, endPct = 78.0)
            BatteryDelta(startPct = 20.0, endPct = 80.0)
            BatteryDelta(startPct = null, endPct = null)
        }
    }
}

@Composable
private fun DeltaAndComparisonSection() {
    Section("Delta + comparison") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Delta(current = 12.0, previous = 10.0, metric = resolveSemantic("cost"), display = DeltaDisplay.Both, unitPrefix = "$")
            Delta(current = 280.0, previous = 250.0, metric = resolveSemantic("range"), unitSuffix = "mi")
            Delta(current = null, previous = 10.0, metric = resolveSemantic("cost"))
            Delta(current = 12.0, previous = 10.0, metric = resolveSemantic("cost"), loading = true)
        }
        KpiOverviewCard(
            header = {
                ComparisonHeader(
                    title = "Overview",
                    currentLabel = "Last 30 days",
                    comparisonLabel = "vs prior 30 days",
                    delta = { Delta(current = 320.0, previous = 300.0, metric = resolveSemantic("range"), unitSuffix = "mi") },
                )
            },
            kpis = {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
                    MetricCard(label = "Drives", value = "42", modifier = Modifier.width(150.dp))
                    MetricCard(label = "Distance", value = "1,204", modifier = Modifier.width(150.dp))
                }
            },
            secondary = "Top speed 152 mph · Longest 29.1 mi · Avg trip 11.5 mi",
        )
        UsageCard(
            budget = UsageBudget(headline = "$0.42 of $5.00", pct = 8f, ariaLabel = "Monthly credit", caption = "Day 5 of 30"),
            bands =
                listOf(
                    UsageBand(label = "Calls", value = "1,204", icon = DataDisplayGlyphs.Bolt),
                    UsageBand(label = "Errors", value = "3", intent = UsageIntent.Warn),
                ),
            details = listOf(UsageDetail("Avg latency", "82 ms"), UsageDetail("Error rate", "0.2%", UsageIntent.Danger)),
            banner = UsageBanner(title = "Approaching limit", description = "80% of monthly credit used"),
        )
        UsageCard(emptyMessage = "No usage recorded yet.")
    }
}

@Composable
private fun IdentityAndBadgeSection() {
    Section("Identity + status badges") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            Avatar(name = SAMPLE_AVATAR_NAME, size = AvatarSize.Lg, status = AvatarStatus.Online)
            Avatar(name = "Model Y", size = AvatarSize.Md, status = AvatarStatus.Idle)
            Avatar(kind = AvatarKind.Bot, size = AvatarSize.Md)
            Avatar(name = null, size = AvatarSize.Md, status = AvatarStatus.Offline)
        }
        UserCell(user = UserCellUser(id = "u1", name = SAMPLE_AVATAR_NAME, email = "ada@example.com"), showEmail = true)
        UserCell(user = null)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.sm), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            StatusBadge("driving")
            StatusBadge("asleep")
            SeverityBadge("critical")
            SeverityBadge("warn", size = ChipSize.Sm)
            SeverityBadge("info", showIcon = false)
            StatusDot("critical", label = "Unread critical alert")
            ScoreBadge(score = 87.0)
            ScoreBadge(grade = ScoreGrade.B, size = ScoreBadgeSize.Lg)
            ScoreBadge(score = null)
            FSMBadge("drive_session")
            SourceLayerBadge("l1", ageMs = 1_500L)
            SourceLayerBadge("stale", ageMs = 180_000L)
        }
    }
}

@Composable
private fun FreshnessSection() {
    val now = System.currentTimeMillis()
    Section("Freshness + live") {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            FreshnessIndicator(timestampMillis = now - 5_000L)
            FreshnessIndicator(timestampMillis = now - 300_000L)
            FreshnessIndicator(timestampMillis = now - 1_200_000L)
            FreshnessIndicator(timestampMillis = null)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            DataFreshness(updatedAtMillis = now - 30_000L, isFetching = false, isStale = false, isError = false)
            DataFreshness(updatedAtMillis = now - 240_000L, isFetching = false, isStale = true, isError = false)
            DataFreshness(updatedAtMillis = null, isFetching = true, isStale = false, isError = false)
            DataFreshness(updatedAtMillis = null, isFetching = false, isStale = false, isError = true)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.sm)) {
            LiveIndicator(status = LiveConnectionStatus.Connected, lastMessageRelative = "5s ago")
            LiveIndicator(status = LiveConnectionStatus.Reconnecting, variant = LiveIndicatorVariant.Compact)
            LiveIndicator(status = LiveConnectionStatus.Disconnected, variant = LiveIndicatorVariant.Dot)
            SystemHealthDot(SystemHealth.Healthy)
            SystemHealthDot(SystemHealth.Degraded)
            SystemHealthDot(SystemHealth.Down)
        }
        ServiceStatusBanner(offline = true, message = "You are offline. Data may be stale.")
    }
}

@Composable
private fun ListsSection() {
    Section("Lists + timelines") {
        KVList(
            items =
                listOf(
                    KVItem("Odometer", "24,184 mi"),
                    KVItem("Software", "2026.4.1"),
                    KVItem("VIN", "5YJ3E1EA1KF"),
                ),
        )
        Timeline(items = sampleTimeline)
        TransitionArrow(from = "parked", to = "driving")
        RouteDisplay(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Office"))
        RouteDisplay(start = RouteEndpoint(address = "Home"))
        RouteDisplay(start = RouteEndpoint())
        HistoryListRow(
            primary = {
                Text("08:42", style = MaterialTheme.typography.bodyMedium)
                ScoreBadge(grade = ScoreGrade.A, size = ScoreBadgeSize.Sm)
            },
            leading = { ScoreBadge(grade = ScoreGrade.A) },
            route = { RouteDisplay(start = RouteEndpoint(address = "Home"), end = RouteEndpoint(address = "Office")) },
            metrics = {
                InlineMetric(icon = DataDisplayGlyphs.Clock, value = "23m")
                BatteryDelta(startPct = 82.0, endPct = 71.0)
            },
            selected = true,
            onClick = {},
        )
        DateGroupedList(
            groups =
                listOf(
                    DateGroup(
                        dateKey = "2026-05-09",
                        dateLabel = "May 9, 2026",
                        relativeLabel = "3 days ago",
                        summary = "2 drives · 6.2 mi",
                        items = listOf("Morning commute", "Evening return"),
                    ),
                ),
        ) { item -> Caption(item) }
        RecentActivityFeed(entries = sampleTimeline)
        RecentActivityFeed(entries = emptyList())
    }
}

@Composable
private fun PlaybackSection() {
    Section("Playback") {
        PlaybackControls(
            isPlaying = false,
            speed = 10,
            progress = 0.4f,
            elapsed = "1:23",
            total = "5:10",
            onPlay = {},
            onPause = {},
            onStop = {},
            onSpeedChange = {},
            onSeek = {},
            durationSeconds = 310,
            markers =
                listOf(
                    TimelineMarker(0.2f, TimelineMarkerKind.FastSegment),
                    TimelineMarker(0.7f, TimelineMarkerKind.RegenPeak),
                ),
        )
        PlaybackSpeedMenu(speed = 25, onChange = {})
        TimelineScrubber(
            progress = 0.6f,
            onSeek = {},
            durationSeconds = 300,
            markers = listOf(TimelineMarker(0.5f, TimelineMarkerKind.LowSoc, label = "Low SoC")),
            background = { Sparkline(data = listOf(1.0, 3.0, 2.0, 5.0, 4.0)) },
        )
    }
}

@Composable
private fun DomainSection() {
    Section("Domain visuals + actions") {
        DriveScore(
            input =
                DriveInput(
                    distanceM = 50_000.0,
                    durationS = 3_600.0,
                    maxSpeedMps = 27.78,
                    startBatteryPct = 80.0,
                    endBatteryPct = 60.0,
                ),
        )
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.md), verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            TeslaCarViz(
                state = TeslaVehicleViz(batteryLevelPct = 82.0, isCharging = true, isLocked = true, isClimateOn = true),
                model = TeslaModel.Model3,
            )
            TeslaCarViz(
                state = TeslaVehicleViz(batteryLevelPct = 14.0, isLocked = false, sentryMode = true, speedText = "62 mph"),
                model = TeslaModel.Cybertruck,
            )
        }
        BulkActionToolbar(
            selectedCount = 3,
            onClear = {},
            total = 27,
            actions =
                listOf(
                    BulkAction(id = "export", label = "Export", onClick = {}),
                    BulkAction(id = "delete", label = "Delete", onClick = {}, danger = true),
                    BulkAction(id = "merge", label = "Merge", onClick = {}, enabled = false),
                ),
        )
        SavedViewMenu(
            views =
                listOf(
                    SavedView("1", "Long drives", "min=50", isPinned = true),
                    SavedView("2", "This week", "range=7d", isDefault = true),
                ),
            currentQuery = "range=7d",
            onApply = {},
            onSetDefault = {},
            onTogglePin = {},
            onDelete = {},
        )
        PollingEngine(
            savings = PollingSavings(savingsPercent = 62.5, estimatedSavings = 4.20, pollsMade = 318, remainingCredit = 95.8),
            vehicles =
                listOf(
                    PollingVehicle("5YJ3E1EA1KF123456", "active", "driving", 72, 0L),
                    PollingVehicle("5YJ3E1EA1KF654321", "idle", "sleeping", 64, 1_800_000L),
                ),
        )
        PollingEngine(savings = null, vehicles = emptyList())
    }
}

@Composable
private fun StatesSection() {
    Section("Loading / empty / error") {
        DataLoading(loadingLabel = "Loading telemetry…")
        DataEmpty(message = "No data for this range", icon = DataDisplayGlyphs.History)
        DataError(message = "Could not load data", retryLabel = "Retry", onRetry = {})
    }
}

@Preview(name = "Data-display \u00b7 Light", showBackground = true, heightDp = 3200)
@Composable
private fun DataDisplayGalleryLightPreview() {
    TeslaSyncTheme(darkTheme = false) { DataDisplayGallery() }
}

@Preview(name = "Data-display \u00b7 Dark", showBackground = true, heightDp = 3200)
@Composable
private fun DataDisplayGalleryDarkPreview() {
    TeslaSyncTheme(darkTheme = true) { DataDisplayGallery() }
}

@Preview(name = "Data-display \u00b7 High contrast", showBackground = true, heightDp = 3200)
@Composable
private fun DataDisplayGalleryHighContrastPreview() {
    TeslaSyncTheme(highContrast = true) { DataDisplayGallery() }
}
