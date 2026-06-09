//
//  VehicleSpecsWidget.swift
//  TeslaSync — P4 dashboard widget · 0109 · VehicleSpecsWidget (Apple)
//
//  The composable "Vehicle Specs" dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VehicleSpecsWidget.tsx. Binds through
//  `VehicleSpecsModel` (no networking in the view); renders every state across
//  the compact (cols ≤ 1) headline and the standard detail-card layouts.
//

import Foundation
import SwiftUI

// MARK: - VehicleSpecsWidget (the dashboard surface)

/// The composable "Vehicle Specs" dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VehicleSpecsWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `VehicleSpecsModel` (P1/S8). No networking
/// lives here.
public struct VehicleSpecsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "VehicleSpecsWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-specs").
    public static let registration = DashboardWidgetRegistration(
        id: "vehicle-specs",
        nameKey: "widget.vehicleSpecs",
        descriptionKey: "widget.specs.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: VehicleSpecsModel
    private let size: DashboardWidgetSize

    public init(
        model: VehicleSpecsModel,
        size: DashboardWidgetSize = VehicleSpecsWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = VehicleSpecsWidget.registration.clamp(size)
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    var projection: SpecsProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: SpecsConnection {
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

extension VehicleSpecsWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "doc.text")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SpecsStrings.text("widget.vehicleSpecs", "Vehicle Specs")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = SpecsStrings.string("widget.specs.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SpecsStrings.string("widget.specs.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SpecsStrings.string("widget.specs.offline", "Offline")
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
        .accessibilityLabel(SpecsStrings.text("widget.specs.refresh", "Refresh"))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension VehicleSpecsWidget {
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
                TSSkeleton(width: 40, height: 24, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 72, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                ForEach(0 ..< 5, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 64, height: 10)
                        Spacer(minLength: TSSpacing.md)
                        TSSkeleton(width: 96, height: 12)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(SpecsStrings.text("widget.specs.loading", "Loading specs"))
    }

    /// Web top-level `<EmptyState … message="No specs available" />`.
    var emptyState: some View {
        ContentUnavailableView {
            Label {
                SpecsStrings.text("widget.specs.noData", "No specs available")
            } icon: {
                Image(systemName: "doc.text")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SpecsStrings.text("widget.specs.errorTitle", "Couldn't load specs")
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
                SpecsStrings.text("widget.specs.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SpecsStrings.text("widget.specs.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.specs.offlineBanner" : "widget.specs.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SpecsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
