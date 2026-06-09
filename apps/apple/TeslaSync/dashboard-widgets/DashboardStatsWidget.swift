//
//  DashboardStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  The composable Dashboard Stats surface — SwiftUI parity of
//  features/dashboard/widgets/DashboardStatsWidget.tsx. Binds through `DashboardStatsModel`
//  (no networking in the view); renders every state (loading / empty / error / stale / offline /
//  content) and all three layouts (compact big-number / standard grid + current-state / wide
//  recent-transitions).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension DashboardStatsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - DashboardStatsWidget (the dashboard surface)

/// The composable Dashboard Stats dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/DashboardStatsWidget.tsx`. Renders every state from the web source
/// inside a glass widget shell, binding through `DashboardStatsModel` (P1/S8). No networking here.
public struct DashboardStatsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DashboardStatsSurface.slug

    /// Canonical registry metadata (registry/system.ts → "dashboard-stats").
    public static let registration = DashboardStatsSurface.registration

    @State private var model: DashboardStatsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: DashboardStatsModel,
        size: DashboardWidgetSize = DashboardStatsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = DashboardStatsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The 1-column minimum (1×2) collapses to the single big-number layout (web `isCompact`).
    private var isCompact: Bool {
        DashboardStatsModel.isCompact(for: size)
    }

    /// Three+ columns add the recent-transitions list (web `isWide`).
    private var isWide: Bool {
        DashboardStatsModel.isWide(for: size)
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

extension DashboardStatsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "rectangle.grid.2x2.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DashboardStatsPalette.icon)
                    .accessibilityHidden(true)
                DashboardStatsStrings.text("widget.dashboardStats.title", "Dashboard Stats")
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
            return DashboardStatsStrings.string("widget.dashboardStats.updating", "Updating")
        }
        switch model.connection {
        case .live: return DashboardStatsStrings.string("widget.dashboardStats.live", "Live")
        case .stale: return DashboardStatsStrings.string("widget.dashboardStats.stale", "Stale")
        case .offline: return DashboardStatsStrings.string("widget.dashboardStats.offline", "Offline")
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
        .accessibilityLabel(DashboardStatsStrings.text("widget.dashboardStats.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                DashboardStatsStrings.text("widget.dashboardStats.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(DashboardStatsStrings.text("widget.dashboardStats.openA11y", "Open the dashboard"))
    }
}

// MARK: - Content states

extension DashboardStatsWidget {
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
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 110, height: 12, cornerRadius: TSRadius.sm)
            LazyVGrid(columns: gridColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 52, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 64, height: 18, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(DashboardStatsStrings.text("widget.dashboardStats.loading", "Loading dashboard stats"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                DashboardStatsStrings.text("widget.dashboardStats.noData", "No dashboard stats available")
            } icon: {
                Image(systemName: "rectangle.grid.2x2")
            }
        } description: {
            DashboardStatsStrings.text(
                "widget.dashboardStats.emptyHint",
                "Stats will appear once your dashboard has data."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            DashboardStatsStrings.text("widget.dashboardStats.errorTitle", "Couldn't load dashboard stats")
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
                DashboardStatsStrings.text("widget.dashboardStats.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(DashboardStatsStrings.text("widget.dashboardStats.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loaded content (compact / standard / wide)

extension DashboardStatsWidget {
    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2)
    }

    private func loadedContent(_ projection: DashboardStatsProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                DashboardStatsBigNumber(value: projection.compactTripValue)
            } else {
                standardBody(projection)
                if isWide {
                    transitionsSection(projection)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: DashboardStatsAccessibility.summary(for: projection)))
    }

    private func standardBody(_ projection: DashboardStatsProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(projection.statItems) { item in
                    DashboardStatTile(item: item)
                }
            }
            HStack(spacing: TSSpacing.sm) {
                DashboardStatsStrings.text("widget.dashboardStats.currentState", "Current State")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                DashboardFsmStateBadge(rawState: projection.fsmState)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func transitionsSection(_ projection: DashboardStatsProjection) -> some View {
        let recent = Array(projection.transitions.prefix(5))
        if !recent.isEmpty {
            let now = Date()
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                DashboardSectionCaption(
                    key: "widget.dashboardStats.recentTransitions",
                    fallback: "Recent Transitions"
                )
                ScrollView {
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        ForEach(recent) { row in
                            DashboardTransitionRowView(row: row, now: now)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.dashboardStats.offlineBanner" : "widget.dashboardStats.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known stats"
            : "Reconnecting — stats may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            DashboardStatsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
