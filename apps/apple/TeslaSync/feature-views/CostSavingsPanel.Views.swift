//
//  CostSavingsPanel.Views.swift
//  TeslaSync — P4 feature view · 0136 · CostSavingsPanel (Apple)
//
//  The presentational subviews composed by `CostSavingsPanel`: the responsive stat
//  grid (web `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` → an adaptive `LazyVGrid`),
//  the individual stat cell (label · big value · optional sub-label), and the
//  loading / empty / error chrome. All consume the P1/S10 facade and the shared
//  P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the green/emerald savings values
//  → `statusSuccess`, the cyan cost-per-unit → `accent`, and the red gas-equivalent
//  → `statusDanger`. Tones are carried token-free by the Adapter (`CostSavingsTone`)
//  and mapped to design tokens here so the pure core stays SwiftUI-free.
//

import SwiftUI

// MARK: - Tone → token mapping (web text-green/cyan/red/emerald)

extension CostSavingsTone {
    /// The design token for this value's semantic accent.
    var color: Color {
        switch self {
        case .positive:
            Color.TS.statusSuccess
        case .accent:
            Color.TS.accent
        case .negative:
            Color.TS.statusDanger
        }
    }
}

// MARK: - Data body (web non-empty render: the stat grid inside the FadeIn)

/// The resolved panel body — the responsive grid of cost/savings cells, wrapped in
/// the shared fade-in (web `FadeIn`). The grid is column-adaptive so it flows from
/// two columns on a compact iPhone up to the web's five on a wide iPad/Mac.
struct CostSavingsContent: View {
    let tiles: [CostSavingsTile]

    private let columns = [GridItem(.adaptive(minimum: 124), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
                ForEach(tiles) { tile in
                    CostSavingsStatTile(tile: tile)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Stat cell (web `<div class="text-center"> label / value / sub </div>`)

/// One resolved cost/savings cell — a centred caption label, the big tone-coloured
/// value, and an optional sub-label. Borderless to match the web tiles, which sit
/// directly inside the single glass panel rather than in their own cards.
struct CostSavingsStatTile: View {
    let tile: CostSavingsTile

    private var label: String {
        CostSavingsStrings.format(
            tile.labelKey,
            tile.labelFallback,
            tile.labelArgument.map { [$0] } ?? []
        )
    }

    private var subLabel: String? {
        guard let key = tile.subLabelKey, let fallback = tile.subLabelFallback else { return nil }
        return CostSavingsStrings.format(key, fallback, tile.subLabelArguments)
    }

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)

            Text(verbatim: tile.value)
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tile.tone.color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)

            if let subLabel {
                Text(verbatim: subLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: CostSavingsAccessibility.tileLabel(
            label: label,
            value: tile.value,
            detail: subLabel
        )))
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: a grid of skeleton cells so the panel keeps its shape
/// while the parent drive-detail query resolves.
struct CostSavingsLoadingView: View {
    private let columns = [GridItem(.adaptive(minimum: 124), spacing: TSSpacing.lg, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
            ForEach(0 ..< 3, id: \.self) { _ in
                VStack(spacing: TSSpacing.xs) {
                    TSSkeleton(width: 56, height: 10)
                    TSSkeleton(width: 80, height: 18)
                    TSSkeleton(width: 64, height: 9)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: CostSavingsStrings.string(
            "costSavings.loadingA11y", "Loading cost and savings"
        )))
    }
}

/// The empty render: a friendly state for a drive with no energy and no distance,
/// never a blank panel.
struct CostSavingsEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: CostSavingsStrings.string(
                    "costSavings.empty", "No cost data for this drive yet."
                ))
            } icon: {
                Image(systemName: "dollarsign.circle")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct CostSavingsErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: CostSavingsStrings.string("costSavings.errorTitle", "Couldn't load cost & savings"))
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
                Text(verbatim: CostSavingsStrings.string("costSavings.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: CostSavingsStrings.string("costSavings.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
