//
//  FleetStatsBar.Views.swift
//  TeslaSync — P4 feature view · 0123 · FleetStatsBar (Apple)
//
//  The presentational subviews composed by `FleetStatsBar`: the glass stat tile (web
//  `<GlassPanel>` — label + animated value + caption or inline sparkline), the
//  responsive 2/3/4/5-column stagger grid (web `StaggerContainer` /
//  `grid-cols-2 sm:3 md:4 lg:5`), the loading skeleton row, the friendly empty state,
//  the error state with retry, and the stale/offline connectivity banner. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Accent → design token (web per-card text color → brand `Color`)

extension FleetStatAccent {
    /// The brand token color for the card's value (and its sparkline). Semantic
    /// (ADR-006) parity with the web Tailwind colors: cyan → brand accent, emerald →
    /// success, amber → warning, red → danger, neutral → primary text.
    var color: Color {
        switch self {
        case .neutral: Color.TS.textPrimary
        case .distance: Color.TS.accent
        case .energy: Color.TS.statusSuccess
        case .efficiency: Color.TS.statusWarning
        case .alert: Color.TS.statusDanger
        case .calm: Color.TS.statusSuccess
        }
    }
}

// MARK: - Card value resolution (web `t()` at the display boundary)

extension FleetStatCard {
    /// The localized card label (web `t(labelKey, fallback)`).
    var resolvedLabel: String {
        FleetStatsStrings.string(labelKey, labelFallback)
    }

    /// The localized supporting caption, or `nil` for the sparkline cards. `.online`
    /// composes "{count} {online}" (web `{onlineCount} {t('fleet.online')}`).
    var resolvedCaption: String? {
        switch caption {
        case nil:
            nil
        case let .online(count):
            "\(count) \(FleetStatsStrings.string("fleet.online", "online"))"
        case let .localized(key, fallback):
            FleetStatsStrings.string(key, fallback)
        }
    }

    /// Whether the inline sparkline should draw — non-nil with ≥ 2 points (web
    /// `MiniChart` renders nothing for `< 2`).
    var showsSparkline: Bool {
        (sparkline?.count ?? 0) >= 2
    }
}

// MARK: - Stat tile (web `<GlassPanel>` card)

/// One resolved stat card — the SwiftUI parity of a single web `<GlassPanel>`:
/// a centered column of label + bold accent value + either a caption line or the
/// inline trend sparkline, on the glass surface, stretched to the row height (web
/// `h-full`).
struct FleetStatTile: View {
    let card: FleetStatCard

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            Text(verbatim: card.resolvedLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            TSAnimatedNumber(formatted: card.valueText)
                .foregroundStyle(card.accent.color)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            footer
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(.vertical, TSSpacing.md)
        .padding(.horizontal, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FleetStatsAccessibility.cardLabel(
            label: card.resolvedLabel, value: card.valueText, detail: card.resolvedCaption
        )))
    }

    @ViewBuilder
    private var footer: some View {
        if card.showsSparkline, let values = card.sparkline {
            FleetStatsSparkline(values: values, color: card.accent.color)
                .padding(.top, 2)
        } else if let caption = card.resolvedCaption {
            Text(verbatim: caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        } else {
            // Sparkline card with < 2 points: web `MiniChart` renders nothing.
            Color.clear.frame(height: 1)
        }
    }
}

// MARK: - Responsive stagger grid (web `StaggerContainer` + `grid-cols-2 sm:3 md:4 lg:5`)

/// A responsive grid that reflows its cells across 2 / 3 / 4 / 5 columns at the web
/// Tailwind breakpoints (measured with the iOS 18 / macOS 15 `onGeometryChange` width
/// seam so the column math stays pure + testable), staggering each cell in (web
/// `StaggerItem`).
struct FleetStatsGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    @ViewBuilder let cell: (Item, Int) -> Cell

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.sm, alignment: .top),
            count: FleetStatsLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.sm) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                cell(item, index)
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Content row (web resolved branch — five staggered cards)

/// The resolved row of five stat cards (web non-loading branch), each cascading in via
/// the shared stagger item (web `StaggerItem`).
struct FleetStatsContentRow: View {
    let cards: [FleetStatCard]

    var body: some View {
        FleetStatsGrid(items: cards) { card, index in
            TSStaggerItem(index: index) {
                FleetStatTile(card: card)
            }
        }
    }
}

// MARK: - Loading row (web initial fetch — skeleton chrome)

/// One skeleton slot identity for the loading grid.
private struct FleetStatsSkeletonSlot: Identifiable {
    let id: Int
}

/// The in-flight skeleton row: five tiles' worth of redacted blocks laid out in the
/// same responsive grid, so the bar keeps its shape while data loads.
struct FleetStatsLoadingRow: View {
    private let slots = (0 ..< 5).map(FleetStatsSkeletonSlot.init)

    var body: some View {
        FleetStatsGrid(items: slots) { _, _ in
            TSSkeleton(height: 96, cornerRadius: TSRadius.lg)
        }
        .accessibilityElement()
        .accessibilityLabel(FleetStatsStrings.text("fleet.loadingA11y", "Loading fleet statistics"))
    }
}

// MARK: - Empty state (resolved, nothing to show → friendly state)

/// The resolved-but-empty state (no vehicles, no analytics, no recent activity),
/// rendered as a native `ContentUnavailableView` rather than a row of zeros.
struct FleetStatsEmpty: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                FleetStatsStrings.text("fleet.emptyTitle", "No fleet data yet")
            } icon: {
                Image(systemName: "car.2")
            }
        } description: {
            FleetStatsStrings.text(
                "fleet.emptyHint",
                "Fleet totals appear here once a vehicle is connected and reporting."
            )
        }
        .frame(maxWidth: .infinity, minHeight: 140)
    }
}

// MARK: - Error state (web parent `isError` → retry)

/// The fetch-failure state with a retry affordance (web `WidgetShell` error → refetch).
struct FleetStatsError: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            FleetStatsStrings.text("fleet.errorTitle", "Couldn't load fleet statistics")
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
                FleetStatsStrings.text("fleet.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(FleetStatsStrings.text("fleet.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Connectivity banner (stale / offline freshness chip)

/// The stale/offline banner shown above the cards when the bound source is not live,
/// so cached totals are clearly labeled (ADR-013 freshness). Serves as the surface's
/// freshness chip for this header-less bar.
struct FleetStatsConnectivityBanner: View {
    let connection: FleetStatsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "fleet.offlineBanner" : "fleet.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded totals"
            : "Reconnecting — fleet totals may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            FleetStatsStrings.text(key, fallback).font(Font.TS.caption)
            Spacer(minLength: 0)
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
