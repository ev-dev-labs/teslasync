//
//  ClimateStatusWidget.swift
//  TeslaSync — P4 dashboard widget · 0028 · ClimateStatusWidget (Apple)
//
//  The composable Climate status dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/ClimateStatusWidget.tsx. Renders the cabin / outside
//  temperature, the HVAC power readout, and the Defrost / Heater status chips across
//  every web state (loading / empty / error / stale / offline / content) inside a
//  glass widget shell, binding through `ClimateStatusModel` (P1/S8). No networking
//  lives here.
//

import SwiftUI

// MARK: - ClimateStatusWidget (the dashboard surface)

/// The composable Climate status dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/ClimateStatusWidget.tsx`. Renders every state from the
/// web source, binding through `ClimateStatusModel` (P1/S8).
public struct ClimateStatusWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "ClimateStatusWidget"

    /// Canonical registry metadata (registry/climate.ts → "climate-status").
    public static let registration = DashboardWidgetRegistration(
        id: "climate-status",
        nameKey: "widget.climate",
        descriptionKey: "widget.climateStatus.description",
        category: "climate",
        defaultSize: DashboardWidgetSize(cols: 1, rows: 2),
        minSize: DashboardWidgetSize(cols: 1, rows: 2),
        maxSize: DashboardWidgetSize(cols: 2, rows: 40)
    )

    @State private var model: ClimateStatusModel

    public init(model: ClimateStatusModel) {
        _model = State(initialValue: model)
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
        Text(verbatim: ClimateStatusStrings.string(key, fallback))
    }
}

// MARK: - Header

extension ClimateStatusWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            tsText("widget.climate", "Climate")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
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
            label = ClimateStatusStrings.string("widget.climateStatus.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = ClimateStatusStrings.string("widget.climateStatus.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = ClimateStatusStrings.string("widget.climateStatus.offline", "Offline")
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
        .accessibilityLabel(tsText("widget.climateStatus.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension ClimateStatusWidget {
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
            ForEach(0 ..< 3, id: \.self) { _ in
                HStack {
                    TSSkeleton(width: 56, height: 14, cornerRadius: TSRadius.pill)
                    Spacer(minLength: TSSpacing.sm)
                    TSSkeleton(width: 44, height: 14, cornerRadius: TSRadius.pill)
                }
            }
            TSSkeleton(width: 96, height: 18, cornerRadius: TSRadius.pill)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(tsText("widget.climateStatus.loading", "Loading climate"))
    }

    private var emptyState: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: "thermometer.medium")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: ClimateStatusStrings.string("widget.noClimate", "No climate data"))
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
            tsText("widget.climateStatus.errorTitle", "Couldn't load climate")
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
                tsText("widget.climateStatus.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(tsText("widget.climateStatus.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var loadedContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                ClimateStatusConnectivityBanner(connection: model.connection)
            }
            ForEach(model.projection.rows) { row in
                ClimateStatusRowView(row: row)
            }
            if !model.projection.chips.isEmpty {
                ClimateStatusChipRow(chips: model.projection.chips)
                    .padding(.top, TSSpacing.xs)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement(children: .contain)
    }
}
