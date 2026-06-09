//
//  CostBreakdownWidget.Views.swift
//  TeslaSync — P4 dashboard widget · 0031 · CostBreakdownWidget (Apple)
//
//  The leaf SwiftUI building blocks the surface composes — the ranked monthly list (web
//  `WidgetRankedList`), the stat cards (web `StatCard`), the compact big-number headline (web
//  `WidgetBigNumber` / `AnimatedNumber`), the success badge (web `Badge`), and the loading skeletons
//  (web `Skeleton`). Kept out of the main surface file so each stays within the per-file length
//  budget and reads on its own. Colors + spacing come from the P1/S9 design tokens.
//

import Foundation
import SwiftUI

// MARK: - Badge (web `Badge` variant="success")

/// A small capsule badge — the native parity of the web `Badge` used for the compact `Saving`
/// chip. Success-toned to match the web `variant="success"`.
struct CostBreakdownBadge: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.label)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.statusSuccess)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusSuccess.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusSuccess.opacity(0.22), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Ranked monthly list (web `WidgetRankedList`)

/// The monthly cost ranked list — the native port of the web `WidgetRankedList` (sorted descending,
/// capped at five by the projector). Each row carries a tinted value bar, a rank index, the month
/// label and the formatted cost.
struct CostBreakdownRankedList: View {
    let items: [CostRankedItem]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(items) { item in
                CostBreakdownRankedRow(item: item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

/// One ranked row: a low-opacity value bar (web `opacity-15`, width `value / maxValue`) behind a rank
/// number, the month label, and the right-aligned formatted cost. The 44pt minimum height preserves
/// the web row's comfortable tap target.
struct CostBreakdownRankedRow: View {
    let item: CostRankedItem

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: "\(item.rank)")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 20, alignment: .trailing)
            Text(verbatim: item.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: item.formattedValue)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(minHeight: 44)
        .background(valueBar)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: item.accessibilityLabel))
    }

    private var valueBar: some View {
        GeometryReader { proxy in
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(TSChartPalette.color(at: item.paletteIndex).opacity(0.15))
                .frame(width: max(0, proxy.size.width * item.barFraction))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Stat card (web `StatCard`)

/// One stat card — the native parity of the web `StatCard` (`label`, `value`, `icon`, optional
/// `sublabel`) shown in the standard-layout grid.
struct CostBreakdownStatCardView: View {
    let card: CostStatCard

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: card.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Image(systemName: card.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: card.value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let sublabel = card.sublabel, !sublabel.isEmpty {
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: card.accessibilityLabel))
    }
}

/// The three-up stat-card grid — the native parity of the web `grid grid-cols-1 @xs:grid-cols-3`.
struct CostBreakdownStatGrid: View {
    let cards: [CostStatCard]

    var body: some View {
        LazyVGrid(
            columns: [
                GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
                GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading),
                GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .topLeading)
            ],
            alignment: .leading,
            spacing: TSSpacing.sm
        ) {
            ForEach(cards) { card in
                CostBreakdownStatCardView(card: card)
            }
        }
    }
}

// MARK: - Compact headline (web `WidgetBigNumber` / `AnimatedNumber`)

/// The compact-layout headline — the native parity of the web `WidgetBigNumber`: a large animated
/// total (emerald, honoring Reduce Motion) with the trailing currency unit, an uppercase label, an
/// optional gas-savings subtitle, and an optional `Saving` badge.
struct CostBreakdownCompactValue: View {
    let compact: CostBreakdownCompact
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(verbatim: compact.bigValue)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                    .foregroundStyle(Color.TS.statusSuccess)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.25), value: compact.bigValue)
                Text(verbatim: compact.unit)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Text(verbatim: compact.label)
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            if let subtitle = compact.subtitle, !subtitle.isEmpty {
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            if let badge = compact.badgeText, !badge.isEmpty {
                CostBreakdownBadge(text: badge)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web `Skeleton`)

/// A redacted skeleton block honoring Reduce Motion (no shimmer animation). Self-contained so the
/// surface depends only on the design tokens.
struct CostBreakdownSkeletonBlock: View {
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

/// The loading chrome: a donut-sized circle skeleton over a stack of row skeletons, mirroring the
/// standard layout while data loads.
struct CostBreakdownSkeletonStandard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Circle()
                .fill(Color.TS.border.opacity(0.25))
                .frame(width: 96, height: 96)
                .frame(maxWidth: .infinity)
            ForEach(0 ..< 3, id: \.self) { _ in
                CostBreakdownSkeletonBlock(height: 18)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

/// The compact loading chrome: a single big-number skeleton with a caption skeleton.
struct CostBreakdownSkeletonCompact: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            CostBreakdownSkeletonBlock(width: 96, height: 26)
            CostBreakdownSkeletonBlock(width: 64, height: 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
