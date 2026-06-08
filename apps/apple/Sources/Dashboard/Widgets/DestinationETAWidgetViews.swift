import SwiftUI

// MARK: - Shell chrome

/// Card-less shell mirroring the web `WidgetShell`: an optional title row with the
/// navigation glyph, a freshness chip, and a refresh control, over the content.
/// The dashboard grid cell supplies the surrounding panel, so the shell itself
/// adds no card — matching the web `relative h-full flex flex-col` container.
struct DestinationETAShell<Content: View>: View {
    let title: LocalizedStringKey?
    let freshness: DestinationETAFreshness
    let onRefresh: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.top, TSSpacing.md)
        .padding(.bottom, TSSpacing.sm)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if let title {
                Image(systemName: "location.north.line.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(title)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            if freshness != .live {
                DestinationETAFreshnessChip(freshness: freshness)
            }
            DestinationETARefreshButton(action: onRefresh)
        }
    }
}

/// Stale / offline chip, shown only when the data is not live.
struct DestinationETAFreshnessChip: View {
    let freshness: DestinationETAFreshness

    var body: some View {
        switch freshness {
        case .live:
            EmptyView()
        case .stale:
            TSBadge("widget.freshness.stale", tone: .warning)
        case .offline:
            TSBadge("widget.freshness.offline", tone: .danger)
        }
    }
}

/// Compact refresh affordance.
struct DestinationETARefreshButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("translation.common.refresh"))
    }
}

// MARK: - Navigating layout

/// The full navigating layout: destination, ETA countdown, distance, progress.
struct DestinationETANavigatingView: View {
    let viewState: DestinationETAViewState
    let distance: Double
    let distanceUnit: String

    private var distanceText: String {
        distance.formatted(.number.precision(.fractionLength(1)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            destinationRow
            metricsRow
            progressSection
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var destinationRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "location.north.line.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: viewState.destinationName)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(minHeight: 44, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: viewState.destinationName))
    }

    private var metricsRow: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                TSAnimatedNumber(formatted: viewState.roundedMinutes.formatted())
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: viewState.etaText)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("translation.widget.destinationETA.eta"))
            .accessibilityValue(Text(verbatim: "\(viewState.roundedMinutes) min"))

            Spacer(minLength: TSSpacing.md)

            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: distanceText)
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: distanceUnit)
                    .font(Font.TS.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("translation.widget.destinationETA.remaining"))
            .accessibilityValue(Text(verbatim: "\(distanceText) \(distanceUnit)"))
        }
    }

    private var progressSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricBar(fraction: viewState.progressFraction, tone: .accent)
            HStack {
                Text("translation.widget.destinationETA.remaining")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Spacer()
                Text(verbatim: "\(distanceText) \(distanceUnit)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Idle + compact pieces

/// Standard idle layout: location glyph, badge, "No active navigation".
struct DestinationETAIdleView: View {
    let location: DestinationETALocationKind

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: location.symbol)
                .font(.system(size: 30))
                .accessibilityHidden(true)
            TSBadge(location.labelKey, tone: location.tone)
            Text("translation.widget.destinationETA.noNav")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(location.labelKey))
        .accessibilityValue(Text("translation.widget.destinationETA.noNav"))
    }
}

/// Compact ETA countdown big number.
struct DestinationETABigCountdown: View {
    let minutes: Int

    var body: some View {
        VStack(spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                TSAnimatedNumber(formatted: minutes.formatted())
                    .foregroundStyle(Color.TS.accent)
                Text("translation.widget.destinationETA.min")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text("translation.widget.destinationETA.eta")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("translation.widget.destinationETA.eta"))
        .accessibilityValue(Text(verbatim: "\(minutes) min"))
    }
}

/// Compact location badge.
struct DestinationETALocationBadge: View {
    let location: DestinationETALocationKind
    let prominent: Bool

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: location.symbol)
                .font(.system(size: prominent ? 30 : 24))
                .accessibilityHidden(true)
            TSBadge(location.labelKey, tone: location.tone)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .frame(minHeight: 44)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(location.labelKey))
    }
}

// MARK: - Empty + error

/// Empty state when no location snapshot is on record (web `!snapshot`).
struct DestinationETAEmptyView: View {
    let compact: Bool

    var body: some View {
        TSEmptyState(
            title: "translation.widget.destinationETA.noData",
            systemImage: "location.slash"
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, compact ? TSSpacing.sm : TSSpacing.md)
    }
}

/// Error state mirroring the web `QueryError` branch, with an offline variant.
struct DestinationETAErrorView: View {
    let error: FacadeError
    let onRetry: () -> Void

    var body: some View {
        Group {
            if error == .offline {
                offlineState
            } else {
                TSQueryError(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.md)
    }

    private var offlineState: some View {
        TSEmptyState(
            title: "widget.freshness.offline",
            message: "translation.widget.destinationETA.noData",
            systemImage: "wifi.slash",
            actions: { TSButton("translation.common.refresh", variant: .secondary, size: .small, action: onRetry) }
        )
    }
}
