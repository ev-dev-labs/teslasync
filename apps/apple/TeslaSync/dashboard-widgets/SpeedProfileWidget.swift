//
//  SpeedProfileWidget.swift
//  TeslaSync — P4 dashboard widget · 0095 · SpeedProfileWidget (Apple)
//
//  The composable Speed Profile dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SpeedProfileWidget.tsx. Binds through
//  SpeedProfileModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content, in both the standard
//  (stat header + composed chart) and compact (summary stats) layouts.
//

import Foundation
import SwiftUI

// MARK: - SpeedProfileWidget (the dashboard surface)

/// The composable Speed Profile dashboard widget. Renders the speed-distribution
/// histogram with its efficiency overlay plus the Most Common / Peak Freq / Sweet
/// Spot summary inside a glass widget shell, binding through `SpeedProfileModel`
/// (P1/S8). No networking lives here.
public struct SpeedProfileWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SpeedProfileWidget"

    /// Canonical registry metadata (registry/driving.ts → "speed-profile").
    public static let registration = DashboardWidgetRegistration(
        id: "speed-profile",
        nameKey: "widget.speedProfile",
        descriptionKey: "widget.speedProfile.description",
        category: "driving",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SpeedProfileModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SpeedProfileModel,
        size: DashboardWidgetSize = SpeedProfileWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = SpeedProfileWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        SpeedProfileModel.isCompact(for: size)
    }

    private var isWide: Bool {
        size.cols >= 3
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension SpeedProfileWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "waveform.path.ecg")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SpeedProfileStrings.text("widget.speedProfile.title", "Speed Profile")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil, !isCompact { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SpeedProfileStrings.string("widget.speedProfile.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SpeedProfileStrings.string("widget.speedProfile.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SpeedProfileStrings.string("widget.speedProfile.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SpeedProfileStrings.text("widget.speedProfile.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SpeedProfileStrings.text("widget.speedProfile.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(SpeedProfileStrings.text("widget.speedProfile.openA11y", "Open the driving analytics page"))
    }
}

// MARK: - Content states

extension SpeedProfileWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                if isCompact {
                    compactContent(projection)
                } else {
                    standardContent(projection)
                }
            } else {
                emptyState
            }
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                ForEach(0 ..< (isCompact ? 2 : 3), id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 52, height: 9)
                        TSSkeleton(width: 64, height: 16)
                    }
                }
            }
            if !isCompact {
                TSSkeleton(height: 120, cornerRadius: TSRadius.md)
                    .frame(maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(SpeedProfileStrings.text("widget.speedProfile.loading", "Loading speed profile"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                SpeedProfileStrings.text("widget.speedProfile.noData", "No speed data")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SpeedProfileStrings.text("widget.speedProfile.errorTitle", "Couldn't load speed profile")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                SpeedProfileStrings.text("widget.speedProfile.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content (compact + standard)

extension SpeedProfileWidget {
    private func compactContent(_ projection: SpeedProfileProjection) -> some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
            spacing: TSSpacing.sm
        ) {
            ForEach(compactStats(projection)) { stat in
                SpeedProfileStatCell(data: stat)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text(verbatim: SpeedProfileAccessibility.summary(for: projection)))
    }

    private func standardContent(_ projection: SpeedProfileProjection) -> some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            HStack(alignment: .top, spacing: TSSpacing.lg) {
                ForEach(standardStats(projection)) { stat in
                    SpeedProfileStatCell(data: stat)
                }
            }
            SpeedProfileChart(
                bars: projection.bars,
                isWide: isWide,
                frequencyName: SpeedProfileStrings.string("widget.speedProfile.frequency", "Frequency"),
                efficiencyName: SpeedProfileStrings.string("widget.speedProfile.efficiency", "Wh/mi"),
                speedAxisName: SpeedProfileStrings.string("widget.speedProfile.title", "Speed Profile")
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            SpeedProfileLegend(
                frequencyName: SpeedProfileStrings.string("widget.speedProfile.frequency", "Frequency"),
                efficiencyName: SpeedProfileStrings.string("widget.speedProfile.efficiency", "Wh/mi")
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text(verbatim: SpeedProfileAccessibility.summary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.speedProfile.offlineBanner" : "widget.speedProfile.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded speed profile"
            : "Reconnecting — speed profile may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SpeedProfileStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func standardStats(_ projection: SpeedProfileProjection) -> [SpeedProfileStatData] {
        [
            SpeedProfileStatData(
                id: "mostCommon",
                label: SpeedProfileStrings.string("widget.speedProfile.mostCommon", "Most Common"),
                value: projection.peakBucket,
                unit: projection.unit.symbol
            ),
            SpeedProfileStatData(
                id: "peakFreq",
                label: SpeedProfileStrings.string("widget.speedProfile.peakFreq", "Peak Freq"),
                value: SpeedProfileNumberFormat.percent(projection.peakFrequency),
                unit: nil
            ),
            SpeedProfileStatData(
                id: "sweetSpot",
                label: SpeedProfileStrings.string("widget.speedProfile.sweetSpot", "Sweet Spot"),
                value: projection.sweetSpot,
                unit: projection.unit.symbol
            )
        ]
    }

    private func compactStats(_ projection: SpeedProfileProjection) -> [SpeedProfileStatData] {
        [
            SpeedProfileStatData(
                id: "mostCommon",
                label: SpeedProfileStrings.string("widget.speedProfile.mostCommon", "Most Common"),
                value: projection.peakBucket,
                unit: projection.unit.symbol
            ),
            SpeedProfileStatData(
                id: "sweetSpot",
                label: SpeedProfileStrings.string("widget.speedProfile.sweetSpot", "Sweet Spot"),
                value: projection.sweetSpot,
                unit: projection.unit.symbol
            )
        ]
    }
}
