// The loaded-content layer for the DriveDetailPage driving surface — the native reproduction of every section the
// web page stacks under `{drive && stats && …}` (web/src/features/driving/pages/DriveDetailPage.tsx), in the same
// data + grouping + order. Each section is wrapped in a [DriveDetailSection] (a Material 3 `SectionErrorBoundary`)
// carrying the localized `driveDetail.section.*Failed` title, so a single failing section degrades to a compact
// retryable error instead of blanking the page — exactly as the web `<SectionErrorBoundary>` wrappers do.
//
// SI boundary (unit-conversion instructions): every numeric value is read from the shared [Drive] DTO in SI
// (meters, m/s, °C, Wh, W, seconds) and formatted at this display boundary through the live [UnitFormatter]
// (P1/S5) — the page performs NO unit math itself. The shared `Drive` read-model carries drive aggregates only
// (no per-sample telemetry/positions arrays), so the chart-shaped sections render their available aggregate and
// the web-faithful empty state (web: "charts gate themselves internally on empty chartData") for the time series.
//
// `InvalidPackageDeclaration` is suppressed: the mandated surface directory (com/teslasync/driving) diverges from
// the `io.teslasync.android.*` package the rest of the app uses, exactly as the sibling A7 pages do.
@file:Suppress("InvalidPackageDeclaration")

package io.teslasync.android.driving.drivedetail

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import io.teslasync.android.R
import io.teslasync.android.components.datadisplay.KVItem
import io.teslasync.android.components.datadisplay.KVList
import io.teslasync.android.components.datadisplay.StatCard
import io.teslasync.android.components.feedback.AlertBanner
import io.teslasync.android.components.feedback.EmptyState
import io.teslasync.android.components.feedback.SectionErrorBoundary
import io.teslasync.android.components.feedback.Tone
import io.teslasync.android.components.feedback.rememberErrorBoundaryState
import io.teslasync.android.components.ui.BodyText
import io.teslasync.android.components.ui.Caption
import io.teslasync.android.components.ui.GlassPanel
import io.teslasync.android.components.ui.PanelPadding
import io.teslasync.android.components.ui.PanelTitle
import io.teslasync.android.data.UnitFormatter
import io.teslasync.android.ui.theme.generated.Spacing
import io.teslasync.shared.core.api.generated.Drive
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/** The empty-value glyph for an absent aggregate (web `'—'`). */
private const val EM_DASH = "\u2014"

/** The start→end arrow used in range values (web `'→'`). */
private const val ARROW = " \u2192 "

/** One label/value tile in a [StatTileGrid]; [value] is pre-formatted at the display boundary. */
private data class DriveStatTile(
    val label: String,
    val value: String,
)

/**
 * The loaded drive content — every web section in order, each guarded by its own [DriveDetailSection]. The
 * no-telemetry envelope (web `hasMeaningfulDriveStats`) swaps the four numeric-summary sections for a single
 * info banner so an all-zero drive never reads as a broken vehicle; the cost-savings section keys off energy
 * (web `stats.energyWh > 0`), and every chart-shaped section is always shown (never hidden) with its available
 * aggregate or the web-faithful empty state.
 */
@Composable
fun DriveDetailLoaded(
    drive: Drive,
    vehicleName: String?,
    formatter: UnitFormatter,
    modifier: Modifier = Modifier,
) {
    val meaningful = hasMeaningfulDriveStats(drive)
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(Spacing.lg),
    ) {
        HeaderSection(drive = drive, vehicleName = vehicleName)
        if (!meaningful) NoTelemetryBanner()
        if (meaningful) HeroGaugesSection(drive = drive, formatter = formatter)
        TimelineSection(drive = drive)
        if (meaningful) StatCardsSection(drive = drive, formatter = formatter)
        AiCoachingSection()
        if (meaningful) MoreDetailsSection(drive = drive, formatter = formatter)
        if (meaningful) EnergySummarySection(drive = drive, formatter = formatter)
        if ((drive.energyUsedWh ?: 0.0) > 0.0) CostSavingsSection(drive = drive, formatter = formatter)
        RouteMapSection(drive = drive, formatter = formatter)
        JourneyDetailsSection(drive = drive)
        OverviewChartSection(drive = drive, formatter = formatter)
        SocChartSection(drive = drive)
        ElevationChartSection()
        TemperatureSection(drive = drive, formatter = formatter)
        SpeedHistogramSection()
        AiSpeedProfileSection()
        PowerProfileSection(drive = drive, formatter = formatter)
        TirePressureSection()
        WhyEndedSection(drive = drive)
    }
}

