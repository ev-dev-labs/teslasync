//
//  ChargeCostTrackerWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0016 · ChargeCostTrackerWidget (Apple)
//
//  The leaf SwiftUI building blocks the surface composes — the metric tile (web `MetricCard`), the
//  loading skeletons (web `Skeleton`) and the compact big-number total (web `AnimatedNumber`). Kept
//  out of the main surface file so each stays within the per-file length budget and reads on its own.
//

import Foundation
import SwiftUI

// MARK: - Tone → Color (web `neonColorMap`)

private extension ChargeCostTone {
    /// The accent color for the tile's icon chip, mirroring the web `neonColorMap` entries the
    /// `MetricCard` `color` prop selects (`cyan` / `green` / `amber`).
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .green: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        }
    }
}

// MARK: - Metric tile (web `MetricCard`)

/// One metric tile: a label + value (+ optional subtitle) with a tinted SF Symbol chip — the native
/// parity of the web `MetricCard` used inside the widget body.
struct ChargeCostMetricTile: View {
    let tile: ChargeCostTile

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: tile.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text(verbatim: tile.value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let subtitle = tile.subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
            }
            Spacer(minLength: 0)
            iconChip
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: tile.accessibilityLabel))
    }

    private var iconChip: some View {
        Image(systemName: tile.systemImage)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tile.tone.color)
            .frame(width: 26, height: 26)
            .background(
                tile.tone.color.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(tile.tone.color.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Loading skeleton (web `Skeleton`)

/// A redacted skeleton block honoring Reduce Motion (no shimmer animation). Self-contained so the
/// surface depends only on the design tokens.
struct ChargeCostSkeletonBlock: View {
    var width: CGFloat?
    var height: CGFloat
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    init(width: CGFloat? = nil, height: CGFloat = 14) {
        self.width = width
        self.height = height
    }

    var body: some View {
        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            .fill(Color.TS.border.opacity(pulse ? 0.45 : 0.25))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
            .accessibilityHidden(true)
    }
}

/// A grid of tile-shaped skeletons mirroring the metric grid while data loads.
struct ChargeCostSkeletonGrid: View {
    let count: Int

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: TSSpacing.sm),
                GridItem(.flexible(), spacing: TSSpacing.sm)
            ],
            spacing: TSSpacing.sm
        ) {
            ForEach(0 ..< count, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ChargeCostSkeletonBlock(width: 64, height: 9)
                    ChargeCostSkeletonBlock(width: 90, height: 18)
                }
                .padding(TSSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
    }
}

// MARK: - Compact total (web `AnimatedNumber`)

/// A large animated total honoring Reduce Motion — the compact-layout headline. Self-contained so
/// the surface needs only the design tokens.
struct ChargeCostCompactTotal: View {
    let formatted: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(verbatim: formatted)
            .font(Font.TS.title)
            .fontWeight(.bold)
            .monospacedDigit()
            .contentTransition(.numericText())
            .foregroundStyle(Color.TS.textPrimary)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: formatted)
    }
}
