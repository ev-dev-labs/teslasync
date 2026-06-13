//
//  PillFilterBar.Previews.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  Xcode previews for every branch of the pill / tab filter row: the `pills` variant with a selection, the
//  `tabs` variant, accents + leading icons + count suffixes, a disabled pill (skipped by arrow nav), the
//  scrollable overflow, the non-scrollable row, and the friendly empty state. DEBUG-only; compiled
//  by the app targets and skipped by the shipped-surface gate scope.
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
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 420, alignment: .leading)
        .background(Color.TS.bg)
    }

    private let collectionPills: [PillItem] = [
        PillItem(key: "all", label: "All", count: 248),
        PillItem(key: "anomalies", label: "Anomalies", count: 12, accent: .red),
        PillItem(key: "notable", label: "Notable", count: 31, accent: .amber),
        PillItem(key: "favourites", label: "Favourites", count: 8, accent: .purple)
    ]

    private let metricPills: [PillItem] = [
        PillItem(key: "battery", label: "Battery", iconSystemName: "battery.100", accent: .green),
        PillItem(key: "energy", label: "Energy", iconSystemName: "bolt.fill", accent: .amber),
        PillItem(key: "speed", label: "Speed", iconSystemName: "speedometer", accent: .blue),
        PillItem(key: "regen", label: "Regen", iconSystemName: "arrow.triangle.2.circlepath", accent: .cyan)
    ]

    #Preview("Pills · collection + counts") {
        staged("pills · All / Anomalies / Notable / Favourites") {
            PillFilterBar(
                items: collectionPills,
                activeKey: "anomalies",
                ariaLabel: "Filter drives",
                onChange: { _ in }
            )
        }
    }

    #Preview("Pills · icons + accents") {
        staged("pills · metric switcher with icons") {
            PillFilterBar(
                items: metricPills,
                activeKey: "battery",
                ariaLabel: "Select metric",
                onChange: { _ in }
            )
        }
    }

    #Preview("Tabs variant") {
        staged("tabs · underlined row") {
            PillFilterBar(
                items: collectionPills,
                activeKey: "all",
                ariaLabel: "Filter drives",
                onChange: { _ in },
                variant: .tabs
            )
        }
    }

    #Preview("Disabled pill") {
        staged("pills · one disabled (skipped by arrows)") {
            PillFilterBar(
                items: [
                    PillItem(key: "live", label: "Live", accent: .green),
                    PillItem(key: "history", label: "History"),
                    PillItem(key: "forecast", label: "Forecast", disabled: true)
                ],
                activeKey: "live",
                ariaLabel: "Data range",
                onChange: { _ in }
            )
        }
    }

    #Preview("Scrollable overflow") {
        staged("pills · many · horizontal scroll") {
            PillFilterBar(
                items: (1 ... 12).map { PillItem(key: "p\($0)", label: "Segment \($0)", count: $0 * 7) },
                activeKey: "p3",
                ariaLabel: "Segments",
                onChange: { _ in }
            )
        }
    }

    #Preview("Non-scrollable") {
        staged("pills · scrollable = false") {
            PillFilterBar(
                items: Array(collectionPills.prefix(2)),
                activeKey: "all",
                ariaLabel: "Filter drives",
                onChange: { _ in },
                scrollable: false
            )
        }
    }

    #Preview("Empty state") {
        staged("no pills · empty state shown") {
            PillFilterBar(items: [], activeKey: "", ariaLabel: "Filter drives", onChange: { _ in })
        }
    }
#endif
