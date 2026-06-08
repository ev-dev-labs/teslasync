//
//  TimeToChargeSection.Views.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  The presentational subviews composed by `TimeToChargeSection`: the persistent
//  header (web `<h2>` title + `<p>` description) with its freshness accessory, the
//  metric card (web `TimeToChargeCard` — uppercase label, bold value + unit,
//  muted subtitle) inside a glass panel, the responsive two/four-column grid (web
//  `grid-cols-2 lg:grid-cols-4`), and the loading / empty / error / offline
//  states. All strings resolve through the P1/S10 facade and all colors/spacing
//  come from the P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Accent → design token (semantic, ADR-006)

extension TimeToChargeAccent {
    /// The brand token color for the card's small affordance glyph. Semantic
    /// parity (never a ported hex): the two duration bands take the brand accent
    /// and the speed-series hue, the fastest card the success role, the slowest
    /// the warning role — so the four cards stay visually distinct.
    var color: Color {
        switch self {
        case .band10: Color.TS.accent
        case .band20: Color.TS.chartSeriesSpeed
        case .fastest: Color.TS.statusSuccess
        case .slowest: Color.TS.statusWarning
        }
    }
}

// MARK: - Card value resolution (web `t()` at the display boundary)

extension TimeToChargeCardModel {
    /// The localized label (web `t(labelKey, fallback)`).
    var resolvedLabel: String {
        TimeToChargeStrings.string(labelKey, labelFallback)
    }

    /// The pre-formatted value, or the em-dash when there is no figure
    /// (web `value ?? '—'`).
    var resolvedValue: String {
        value ?? TimeToChargeFormat.dash
    }

    /// The localized unit symbol (web `unit`), shown only when a value exists.
    var resolvedUnit: String {
        TimeToChargeStrings.string(unitKey, unitFallback)
    }

    /// The localized subtitle (web `subtitle`), or `nil` when the card has none.
    var resolvedSubtitle: String? {
        TimeToChargeStrings.cardSubtitle(self)
    }
}

// MARK: - Metric card (web `<TimeToChargeCard>`)

/// One resolved metric card — the SwiftUI parity of a single web `TimeToChargeCard`:
/// an uppercase label, the bold value with its trailing unit (hidden when the
/// value is the em-dash, matching `unit && value`), and the muted subtitle, inside
/// the shared glass panel. A small accent glyph is an Apple-idiomatic affordance.
struct TTCMetricCard: View {
    let card: TimeToChargeCardModel

    private var hasValue: Bool {
        card.value != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Text(verbatim: card.resolvedLabel)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: card.symbol)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(card.accent.color)
                    .accessibilityHidden(true)
            }
            valueLine
            if let subtitle = card.resolvedSubtitle {
                Text(verbatim: subtitle)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TimeToChargeAccessibility.cardLabel(
            label: card.resolvedLabel,
            value: card.value,
            unit: card.resolvedUnit,
            subtitle: card.resolvedSubtitle
        )))
    }

    private var valueLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: card.resolvedValue)
                .font(Font.TS.title)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if hasValue {
                Text(verbatim: card.resolvedUnit)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }
}

// MARK: - Responsive grid (web `grid grid-cols-2 gap-4 lg:grid-cols-4`)

