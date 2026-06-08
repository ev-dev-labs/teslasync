//
//  WatchSummaryWidget.swift
//  TeslaSync — P4 dashboard widget · 0114 · WatchSummaryWidget (Apple)
//
//  The composable Watch Summary dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WatchSummaryWidget.tsx. An Apple Watch-style glance (battery, range,
//  state, lock status) that renders a compact watch-face layout at 1 column and a fuller battery
//  hero + detail grid at 2 columns. Binds through `WatchSummaryModel` (P1/S8); no networking lives
//  in the view. Renders every state from the web source (loading / empty / error / stale / offline
//  / content).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension WatchSummaryStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - WatchSummaryWidget (the dashboard surface)

/// The composable Watch Summary dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WatchSummaryWidget.tsx`. Renders every state from the web source
/// inside a glass widget shell, binding through `WatchSummaryModel` (P1/S8). No networking here.
public struct WatchSummaryWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WatchSummarySurface.slug

    /// Canonical registry metadata (registry/vehicle.ts → "watch-summary").
    public static let registration = WatchSummarySurface.registration

    @State private var model: WatchSummaryModel
    private let size: DashboardWidgetSize

    public init(
        model: WatchSummaryModel,
        size: DashboardWidgetSize = WatchSummaryWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = WatchSummaryWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — the single-column watch-face layout (no title chrome).
    private var isCompact: Bool {
        WatchSummaryLayout.isCompact(cols: size.cols)
    }

    /// The display projection, derived per render from the model's cached summary — the native
    /// parity of the web `useMemo` derives (battery/range/temp conversions + tones + lock + state).
    private var projection: WatchSummaryProjection {
        WatchSummaryProjector.project(summary: model.summary, units: model.units)
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

extension WatchSummaryWidget {
    @ViewBuilder
    private var header: some View {
        if isCompact {
            HStack(spacing: TSSpacing.xs) {
                Spacer(minLength: 0)
                freshnessDot
                refreshButton
            }
        } else {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "applewatch")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                WatchSummaryStrings.text("widget.watchSummary", "Watch Summary")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                Spacer(minLength: TSSpacing.sm)
                freshnessChip
                refreshButton
            }
        }
    }

    private var freshnessDot: some View {
        Circle()
            .fill(freshnessTone)
            .frame(width: 6, height: 6)
            .accessibilityLabel(Text(verbatim: freshnessLabel))
    }

    private var freshnessChip: some View {
        HStack(spacing: 4) {
            Circle().fill(freshnessTone).frame(width: 6, height: 6)
            Text(verbatim: freshnessLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
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
            return WatchSummaryStrings.string("widget.watchSummary.updating", "Updating")
        }
        switch model.connection {
        case .live: return WatchSummaryStrings.string("widget.watchSummary.live", "Live")
        case .stale: return WatchSummaryStrings.string("widget.watchSummary.stale", "Stale")
        case .offline: return WatchSummaryStrings.string("widget.watchSummary.offline", "Offline")
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
        .accessibilityLabel(WatchSummaryStrings.text("widget.watchSummary.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension WatchSummaryWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            WatchSummarySkeleton(compact: isCompact)
                .accessibilityElement()
                .accessibilityLabel(
                    WatchSummaryStrings.text("widget.watchSummary.loading", "Loading watch summary")
                )
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            loadedContent
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                WatchSummaryStrings.text("widget.noWatchData", "No watch data")
            } icon: {
                Image(systemName: "applewatch.slash")
            }
        } description: {
            WatchSummaryStrings.text(
                "widget.watchSummary.emptyHint",
                "Battery, range and lock status will appear here once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
            WatchSummaryStrings.text("widget.watchSummary.errorTitle", "Couldn't load watch summary")
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
                WatchSummaryStrings.text("widget.watchSummary.retry", "Retry")
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

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if !isCompact, model.connection != .live { connectivityBanner }
            if isCompact {
                compactLayout
            } else {
                standardLayout
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WatchSummaryAccessibility.summary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.watchSummary.offlineBanner" : "widget.watchSummary.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known glance"
            : "Reconnecting — glance may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            WatchSummaryStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Compact (1×2): watch-face circular display

extension WatchSummaryWidget {
    private var compactLayout: some View {
        VStack(spacing: TSSpacing.xs) {
            Spacer(minLength: 0)
            WatchBatteryRing(
                value: projection.batteryValue,
                valueText: projection.batteryText,
                tone: projection.batteryTone
            )
            if let state = projection.state {
                WatchStatePill(state: state)
            }
            if projection.rangeDisplay != nil {
                Text(verbatim: "\(projection.rangeText) \(projection.rangeUnit)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .monospacedDigit()
                    .lineLimit(1)
            }
            if projection.charging {
                WatchChargingPip(text: WatchSummaryStrings.string("widget.charging", "Charging"))
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Standard (2×2+): battery hero + detail grid

extension WatchSummaryWidget {
    private var standardLayout: some View {
        VStack(spacing: TSSpacing.md) {
            WatchBigNumber(
                valueText: projection.batteryBigText,
                label: WatchSummaryStrings.string("widget.battery", "Battery"),
                badge: projection.state.map { (text: $0.raw, tone: $0.badgeTone) }
            )
            detailGrid
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var detailGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: TSSpacing.sm),
            GridItem(.flexible(), spacing: TSSpacing.sm)
        ]
        return LazyVGrid(columns: columns, spacing: TSSpacing.sm) {
            WatchStatCell(caption: WatchSummaryStrings.string("widget.range", "Range")) {
                WatchValueUnit(
                    valueText: projection.rangeText,
                    unit: projection.rangeUnit,
                    hasValue: projection.rangeDisplay != nil
                )
            }
            WatchStatCell(caption: WatchSummaryStrings.string("widget.lockStatus", "Lock")) {
                WatchLockChip(
                    lock: projection.lock,
                    lockedText: WatchSummaryStrings.string("widget.locked", "Locked"),
                    unlockedText: WatchSummaryStrings.string("widget.unlocked", "Unlocked")
                )
            }
            WatchStatCell(caption: WatchSummaryStrings.string("widget.cabinTemp", "Cabin")) {
                WatchValueUnit(
                    valueText: projection.cabinText,
                    unit: projection.cabinUnit,
                    hasValue: projection.cabinDisplay != nil
                )
            }
            WatchStatCell(caption: WatchSummaryStrings.string("widget.lastSeen", "Last Seen")) {
                Text(verbatim: projection.lastSeenText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
        }
    }
}
