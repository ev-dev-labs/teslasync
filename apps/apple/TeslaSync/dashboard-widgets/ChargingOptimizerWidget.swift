//
//  ChargingOptimizerWidget.swift
//  TeslaSync — P4 dashboard widget · 0022 · ChargingOptimizerWidget (Apple)
//
//  The composable Charging Optimizer dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargingOptimizerWidget.tsx. Binds through
//  `ChargingOptimizerModel` (no networking in the view); renders every state
//  across the compact (cols ≤ 1), standard (2×2), and wide (cols ≥ 4) layouts.
//

import Foundation
import SwiftUI

// MARK: - ChargingOptimizerWidget (the dashboard surface)

/// The composable Charging Optimizer dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargingOptimizerWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `ChargingOptimizerModel` (P1/S8).
/// No networking lives here.
public struct ChargingOptimizerWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ChargingOptimizerWidget"

    /// Canonical registry metadata (registry/charging.ts → "charging-optimizer").
    public static let registration = DashboardWidgetRegistration(
        id: "charging-optimizer",
        nameKey: "widget.chargingOptimizer.title",
        descriptionKey: "widget.chargingOptimizer.description",
        category: "charging",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ChargingOptimizerModel
    let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargingOptimizerModel,
        size: DashboardWidgetSize = ChargingOptimizerWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargingOptimizerWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 4` — adds the 24-hour rate timeline + more tips.
    var isWide: Bool {
        size.cols >= 4
    }

    var projection: ChargingOptimizerProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: ChargingOptimizerConnection {
        model.connection
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

// MARK: - Header (web WidgetShell header + freshness)

extension ChargingOptimizerWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "sparkles")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                ChargingOptimizerStrings.text("widget.chargingOptimizer.title", "Charging Optimizer")
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
            label = ChargingOptimizerStrings.string("widget.chargingOptimizer.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ChargingOptimizerStrings.string("widget.chargingOptimizer.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ChargingOptimizerStrings.string("widget.chargingOptimizer.offline", "Offline")
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
        .accessibilityLabel(ChargingOptimizerStrings.text("widget.chargingOptimizer.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargingOptimizerStrings.text("widget.chargingOptimizer.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ChargingOptimizerStrings.text(
            "widget.chargingOptimizer.openA11y",
            "Open the Charging page"
        ))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension ChargingOptimizerWidget {
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
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if isCompact {
                Spacer(minLength: 0)
                TSSkeleton(width: 64, height: 24, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 72, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                    TSSkeleton(height: 52, cornerRadius: TSRadius.md)
                }
                TSSkeleton(height: 14)
                ForEach(0 ..< 2, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(ChargingOptimizerStrings.text(
            "widget.chargingOptimizer.loading",
            "Loading charging optimizer"
        ))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargingOptimizerStrings.text("widget.chargingOptimizer.noData", "No optimizer data")
            } icon: {
                Image(systemName: "sparkles")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargingOptimizerStrings.text("widget.chargingOptimizer.errorTitle", "Couldn't load optimizer")
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
                ChargingOptimizerStrings.text("widget.chargingOptimizer.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargingOptimizerStrings.text("widget.chargingOptimizer.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.chargingOptimizer.offlineBanner" : "widget.chargingOptimizer.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargingOptimizerStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
