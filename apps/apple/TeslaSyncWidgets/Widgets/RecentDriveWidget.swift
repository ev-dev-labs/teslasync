import SwiftUI
import WidgetKit

/// Recent drive widget: the latest completed trip's distance, duration, efficiency,
/// and when it ended. Deep-links to the Trips route.
struct RecentDriveWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetKind.recentDrive, provider: TeslaSyncTimelineProvider()) { entry in
            RecentDriveEntryView(entry: entry)
        }
        .configurationDisplayName(Text("widget.recentDrive.displayName"))
        .description(Text("widget.recentDrive.description"))
        .supportedFamilies(WidgetFamilies.system)
    }
}

struct RecentDriveEntryView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TeslaSyncWidgetEntry

    var body: some View {
        content
            .widgetURL(WidgetDeepLink.recentDrive.url)
            .widgetSurface(for: family)
    }

    @ViewBuilder private var content: some View {
        if let drive = entry.snapshot.recentDrive, entry.freshness != .offline {
            loaded(drive)
        } else {
            offline
        }
    }

    @ViewBuilder private func loaded(_ drive: RecentDriveSummary) -> some View {
        switch family {
        case .systemSmall:
            RecentDriveSmallView(drive: drive)
        case .systemMedium:
            RecentDriveMediumView(drive: drive)
        default:
            RecentDriveLargeView(drive: drive, freshness: entry.freshness)
        }
    }

    @ViewBuilder private var offline: some View {
        if entry.snapshot.recentDrive == nil, entry.freshness != .offline {
            WidgetUnavailableView(
                titleKey: "widget.recentDrive.none",
                messageKey: "widget.recentDrive.description",
                systemImage: "car.side"
            )
        } else {
            WidgetOfflineView()
        }
    }
}

private struct RecentDriveSmallView: View {
    let drive: RecentDriveSummary

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            WidgetSectionHeader(titleKey: "widget.recentDrive.displayName", systemImage: "car.side.fill")
            Spacer(minLength: 0)
            WidgetBigValue(value: drive.distanceDisplay, captionKey: "widget.recentDrive.distance")
            Text(verbatim: drive.title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            Text(drive.endedAt, style: .relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

private struct RecentDriveMediumView: View {
    let drive: RecentDriveSummary

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.recentDrive.displayName", systemImage: "car.side.fill")
                Spacer()
                Text(verbatim: drive.title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
            RecentDriveMetricsRow(drive: drive)
            Spacer(minLength: 0)
            Text(drive.endedAt, style: .relative)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

private struct RecentDriveLargeView: View {
    let drive: RecentDriveSummary
    let freshness: WidgetFreshness

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack {
                WidgetSectionHeader(titleKey: "widget.recentDrive.displayName", systemImage: "car.side.fill")
                Spacer()
                WidgetFreshnessChip(freshness: freshness)
            }
            Text(verbatim: drive.title)
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            RecentDriveMetricsRow(drive: drive)
            Spacer(minLength: 0)
            HStack {
                Label {
                    Text(drive.endedAt, style: .relative)
                } icon: {
                    Image(systemName: "flag.checkered")
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                Spacer()
                WidgetUpdatedLabel(date: drive.sampledAt)
            }
        }
    }
}

private struct RecentDriveMetricsRow: View {
    let drive: RecentDriveSummary

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            WidgetMetric(titleKey: "widget.recentDrive.distance", value: drive.distanceDisplay)
            WidgetMetric(titleKey: "widget.recentDrive.duration", value: drive.durationDisplay)
            WidgetMetric(titleKey: "widget.recentDrive.efficiency", value: drive.efficiencyDisplay)
        }
    }
}
