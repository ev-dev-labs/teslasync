//
//  VehicleGauges.States.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The P4 leaf-contract chrome composed by `VehicleGauges` when the cluster is not in its data
//  state: the loading skeleton (mirroring the gauge layout), the empty (no-state) state, the
//  error state with a retry affordance, and the stale / offline connectivity banner. Each keeps
//  the surface shape so it never collapses to a blank box. All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — a circular car-viz skeleton beside skeleton gauge rings and bar
/// lines, so the cluster keeps its shape while the parent vehicle-state query resolves.
struct VehicleGaugesLoadingView: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.x3xl) {
                carSkeleton
                metricsSkeleton
            }
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                carSkeleton.frame(maxWidth: .infinity)
                metricsSkeleton
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VehicleGaugesStrings.string(
            "vehicleGauges.loadingA11y", "Loading vehicle gauges"
        )))
    }

    private var carSkeleton: some View {
        VStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 176, height: 176, cornerRadius: TSRadius.pill)
            TSSkeleton(width: 96, height: 12)
        }
    }

    private var metricsSkeleton: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: VehicleGaugesLayout.gaugeColumns, spacing: TSSpacing.lg) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(spacing: TSSpacing.xs) {
                        TSSkeleton(width: 96, height: 96, cornerRadius: TSRadius.pill)
                        TSSkeleton(width: 56, height: 10)
                    }
                }
            }
            VStack(spacing: TSSpacing.md) {
                ForEach(0 ..< 2, id: \.self) { _ in
                    TSSkeleton(height: 18, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Empty (resolved, no state)

/// The empty render (resolved, no vehicle state) — a friendly state shown when the parent has
/// no readings yet, never a blank box.
struct VehicleGaugesEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.emptyTitle", "No live readings"))
            } icon: {
                Image(systemName: "gauge.with.dots.needle.bottom.50percent")
            }
        } description: {
            Text(verbatim: VehicleGaugesStrings.string(
                "vehicleGauges.empty",
                "Gauges will appear once the vehicle reports in."
            ))
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance, shown only when
/// there is no cached content to fall back to.
struct VehicleGaugesErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.errorTitle", "Couldn't load gauges"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Connectivity banner (P4 leaf freshness axis)

/// The stale / offline banner shown above the cluster when the feed is not live: a freshness
/// message + a refresh affordance. Cached content stays visible beneath it.
struct VehicleGaugesConnectivityBanner: View {
    let connection: VehicleGaugesConnection
    let onRefresh: () -> Void

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var chipLabel: String {
        isOffline
            ? VehicleGaugesStrings.string("vehicleGauges.offline", "Offline")
            : VehicleGaugesStrings.string("vehicleGauges.stale", "Stale")
    }

    private var message: String {
        isOffline
            ? VehicleGaugesStrings.string("vehicleGauges.offlineBanner", "Offline — showing last known data")
            : VehicleGaugesStrings.string("vehicleGauges.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                    .font(.system(size: 11, weight: .semibold))
                    .accessibilityHidden(true)
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .lineLimit(2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: "\(chipLabel). \(message)"))

            Spacer(minLength: TSSpacing.sm)

            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: VehicleGaugesStrings.string("vehicleGauges.refresh", "Refresh")))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            tone.opacity(0.12),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}