// ── Section error boundary + panel scaffolding ────────────────────────────────────────────────────────────────

/**
 * Wraps one page section in a [SectionErrorBoundary] carrying its localized [fallbackTitle] (web
 * `<SectionErrorBoundary fallbackTitle={…}>`). The boundary renders [content] while healthy and the compact
 * retryable error surface when a child reports a failure.
 */
@Composable
private fun DriveDetailSection(
    fallbackTitle: String,
    content: @Composable () -> Unit,
) {
    val boundary = rememberErrorBoundaryState()
    SectionErrorBoundary(state = boundary, title = fallbackTitle) { content() }
}

/** A titled glass panel hosting one section's body; [title] is the section's own heading (not the error title). */
@Composable
private fun SectionPanel(
    title: String?,
    content: @Composable ColumnScope.() -> Unit,
) {
    GlassPanel(padding = PanelPadding.Lg) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
            if (title != null) PanelTitle(title)
            content()
        }
    }
}

/** A responsive grid of KPI [tiles] laid out two-per-row (web stat-card / hero-gauge grids). */
@Composable
private fun StatTileGrid(tiles: List<DriveStatTile>) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.md)) {
        tiles.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.md)) {
                row.forEach { tile ->
                    StatCard(label = tile.label, value = tile.value, modifier = Modifier.weight(1f))
                }
                if (row.size == 1) Spacer(modifier = Modifier.weight(1f))
            }
        }
    }
}

// ── Sections (web order) ──────────────────────────────────────────────────────────────────────────────────────

/** Header — the owning vehicle + start/destination addresses (web `DriveDetailHeader`). */
@Composable
private fun HeaderSection(
    drive: Drive,
    vehicleName: String?,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_headerFailed)) {
        val fmt = rememberDriveDateTimeFormat()
        SectionPanel(title = vehicleName ?: stringResource(R.string.translation_driveDetail_vehicle)) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            label = stringResource(R.string.translation_driveDetail_start),
                            value = drive.startAddress ?: fmt.formatEpochMillis(drive.startTs.toEpochMilliseconds()),
                        ),
                        KVItem(
                            label = stringResource(R.string.translation_driveDetail_destination),
                            value =
                                drive.endAddress
                                    ?: drive.endTs?.let { fmt.formatEpochMillis(it.toEpochMilliseconds()) }
                                    ?: stringResource(R.string.translation_driveDetail_inProgress),
                        ),
                    ),
            )
        }
    }
}

/** No-telemetry banner (web `AlertBanner` when `!hasMeaningfulDriveStats`). Not boundary-wrapped, per web. */
@Composable
private fun NoTelemetryBanner() {
    AlertBanner(
        message = stringResource(R.string.translation_driveDetail_noTelemetryBody),
        tone = Tone.Info,
        title = stringResource(R.string.translation_driveDetail_noTelemetryTitle),
    )
}

/** Hero gauges — distance / duration / avg + max speed (web `HeroGauges`). */
@Composable
private fun HeroGaugesSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_heroGaugesFailed)) {
        StatTileGrid(
            tiles =
                listOf(
                    DriveStatTile(stringResource(R.string.translation_driveDetail_distance), formatter.distance(drive.distanceM)),
                    DriveStatTile(
                        stringResource(R.string.translation_driveDetail_duration),
                        formatter.duration(durationSeconds(drive)),
                    ),
                    DriveStatTile(stringResource(R.string.translation_driveDetail_avgSpeed), formatter.speed(drive.avgSpeedMps)),
                    DriveStatTile(stringResource(R.string.translation_driveDetail_maxSpeed), formatter.speed(drive.maxSpeedMps)),
                ),
        )
    }
}

