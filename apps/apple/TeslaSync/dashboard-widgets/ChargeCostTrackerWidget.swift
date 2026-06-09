//
//  ChargeCostTrackerWidget.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  The composable Charge Cost Tracker dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargeCostTrackerWidget.tsx. Binds through ChargeCostModel
//  (no networking in the view); renders every state and every layout (compact / standard / tall).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension ChargeCostStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargeCostTrackerWidget (the dashboard surface)

/// The composable Charge Cost Tracker dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargeCostTrackerWidget.tsx`. Renders every state from the web source
/// (loading / empty / error / stale / offline / content) and all three layouts inside a glass widget
/// shell, binding through `ChargeCostModel` (P1/S8). No networking lives here.
public struct ChargeCostTrackerWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargeCostSurface.slug

    /// Canonical registry metadata (registry/charging.ts → "charge-cost-tracker").
    public static let registration = ChargeCostSurface.registration

    @State private var model: ChargeCostModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargeCostModel,
        size: DashboardWidgetSize = ChargeCostTrackerWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargeCostTrackerWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    private var layout: ChargeCostLayout {
        ChargeCostLayout.resolve(size)
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

extension ChargeCostTrackerWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if layout != .compact {
                Image(systemName: "dollarsign.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                ChargeCostStrings.text("widget.chargeCost.title", "Charge Cost Tracker")
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
            return ChargeCostStrings.string("widget.chargeCost.updating", "Updating")
        }
        switch model.connection {
        case .live: return ChargeCostStrings.string("widget.chargeCost.live", "Live")
        case .stale: return ChargeCostStrings.string("widget.chargeCost.stale", "Stale")
        case .offline: return ChargeCostStrings.string("widget.chargeCost.offline", "Offline")
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
        .accessibilityLabel(ChargeCostStrings.text("widget.chargeCost.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargeCostStrings.text("widget.chargeCost.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ChargeCostStrings.text("widget.chargeCost.openA11y", "Open the Charging page"))
    }
}

// MARK: - Content states (web `WidgetShell` body)

extension ChargeCostTrackerWidget {
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
                VStack(alignment: .center, spacing: TSSpacing.sm) {
                    ChargeCostSkeletonBlock(width: 96, height: 26)
                    ChargeCostSkeletonBlock(width: 64, height: 8)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ChargeCostSkeletonGrid(count: layout == .tall ? 4 : 2)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(ChargeCostStrings.text("widget.chargeCost.loading", "Loading charge costs"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargeCostStrings.text("widget.chargeCost.noData", "No charge data")
            } icon: {
                Image(systemName: "dollarsign.circle")
            }
        } description: {
            ChargeCostStrings.text(
                "widget.chargeCost.emptyHint",
                "Charge your vehicle to start tracking what each session costs."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargeCostStrings.text("widget.chargeCost.errorTitle", "Couldn't load charge costs")
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
                ChargeCostStrings.text("widget.chargeCost.retry", "Retry")
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

    private func loadedContent(_ projection: ChargeCostProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            switch layout {
            case .compact:
                compactValue(projection)
            case .standard:
                metricGrid(projection.tiles(for: .standard))
                footer(projection)
            case .tall:
                metricGrid(projection.tiles(for: .tall))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargeCostAccessibility.summary(for: projection, layout: layout)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.chargeCost.offlineBanner" : "widget.chargeCost.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known costs"
            : "Reconnecting — costs may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargeCostStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    // Compact: a single big total-cost number with a "30-day cost" caption.
    private func compactValue(_ projection: ChargeCostProjection) -> some View {
        VStack(spacing: 2) {
            ChargeCostCompactTotal(formatted: projection.compactValue)
            Text(verbatim: projection.compactCaption)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(projection.compactValue) \(projection.compactCaption)"))
    }

    private func metricGrid(_ tiles: [ChargeCostTile]) -> some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
                GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading)
            ],
            alignment: .leading,
            spacing: TSSpacing.sm
        ) {
            ForEach(tiles) { tile in
                ChargeCostMetricTile(tile: tile)
            }
        }
    }

    /// Standard layout footer: cost-per-distance on the left, gas savings on the right.
    private func footer(_ projection: ChargeCostProjection) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.footerLeft)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: projection.footerRight)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, TSSpacing.xs)
        .accessibilityElement(children: .combine)
    }
}
