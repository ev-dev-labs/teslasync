//
//  VehicleHeroCardWidget.swift
//  TeslaSync — P4 dashboard widget · 0107 · VehicleHeroCardWidget (Apple)
//
//  The composable Vehicle Hero Card dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/VehicleHeroCardWidget.tsx. Binds through `VehicleHeroModel` (no
//  networking in the view); renders every state (loading / empty / error / stale / offline /
//  content) and both layouts (compact 1×1 / full 2×1+) inside a glass widget shell.
//

import SwiftUI

// MARK: - VehicleHeroCardWidget (the dashboard surface)

/// The composable Vehicle Hero Card dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/VehicleHeroCardWidget.tsx`. Renders every state from the web source
/// inside a glass widget shell, binding through `VehicleHeroModel` (P1/S8). No networking here.
public struct VehicleHeroCardWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = VehicleHeroSurface.slug

    /// Canonical registry metadata (registry/vehicle.ts → "vehicle-hero-card").
    public static let registration = VehicleHeroSurface.registration

    @State private var model: VehicleHeroModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    /// The grid footprint is stored as supplied — the dashboard grid (P4 core) owns sizing and
    /// already honors `registration.clamp(_:)`, exactly as the web grid hands a valid `size` prop
    /// to the component. Keeping it unclamped preserves the web `isCompact` (1×1) branch.
    public init(
        model: VehicleHeroModel,
        size: DashboardWidgetSize = VehicleHeroCardWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = size
        self.onOpen = onOpen
    }

    /// The responsive layout for the current footprint (web `isCompact` / `isWide` / `isTall`).
    private var layout: VehicleHeroLayout {
        VehicleHeroLayout.resolve(cols: size.cols, rows: size.rows)
    }

    private var isCompact: Bool {
        layout == .compact
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

extension VehicleHeroCardWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "car.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                VehicleHeroStrings.text("widget.vehicleHeroCard", "Vehicle")
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
            return VehicleHeroStrings.string("widget.vehicleHeroCard.updating", "Updating")
        }
        switch model.connection {
        case .live: return VehicleHeroStrings.string("widget.vehicleHeroCard.live", "Live")
        case .stale: return VehicleHeroStrings.string("widget.vehicleHeroCard.stale", "Stale")
        case .offline: return VehicleHeroStrings.string("widget.vehicleHeroCard.offline", "Offline")
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
        .accessibilityLabel(VehicleHeroStrings.text("widget.vehicleHeroCard.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                VehicleHeroStrings.text("widget.vehicleHeroCard.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(VehicleHeroStrings.text("widget.vehicleHeroCard.openA11y", "Open the vehicle page"))
    }
}

// MARK: - Content states

extension VehicleHeroCardWidget {
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
            TSSkeleton(width: 120, height: 14, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 80, height: 8, cornerRadius: TSRadius.sm)
            HStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 3, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 48, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 56, height: 16, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(VehicleHeroStrings.text("widget.vehicleHeroCard.loading", "Loading vehicle"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                VehicleHeroStrings.text("widget.noVehicle", "No vehicle data")
            } icon: {
                Image(systemName: "car.fill")
            }
        } description: {
            VehicleHeroStrings.text(
                "widget.vehicleHeroCard.emptyHint",
                "Vehicle data will appear once a vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            VehicleHeroStrings.text("widget.vehicleHeroCard.errorTitle", "Couldn't load vehicle")
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
                VehicleHeroStrings.text("widget.vehicleHeroCard.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(VehicleHeroStrings.text("widget.vehicleHeroCard.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func loadedContent(_ projection: VehicleHeroProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            switch layout {
            case .compact:
                VehicleHeroCompactContent(projection: projection)
            case let .full(isWide, isTall):
                VehicleHeroFullContent(projection: projection, isWide: isWide, isTall: isTall)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.vehicleHeroCard.offlineBanner" : "widget.vehicleHeroCard.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known data"
            : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            VehicleHeroStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
