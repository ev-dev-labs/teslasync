//
//  VehicleCharts.States.swift
//  TeslaSync — P4 feature view · 0303 · VehicleCharts (Apple)
//
//  The non-loaded chrome composed by `VehicleCharts`: the stale/offline freshness
//  chip, the hard-error state (web `QueryError`), the friendly empty state (web
//  `EmptyState`), and the loading skeleton. All consume the P1/S10 facade + the
//  shared P1/S9 tokens (and the shared `TSSkeleton`) — never a blank box, never a
//  literal.
//

import SwiftUI

// MARK: - Freshness chip (native chrome for stale / offline)

/// A compact chip shown over the composite when the live feed is stale or
/// offline. The cached content stays visible; the chip offers a manual refresh.
struct VehicleChartsFreshnessChip: View {
    let connection: VehicleChartsConnection
    let localize: (String, String) -> String
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        connection == .offline
            ? localize("map.offlineBanner", "Offline — showing the last known data")
            : localize("map.staleBanner", "Reconnecting — this data may be out of date")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onRefresh) {
                Text(verbatim: localize("map.refresh", "Refresh"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: localize("map.refresh", "Refresh")))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the slice fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct VehicleChartsErrorView: View {
    let message: String
    let localize: (String, String) -> String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: localize("vehicleCharts.errorTitle", "Couldn't load vehicle charts"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                Text(verbatim: localize("vehicleCharts.retry", "Retry"))
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: localize("vehicleCharts.retry", "Retry")))
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(TSSpacing.xl)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `EmptyState`)

/// The friendly empty state — shown when the slice resolves with no section
/// content (no location, configuration, preferences, or speed), never a blank box.
struct VehicleChartsEmptyState: View {
    let localize: (String, String) -> String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "car.side.and.exclamationmark")
                .font(.system(size: 30))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: localize("vehicleCharts.emptyTitle", "No vehicle data yet"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: localize(
                "vehicleCharts.emptyMessage",
                "Live position, configuration, and speed history will appear here once your vehicle reports in."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 280)
        .padding(TSSpacing.xl)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: a redacted map block, a tile grid, and a
/// chart block so the transition into the loaded composite is stable.
struct VehicleChartsSkeleton: View {
    let localize: (String, String) -> String

    private let columns = [GridItem(.adaptive(minimum: 120), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(spacing: TSSpacing.lg) {
            TSSkeleton(height: 288, cornerRadius: TSRadius.lg)
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 180, height: 16, cornerRadius: TSRadius.sm)
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    ForEach(0 ..< 6, id: \.self) { _ in
                        TSSkeleton(height: 56, cornerRadius: TSRadius.md)
                    }
                }
            }
            .padding(TSSpacing.xl)
            .tsGlassPanel()
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSkeleton(width: 140, height: 16, cornerRadius: TSRadius.sm)
                TSSkeleton(height: 200, cornerRadius: TSRadius.md)
            }
            .padding(TSSpacing.xl)
            .tsGlassPanel()
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: localize("vehicleCharts.loading", "Loading vehicle charts")))
    }
}
