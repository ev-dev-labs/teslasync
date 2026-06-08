//
//  MileageStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0064 · MileageStatsWidget (Apple)
//
//  The composable Mileage Stats dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MileageStatsWidget.tsx. Binds through
//  MileageStatsModel (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content, in both the compact
//  (1-column big-number) and standard (2×2 stat grid) layouts.
//

import Foundation
import SwiftUI

// MARK: - MileageStatsWidget (the dashboard surface)

/// The composable Mileage Stats dashboard widget. Renders driving averages
/// (daily / weekly / monthly) plus the next 10k milestone projection inside a
/// glass widget shell, binding through `MileageStatsModel` (P1/S8). No
/// networking lives here.
public struct MileageStatsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MileageStatsWidget"

    /// Canonical registry metadata (registry/analytics.ts → "mileage-stats").
    public static let registration = DashboardWidgetRegistration(
        id: "mileage-stats",
        nameKey: "widget.mileageStats",
        descriptionKey: "widget.mileageStats.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MileageStatsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MileageStatsModel,
        size: DashboardWidgetSize = MileageStatsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MileageStatsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        MileageStatsModel.isCompact(for: size)
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

extension MileageStatsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                MileageStatsStrings.text("widget.mileageStats.title", "Mileage Stats")
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
            label = MileageStatsStrings.string("widget.mileageStats.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MileageStatsStrings.string("widget.mileageStats.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MileageStatsStrings.string("widget.mileageStats.offline", "Offline")
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
        .accessibilityLabel(MileageStatsStrings.text("widget.mileageStats.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MileageStatsStrings.text("widget.mileageStats.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MileageStatsStrings.text("widget.mileageStats.openA11y", "Open the analytics page"))
    }
}

// MARK: - Content states

extension MileageStatsWidget {
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
        Group {
            if isCompact {
                TSSkeleton(height: 36, cornerRadius: TSRadius.md)
                    .frame(maxWidth: 120, maxHeight: .infinity, alignment: .center)
            } else {
                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
                    spacing: TSSpacing.sm
                ) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        TSSkeleton(height: 58, cornerRadius: TSRadius.md)
                    }
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(MileageStatsStrings.text("widget.mileageStats.loading", "Loading mileage stats"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                MileageStatsStrings.text("widget.mileageStats.noData", "No mileage data")
            } icon: {
                Image(systemName: "chart.line.uptrend.xyaxis")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MileageStatsStrings.text("widget.mileageStats.errorTitle", "Couldn't load mileage stats")
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
                MileageStatsStrings.text("widget.mileageStats.retry", "Retry")
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

extension MileageStatsWidget {
    private func compactContent(_ projection: MileageStatsProjection) -> some View {
        VStack(spacing: TSSpacing.xs) {
            MileageBigNumber(
                formatted: MileageNumberFormat.integer(projection.dailyAvgDisplay)
            )
            Text(verbatim: "\(projection.unit.symbol)/\(MileageStatsStrings.string("widget.mileageStats.day", "day"))")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(MileageStatsAccessibility.summary(for: projection))
    }

    private func standardContent(_ projection: MileageStatsProjection) -> some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            LazyVGrid(
                columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2),
                spacing: TSSpacing.sm
            ) {
                ForEach(tiles(for: projection)) { tile in
                    MileageStatTile(data: tile)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text(verbatim: MileageStatsAccessibility.summary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.mileageStats.offlineBanner" : "widget.mileageStats.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known totals"
            : "Reconnecting — totals may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            MileageStatsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private func tiles(for projection: MileageStatsProjection) -> [MileageStatTileData] {
        let unit = projection.unit.symbol
        let trend: String = projection.monthsToMilestone > 0
            ? MileageStatsStrings.format("widget.mileageStats.inMonths", "~%lld mo", projection.monthsToMilestone)
            : "—"
        return [
            MileageStatTileData(
                id: "daily",
                label: MileageStatsStrings.string("widget.mileageStats.dailyAvg", "Daily Avg"),
                value: MileageNumberFormat.decimal(projection.dailyAvgDisplay, fractionDigits: 1),
                unit: unit,
                systemImage: "road.lanes"
            ),
            MileageStatTileData(
                id: "weekly",
                label: MileageStatsStrings.string("widget.mileageStats.weeklyAvg", "Weekly Avg"),
                value: MileageNumberFormat.decimal(projection.weeklyAvgDisplay, fractionDigits: 0),
                unit: unit,
                systemImage: "calendar"
            ),
            MileageStatTileData(
                id: "monthly",
                label: MileageStatsStrings.string("widget.mileageStats.monthlyAvg", "Monthly Avg"),
                value: MileageNumberFormat.decimal(projection.monthlyAvgDisplay, fractionDigits: 0),
                unit: unit,
                systemImage: "chart.line.uptrend.xyaxis"
            ),
            MileageStatTileData(
                id: "milestone",
                label: MileageStatsStrings.string("widget.mileageStats.nextMilestone", "Next Milestone"),
                value: MileageNumberFormat.integer(projection.milestone),
                unit: unit,
                systemImage: "target",
                trend: trend
            )
        ]
    }
}