/** Timeline — start / end timestamps + duration (web `DriveTimeline`). Always shown. */
@Composable
private fun TimelineSection(drive: Drive) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_timelineFailed)) {
        val fmt = rememberDriveDateTimeFormat()
        SectionPanel(title = null) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            label = stringResource(R.string.translation_driveDetail_start),
                            value = fmt.formatEpochMillis(drive.startTs.toEpochMilliseconds()),
                        ),
                        KVItem(
                            label = stringResource(R.string.translation_driveDetail_end),
                            value =
                                drive.endTs?.let { fmt.formatEpochMillis(it.toEpochMilliseconds()) }
                                    ?: stringResource(R.string.translation_driveDetail_inProgress),
                        ),
                    ),
            )
        }
    }
}

/** Stat cards — energy + power + battery aggregates (web `DriveStatCards`). */
@Composable
private fun StatCardsSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_statCardsFailed)) {
        StatTileGrid(
            tiles =
                listOf(
                    DriveStatTile(
                        stringResource(R.string.translation_driveDetail_energyConsumed),
                        formatter.energy(drive.energyUsedWh),
                    ),
                    DriveStatTile(
                        stringResource(R.string.translation_driveDetail_energyRecovered),
                        formatter.energy(drive.regenEnergyWh),
                    ),
                    DriveStatTile(stringResource(R.string.translation_driveDetail_avgPower), formatter.power(drive.avgPowerW)),
                    DriveStatTile(
                        stringResource(R.string.translation_driveDetail_batteryUsed),
                        batteryUsed(drive.startBatteryPct, drive.endBatteryPct),
                    ),
                ),
        )
    }
}

/** Helix drive-coaching intro (web `AIDriveCoaching`). The opt-in narrative surface is a separate parity unit. */
@Composable
private fun AiCoachingSection() {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_aiCoachingFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_aiCoaching_title)) {
            Caption(stringResource(R.string.translation_driveDetail_aiCoaching_badge))
            BodyText(stringResource(R.string.translation_driveDetail_aiCoaching_description))
        }
    }
}

/** More details — average cabin/ambient temperature + battery range (web `MoreDetailsPanel`). */
@Composable
private fun MoreDetailsSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_moreDetailsFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_moreDetails)) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_driveDetail_insideTemp),
                            formatter.temperature(drive.insideTempAvgC),
                        ),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_outsideTemp),
                            formatter.temperature(drive.outsideTempAvgC),
                        ),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_battery),
                            batteryRange(drive.startBatteryPct, drive.endBatteryPct),
                        ),
                    ),
            )
        }
    }
}

/** Energy summary — consumed / recovered / net (web `EnergySummaryPanel`). */
@Composable
private fun EnergySummarySection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_energySummaryFailed)) {
        val net = (drive.energyUsedWh ?: 0.0) - (drive.regenEnergyWh ?: 0.0)
        SectionPanel(title = stringResource(R.string.translation_driveDetail_energySummary)) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_driveDetail_energyConsumed),
                            formatter.energy(drive.energyUsedWh),
                        ),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_energyRecovered),
                            formatter.energy(drive.regenEnergyWh),
                        ),
                        KVItem(stringResource(R.string.translation_driveDetail_netConsumption), formatter.energy(net)),
                    ),
            )
        }
    }
}

/** Cost & savings — the energy basis the cost is derived from (web `CostSavingsPanel`, gated on energy). */
@Composable
private fun CostSavingsSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_costSavingsFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_costSavings)) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_driveDetail_energyConsumed),
                            formatter.energy(drive.energyUsedWh),
                        ),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_energyRecovered),
                            formatter.energy(drive.regenEnergyWh),
                        ),
                    ),
            )
        }
    }
}

