//
//  SecuritySection.Views.swift
//  TeslaSync — P4 feature view · 0298 · SecuritySection (Apple)
//
//  The presentational subviews composed by `SecuritySection`: the data body (the
//  responsive four-tile grid — web `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), the
//  per-tile `SecuritySectionMetricTile` (the native counterpart of the web `MetricCard`:
//  label + bold value + the accent-tinted icon chip), and the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens + shared components
//  (`tsGlassPanel` / `TSSkeleton` / `TSButton` / `TSFadeIn`) — no networking, no Tailwind
//  ports, no raw hex.
//

import SwiftUI

// MARK: - Value text (web `MetricCard` value expression → localized string)

/// The resolved i18n words a ``SecuritySectionValue`` may need — bundled so the resolver
/// stays a small, pure function. The view fills these from the P1/S10 facade; tests pass
/// literals.
struct SecuritySectionValueWords {
    let yes: String
    let no: String
    let active: String
    let off: String
    let closed: String
}

/// Resolves one tile's semantic ``SecuritySectionValue`` into its final display string.
/// Pure + dependency-injected (the i18n words + the count formatter are passed in), so the
/// "Yes" / "No" / "Active" / "Off" / "Closed" / "{{count}} open" composition is unit
/// tested without a bundle, and the view passes the facade's resolved words.
enum SecuritySectionValueText {
    static func resolve(
        _ value: SecuritySectionValue,
        words: SecuritySectionValueWords,
        windowsOpen: (Int) -> String
    ) -> String {
        switch value {
        case let .yesNo(flag): flag ? words.yes : words.no
        case let .activeOff(flag): flag ? words.active : words.off
        case let .text(text): text
        case .closed: words.closed
        case let .windowsOpen(count): windowsOpen(count)
        }
    }
}

// MARK: - Responsive grid (web `grid-cols-2 sm:3 lg:4`)

/// The shared adaptive grid for the data + loading bodies: a single column on narrow
/// widths growing to several on wide ones (the web 2→3→4 column breakpoints).
enum SecuritySectionGrid {
    static let columns: [GridItem] = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]
}

// MARK: - Data body (web non-empty render: the four-tile grid)

/// The populated state — the four security tiles in the responsive grid, wrapped in the
/// shared fade-in. Each tile is its own VoiceOver element; the grid only contains them.
struct SecuritySectionContent: View {
    let projection: SecuritySectionProjection

    var body: some View {
        TSFadeIn {
            LazyVGrid(columns: SecuritySectionGrid.columns, spacing: TSSpacing.md) {
                ForEach(projection.cards) { card in
                    SecuritySectionMetricTile(
                        kind: card.kind,
                        value: card.value,
                        accent: card.accent,
                        systemImage: card.systemImage
                    )
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Metric tile (web `MetricCard`: label + value + accent icon chip)

/// One security metric — the native counterpart of the web `MetricCard`: the label and
/// bold value on the leading edge, with the accent-tinted icon chip on the trailing edge
/// (the web `color` prop only tints that chip, not the value). One VoiceOver element
/// exposing the label + the resolved value.
struct SecuritySectionMetricTile: View {
    let kind: SecuritySectionMetricKind
    let value: SecuritySectionValue
    let accent: SecuritySectionAccent
    let systemImage: String

    private var label: String {
        SecuritySectionStrings.string(kind.labelKey, kind.labelFallback)
    }

    private var valueText: String {
        SecuritySectionValueText.resolve(
            value,
            words: SecuritySectionValueWords(
                yes: SecuritySectionStrings.string("common.yes", "Yes"),
                no: SecuritySectionStrings.string("common.no", "No"),
                active: SecuritySectionStrings.string("common.active", "Active"),
                off: SecuritySectionStrings.string("common.off", "Off"),
                closed: SecuritySectionStrings.string("common.closed", "Closed")
            ),
            windowsOpen: { SecuritySectionStrings.windowsOpen($0) }
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
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            Spacer(minLength: TSSpacing.xs)
            SecuritySectionIconChip(systemImage: systemImage, accent: accent)
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
struct SecuritySectionIconChip: View {
    let systemImage: String
    let accent: SecuritySectionAccent

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

/// One skeleton tile mirroring `SecuritySectionMetricTile`'s shape, so the grid does not
/// jump when content resolves.
struct SecuritySectionTileSkeleton: View {
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

/// The first-load state: four skeleton tiles in the same grid as the data body.
struct SecuritySectionLoadingView: View {
    var body: some View {
        LazyVGrid(columns: SecuritySectionGrid.columns, spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in SecuritySectionTileSkeleton() }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: SecuritySectionStrings.string("security.loadingA11y", "Loading security")))
    }
}

// MARK: - Empty (web `EmptyState`)

/// The no-reading render (web `EmptyState`): a friendly state, never a blank panel.
struct SecuritySectionEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: SecuritySectionStrings.string(
                    "vehicles.detail.noSecurityData", "No security data available"
                ))
            } icon: {
                Image(systemName: "shield.fill")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer + retry)

/// The fetch-failure state (web `QueryError` peer) with a retry affordance wired to the
/// model's refresh.
struct SecuritySectionErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: SecuritySectionStrings.string("security.errorTitle", "Couldn't load security"))
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
                Text(verbatim: SecuritySectionStrings.string("security.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: SecuritySectionStrings.string("security.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
