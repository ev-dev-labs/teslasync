//
//  CostBreakdownWidget.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  The composable Cost Breakdown dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/CostBreakdownWidget.tsx. Binds through CostBreakdownModel
//  (no networking in the view); renders every state and both layouts (compact / standard).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension CostBreakdownStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - CostBreakdownWidget (the dashboard surface)

/// The composable Cost Breakdown dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/CostBreakdownWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) and both layouts (compact big-number /
/// standard donut + ranked list + stat cards) inside a glass widget shell, binding through
/// `CostBreakdownModel` (P1/S8). No networking lives here.
public struct CostBreakdownWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = CostBreakdownSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "cost-breakdown").
    public static let registration = CostBreakdownSurface.registration

    @State private var model: CostBreakdownModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: CostBreakdownModel,
        size: DashboardWidgetSize = CostBreakdownWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = CostBreakdownWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var layout: CostBreakdownLayout {
        CostBreakdownLayout.resolve(size)
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

// MARK: - Header (web `WidgetShell` chrome)

extension CostBreakdownWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if layout != .compact {
                Image(systemName: "chart.pie.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                CostBreakdownStrings.text("widget.costBreakdown.title", "Cost Breakdown")
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
            if layout != .compact, let updatedAt = model.updatedAt {
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
            return CostBreakdownStrings.string("widget.costBreakdown.updating", "Updating")
        }
        switch model.connection {
        case .live: return CostBreakdownStrings.string("widget.costBreakdown.live", "Live")
        case .stale: return CostBreakdownStrings.string("widget.costBreakdown.stale", "Stale")
        case .offline: return CostBreakdownStrings.string("widget.costBreakdown.offline", "Offline")
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
        .accessibilityLabel(CostBreakdownStrings.text("widget.costBreakdown.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                CostBreakdownStrings.text("widget.costBreakdown.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(CostBreakdownStrings.text("widget.costBreakdown.openA11y", "Open the Analytics page"))
    }
}

// MARK: - Content states (web `WidgetShell` body)

extension CostBreakdownWidget {
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
            if layout == .compact {
                CostBreakdownSkeletonCompact()
            } else {
                CostBreakdownSkeletonStandard()
            }
        }
        .accessibilityElement()
        .accessibilityLabel(CostBreakdownStrings.text("widget.costBreakdown.loading", "Loading cost breakdown"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                CostBreakdownStrings.text("widget.costBreakdown.noData", "No cost data")
            } icon: {
                Image(systemName: "chart.pie")
            }
        } description: {
            CostBreakdownStrings.text(
                "widget.costBreakdown.emptyHint",
                "Charge your vehicle to start tracking what each month costs."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            CostBreakdownStrings.text("widget.costBreakdown.errorTitle", "Couldn't load cost breakdown")
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
                CostBreakdownStrings.text("widget.costBreakdown.retry", "Retry")
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

    private func loadedContent(_ projection: CostBreakdownProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            switch layout {
            case .compact:
                CostBreakdownCompactValue(compact: projection.compact)
            case .standard:
                standardContent(projection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: CostBreakdownAccessibility.summary(for: projection, layout: layout)))
    }

    private func standardContent(_ projection: CostBreakdownProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            CostBreakdownDonutChart(segments: projection.donutSegments)
                .frame(height: 140)
            CostBreakdownRankedList(items: projection.rankedItems)
            CostBreakdownStatGrid(cards: projection.statCards)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.costBreakdown.offlineBanner" : "widget.costBreakdown.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known costs"
            : "Reconnecting — costs may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            CostBreakdownStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
