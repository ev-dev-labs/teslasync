//
//  DetailCards.Views.swift
//  TeslaSync — P4 feature view · 0153 · DetailCards (Apple)
//
//  The presentational subviews composed by `DetailCards`: the responsive two-up
//  grid (web `Grid cols={{ default: 1, md: 2 }}`), the card shell + titled header +
//  key/value rows (the native parity of the web `Card` / `CardHeader` / `KVList`
//  from @/components/ui + @/components/data-display), the freshness banner (stale /
//  offline), the hard-error state (web `QueryError`), and the loading skeleton. All
//  consume pre-localized strings from the P1/S10 facade + the shared P1/S9 tokens —
//  no Tailwind ports.
//

import SwiftUI

// MARK: - Responsive grid (web `Grid cols={{ default: 1, md: 2 }}`)

/// A responsive grid that lays the two cards out one-up on compact widths (web
/// `default: 1`) and two-up once there is room (web `md: 2`), the SwiftUI parity of
/// the web `@/components/layout` `Grid`.
struct DetailCardsGrid<Content: View>: View {
    @ViewBuilder var content: () -> Content

    private let columns = [
        GridItem(.adaptive(minimum: 260, maximum: .infinity), spacing: TSSpacing.md, alignment: .top)
    ]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            content()
        }
    }
}

// MARK: - Card shell + header + key/value rows (web `Card` / `CardHeader` / `KVList`)

/// One card: a titled header above a key/value list, on the elevated card surface —
/// the native parity of the web `<Card><CardHeader/><KVList/></Card>`. The card
/// always renders; each row self-fills with an em dash when a value is absent.
struct DetailCardView: View {
    let title: String
    let rows: [DetailCardRow]
    let localize: (String, String) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            DetailCardHeader(title: title)
            DetailKVList(rows: rows, localize: localize)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

/// The card's titled header (web `CardHeader title=…`), marked as an accessibility
/// header.
struct DetailCardHeader: View {
    let title: String

    var body: some View {
        Text(verbatim: title)
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityAddTraits(.isHeader)
    }
}

/// The key/value list (web `KVList`): a label on the left and a monospaced value
/// chip on the right, one row per item, each spoken as a single VoiceOver element.
struct DetailKVList: View {
    let rows: [DetailCardRow]
    let localize: (String, String) -> String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                DetailKVRow(row: row, localize: localize)
            }
        }
    }
}

/// One key/value row (web `KVList` item): label + monospaced value chip.
struct DetailKVRow: View {
    let row: DetailCardRow
    let localize: (String, String) -> String

    private var label: String {
        localize(row.labelKey, row.labelFallback)
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: row.value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .monospacedDigit()
                .padding(.horizontal, TSSpacing.xs)
                .padding(.vertical, 2)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: DetailCardsAccessibility.rowSummary(label: label, value: row.value)))
    }
}

// MARK: - Freshness banner (native chrome for stale / offline)

/// The freshness banner shown above the cards when the feed is stale or offline.
/// Cached data stays visible; the banner offers a manual refresh.
struct DetailCardsFreshnessBanner: View {
    let connection: DetailCardsConnection
    let localize: (String, String) -> String
    let onRefresh: () -> Void

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var message: String {
        connection == .offline
            ? localize(
                "drivetrain.detailCards.offlineBanner",
                "Offline — showing the last known drivetrain details"
            )
            : localize(
                "drivetrain.detailCards.staleBanner",
                "Reconnecting — drivetrain details may be out of date"
            )
    }

    private var refreshLabel: String {
        localize("drivetrain.detailCards.refresh", "Refresh")
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
                Text(verbatim: refreshLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: refreshLabel))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
    }
}

// MARK: - Hard-error state (web `QueryError`)

/// The hard-error state shown when the feed fails with nothing cached to render
/// (web `QueryError`): an icon, title, the technical message, and a retry action.
struct DetailCardsErrorView: View {
    let message: String
    let localize: (String, String) -> String
    let onRetry: () -> Void

    private var retryLabel: String {
        localize("drivetrain.detailCards.retry", "Retry")
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: localize("drivetrain.detailCards.errorTitle", "Couldn't load drivetrain details"))
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
                Text(verbatim: retryLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .padding(TSSpacing.lg)
        .tsGlassPanel()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome: two redacted cards, each a redacted title over
/// a few redacted key/value rows, matching the loaded two-up layout so the
/// transition is stable.
struct DetailCardsSkeleton: View {
    let localize: (String, String) -> String

    var body: some View {
        DetailCardsGrid {
            DetailCardSkeleton(rowCount: 4)
            DetailCardSkeleton(rowCount: 5)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: localize(
            "drivetrain.detailCards.loading",
            "Loading drivetrain details"
        )))
    }
}

/// One redacted card used by the loading skeleton.
private struct DetailCardSkeleton: View {
    let rowCount: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TSSkeleton(width: 160, height: 14)
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< rowCount, id: \.self) { _ in
                    HStack {
                        TSSkeleton(width: 120, height: 10)
                        Spacer(minLength: TSSpacing.md)
                        TSSkeleton(width: 64, height: 10)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}