/** Route map — start/destination + distance, or the no-route empty state (web `RouteMapSection`). */
@Composable
private fun RouteMapSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_routeMapFailed)) {
        val hasRoute = drive.startLat != null && drive.startLon != null
        SectionPanel(title = stringResource(R.string.translation_driveDetail_route)) {
            if (hasRoute) {
                KVList(
                    items =
                        listOf(
                            KVItem(
                                stringResource(R.string.translation_driveDetail_start),
                                drive.startAddress
                                    ?: coordinates(drive.startLat, drive.startLon)
                                    ?: stringResource(R.string.translation_driveDetail_noAddress),
                            ),
                            KVItem(
                                stringResource(R.string.translation_driveDetail_destination),
                                drive.endAddress
                                    ?: coordinates(drive.endLat, drive.endLon)
                                    ?: stringResource(R.string.translation_driveDetail_noAddress),
                            ),
                            KVItem(
                                stringResource(R.string.translation_driveDetail_distance),
                                formatter.distance(drive.distanceM),
                            ),
                        ),
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_driveDetail_noRouteData))
            }
        }
    }
}

/** Journey details — start / destination addresses (web `JourneyDetailsPanel`). */
@Composable
private fun JourneyDetailsSection(drive: Drive) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_journeyDetailsFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_journeyDetails)) {
            KVList(
                items =
                    listOf(
                        KVItem(
                            stringResource(R.string.translation_driveDetail_start),
                            drive.startAddress ?: stringResource(R.string.translation_driveDetail_noAddress),
                        ),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_destination),
                            drive.endAddress ?: stringResource(R.string.translation_driveDetail_noAddress),
                        ),
                    ),
            )
        }
    }
}

/** Drive overview — distance / duration / speed summary (web `DriveOverviewChart`). */
@Composable
private fun OverviewChartSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_overviewChartFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_driveChart)) {
            KVList(
                items =
                    listOf(
                        KVItem(stringResource(R.string.translation_driveDetail_distance), formatter.distance(drive.distanceM)),
                        KVItem(
                            stringResource(R.string.translation_driveDetail_duration),
                            formatter.duration(durationSeconds(drive)),
                        ),
                        KVItem(stringResource(R.string.translation_driveDetail_avgSpeed), formatter.speed(drive.avgSpeedMps)),
                        KVItem(stringResource(R.string.translation_driveDetail_maxSpeed), formatter.speed(drive.maxSpeedMps)),
                    ),
            )
        }
    }
}

/** SOC over time — start → end state of charge, or the empty state (web `SocChart`). */
@Composable
private fun SocChartSection(drive: Drive) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_socChartFailed)) {
        val hasSoc = drive.startBatteryPct != null || drive.endBatteryPct != null
        SectionPanel(title = stringResource(R.string.translation_driveDetail_socOverTime)) {
            if (hasSoc) {
                KVList(
                    items =
                        listOf(
                            KVItem(stringResource(R.string.translation_driveDetail_start), batteryPct(drive.startBatteryPct)),
                            KVItem(stringResource(R.string.translation_driveDetail_end), batteryPct(drive.endBatteryPct)),
                        ),
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_driveDetail_noChartData))
            }
        }
    }
}

/** Elevation profile — no per-sample elevation in the aggregate model, so the web-faithful empty state. */
@Composable
private fun ElevationChartSection() {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_elevationChartFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_elevProfile)) {
            EmptyState(message = stringResource(R.string.translation_driveDetail_noChartData))
        }
    }
}

/** Temperatures — average cabin / ambient, or the no-temperature empty state (web `TemperatureSection`). */
@Composable
private fun TemperatureSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_temperatureFailed)) {
        val hasTemp = drive.insideTempAvgC != null || drive.outsideTempAvgC != null
        SectionPanel(title = stringResource(R.string.translation_driveDetail_temperatures)) {
            if (hasTemp) {
                KVList(
                    items =
                        listOf(
                            KVItem(
                                stringResource(R.string.translation_driveDetail_avgInsideTemp),
                                formatter.temperature(drive.insideTempAvgC),
                            ),
                            KVItem(
                                stringResource(R.string.translation_driveDetail_avgOutsideTemp),
                                formatter.temperature(drive.outsideTempAvgC),
                            ),
                        ),
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_driveDetail_noTemperatureData))
            }
        }
    }
}

