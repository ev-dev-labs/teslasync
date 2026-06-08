//
//  LifetimeStatsWidget.swift
//  TeslaSync — P4 dashboard widget · 0055 · LifetimeStatsWidget (Apple)
//
//  The composable Lifetime Stats dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/LifetimeStatsWidget.tsx. Binds through LifetimeStatsModel
//  (no networking in the view); renders every state and every layout (compact / standard / wide).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension LifetimeStatsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - LifetimeStatsWidget (the dashboard surface)

/// The composable Lifetime Stats dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/LifetimeStatsWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) and all three layouts inside a
/// glass widget shell, binding through `LifetimeStatsModel` (P1/S8). No networking lives here.
public struct LifetimeStatsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LifetimeStatsSurface.slug

    /// Canonical registry metadata (registry/analytics.ts → "lifetime-stats").
    public static let registration = LifetimeStatsSurface.registration

    @State private var model: LifetimeStatsModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: LifetimeStatsModel,
        size: DashboardWidgetSize = LifetimeStatsWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = LifetimeStatsWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var isCompact: Bool {
        size.cols <= 1
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

extension LifetimeStatsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                LifetimeStatsStrings.text("widget.lifetimeStats.title", "Lifetime Stats")
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
            return LifetimeStatsStrings.string("widget.lifetimeStats.updating", "Updating")
        }
        switch model.connection {
        case .live: return LifetimeStatsStrings.string("widget.lifetimeStats.live", "Live")
        case .stale: return LifetimeStatsStrings.string("widget.lifetimeStats.stale", "Stale")
        case .offline: return LifetimeStatsStrings.string("widget.lifetimeStats.offline", "Offline")
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
        .accessibilityLabel(LifetimeStatsStrings.text("widget.lifetimeStats.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                LifetimeStatsStrings.text("widget.lifetimeStats.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LifetimeStatsStrings.text("widget.lifetimeStats.openA11y", "Open the Lifetime Stats page"))
    }
}

// MARK: - Content states

extension LifetimeStatsWidget {
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
                TSStatGridSkeleton(count: isWide ? 8 : 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(LifetimeStatsStrings.text("widget.lifetimeStats.loading", "Loading lifetime stats"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                LifetimeStatsStrings.text("widget.lifetimeStats.noData", "No lifetime data")
            } icon: {
                Image(systemName: "trophy.fill")
            }
        } description: {
            LifetimeStatsStrings.text(
                "widget.lifetimeStats.emptyHint",
                "Drive and charge to build up your lifetime totals."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LifetimeStatsStrings.text("widget.lifetimeStats.errorTitle", "Couldn't load lifetime stats")
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
                LifetimeStatsStrings.text("widget.lifetimeStats.retry", "Retry")
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

    private func loadedContent(_ projection: LifetimeStatsProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            if isCompact {
                compactValue(projection)
            } else {
                statGrid(projection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.lifetimeStats.offlineBanner" : "widget.lifetimeStats.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known totals"
            : "Reconnecting — totals may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            LifetimeStatsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // Compact: a single big lifetime-distance number with a unit caption.
    private func compactValue(_ projection: LifetimeStatsProjection) -> some View {
        VStack(spacing: 2) {
            TSAnimatedNumber(formatted: projection.compactValue)
            HStack(spacing: 4) {
                Text(verbatim: projection.distanceSymbol)
                LifetimeStatsStrings.text("widget.lifetimeStats.lifetime", "lifetime")
            }
            .font(Font.TS.caption)
            .textCase(.uppercase)
            .tracking(0.6)
            .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: compactAccessibilityLabel(projection)))
    }

    private func compactAccessibilityLabel(_ projection: LifetimeStatsProjection) -> String {
        let lifetime = LifetimeStatsStrings.string("widget.lifetimeStats.lifetime", "lifetime")
        return "\(projection.compactValue) \(projection.distanceSymbol) \(lifetime)"
    }

    /// Standard / Wide: a responsive grid of stat tiles.
    private func statGrid(_ projection: LifetimeStatsProjection) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
            count: isWide ? 4 : 2
        )
        return LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(projection.stats(isWide: isWide)) { item in
                LifetimeStatTile(item: item)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            Text(verbatim: LifetimeStatsAccessibility.summary(for: projection, isWide: isWide))
        )
    }
}

// MARK: - Stat tile (web `StatCard` within `WidgetStatGrid`)

/// One compact stat tile: icon + label over a value with an optional unit suffix. The native
/// parity of the web `StatCard` used inside `WidgetStatGrid`.
private struct LifetimeStatTile: View {
    let item: LifetimeStatItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: item.systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: item.value)
                    .font(Font.TS.panel)
                    .fontWeight(.semibold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
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
