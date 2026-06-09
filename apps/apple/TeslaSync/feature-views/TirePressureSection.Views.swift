//
//  TirePressureSection.Views.swift
//  TeslaSync — P4 feature view · 0151 · TirePressureSection (Apple)
//
//  Presentational chrome composed by `TirePressureSection`: the per-wheel palette, the
//  panel header + freshness chip, the stale/offline banner, the four stat tiles (web
//  `grid-cols-4`), the bottom legend, and the loading / empty / error states. The Swift
//  Charts line chart + tooltip live in TirePressureSection.Chart.swift. Copy resolves
//  through the P1/S10 facade; chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here.
//

import SwiftUI

// MARK: - Wheel palette (web line `stroke`)

/// The wheel → stroke mapping. The web colors each line + tile with a fixed Tailwind
/// hue (`#3b82f6` FL, `#10b981` FR, `#f59e0b` RL, `#ef4444` RR); native reads the
/// design-token brand chart colors that match those hues exactly (Speed / Battery /
/// Energy / Temperature) so a line, its legend swatch, and its stat tile always agree
/// and the colors track the theme.
enum TPSectionPalette {
    static func color(for wheel: TPSectionWheel) -> Color {
        switch wheel {
        case .frontLeft: Color.TS.chartSeriesSpeed
        case .frontRight: Color.TS.chartSeriesBattery
        case .rearLeft: Color.TS.chartSeriesEnergy
        case .rearRight: Color.TS.chartSeriesTemperature
        }
    }
}

// MARK: - Header (title + freshness chip)

/// The panel header: the web `ChartContainer` title `Tire Pressure During Drive` with
/// a tire-pressure glyph + the live-state freshness chip.
struct TPSectionHeader: View {
    let connection: TPSectionConnection

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Image(systemName: "tirepressure")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            TPSectionStrings.text("driveDetail.tirePressure", "Tire Pressure During Drive")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: TSSpacing.sm)
            TPSectionFreshnessChip(connection: connection)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct TPSectionFreshnessChip: View {
    let connection: TPSectionConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            TPSectionStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TPSectionStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: TPSectionConnection) -> Descriptor {
        switch connection {
        case .live: Descriptor(tone: Color.TS.statusSuccess, key: "driveDetail.live", fallback: "Live")
        case .stale: Descriptor(tone: Color.TS.statusWarning, key: "driveDetail.stale", fallback: "Stale")
        case .offline: Descriptor(tone: Color.TS.textMuted, key: "driveDetail.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the content when the bound source is not live,
/// so a cached trace is clearly labeled (web `DataFreshness` intent).
struct TPSectionConnectivityBanner: View {
    let connection: TPSectionConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "driveDetail.offlineBanner" : "driveDetail.staleBanner"
        let fallback = offline
            ? "Offline — showing last known tire pressure"
            : "Reconnecting — tire pressure may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            TPSectionStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat tiles (web `grid-cols-4` cells)

/// One resolved stat tile (label + value + accent), built from the projection.
private struct TPSectionTileItem: Identifiable {
    let id: TPSectionWheel
    let label: String
    let value: String
    let tone: Color
}

/// The four stat tiles in a four-column grid (web `grid grid-cols-4 gap-3`): one per
/// wheel showing its min/max range or the `—` placeholder, tinted the wheel's color.
struct TPSectionStatGrid: View {
    let projection: TPSectionProjection
    let locale: Locale

    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md),
        count: 4
    )

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(items) { item in
                TPSectionStatTileView(item: item)
            }
        }
    }

    private var items: [TPSectionTileItem] {
        projection.tileWheels.map { wheel in tile(for: wheel) }
    }

    private func tile(for wheel: TPSectionWheel) -> TPSectionTileItem {
        let value: String = if let range = projection.range(for: wheel) {
            TPSectionFormat.range(range, symbol: projection.unitSymbol, localeIdentifier: locale.identifier)
        } else {
            TPSectionStrings.string("driveDetail.tireNoValue", "—")
        }
        return TPSectionTileItem(
            id: wheel,
            label: TPSectionStrings.string(wheel.tileLabelKey, wheel.tileLabelFallback),
            value: value,
            tone: TPSectionPalette.color(for: wheel)
        )
    }
}

/// A single stat tile: the muted label over the accent value, in a hairline-bordered
/// card (web `rounded-lg bg-white/[0.03] border-white/[0.06]`).
private struct TPSectionStatTileView: View {
    let item: TPSectionTileItem

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: item.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            Text(verbatim: item.value)
                .font(Font.TS.body)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(item.tone)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.sm)
        .padding(.horizontal, TSSpacing.xs)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(item.label), \(item.value)"))
    }
}

// MARK: - Legend (web bottom `<Legend>`)

/// The legend: one swatch + "FL (kPa)" label per present wheel (web `<Line name>` is
/// `${shortName} (${pressureUnit})`), colored from the wheel palette.
struct TPSectionLegend: View {
    let wheels: [TPSectionWheel]
    let unitSymbol: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(wheels) { wheel in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(TPSectionPalette.color(for: wheel))
                        .frame(width: 12, height: 8)
                    Text(verbatim: label(for: wheel))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
    }

    /// The web `<Line name>` label: the short wheel name with the unit in parentheses
    /// (e.g. "FL (kPa)").
    private func label(for wheel: TPSectionWheel) -> String {
        let name = TPSectionStrings.string(wheel.shortNameKey, wheel.shortNameFallback)
        return "\(name) (\(unitSymbol))"
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a row of four muted stat tiles over a chart
/// placeholder, respecting Reduce Motion (via `TSSkeleton`).
struct TPSectionLoading: View {
    private let columns = Array(
        repeating: GridItem(.flexible(), spacing: TSSpacing.md),
        count: 4
    )

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(height: 44, cornerRadius: TSRadius.sm)
                }
            }
            TSSkeleton(height: 180, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(TPSectionStrings.text("driveDetail.tireLoading", "Loading tire pressure"))
    }
}

// MARK: - Empty state (web "No telemetry data available" overlay)

/// The resolved-but-empty state: the web empty overlay (Activity glyph + sentence)
/// over a native `ContentUnavailableView`. Never a blank box.
struct TPSectionEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                TPSectionStrings.text("driveDetail.noChartData", "No telemetry data available")
            } icon: {
                Image(systemName: "waveform.path.ecg")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct TPSectionError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            TPSectionStrings.text("driveDetail.tireErrorTitle", "Couldn't load tire pressure")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                TPSectionStrings.text("driveDetail.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(TPSectionStrings.text("driveDetail.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
