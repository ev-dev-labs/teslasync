//
//  FleetStatsBarWidget.swift
//  TeslaSync — P4 dashboard widget · 0050 · FleetStatsBarWidget (Apple)
//
//  The composable Fleet Stats Bar dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/FleetStatsBarWidget.tsx. Binds through FleetStatsBarModel
//  (no networking in the view); renders every state and the responsive stat grid
//  (compact 1-col / standard 2-col / wide 4-col bar).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension FleetStatsBarStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - FleetStatsBarWidget (the dashboard surface)

/// The composable Fleet Stats Bar dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/FleetStatsBarWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) and the responsive stat grid
/// inside a glass widget shell, binding through `FleetStatsBarModel` (P1/S8). No networking
/// lives here.
public struct FleetStatsBarWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FleetStatsBarSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "fleet-stats-bar").
    public static let registration = FleetStatsBarSurface.registration

    @State private var model: FleetStatsBarModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: FleetStatsBarModel,
        size: DashboardWidgetSize = FleetStatsBarWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = FleetStatsBarWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.rows < 2` → the stat grid collapses to a single column.
    private var isCompact: Bool {
        size.rows < 2
    }

    /// Column count for the stat grid. Mirrors the web container-query collapse of the 4-up
    /// grid (`grid-cols-2 @sm:grid-cols-4`): one column when compact, the full 4-across bar on
    /// a wide (≥4 grid-cols) widget, and a 2-up grid on the narrower (3 grid-cols) minimum.
    private var columnCount: Int {
        if isCompact { return 1 }
        return size.cols >= 4 ? 4 : 2
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

extension FleetStatsBarWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.2.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            FleetStatsBarStrings.text("widget.fleetStatsBar.title", "Fleet Stats")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
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
            if let updatedAt = model.updatedAt {
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
            return FleetStatsBarStrings.string("widget.fleetStatsBar.updating", "Updating")
        }
        switch model.connection {
        case .live: return FleetStatsBarStrings.string("widget.fleetStatsBar.live", "Live")
        case .stale: return FleetStatsBarStrings.string("widget.fleetStatsBar.stale", "Stale")
        case .offline: return FleetStatsBarStrings.string("widget.fleetStatsBar.offline", "Offline")
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
        .accessibilityLabel(FleetStatsBarStrings.text("widget.fleetStatsBar.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                FleetStatsBarStrings.text("widget.fleetStatsBar.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(FleetStatsBarStrings.text("widget.fleetStatsBar.openA11y", "Open the Fleet Stats page"))
    }
}

// MARK: - Content states

extension FleetStatsBarWidget {
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
        TSStatGridSkeleton(count: isCompact ? 2 : 4)
            .accessibilityElement()
            .accessibilityLabel(FleetStatsBarStrings.text("widget.fleetStatsBar.loading", "Loading fleet stats"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                FleetStatsBarStrings.text("widget.fleetStatsBar.noData", "No fleet data available")
            } icon: {
                Image(systemName: "car.2.fill")
            }
        } description: {
            FleetStatsBarStrings.text(
                "widget.fleetStatsBar.emptyHint",
                "Connect a vehicle to see fleet-wide totals."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            FleetStatsBarStrings.text("widget.fleetStatsBar.errorTitle", "Couldn't load fleet stats")
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
                FleetStatsBarStrings.text("widget.fleetStatsBar.retry", "Retry")
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

    private func loadedContent(_ projection: FleetStatsBarProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            statGrid(projection)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.fleetStatsBar.offlineBanner" : "widget.fleetStatsBar.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known stats"
            : "Reconnecting — stats may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            FleetStatsBarStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// The responsive stat grid (web `WidgetStatGrid`): a grid of stat tiles whose column count
    /// tracks the widget's grid footprint.
    private func statGrid(_ projection: FleetStatsBarProjection) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
            count: columnCount
        )
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(projection.items) { item in
                FleetStatsBarStatTile(item: item)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: FleetStatsBarAccessibility.summary(for: projection)))
    }
}

// MARK: - Stat tile (web `StatCard` within `WidgetStatGrid`)

/// One compact stat tile: icon + label over a value with an optional unit suffix. The native
/// parity of the web `StatCard` used inside `WidgetStatGrid`.
private struct FleetStatsBarStatTile: View {
    let item: FleetStatsBarStatItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Image(systemName: item.systemImage)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: item.value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = item.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: tileAccessibilityLabel))
    }

    private var tileAccessibilityLabel: String {
        if let unit = item.unit {
            return "\(item.label) \(item.value) \(unit)"
        }
        return "\(item.label) \(item.value)"
    }
}
