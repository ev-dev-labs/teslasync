//
//  AnalyticsSummaryWidget.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  The composable Analytics Summary dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/AnalyticsSummaryWidget.tsx. Binds through AnalyticsSummaryModel
//  (no networking in the view); renders every state (loading / empty / error / stale / offline /
//  content) and every layout (compact 1×2 / standard 2×2 / wide 4×2).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helpers (P1/S10)

public extension AnalyticsSummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - AnalyticsSummaryWidget (the dashboard surface)

/// The composable Analytics Summary dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/AnalyticsSummaryWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) and all three layouts inside a
/// glass widget shell, binding through `AnalyticsSummaryModel` (P1/S8). No networking lives here.
public struct AnalyticsSummaryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AnalyticsSummarySurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "analytics-summary").
    public static let registration = AnalyticsSummarySurface.registration

    @State private var model: AnalyticsSummaryModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: AnalyticsSummaryModel,
        size: DashboardWidgetSize = AnalyticsSummaryWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = AnalyticsSummaryWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the 1-column big-number layout.
    private var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 4` — the 4-up grid + sparkline row.
    private var isWide: Bool {
        size.cols >= 4
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
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

extension AnalyticsSummaryWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "chart.bar.xaxis")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                AnalyticsSummaryStrings.text("widget.analyticsSummary.title", "Analytics Summary")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if !isCompact, let updatedAt = model.updatedAt {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                Text(updatedAt, style: .relative)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessTone: Color {
        if model.isFetching { return Color.TS.accent }
        switch model.connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.textMuted
        }
    }

    private var freshnessLabel: String {
        if model.isFetching {
            return AnalyticsSummaryStrings.string("widget.analyticsSummary.updating", "Updating")
        }
        switch model.connection {
        case .live: return AnalyticsSummaryStrings.string("widget.analyticsSummary.live", "Live")
        case .stale: return AnalyticsSummaryStrings.string("widget.analyticsSummary.stale", "Stale")
        case .offline: return AnalyticsSummaryStrings.string("widget.analyticsSummary.offline", "Offline")
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(AnalyticsSummaryStrings.text("widget.analyticsSummary.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                AnalyticsSummaryStrings.text("widget.analyticsSummary.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(AnalyticsSummaryStrings.text("widget.analyticsSummary.openA11y", "Open the Analytics page"))
    }
}

// MARK: - Content states

extension AnalyticsSummaryWidget {
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
                loadedContent(projection)
            } else {
                emptyState
            }
        }
    }

    private var loadingChrome: some View {
        Group {
            if isCompact {
                VStack(alignment: .center, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 90, height: 26, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 60, height: 8, cornerRadius: TSRadius.sm)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                TSStatGridSkeleton(count: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            AnalyticsSummaryStrings.text("widget.analyticsSummary.loading", "Loading analytics summary")
        )
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                AnalyticsSummaryStrings.text("widget.analyticsSummary.noData", "No analytics data")
            } icon: {
                Image(systemName: "chart.bar.xaxis")
            }
        } description: {
            AnalyticsSummaryStrings.text(
                "widget.analyticsSummary.emptyHint",
                "Drive and charge to build a fleet-wide snapshot."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            AnalyticsSummaryStrings.text("widget.analyticsSummary.errorTitle", "Couldn't load analytics")
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
                AnalyticsSummaryStrings.text("widget.analyticsSummary.retry", "Retry")
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

    private func loadedContent(_ projection: AnalyticsSummaryProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                compactValue(projection)
            } else {
                statGrid(projection)
                if isWide, projection.hasSparklines {
                    sparklineRow(projection)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.analyticsSummary.offlineBanner" : "widget.analyticsSummary.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known snapshot"
            : "Reconnecting — snapshot may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            AnalyticsSummaryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // Compact: a single big animated distance number with a unit suffix and a role caption.
    private func compactValue(_ projection: AnalyticsSummaryProjection) -> some View {
        VStack(spacing: 2) {
            TSAnimatedNumber(formatted: "\(projection.compactValue) \(projection.distanceSymbol)")
                .foregroundStyle(Color.TS.accent)
            AnalyticsSummaryStrings.text("widget.analyticsSummary.totalDistance", "Total Distance")
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: AnalyticsSummaryAccessibility.compactLabel(for: projection)))
    }

    /// Standard / Wide: a responsive grid of stat tiles (web `WidgetStatGrid`, 2-up / 4-up).
    private func statGrid(_ projection: AnalyticsSummaryProjection) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
            count: isWide ? 4 : 2
        )
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(projection.stats) { item in
                AnalyticsSummaryStatTile(item: item)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: AnalyticsSummaryAccessibility.summary(for: projection)))
    }

    /// Wide-only trend row (web `sparklines.map(...)` under `grid grid-cols-4`).
    private func sparklineRow(_ projection: AnalyticsSummaryProjection) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.md),
            count: 4
        )
        return LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(projection.sparklines) { series in
                TSSparkline(values: series.values, colorIndex: series.colorIndex)
                    .frame(height: 30)
                    .accessibilityHidden(true)
            }
        }
    }
}
