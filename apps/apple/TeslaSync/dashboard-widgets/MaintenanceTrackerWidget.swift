//
//  MaintenanceTrackerWidget.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  The composable Maintenance dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/MaintenanceTrackerWidget.tsx. Binds through
//  `MaintenanceModel` (no networking in the view); renders every state across the
//  compact (cols ≤ 1) and standard layouts.
//

import Foundation
import SwiftUI

// MARK: - MaintenanceTrackerWidget (the dashboard surface)

/// The composable Maintenance dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/MaintenanceTrackerWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `MaintenanceModel` (P1/S8). No
/// networking lives here.
public struct MaintenanceTrackerWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "MaintenanceTrackerWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "maintenance-tracker").
    public static let registration = DashboardWidgetRegistration(
        id: "maintenance-tracker",
        nameKey: "widget.maintenance.title",
        descriptionKey: "widget.maintenance.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: MaintenanceModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: MaintenanceModel,
        size: DashboardWidgetSize = MaintenanceTrackerWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = MaintenanceTrackerWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    var projection: MaintenanceProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: MaintenanceConnection {
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

extension MaintenanceTrackerWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "wrench.and.screwdriver.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                MaintenanceStrings.text("widget.maintenance.title", "Maintenance")
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
            label = MaintenanceStrings.string("widget.maintenance.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = MaintenanceStrings.string("widget.maintenance.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = MaintenanceStrings.string("widget.maintenance.offline", "Offline")
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
        .accessibilityLabel(MaintenanceStrings.text("widget.maintenance.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                MaintenanceStrings.text("widget.maintenance.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(MaintenanceStrings.text("widget.maintenance.openA11y", "Open the Maintenance page"))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension MaintenanceTrackerWidget {
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
                TSSkeleton(width: 48, height: 28, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 80, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                TSSkeleton(height: 64, cornerRadius: TSRadius.md)
                TSSkeleton(width: 110, height: 10)
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 10, height: 10, cornerRadius: TSRadius.pill)
                        TSSkeleton(height: 12)
                        TSSkeleton(width: 56, height: 12)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(MaintenanceStrings.text("widget.maintenance.loading", "Loading maintenance"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                MaintenanceStrings.text("widget.maintenance.noData", "No maintenance data")
            } icon: {
                Image(systemName: "wrench.and.screwdriver.fill")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            MaintenanceStrings.text("widget.maintenance.errorTitle", "Couldn't load maintenance")
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
                MaintenanceStrings.text("widget.maintenance.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(MaintenanceStrings.text("widget.maintenance.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.maintenance.offlineBanner" : "widget.maintenance.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            MaintenanceStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
