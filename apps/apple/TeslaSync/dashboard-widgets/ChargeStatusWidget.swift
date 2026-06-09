//
//  ChargeStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0021 · ChargeStatusWidget (Apple)
//
//  The composable Charge Status dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ChargeStatusWidget.tsx. Binds through `ChargeStatusModel`
//  (no networking in the view); renders every state and both bodies (charging / idle).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension ChargeStatusStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - ChargeStatusWidget (the dashboard surface)

/// The composable Charge Status dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ChargeStatusWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) inside a glass widget shell,
/// binding through `ChargeStatusModel` (P1/S8). No networking lives here.
public struct ChargeStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ChargeStatusSurface.slug

    /// Canonical registry metadata (registry/charging.ts → "charge-status").
    public static let registration = ChargeStatusSurface.registration

    @State private var model: ChargeStatusModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: ChargeStatusModel,
        size: DashboardWidgetSize = ChargeStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = ChargeStatusWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// The 1-column minimum (1×2) collapses the metric grid to a single column; the default
    /// 2×2 and larger keep the web's two-column grid.
    private var isCompact: Bool {
        size.cols <= 1
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

extension ChargeStatusWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                ChargeStatusStrings.text("widget.chargeStatus.title", "Charge Status")
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
            return ChargeStatusStrings.string("widget.chargeStatus.updating", "Updating")
        }
        switch model.connection {
        case .live: return ChargeStatusStrings.string("widget.chargeStatus.live", "Live")
        case .stale: return ChargeStatusStrings.string("widget.chargeStatus.stale", "Stale")
        case .offline: return ChargeStatusStrings.string("widget.chargeStatus.offline", "Offline")
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
        .accessibilityLabel(ChargeStatusStrings.text("widget.chargeStatus.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                ChargeStatusStrings.text("widget.chargeStatus.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(ChargeStatusStrings.text("widget.chargeStatus.openA11y", "Open the Charging page"))
    }
}

// MARK: - Content states

extension ChargeStatusWidget {
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
            TSSkeleton(width: 96, height: 12, cornerRadius: TSRadius.sm)
            LazyVGrid(columns: gridColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 48, height: 8, cornerRadius: TSRadius.sm)
                        TSSkeleton(width: 72, height: 18, cornerRadius: TSRadius.sm)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(ChargeStatusStrings.text("widget.chargeStatus.loading", "Loading charge status"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                ChargeStatusStrings.text("widget.noChargeData", "No charge data")
            } icon: {
                Image(systemName: "bolt")
            }
        } description: {
            ChargeStatusStrings.text(
                "widget.chargeStatus.emptyHint",
                "Charge data will appear once your vehicle reports in."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            ChargeStatusStrings.text("widget.chargeStatus.errorTitle", "Couldn't load charge status")
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
                ChargeStatusStrings.text("widget.chargeStatus.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(ChargeStatusStrings.text("widget.chargeStatus.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func loadedContent(_ projection: ChargeStatusProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            switch projection {
            case let .charging(charging):
                chargingBody(charging)
            case let .idle(idle):
                idleBody(idle)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ChargeStatusAccessibility.summary(for: projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.chargeStatus.offlineBanner" : "widget.chargeStatus.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known charge state"
            : "Reconnecting — charge state may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            ChargeStatusStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Charging + idle bodies

extension ChargeStatusWidget {
    private var gridColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 2)
    }

    private func chargingBody(_ charging: ChargingProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                ChargingPulseIcon()
                ChargeStatusStrings.text("widget.charging", "Charging")
                    .font(Font.TS.label)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.statusSuccess)
            }
            LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(charging.metrics) { metric in
                    if isCompact {
                        ChargeMetricView(metric: metric)
                    } else {
                        ChargeMetricTile(metric: metric)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func idleBody(_ idle: IdleProjection) -> some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ChargeStatusStrings.text("widget.notCharging", "Not Charging")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: idle.summary)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
}
