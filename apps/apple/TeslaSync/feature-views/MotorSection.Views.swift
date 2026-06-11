//
//  MotorSection.Views.swift
//  TeslaSync — P4 feature view · 0293 · MotorSection (Apple)
//
//  The presentational subviews composed by `MotorSection`: the data body (the responsive
//  eight-tile grid — web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), the per-tile
//  `MotorSectionMetricTile` (the native counterpart of the web `MetricCard`: label + bold
//  value + the accent-tinted icon chip), and the loading / empty / error chrome. All
//  consume the P1/S10 facade and the shared P1/S9 tokens + shared components
//  (`TSGlassPanel` / `tsGlassPanel` / `TSSkeleton` / `TSButton` / `TSFadeIn`) — no
//  networking, no Tailwind ports, no raw hex. The Foundation-only accent is mapped to the
//  shared design-system colour here, at the view boundary.
//

import SwiftUI

// MARK: - Accent colour (web `MetricCard` `color` → design-system token)

/// Maps the Foundation-only ``MotorSectionAccent`` to the shared design-system colour, so
/// the hex map lives once (in tokens) and the icon chip tracks the theme. The web
/// MotorSection palette is green / cyan / purple.
extension MotorSectionAccent {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .info: Color.TS.statusInfo
        case .power: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:3 lg:4`)

/// The shared adaptive grid for the data + loading bodies: two columns on narrow widths
/// growing to several on wide ones (the web 2→3→4 column breakpoints).
enum MotorSectionGrid {
    static let columns: [GridItem] = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
}

// MARK: - Data body (web non-empty render: the eight-tile grid)

/// The populated state — the eight powertrain tiles in the responsive grid, wrapped in
/// the shared fade-in. Each tile is its own VoiceOver element; the grid only contains
/// them.
struct MotorSectionContent: View {
    let projection: MotorSectionProjection

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: MotorSectionGrid.columns, spacing: TSSpacing.md) {
                ForEach(projection.cards) { card in
                    MotorSectionMetricTile(kind: card.kind, valueText: card.valueText, accent: card.accent)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Metric tile (web `MetricCard`: label + value + accent icon chip)

/// One powertrain metric — the native counterpart of the web `MetricCard`: the label and
/// bold value on the leading edge, with the accent-tinted icon chip on the trailing edge
/// (the web `color` prop only tints that chip, not the value). One VoiceOver element
/// exposing the label + the resolved value.
struct MotorSectionMetricTile: View {
    let kind: MotorSectionMetricKind
    let valueText: String
    let accent: MotorSectionAccent

    private var label: String {
        MotorSectionStrings.string(kind.labelKey, kind.labelFallback)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                Text(verbatim: valueText)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: TSSpacing.xs)
            MotorSectionIconChip(systemImage: kind.systemImage, accent: accent)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityValue(Text(verbatim: valueText))
    }
}

/// The accent-tinted icon chip (web `MetricCard` `rounded-lg p-1.5 ring-1` icon box).
struct MotorSectionIconChip: View {
    let systemImage: String
    let accent: MotorSectionAccent

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(accent.color)
            .frame(width: 26, height: 26)
            .background(
                accent.color.opacity(0.12),
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(accent.color.opacity(0.25), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Loading (skeleton chrome)

/// One skeleton tile mirroring `MotorSectionMetricTile`'s shape, so the grid does not jump
/// when content resolves.
struct MotorSectionTileSkeleton: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSSkeleton(width: 72, height: 9)
                TSSkeleton(width: 48, height: 14)
            }
            Spacer(minLength: TSSpacing.xs)
            TSSkeleton(width: 26, height: 26, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityHidden(true)
    }
}

/// The first-load state: eight skeleton tiles in the same grid as the data body.
struct MotorSectionLoadingView: View {
    var body: some View {
        LazyVGrid(columns: MotorSectionGrid.columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in MotorSectionTileSkeleton() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: MotorSectionStrings.string("motor.loadingA11y", "Loading powertrain")))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The no-snapshot render (web `EmptyState`): a friendly state, never a blank panel.
struct MotorSectionEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: MotorSectionStrings.string(
                    "vehicles.detail.noMotorData", "No motor data available"
                ))
            } icon: {
                Image(systemName: "gearshape.2.fill")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer + retry)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance wired to the
/// model's refresh.
struct MotorSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: MotorSectionStrings.string("motor.errorTitle", "Couldn't load powertrain"))
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
                Text(verbatim: MotorSectionStrings.string("motor.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: MotorSectionStrings.string("motor.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
