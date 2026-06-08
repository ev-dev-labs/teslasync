//
//  WarrantyStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  The composable Warranty dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WarrantyStatusWidget.tsx. Binds through
//  `WarrantyModel` (no networking in the view); renders every state across the
//  compact (cols ≤ 1) and standard layouts.
//

import Foundation
import SwiftUI

// MARK: - WarrantyStatusWidget (the dashboard surface)

/// The composable Warranty dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WarrantyStatusWidget.tsx`. Renders every state from
/// the web source (loading / empty / error / stale / offline / content) inside a
/// glass widget shell, binding through `WarrantyModel` (P1/S8). No networking lives
/// here.
public struct WarrantyStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "WarrantyStatusWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "warranty-status").
    public static let registration = DashboardWidgetRegistration(
        id: "warranty-status",
        nameKey: "widget.warranty.title",
        descriptionKey: "widget.warranty.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: WarrantyModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: WarrantyModel,
        size: DashboardWidgetSize = WarrantyStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = WarrantyStatusWidget.registration.clamp(size)
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1` — the headline-only 1-column layout.
    var isCompact: Bool {
        size.cols <= 1
    }

    var projection: WarrantyProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: WarrantyConnection {
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

extension WarrantyStatusWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "checkmark.shield.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                WarrantyStrings.text("widget.warranty.title", "Warranty Status")
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
            label = WarrantyStrings.string("widget.warranty.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = WarrantyStrings.string("widget.warranty.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = WarrantyStrings.string("widget.warranty.offline", "Offline")
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
        .accessibilityLabel(WarrantyStrings.text("widget.warranty.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                WarrantyStrings.text("widget.warranty.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(WarrantyStrings.text("widget.warranty.openA11y", "Open the Warranty page"))
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension WarrantyStatusWidget {
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
                TSSkeleton(width: 24, height: 24, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 48, height: 28, cornerRadius: TSRadius.sm)
                    .frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 64, height: 10).frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                TSSkeleton(width: 110, height: 10)
                TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
                TSSkeleton(width: 130, height: 10)
                TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
                ForEach(0 ..< 3, id: \.self) { _ in
                    HStack(spacing: TSSpacing.md) {
                        TSSkeleton(width: 70, height: 10)
                        Spacer(minLength: 0)
                        TSSkeleton(width: 56, height: 12)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(WarrantyStrings.text("widget.warranty.loading", "Loading warranty"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                WarrantyStrings.text("widget.warranty.noData", "No warranty data")
            } icon: {
                Image(systemName: "checkmark.shield.fill")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            WarrantyStrings.text("widget.warranty.errorTitle", "Couldn't load warranty")
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
                WarrantyStrings.text("widget.warranty.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WarrantyStrings.text("widget.warranty.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.warranty.offlineBanner" : "widget.warranty.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            WarrantyStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Variant → tone mapping (web colour map)

extension WarrantyVariant {
    /// Maps the web variant to a shared design-token tone. Web `success → #10b981`,
    /// `warning → #f59e0b`, `error → #ef4444` ⇒ the status-success/warning/danger
    /// tokens.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .warning: .warning
        case .error: .danger
        }
    }
}
