//
//  WeatherAtCarWidget.swift
//  TeslaSync — P4 dashboard widget · 0115 · WeatherAtCarWidget (Apple)
//
//  The composable Weather at Car dashboard surface — SwiftUI parity of
//  features/dashboard/widgets/WeatherAtCarWidget.tsx. Binds through `WeatherAtCarModel`
//  (no networking in the view); renders every state and both layouts (compact / standard).
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension WeatherAtCarStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model
    /// file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - WeatherAtCarWidget (the dashboard surface)

/// The composable Weather at Car dashboard widget — the SwiftUI parity of
/// `features/dashboard/widgets/WeatherAtCarWidget.tsx`. Renders every state from the web
/// source (loading / empty / error / stale / offline / content) inside a glass widget shell,
/// binding through `WeatherAtCarModel` (P1/S8). No networking lives here.
public struct WeatherAtCarWidget: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WeatherAtCarSurface.slug

    /// Canonical registry metadata (registry/climate.ts → "weather-at-car").
    public static let registration = WeatherAtCarSurface.registration

    @State private var model: WeatherAtCarModel
    private let size: DashboardWidgetSize

    public init(
        model: WeatherAtCarModel,
        size: DashboardWidgetSize = WeatherAtCarWidget.registration.defaultSize
    ) {
        _model = State(initialValue: model)
        // The widget renders at whatever size the dashboard grid assigns (parity with the web
        // component, which trusts the grid); `registration` declares the min/max the grid
        // enforces. A defensive floor of 1×1 guards against degenerate sizes while keeping the
        // web `cols === 1 && rows === 1` compact branch reachable.
        self.size = DashboardWidgetSize(cols: max(1, size.cols), rows: max(1, size.rows))
    }

    /// Web `isCompact = size.cols === 1 && size.rows === 1`.
    private var isCompact: Bool {
        size.cols == 1 && size.rows == 1
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

extension WeatherAtCarWidget {
    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            if !isCompact {
                Image(systemName: "cloud.sun.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                WeatherAtCarStrings.text("widget.weatherAtCar", "Weather at Car")
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
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
            return WeatherAtCarStrings.string("widget.weatherAtCar.updating", "Updating")
        }
        switch model.connection {
        case .live: return WeatherAtCarStrings.string("widget.weatherAtCar.live", "Live")
        case .stale: return WeatherAtCarStrings.string("widget.weatherAtCar.stale", "Stale")
        case .offline: return WeatherAtCarStrings.string("widget.weatherAtCar.offline", "Offline")
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
        .accessibilityLabel(WeatherAtCarStrings.text("widget.weatherAtCar.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension WeatherAtCarWidget {
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
        VStack(alignment: isCompact ? .center : .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 40, height: 40, cornerRadius: TSRadius.md)
            TSSkeleton(width: 96, height: 24, cornerRadius: TSRadius.sm)
            if !isCompact {
                TSSkeleton(width: 120, height: 10, cornerRadius: TSRadius.sm)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(WeatherAtCarStrings.text("widget.weatherAtCar.loading", "Loading weather"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                WeatherAtCarStrings.text("widget.noWeather", "No weather data")
            } icon: {
                Image(systemName: "thermometer.medium")
            }
        } description: {
            WeatherAtCarStrings.text(
                "widget.weatherAtCar.emptyHint",
                "Weather appears once your vehicle reports its outside temperature."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            WeatherAtCarStrings.text("widget.weatherAtCar.errorTitle", "Couldn't load weather")
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
                WeatherAtCarStrings.text("widget.weatherAtCar.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(WeatherAtCarStrings.text("widget.weatherAtCar.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private func loadedContent(_ projection: WeatherAtCarProjection) -> some View {
        VStack(alignment: isCompact ? .center : .leading, spacing: TSSpacing.sm) {
            if model.connection != .live { connectivityBanner }
            WeatherReadout(projection: projection, isCompact: isCompact)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: isCompact ? .center : .topLeading)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "widget.weatherAtCar.offlineBanner" : "widget.weatherAtCar.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known weather"
            : "Reconnecting — weather may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            WeatherAtCarStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Weather readout (web temperature + conditions block)

/// The temperature readout: a conditions glyph next to (standard) or above (compact) the
/// formatted temperature. Reproduces the two web layouts — the compact `1×1` centered column
/// and the standard row with the "Outside Temperature" label and optional coordinate line.
/// Shared by the surface and the previews so both layouts render the exact same way.
private struct WeatherReadout: View {
    let projection: WeatherAtCarProjection
    let isCompact: Bool

    var body: some View {
        Group {
            if isCompact {
                compactBody
            } else {
                standardBody
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: WeatherAtCarAccessibility.summary(for: projection)))
    }

    private var glyphLabel: String {
        WeatherAtCarStrings.string(projection.condition.accessibilityKey, projection.condition.accessibilityFallback)
    }

    private var compactBody: some View {
        VStack(spacing: TSSpacing.xs) {
            Image(systemName: projection.conditionSymbol)
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: projection.temperatureText)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }

    private var standardBody: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Image(systemName: projection.conditionSymbol)
                .font(.system(size: 40))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: projection.temperatureText)
                    .font(Font.TS.display)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                WeatherAtCarStrings.text("widget.outsideTemp", "Outside Temperature")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if let coordinateText = projection.coordinateText {
                    Text(verbatim: coordinateText)
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
