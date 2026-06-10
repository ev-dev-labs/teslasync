//
//  ClimateSection.Views.swift
//  TeslaSync — P4 feature view · 0291 · ClimateSection (Apple)
//
//  The presentational subviews composed by `ClimateSection`: the data body (the
//  responsive eight-tile grid — web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`),
//  the per-tile `ClimateSectionMetricTile` (the native counterpart of the web `MetricCard`:
//  label + bold value + the accent-tinted icon chip), and the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens + shared
//  components (`tsGlassPanel` / `TSSkeleton` / `TSButton` / `TSFadeIn`) — no
//  networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Value text (web `MetricCard` value expression → localized string)

/// Resolves one tile's semantic ``ClimateSectionValue`` into its final display string. Pure +
/// dependency-injected (the i18n words are passed in), so the "Level {n}" / "On" /
/// "Off" composition is unit tested without a bundle, and the view passes the facade's
/// resolved words.
enum ClimateSectionValueText {
    static func resolve(_ value: ClimateSectionValue, level: String, on: String, off: String, dash: String) -> String {
        switch value {
        case let .measurement(text): text
        case .missing: dash
        case let .seatLevel(amount): "\(level) \(amount)"
        case let .onOff(flag): flag ? on : off
        }
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:3 lg:4`)

/// The shared adaptive grid for the data + loading bodies: a single column on narrow
/// widths growing to several on wide ones (the web 2→3→4 column breakpoints).
enum ClimateSectionGrid {
    static let columns: [GridItem] = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
}

// MARK: - Data body (web non-empty render: the eight-tile grid)

/// The populated state — the eight climate tiles in the responsive grid, wrapped in the
/// shared fade-in. Each tile is its own VoiceOver element; the grid only contains them.
struct ClimateSectionContent: View {
    let projection: ClimateSectionProjection

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: ClimateSectionGrid.columns, spacing: TSSpacing.md) {
                ForEach(projection.cards) { card in
                    ClimateSectionMetricTile(kind: card.kind, value: card.value, accent: card.accent)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Metric tile (web `MetricCard`: label + value + accent icon chip)

/// One climate metric — the native counterpart of the web `MetricCard`: the label and
/// bold value on the leading edge, with the accent-tinted icon chip on the trailing
/// edge (the web `color` prop only tints that chip, not the value). One VoiceOver
/// element exposing the label + the resolved value.
struct ClimateSectionMetricTile: View {
    let kind: ClimateSectionMetricKind
    let value: ClimateSectionValue
    let accent: ClimateSectionAccent

    private var label: String {
        ClimateSectionStrings.string(kind.labelKey, kind.labelFallback)
    }

    private var valueText: String {
        ClimateSectionValueText.resolve(
            value,
            level: ClimateSectionStrings.string("common.level", "Level"),
            on: ClimateSectionStrings.string("common.on", "On"),
            off: ClimateSectionStrings.string("common.off", "Off"),
            dash: ClimateSectionFormat.dash
        )
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
            ClimateSectionIconChip(systemImage: kind.systemImage, accent: accent)
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
struct ClimateSectionIconChip: View {
    let systemImage: String
    let accent: ClimateSectionAccent

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

/// One skeleton tile mirroring `ClimateSectionMetricTile`'s shape, so the grid does not jump
/// when content resolves.
struct ClimateSectionTileSkeleton: View {
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
struct ClimateSectionLoadingView: View {
    var body: some View {
        LazyVGrid(columns: ClimateSectionGrid.columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 8, id: \.self) { _ in ClimateSectionTileSkeleton() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ClimateSectionStrings.string("climate.loadingA11y", "Loading climate")))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The no-snapshot render (web `EmptyState`): a friendly state, never a blank panel.
struct ClimateSectionEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: ClimateSectionStrings.string(
                    "vehicles.detail.noClimateData", "No climate data available"
                ))
            } icon: {
                Image(systemName: "wind")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer + retry)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance wired to the
/// model's refresh.
struct ClimateSectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: ClimateSectionStrings.string("climate.errorTitle", "Couldn't load climate"))
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
                Text(verbatim: ClimateSectionStrings.string("climate.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: ClimateSectionStrings.string("climate.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
