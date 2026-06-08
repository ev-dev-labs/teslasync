//
//  DrivingTemperatureStats.Views.swift
//  TeslaSync — P4 feature view · 0057 · DrivingTemperatureStats (Apple)
//
//  The presentational chrome composed by `DrivingTemperatureStats`: the freshness chip,
//  the stale/offline connectivity banner, the six-cell metric grid (web `<MetricCard>` ×6),
//  and the loading / empty / error states. All consume pre-localized strings from the P1/S10
//  facade and the shared P1/S9 tokens + components — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Localization helper (SwiftUI side of the P1/S10 facade)

extension DrivingTemperatureStrings {
    /// `Text` wrapper over `string(_:_:)` so views resolve the per-surface table without
    /// hardcoded literals (web `t(key, default)`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Metric color → semantic tone (web NeonColor → P1/S9 token)

extension DrivingTempMetricColor {
    /// Maps the web `MetricCard` NeonColor to a semantic tone token (cyan → info,
    /// green → success, amber → warning) for the cell's icon box.
    var tone: TSTone {
        switch self {
        case .cyan: .info
        case .green: .success
        case .amber: .warning
        }
    }
}

// MARK: - Grid layout

/// The responsive metric grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`): adaptive
/// columns wrap from two on a narrow phone panel up to six on a wide iPad / Mac surface.
enum DrivingTemperatureLayout {
    static let columns = [GridItem(.adaptive(minimum: 132, maximum: .infinity), spacing: TSSpacing.md)]
}

// MARK: - Metric cell (web `<MetricCard>`)

/// One temperature metric cell — the SwiftUI parity of the web `<MetricCard>`: a truncating
/// label, the formatted value, the display-unit subtitle, and a tinted thermometer icon box.
struct DrivingTemperatureMetricTile: View {
    let tile: DrivingTemperatureTile
    let value: String
    let unit: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            TSIconBox(systemName: "thermometer.medium", tone: tile.color.tone)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var label: String {
        DrivingTemperatureStrings.string(tile.labelKey, tile.labelFallback)
    }

    private var accessibilityLabel: String {
        DrivingTemperatureAccessibility.cellSummary(label: label, value: value, unit: unit)
    }
}

// MARK: - Metric grid (web grid of six cards)

/// The populated state (web `insideTemp || outsideTemp`): the six metric cells in source
/// order. Absent reading groups render the em-dash per cell (handled by the projector).
struct DrivingTemperatureGrid: View {
    let projection: DrivingTemperatureProjection

    var body: some View {
        LazyVGrid(columns: DrivingTemperatureLayout.columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(DrivingTemperatureProjector.tiles) { tile in
                DrivingTemperatureMetricTile(
                    tile: tile,
                    value: DrivingTemperatureProjector.value(for: tile, in: projection),
                    unit: projection.unitSymbol
                )
            }
        }
    }
}

// MARK: - Loading grid (web `<Skeleton>` chrome)

/// The initial-fetch skeleton grid: six redacted cells in the same layout, respecting Reduce
/// Motion through the shared `TSSkeleton`.
struct DrivingTemperatureLoadingGrid: View {
    var body: some View {
        LazyVGrid(columns: DrivingTemperatureLayout.columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< DrivingTemperatureProjector.tiles.count, id: \.self) { _ in
                DrivingTemperatureSkeletonTile()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            DrivingTemperatureStrings.text("analytics.driving.temp.loading", "Loading temperature stats")
        )
    }
}

/// One redacted skeleton cell matching the metric cell chrome.
struct DrivingTemperatureSkeletonTile: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 56, height: 10)
                TSSkeleton(width: 72, height: 20)
                TSSkeleton(width: 28, height: 10)
            }
            Spacer(minLength: 0)
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Empty state (web `<EmptyState>`)

/// The zero-readings state (web `<EmptyState message="No temperature stats" />`): a friendly
/// thermometer glyph plus the localized message, never a blank box.
struct DrivingTemperatureEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "thermometer.medium.slash")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DrivingTemperatureStrings.text("analytics.driving.noTempStats", "No temperature stats")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error state (QueryError equivalent)

/// The failure state (the P4 states contract's `QueryError` equivalent): an icon, a title, the
/// optional message, and a retry affordance wired to the model's refresh.
struct DrivingTemperatureErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            DrivingTemperatureStrings.text("analytics.driving.temp.errorTitle", "Couldn't load temperature stats")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                DrivingTemperatureStrings.text("analytics.driving.temp.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DrivingTemperatureStrings.text("analytics.driving.temp.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct DrivingTemperatureFreshnessChip: View {
    let connection: DrivingTemperatureConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            DrivingTemperatureStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(DrivingTemperatureStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: DrivingTemperatureConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "analytics.driving.temp.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "analytics.driving.temp.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "analytics.driving.temp.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the grid when the bound source is not live, so cached
/// values are clearly labeled (web `DataFreshness` indicator intent).
struct DrivingTemperatureConnectivityBanner: View {
    let connection: DrivingTemperatureConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "analytics.driving.temp.offlineBanner" : "analytics.driving.temp.staleBanner"
        let fallback = offline
            ? "Offline — showing last known temperature stats"
            : "Reconnecting — temperature stats may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            DrivingTemperatureStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
