//
//  LivePowerFlowWidget.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  The composable Live Power Flow dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/LivePowerFlowWidget.tsx. Binds through
//  LivePowerFlowModel (no networking in the view); renders every state inside a
//  glass widget shell.
//

import SwiftUI

// MARK: - LivePowerFlowWidget (the dashboard surface)

/// The composable Live Power Flow dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/LivePowerFlowWidget.tsx`. Renders every state from
/// the web source (loading / no-site / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `LivePowerFlowModel` (P1/S8). No
/// networking lives here.
public struct LivePowerFlowWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LivePowerFlowWidget"

    /// Canonical registry metadata (registry/energy.ts → "live-power-flow").
    public static let registration = DashboardWidgetRegistration(
        id: "live-power-flow",
        nameKey: "widget.livePowerFlow.title",
        descriptionKey: "widget.livePowerFlow.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: LivePowerFlowModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: LivePowerFlowModel,
        size: DashboardWidgetSize = LivePowerFlowWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = LivePowerFlowWidget.registration.clamp(size)
        self.onOpen = onOpen
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

    private var isCompact: Bool {
        LivePowerFlowModel.isCompact(for: size)
    }
}

// MARK: - Header

extension LivePowerFlowWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "point.3.connected.trianglepath.dotted")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.chartSeriesEnergy)
                .accessibilityHidden(true)
            LivePowerFlowStrings.text("widget.livePowerFlow.title", "Live Power Flow")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
            if onOpen != nil { openButton }
        }
    }

    private var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = LivePowerFlowStrings.string("widget.livePowerFlow.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = LivePowerFlowStrings.string("widget.livePowerFlow.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = LivePowerFlowStrings.string("widget.livePowerFlow.offline", "Offline")
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
        .accessibilityLabel(LivePowerFlowStrings.text("widget.livePowerFlow.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                LivePowerFlowStrings.text("widget.livePowerFlow.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(LivePowerFlowStrings.text("widget.livePowerFlow.openA11y", "Open the Energy page"))
    }
}

// MARK: - Content states

extension LivePowerFlowWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .noSite:
            noSiteState
        case .empty:
            noDataState
        case let .error(message):
            errorState(message)
        case .content:
            flowContent
        }
    }

    private var loadingChrome: some View {
        VStack(spacing: TSSpacing.sm) {
            TSSkeleton(height: 8, cornerRadius: TSRadius.sm).frame(width: 90)
            TSSkeleton(height: 140, cornerRadius: TSRadius.lg)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .accessibilityElement()
        .accessibilityLabel(LivePowerFlowStrings.text("widget.livePowerFlow.loading", "Loading power flow"))
    }

    private var noSiteState: some View {
        ContentUnavailableView {
            Label {
                LivePowerFlowStrings.text("widget.livePowerFlow.noSite", "No Tesla Energy site linked")
            } icon: {
                Image(systemName: "bolt.badge.questionmark")
            }
        } description: {
            LivePowerFlowStrings.text(
                "widget.livePowerFlow.noSiteHint",
                "Link a Tesla Energy site (Powerwall or solar) to see live power."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noDataState: some View {
        ContentUnavailableView {
            Label {
                LivePowerFlowStrings.text("widget.livePowerFlow.noData", "No live power data")
            } icon: {
                Image(systemName: "bolt.slash")
            }
        } description: {
            LivePowerFlowStrings.text(
                "widget.livePowerFlow.noDataHint",
                "Live power readings will appear here once the site reports."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LivePowerFlowStrings.text("widget.livePowerFlow.errorTitle", "Couldn't load power flow")
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
                LivePowerFlowStrings.text("widget.livePowerFlow.retry", "Retry")
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

    private var flowContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            PowerFlowDiagram(projection: model.projection, compact: isCompact)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.livePowerFlow.offlineBanner" : "widget.livePowerFlow.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known power flow"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            LivePowerFlowStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
