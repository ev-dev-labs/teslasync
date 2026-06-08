//
//  VehicleUpgradesWidget.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  The composable "Upgrades & Sharing" dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VehicleUpgradesWidget.tsx. Binds through
//  `VehicleUpgradesModel` (no networking in the view); renders every state across
//  the compact (cols ≤ 1) and standard / wide layouts.
//

import Foundation
import SwiftUI

// MARK: - VehicleUpgradesWidget (the dashboard surface)

/// The composable "Upgrades & Sharing" dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VehicleUpgradesWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `VehicleUpgradesModel` (P1/S8). No
/// networking lives here.
public struct VehicleUpgradesWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleUpgradesWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-upgrades").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-upgrades",
        nameKey: "widget.upgrades.title",
        descriptionKey: "widget.upgrades.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: VehicleUpgradesModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: VehicleUpgradesModel,
        size: DashboardWidgetSize = VehicleUpgradesWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = VehicleUpgradesWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    /// Web `isWide = size.cols >= 3` — promotes the per-row eligibility caption.
    var isWide: Bool {
        size.cols >= 3
    }

    var projection: UpgradesProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: UpgradesConnection {
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

extension VehicleUpgradesWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                UpgradesStrings.text("widget.upgrades.title", "Upgrades & Sharing")
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
            label = UpgradesStrings.string("widget.upgrades.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = UpgradesStrings.string("widget.upgrades.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = UpgradesStrings.string("widget.upgrades.offline", "Offline")
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
        .accessibilityLabel(UpgradesStrings.text("widget.upgrades.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                UpgradesStrings.text("widget.upgrades.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(UpgradesStrings.text("widget.upgrades.openA11y", "Open the Upgrades page"))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension VehicleUpgradesWidget {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            if isCompact {
                compactContent
            } else {
                emptyState
            }
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
                TSSkeleton(width: 40, height: 28, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 64, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                TSSkeleton(width: 120, height: 10)
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 52, height: 12, cornerRadius: TSRadius.pill)
                    }
                }
                TSSkeleton(width: 90, height: 10).padding(.top, TSSpacing.xs)
                TSSkeleton(height: 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(UpgradesStrings.text("widget.upgrades.loading", "Loading upgrades"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                UpgradesStrings.text("widget.upgrades.noData", "No upgrade data")
            } icon: {
                Image(systemName: "arrow.up.circle.fill")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            UpgradesStrings.text("widget.upgrades.errorTitle", "Couldn't load upgrades")
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
                UpgradesStrings.text("widget.upgrades.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(UpgradesStrings.text("widget.upgrades.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.upgrades.offlineBanner" : "widget.upgrades.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            UpgradesStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
