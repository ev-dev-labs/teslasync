//
//  HealthProbesSection.Sections.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  The two populated probe cards composed by `HealthProbesSection`, the SwiftUI
//  parity of the web body `<Grid cols={{ default: 1, md: 2 }} gap={4}>` of two
//  `<Card>`s:
//    1. Liveness — /healthz — the web `<Card>` with `<CardHeader title action=Badge>`
//       + `<KVList>` (Status / Goroutines / Uptime).
//    2. Readiness — /readyz — the web `<Card>` with `<CardHeader title action=Badge>`
//       + `<KVList>` (Database / Latency / Pool Connections).
//  The grid is side-by-side on regular widths and stacked on compact iPhone widths.
//  Copy resolves through the P1/S10 facade; chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Cards grid (web `<Grid cols 1/2 gap 4>`)

/// The two probe cards laid out in the web `<Grid cols={{ default: 1, md: 2 }}>` — side
/// by side on regular widths, stacked on compact iPhone widths.
struct HealthProbesCardsGrid: View {
    let cards: [HealthProbeCard]

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(cards) { card in
                HealthProbeCardView(card: card)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Probe card (web `<Card>` + `<CardHeader>` + `<KVList>`)

/// One probe card — the native parity of the web `<Card>` with `<CardHeader title
/// action>` + `<KVList>`: the title + status badge header over the key/value rows.
struct HealthProbeCardView: View {
    let card: HealthProbeCard

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                Divider().overlay(Color.TS.border)
                VStack(spacing: TSSpacing.xs) {
                    ForEach(card.rows) { row in
                        HealthProbeKVRow(row: row)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: HealthProbesAccessibility.cardLabel(
            card,
            localize: HealthProbesStrings.string
        )))
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: HealthProbesStrings.string(card.titleKey, card.titleKey))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
            Spacer(minLength: TSSpacing.sm)
            HealthProbeStatusBadge(status: card.status, tone: card.tone)
        }
    }
}

// MARK: - Key/value row (web `KVList` item)

/// One key/value line in a probe card (web `KVList` row): a muted label and the value.
struct HealthProbeKVRow: View {
    let row: HealthProbeKV

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: HealthProbesStrings.string(row.labelKey, row.labelKey))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: row.value)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(.vertical, 2)
    }
}
