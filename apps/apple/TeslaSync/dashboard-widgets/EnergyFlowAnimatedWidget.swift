//
//  EnergyFlowAnimatedWidget.swift
//  TeslaSync — P4 dashboard widget · 0045 · EnergyFlowAnimatedWidget (Apple)
//
//  The composable Animated Energy Flow dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx. Binds through
//  EnergyFlowAnimatedModel (no networking in the view); renders every state
//  inside a glass widget shell, choosing the compact 1-column layout when the
//  widget is a single column wide (web `size.cols < 2`).
//

import SwiftUI

// MARK: - EnergyFlowAnimatedWidget (the dashboard surface)

/// The composable Animated Energy Flow dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx`. Renders every state
/// from the web source (loading / empty / error / stale / offline / content)
/// inside a glass widget shell, binding through `EnergyFlowAnimatedModel` (P1/S8).
/// No networking lives here.
public struct EnergyFlowAnimatedWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EnergyFlowAnimatedWidget"

    /// Canonical registry metadata (registry/energy.ts → "energy-flow-animated").
    public static let registration = DashboardWidgetRegistration(
        id: "energy-flow-animated",
        nameKey: "widget.energyFlowAnimated.name",
        descriptionKey: "widget.energyFlowAnimated.description",
        category: "energy",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 4),
        maxSize: DashboardWidgetSize(cols: 3, rows: 40)
    )

    @State private var model: EnergyFlowAnimatedModel
    private let size: DashboardWidgetSize
    private let onOpen: (() -> Void)?

    public init(
        model: EnergyFlowAnimatedModel,
        size: DashboardWidgetSize = EnergyFlowAnimatedWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        self.size = EnergyFlowAnimatedWidget.registration.clamp(size)
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
        EnergyFlowAnimatedModel.isCompact(for: size)
    }
}

// MARK: - Header

extension EnergyFlowAnimatedWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(EnergyFlowAnimatedPalette.cyan)
                .accessibilityHidden(true)
            EnergyFlowAnimatedStrings.text("widget.energyFlowAnimated.title", "Energy Flow")
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
            label = EnergyFlowAnimatedStrings.string("widget.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = EnergyFlowAnimatedStrings.string("widget.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = EnergyFlowAnimatedStrings.string("widget.offline", "Offline")
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
        .accessibilityLabel(EnergyFlowAnimatedStrings.text("widget.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                EnergyFlowAnimatedStrings.text("widget.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(EnergyFlowAnimatedStrings.text("widget.openA11y", "Open the vehicle page"))
    }
}

// MARK: - Content states

extension EnergyFlowAnimatedWidget {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
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
        .accessibilityLabel(EnergyFlowAnimatedStrings.text("widget.loading", "Loading energy flow"))
    }

    private var noDataState: some View {
        ContentUnavailableView {
            Label {
                EnergyFlowAnimatedStrings.text("widget.energyFlowAnimated.noData", "No energy data available")
            } icon: {
                Image(systemName: "bolt.fill")
            }
        } description: {
            EnergyFlowAnimatedStrings.text(
                "widget.noDataHint",
                "Live energy flow will appear here once the vehicle reports."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            EnergyFlowAnimatedStrings.text("widget.errorTitle", "Couldn't load energy flow")
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
                EnergyFlowAnimatedStrings.text("widget.retry", "Retry")
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
            if isCompact {
                EnergyFlowAnimatedCompactView(summary: model.compactSummary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                EnergyFlowAnimatedDiagram(projection: model.projection)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.bottom, TSSpacing.sm)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.offlineBanner" : "widget.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known energy flow"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            EnergyFlowAnimatedStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