/** Speed histogram — needs per-sample speeds (not in the aggregate model), so the web-faithful empty state. */
@Composable
private fun SpeedHistogramSection() {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_speedHistogramFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_speedHistogram)) {
            EmptyState(message = stringResource(R.string.translation_driveDetail_noChartData))
        }
    }
}

/** Helix speed-profile insights intro (web `AISpeedProfileInsights`). Separate parity unit owns the narrative. */
@Composable
private fun AiSpeedProfileSection() {
    DriveDetailSection(
        fallbackTitle = stringResource(R.string.translation_driveDetail_section_aiSpeedProfileInsightsFailed),
    ) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_aiSpeedProfile_title)) {
            Caption(stringResource(R.string.translation_driveDetail_aiSpeedProfile_badge))
            BodyText(stringResource(R.string.translation_driveDetail_aiSpeedProfile_description))
        }
    }
}

/** Power profile — average power, or the empty state when absent (web `PowerProfileChart`). */
@Composable
private fun PowerProfileSection(
    drive: Drive,
    formatter: UnitFormatter,
) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_powerProfileFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_powerProfile)) {
            if (drive.avgPowerW != null) {
                KVList(
                    items =
                        listOf(
                            KVItem(stringResource(R.string.translation_driveDetail_avgPower), formatter.power(drive.avgPowerW)),
                        ),
                )
            } else {
                EmptyState(message = stringResource(R.string.translation_driveDetail_noChartData))
            }
        }
    }
}

/** Tire pressure — needs per-sample pressure (not in the aggregate model), so the web-faithful empty state. */
@Composable
private fun TirePressureSection() {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_tirePressureFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_tirePressure)) {
            EmptyState(message = stringResource(R.string.translation_driveDetail_noChartData))
        }
    }
}

/** Why did this drive end — the recorded end status (web `WhyEndedPanel`). */
@Composable
private fun WhyEndedSection(drive: Drive) {
    DriveDetailSection(fallbackTitle = stringResource(R.string.translation_driveDetail_section_whyEndedFailed)) {
        SectionPanel(title = stringResource(R.string.translation_driveDetail_whyEnded_title)) {
            BodyText(drive.endedStatus ?: stringResource(R.string.translation_driveDetail_inProgress))
        }
    }
}

// ── Formatting helpers (display boundary) ─────────────────────────────────────────────────────────────────────

/** The localized medium-date / short-time formatter for the device zone (web `useDateFormat().formatTime`). */
@Composable
private fun rememberDriveDateTimeFormat(): DateTimeFormatter =
    remember {
        DateTimeFormatter
            .ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .withZone(ZoneId.systemDefault())
    }

/** Formats an epoch-millisecond stamp, or the em-dash fallback when absent. */
private fun DateTimeFormatter.formatEpochMillis(epochMillis: Long?): String =
    epochMillis?.let { format(Instant.ofEpochMilli(it)) } ?: EM_DASH

/** The drive duration in whole seconds as a Double, for the SI duration formatter. */
private fun durationSeconds(drive: Drive): Double =
    drive.durationS.toDouble() // parity:allow numeric widening of Long seconds to Double for the SI formatter

/** Formats a state-of-charge percentage, or the em-dash fallback when absent. */
private fun batteryPct(pct: Long?): String = pct?.let { "$it%" } ?: EM_DASH

/** Formats the start→end state-of-charge range, or the em-dash fallback when both are absent. */
private fun batteryRange(
    start: Long?,
    end: Long?,
): String = if (start == null && end == null) EM_DASH else batteryPct(start) + ARROW + batteryPct(end)

/** Formats the consumed battery percentage (start − end), or the em-dash fallback when either is absent. */
private fun batteryUsed(
    start: Long?,
    end: Long?,
): String = if (start != null && end != null) "${start - end}%" else EM_DASH

/** Formats a lat/lon pair to four decimals, or `null` when either is absent. */
private fun coordinates(
    lat: Double?,
    lon: Double?,
): String? = if (lat != null && lon != null) String.format(Locale.US, "%.4f, %.4f", lat, lon) else null
