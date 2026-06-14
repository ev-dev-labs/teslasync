//
//  WidgetDetailCard.Previews.swift
//  TeslaSync — P4 widget primitive · 0004 · WidgetDetailCard (Apple)
//
//  Xcode previews for every real branch of the detail card: the populated column across mixed rows (a
//  monospaced VIN-style value, status badges of every variant, a missing value rendering the em-dash
//  fallback), the `compact` four-row slice (from six entries), a single-row card, the empty leaf, and the
//  empty leaf with a caller message + glyph override. DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(_ label: String, @ViewBuilder _ content: @escaping () -> some View) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleEntries() -> [DetailEntry] {
        [
            DetailEntry(
                label: "Status",
                value: "Charging",
                badge: DetailBadge(text: "Active", variant: .success)
            ),
            DetailEntry(label: "Range added", value: "142 km"),
            DetailEntry(
                label: "Connector",
                value: "Tesla Wall Connector",
                badge: DetailBadge(text: "Slow", variant: .warning)
            ),
            DetailEntry(
                label: "Fault",
                value: "Over-temperature",
                badge: DetailBadge(text: "Error", variant: .error)
            ),
            DetailEntry(label: "VIN", value: "5YJ3E1EA7KF000000", mono: true),
            DetailEntry(
                label: "Scheduled",
                value: nil,
                badge: DetailBadge(text: "None", variant: .neutral)
            )
        ]
    }

    #Preview("Populated — mixed rows") {
        staged("six entries · badges · monospaced VIN · em-dash fallback") {
            WidgetDetailCard(entries: sampleEntries())
                .frame(height: 280)
        }
    }

    #Preview("Compact — first four") {
        staged("compact · slices six entries to the first four") {
            WidgetDetailCard(entries: sampleEntries(), compact: true)
                .frame(height: 200)
        }
    }

    #Preview("Single row") {
        staged("one entry · no trailing separator") {
            WidgetDetailCard(
                entries: [
                    DetailEntry(label: "Odometer", value: "48,210 km", mono: true)
                ]
            )
            .frame(height: 80)
        }
    }

    #Preview("Empty — nothing to show") {
        staged("no entries · friendly empty leaf · never a blank box") {
            WidgetDetailCard(entries: [])
                .frame(height: 180)
        }
    }

    #Preview("Empty — caller override") {
        staged("no entries · caller emptyMessage + glyph override") {
            WidgetDetailCard(
                entries: [],
                emptyMessage: "No charging session in progress",
                emptyIconSymbol: "bolt.slash"
            )
            .frame(height: 180)
        }
    }
#endif