/// A responsive grid that reflows its cells across two or four columns at the web
/// Tailwind `lg` breakpoint, measured with the iOS 18 / macOS 15 `onGeometryChange`
/// width seam so the column math (`TimeToChargeLayout`) stays pure + testable.
struct TTCResponsiveGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    @ViewBuilder let cell: (Item) -> Cell

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
            count: TimeToChargeLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(items) { item in
                cell(item)
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Header (web `<h2>` title + `<p>` description + freshness accessory)

/// The persistent section header: the title + description the web always renders,
/// plus a freshness/refresh accessory for the live/stale/offline chrome.
struct TTCHeader<Accessory: View>: View {
    @ViewBuilder let accessory: () -> Accessory

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: TimeToChargeStrings.string(
                    "charging.curve.timeToCharge", "Time-to-Charge Analysis"
                ))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
                accessory()
            }
            Text(verbatim: TimeToChargeStrings.string(
                "charging.curve.timeToChargeDesc",
                "How long DC sessions take to reach key SOC thresholds"
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip + status accessory (live / stale / offline)

/// Header chip flagging live / stale / offline data (web freshness indicator).
struct TTCFreshnessChip: View {
    let freshness: TimeToChargeFreshness

    private var tone: TSTone {
        switch freshness {
        case .live: .success
        case .stale: .warning
        case .offline: .neutral
        }
    }

    private var symbol: String {
        switch freshness {
        case .live: "clock"
        case .stale: "clock.badge.exclamationmark"
        case .offline: "wifi.slash"
        }
    }

    private var label: String {
        switch freshness {
        case .live: TimeToChargeStrings.string("charging.curve.live", "Live")
        case .stale: TimeToChargeStrings.string("charging.curve.stale", "Stale")
        case .offline: TimeToChargeStrings.string("charging.curve.offline", "Offline")
        }
    }

    var body: some View {
        HStack(spacing: 2) {
            Image(systemName: symbol).font(.caption2)
            Text(verbatim: label).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Freshness chip + an in-flight spinner + a refresh control (web refetch).
struct TTCStatusAccessory: View {
    let freshness: TimeToChargeFreshness
    let refreshing: Bool
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TTCFreshnessChip(freshness: freshness)
            if refreshing {
                ProgressView().controlSize(.mini)
            }
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: TimeToChargeStrings.string(
                "charging.curve.refresh", "Refresh"
            )))
        }
    }
}

// MARK: - Retry affordance (web `QueryError` retry button)

/// Capsule retry button shared by the error + offline states.
struct TTCRetryButton: View {
    let onRetry: () -> Void

    var body: some View {
        Button(action: onRetry) {
            Text(verbatim: TimeToChargeStrings.string("charging.curve.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: TimeToChargeStrings.string("charging.curve.retry", "Retry")))
    }
}

// MARK: - Content grid (web non-loading branch — four cards in a `<FadeIn>`)

/// The resolved row of four metric cards (web content branch), wrapped in the
/// shared fade-in (web `<FadeIn delay={0.25}>`).
struct TTCCardsGrid: View {
    let cards: [TimeToChargeCardModel]

    var body: some View {
        TSFadeIn(delay: 0.25) {
            TTCResponsiveGrid(items: cards) { card in
                TTCMetricCard(card: card)
            }
        }
    }
}

// MARK: - Loading state (web initial fetch — skeleton cards)

/// One skeleton slot identity for the loading grid.
private struct TTCSkeletonSlot: Identifiable {
    let id: Int
}

/// The in-flight skeleton grid (loading branch): four redacted card blocks laid
/// out in the same responsive grid, so the section keeps its shape while data
/// loads.
struct TTCLoadingView: View {
    private let slots = (0 ..< 4).map(TTCSkeletonSlot.init)

    var body: some View {
        TTCResponsiveGrid(items: slots) { _ in
            TSSkeleton(height: 92, cornerRadius: TSRadius.lg)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TimeToChargeStrings.string(
            "charging.curve.loadingA11y", "Loading time-to-charge analysis"
        )))
    }
}

// MARK: - Empty state (web `EmptyState` — friendly, never a blank box)

/// The in-place empty state shown when the feed resolves with no sessions.
struct TTCEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: TimeToChargeStrings.string(
                    "charging.curve.empty.title", "No charging sessions yet"
                ))
            } icon: {
                Image(systemName: "bolt.badge.clock")
            }
        } description: {
            Text(verbatim: TimeToChargeStrings.string(
                "charging.curve.empty.message",
                "Time-to-charge figures appear here once DC fast-charging sessions are recorded."
            ))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Error + offline states

/// The fetch-failure state (web `QueryError`) with a retry affordance.
struct TTCErrorView: View {
    let retryable: Bool
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: TimeToChargeStrings.string(
                "charging.curve.errorTitle", "Couldn't load time-to-charge analysis"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if retryable {
                TTCRetryButton(onRetry: onRetry)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

/// The offline-without-cache state (web offline fallback) with retry.
struct TTCOfflineView: View {
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "wifi.slash")
                .font(.system(size: 24))
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: TimeToChargeStrings.string(
                "charging.curve.offlineMessage", "Offline — showing the last loaded analysis"
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            TTCRetryButton(onRetry: onRetry)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
