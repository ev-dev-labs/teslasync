//
//  ClimateControlPanelWidget.swift
//  TeslaSync — P4 dashboard widget · 0026 · ClimateControlPanelWidget (Apple)
//
//  The composable Climate Control Panel dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ClimateControlPanelWidget.tsx. Renders inside/outside
//  temperature, HVAC on/off + power, fan speed, seat heaters, and steering-wheel
//  heat across every web state (loading / empty / error / stale / offline /
//  content) inside a glass widget shell, binding through `ClimatePanelModel`
//  (P1/S8). No networking lives here.
//

import SwiftUI

// MARK: - ClimateControlPanelWidget (the dashboard surface)

/// The composable Climate Control Panel dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ClimateControlPanelWidget.tsx`. Renders every state
/// from the web source, binding through `ClimatePanelModel` (P1/S8).
public struct ClimateControlPanelWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ClimateControlPanelWidget"

    /// Canonical registry metadata (registry/climate.ts → "climate-control-panel").
    public static let registration = DashboardWidgetRegistration(
        id: "climate-control-panel",
        nameKey: "widget.climatePanel.title",
        descriptionKey: "widget.climatePanel.description",
        category: "climate",
        defaultSize: DashboardWidgetSize(cols: 2, rows: 4),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )

    @State private var model: ClimatePanelModel
    private let isCompact: Bool
    private let onOpen: (() -> Void)?

    public init(
        model: ClimatePanelModel,
        size: DashboardWidgetSize = ClimateControlPanelWidget.registration.defaultSize,
        onOpen: (() -> Void)? = nil
    ) {
        _model = State(initialValue: model)
        // Web `isCompact = size.cols <= 1 && size.rows <= 1`. The widget keys its
        // density off the size the host renders it at, exactly like the web
        // component; the registry min…max envelope (`registration.clamp`) is held by
        // the dashboard grid, not the component.
        isCompact = size.cols <= 1 && size.rows <= 1
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

    private func tsText(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: ClimatePanelStrings.string(key, fallback))
    }
}

// MARK: - Header

extension ClimateControlPanelWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "thermometer.medium")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                tsText("widget.climatePanel.title", "Climate Control")
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
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = ClimatePanelStrings.string("widget.climatePanel.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ClimatePanelStrings.string("widget.climatePanel.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ClimatePanelStrings.string("widget.climatePanel.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            if !isCompact {
                Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            }
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
        .accessibilityLabel(tsText("widget.climatePanel.refresh", "Refresh"))
    }

    private var openButton: some View {
        Button {
            onOpen?()
        } label: {
            HStack(spacing: 2) {
                tsText("widget.climatePanel.open", "Open").font(Font.TS.caption)
                Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .semibold))
            }
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(tsText("widget.climatePanel.openA11y", "Open the Climate page"))
    }
}

// MARK: - Content states

extension ClimateControlPanelWidget {
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
            loadedContent
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if !isCompact {
                TSSkeleton(width: 96, height: 18, cornerRadius: TSRadius.pill)
                ForEach(0 ..< 2, id: \.self) { _ in
                    HStack(spacing: TSSpacing.sm) {
                        TSSkeleton(height: 32, cornerRadius: TSRadius.md)
                        TSSkeleton(height: 32, cornerRadius: TSRadius.md)
                    }
                }
                TSSkeleton(width: 140, height: 18, cornerRadius: TSRadius.pill)
            } else {
                TSSkeleton(width: 64, height: 28, cornerRadius: TSRadius.md)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(tsText("widget.climatePanel.loading", "Loading climate control"))
    }

    private var emptyState: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ClimatePanelStrings.string("widget.climatePanel.noData", "No climate data"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            tsText("widget.climatePanel.errorTitle", "Couldn't load climate control")
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
                tsText("widget.climatePanel.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tsText("widget.climatePanel.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                ClimatePanelConnectivityBanner(connection: model.connection)
            }
            if isCompact {
                ClimatePanelCompactView(value: model.projection.compactValue)
            } else {
                ClimatePanelFullView(projection: model.projection)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
