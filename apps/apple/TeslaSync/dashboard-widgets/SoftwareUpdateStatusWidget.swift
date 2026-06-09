//
//  SoftwareUpdateStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  The composable Software Update dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx. Binds through
//  `SoftwareStatusModel` (no networking in the view); renders every state across
//  the compact (cols ≤ 1 && rows ≤ 1) and standard layouts.
//

import Foundation
import SwiftUI

// MARK: - SoftwareUpdateStatusWidget (the dashboard surface)

/// The composable Software Update dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/SoftwareUpdateStatusWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content) inside
/// a glass widget shell, binding through `SoftwareStatusModel` (P1/S8). No
/// networking lives here.
public struct SoftwareUpdateStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "SoftwareUpdateStatusWidget"

    /// Canonical registry metadata (registry/vehicle.ts → "software-update-status").
    public static let registration = DashboardWidgetRegistration(
        id: "software-update-status",
        nameKey: "widget.softwareUpdate",
        descriptionKey: "widget.softwareUpdate.description",
        category: "vehicle",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: SoftwareStatusModel
    let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: SoftwareStatusModel,
        size: DashboardWidgetSize = SoftwareUpdateStatusWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        // Render the size the grid hands us (web parity — the component reads `size`
        // directly). The dashboard grid keeps it inside the registry envelope via
        // `registration.clamp(_:)`; with the canonical 1×2 minimum the compact branch
        // never appears in production, exactly as on the web.
        self.size = size
        self.onOpen = onOpen
    }

    /// Web `isCompact = size.cols <= 1 && size.rows <= 1` — the headline-only tile.
    var isCompact: Bool {
        size.cols <= 1 && size.rows <= 1
    }

    /// Web `isTall = size.rows >= 2` — gates the estimate + schedule rows.
    var isTall: Bool {
        size.rows >= 2
    }

    var projection: SoftwareStatusProjection {
        model.projection
    }

    /// Live freshness from the bound model (web `DataFreshness` connection state).
    var connection: SoftwareStatusConnection {
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

extension SoftwareUpdateStatusWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "laptopcomputer.and.iphone")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                SoftwareStatusStrings.text("widget.softwareUpdate", "Software Update")
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
            label = SoftwareStatusStrings.string("widget.softwareUpdate.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = SoftwareStatusStrings.string("widget.softwareUpdate.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = SoftwareStatusStrings.string("widget.softwareUpdate.offline", "Offline")
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
        .accessibilityLabel(SoftwareStatusStrings.text("widget.softwareUpdate.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                SoftwareStatusStrings.text("widget.softwareUpdate.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(
            SoftwareStatusStrings.text("widget.softwareUpdate.openA11y", "Open the Software Update page")
        )
    }
}

// MARK: - Content states (web shell loading / empty + body)

extension SoftwareUpdateStatusWidget {
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
                TSSkeleton(width: 56, height: 14).frame(maxWidth: .infinity, alignment: .center)
                TSSkeleton(width: 64, height: 16, cornerRadius: TSRadius.pill)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer(minLength: 0)
            } else {
                HStack {
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 80, height: 10)
                        TSSkeleton(width: 120, height: 14)
                    }
                    Spacer(minLength: 0)
                    TSSkeleton(width: 72, height: 18, cornerRadius: TSRadius.pill)
                }
                TSSkeleton(width: 140, height: 10)
                TSSkeleton(height: 8, cornerRadius: TSRadius.pill)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement()
        .accessibilityLabel(SoftwareStatusStrings.text("widget.softwareUpdate.loading", "Loading software status"))
    }

    var emptyState: some View {
        ContentUnavailableView {
            Label {
                SoftwareStatusStrings.text("widget.noSoftwareData", "No software data")
            } icon: {
                Image(systemName: "laptopcomputer.and.iphone")
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            SoftwareStatusStrings.text("widget.softwareUpdate.errorTitle", "Couldn't load software status")
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
                SoftwareStatusStrings.text("widget.softwareUpdate.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(SoftwareStatusStrings.text("widget.softwareUpdate.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    var connectivityBanner: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "widget.softwareUpdate.offlineBanner" : "widget.softwareUpdate.staleBanner"
        let fallback = isOffline ? "Offline — showing last known data" : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            SoftwareStatusStrings.text(key, fallback).font(Font.TS.caption)
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

extension SoftwareStatusBadgeVariant {
    /// Maps the web badge variant to a shared design-token tone. Web
    /// `success → emerald`, `info → cyan`, `warning → amber`, `neutral → muted`.
    var tone: TSTone {
        switch self {
        case .success: .success
        case .info: .info
        case .warning: .warning
        case .neutral: .neutral
        }
    }
}

extension SoftwareStatusProgressKind {
    /// The web `MetricBar` colour per flow: cyan `#22d3ee` download, violet
    /// `#a78bfa` install — mapped to the shared design tokens so no raw hex lives in
    /// the rendered output.
    var color: Color {
        switch self {
        case .downloading: Color.TS.statusInfo
        case .installing: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Localization facade `Text` helper

extension SoftwareStatusStrings {
    /// Resolves a key through the facade and wraps it as a verbatim `Text` (no
    /// double localization).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
