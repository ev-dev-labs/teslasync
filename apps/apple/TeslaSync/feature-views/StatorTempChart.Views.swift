//
//  StatorTempChart.Views.swift
//  TeslaSync — P4 feature view · 0159 · StatorTempChart (Apple)
//
//  Presentational chrome composed by `StatorTempChart`: the panel header (title + subtitle +
//  freshness chip), the stale/offline banner, the three-series legend, and the loading / empty /
//  error states. The Swift Charts chart + tooltip + color tokens live in StatorTempChart.Chart.swift.
//  Copy resolves through the P1/S10 facade; chrome is token-driven (P1/S9). No networking and no
//  Tailwind ports live here.
//

import SwiftUI

// MARK: - Localization helper (SwiftUI side of the P1/S10 facade)

extension StatorTempStrings {
    /// `Text` wrapper over `string(_:_:)` so views resolve the per-surface table without hardcoded
    /// literals (web `t(key, default)`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Header (title + subtitle + freshness chip)

/// The panel header: the web `ChartContainer` title `Stator Temperature History` with a
/// thermometer glyph + the live-state freshness chip, over the subtitle `Motor stator temperature
/// over recent snapshots`.
struct StatorTempHeader: View {
    let connection: StatorTempConnection

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .center, spacing: TSSpacing.sm) {
                Image(systemName: "thermometer.high")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.chartSeriesTemperature)
                    .accessibilityHidden(true)
                StatorTempStrings.text("drivetrain.statorTempHistory", "Stator Temperature History")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: TSSpacing.sm)
                StatorTempFreshnessChip(connection: connection)
            }
            StatorTempStrings.text(
                "drivetrain.statorTempSub",
                "Motor stator temperature over recent snapshots"
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct StatorTempFreshnessChip: View {
    let connection: StatorTempConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            StatorTempStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(StatorTempStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: StatorTempConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "drivetrain.statorTemp.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "drivetrain.statorTemp.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "drivetrain.statorTemp.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the chart when the bound source is not live, so a cached
/// history is clearly labeled (web `DataFreshness` intent).
struct StatorTempConnectivityBanner: View {
    let connection: StatorTempConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "drivetrain.statorTemp.offlineBanner" : "drivetrain.statorTemp.staleBanner"
        let fallback = offline
            ? "Offline — showing last known stator temperature history"
            : "Reconnecting — stator temperature history may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            StatorTempStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Legend (web `<Legend>`)

/// The three-series legend (web Recharts `<Legend>`): a colored swatch + the full line name with
/// the unit suffix for each series, colored from the series token.
struct StatorTempLegend: View {
    let unitSymbol: String

    var body: some View {
        HStack(spacing: TSSpacing.lg) {
            ForEach(StatorSeries.ordered) { series in
                HStack(spacing: TSSpacing.xs) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(series.color.color)
                        .frame(width: 12, height: 8)
                    Text(verbatim: StatorTempNaming.fullName(series, unit: unitSymbol))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xs)
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint baseline with two muted trend rows, respecting Reduce
/// Motion (via `TSSkeleton`).
struct StatorTempLoadingChart: View {
    private let columns = 7

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    ForEach(0 ..< columns, id: \.self) { _ in
                        TSSkeleton(width: 10, height: 10, cornerRadius: 5)
                    }
                    Spacer(minLength: 0)
                }
            }
            TSSkeleton(height: 140, cornerRadius: TSRadius.md)
        }
        .frame(height: 280, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(
            StatorTempStrings.text("drivetrain.statorTemp.loading", "Loading stator temperature history")
        )
    }
}

// MARK: - Empty state (web `data.length <= 1` → nothing, surfaced as a friendly panel)

/// The resolved-but-empty state (web `data.length <= 1 ? null`): a friendly thermometer glyph + the
/// localized message, never a blank box.
struct StatorTempEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                StatorTempStrings.text("drivetrain.statorTemp.noData", "No stator temperature history")
            } icon: {
                Image(systemName: "thermometer.medium.slash")
            }
        } description: {
            StatorTempStrings.text(
                "drivetrain.statorTemp.emptyHint",
                "Stator temperature history will appear here once at least two motor snapshots are recorded."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the inline error
/// treatment used across the feature-view surfaces.
struct StatorTempError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            StatorTempStrings.text("drivetrain.statorTemp.errorTitle", "Couldn't load stator temperature history")
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
                StatorTempStrings.text("drivetrain.statorTemp.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(StatorTempStrings.text("drivetrain.statorTemp.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 240)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
