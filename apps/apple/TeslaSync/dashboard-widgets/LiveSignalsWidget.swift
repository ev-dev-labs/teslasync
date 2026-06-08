//
//  LiveSignalsWidget.swift
//  TeslaSync — P4 dashboard widget · 0058 · LiveSignalsWidget (Apple)
//
//  The composable Live Signals dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/LiveSignalsWidget.tsx. Renders every state from the
//  web source (loading / empty / error / stale / offline / content) inside a glass
//  widget shell, binding through `LiveSignalsModel` (P1/S8). No networking here.
//

import Foundation
import SwiftUI

// MARK: - LiveSignalsWidget (the dashboard surface)

/// The composable Live Signals dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/LiveSignalsWidget.tsx`. It shows the latest motor,
/// climate, tire, and security signals in a four-quadrant grid, formatted to the
/// user's units, with per-section skeletons and a whole-widget empty state.
public struct LiveSignalsWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveSignalsWidget"

    /// Canonical registry metadata (registry/telemetry.ts → "live-signals").
    public static let registration = DashboardWidgetRegistration(
        id: "live-signals",
        nameKey: "widget.liveSignals",
        descriptionKey: "widget.liveSignals.description",
        category: "telemetry",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 2, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: LiveSignalsModel
    private let size: DashboardWidgetSize

    public init(
        model: LiveSignalsModel,
        size: DashboardWidgetSize = LiveSignalsWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        self.size = LiveSignalsWidget.registration.clamp(size)
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

extension LiveSignalsWidget {
    // MARK: Header (web WidgetShell chrome: Wifi icon + title + freshness + refresh)

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "wifi")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            LiveSignalsStrings.text("widget.liveSignals", "Live Signals")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
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
            label = LiveSignalsStrings.string("widget.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = LiveSignalsStrings.string("widget.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = LiveSignalsStrings.string("widget.offline", "Offline")
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
        .accessibilityLabel(LiveSignalsStrings.text("widget.refresh", "Refresh"))
    }

    // MARK: Content states

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
            signalContent
        }
    }

    private var loadingChrome: some View {
        LiveSignalsGrid {
            ForEach(LiveSignalsSection.allCases) { section in
                LiveSignalsSectionScaffold(section: section) {
                    TSSkeleton(height: 48, cornerRadius: TSRadius.sm)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(LiveSignalsStrings.text("widget.loading", "Loading live signals"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                LiveSignalsStrings.text("widget.noSignals", "No live signal data")
            } icon: {
                Image(systemName: "wifi")
            }
        } description: {
            LiveSignalsStrings.text("widget.emptyHint", "Live values appear here once the vehicle streams telemetry.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            LiveSignalsStrings.text("widget.errorTitle", "Couldn't load live signals")
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
                LiveSignalsStrings.text("widget.retry", "Retry")
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

    private var signalContent: some View {
        VStack(spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            LiveSignalsGrid {
                LiveSignalsMotorSection(rows: model.projection.motor)
                LiveSignalsClimateSection(rows: model.projection.climate)
                LiveSignalsTiresSection(rows: model.projection.tires)
                LiveSignalsSecuritySection(rows: model.projection.security)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(LiveSignalsStrings.text("widget.liveSignals", "Live Signals"))
        .accessibilityValue(Text(verbatim: LiveSignalsAccessibility.summary(for: model.projection)))
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.offlineBanner" : "widget.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known values"
            : "Reconnecting — values may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            LiveSignalsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
