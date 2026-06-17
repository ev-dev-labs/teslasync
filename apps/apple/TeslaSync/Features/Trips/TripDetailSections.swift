//
//  TripDetailSections.swift
//  TeslaSync — P4-APPLE P7 · page:trips/TripDetail (Apple) — Panels
//
//  The page's panels: the four-tile stat row (Distance, Energy-Used, Efficiency, Cost) and the
//  GlassPanel5 key/value detail panel (Trip ID, Name, Started, Ended, Drives, Charges). Both bind to
//  the `@Observable` `TripDetailPageModel` and reflow across macOS / iPad regular width and compact
//  iPhone (ADR-002/006); every value is read display-unit-formatted from the model (SI converts at
//  the render boundary, ADR-005). The loading skeleton keeps the page's structure recognizable while
//  the trip loads (ADR-011 — never a blank region).
//

import SwiftUI

// MARK: - Stat row (web 2/4-col `StatCard` grid)

/// The four headline stat panels (web `Grid cols 2/lg 4`): each `TSStatCard` reads its
/// display-unit value from the bound model and reflows from two columns (compact) to four (regular).
struct TripDetailStatsSection: View {
    let model: TripDetailPageModel
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            ForEach(model.stats(units: units)) { stat in
                TSStatCard(
                    title: stat.kind.titleKey,
                    value: stat.value,
                    systemImage: stat.kind.systemImage
                )
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Detail panel (web "GlassPanel5" + `KVList`)

/// The trip's key/value detail panel (web `GlassPanel` + `KVList`): Trip ID, Name, Started, Ended,
/// Drives, Charges. Rendered as the page's glass card (ADR-005 material) holding the shared
/// `TSKVList`, with each row's label resolved from its web i18n key.
struct TripDetailInfoSection: View {
    let model: TripDetailPageModel

    var body: some View {
        TSGlassPanel {
            TSKVList(rows: model.infoRows.map { row in
                TSKVRow(id: row.kind.rawValue, key: row.kind.titleKey, value: row.value)
            })
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web `PageContainer loading`)

/// The initial loading state: redacted stat tiles + a redacted detail panel with a centered
/// progress indicator so the trip's structure is recognizable while it loads (ADR-011).
struct TripDetailSkeleton: View {
    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSCard {
                        VStack(alignment: .leading, spacing: TSSpacing.sm) {
                            Text(verbatim: "Label").font(Font.TS.bodySm)
                            Text(verbatim: "000").font(Font.TS.title)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .skeletonRedaction()

            TSGlassPanel {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(0 ..< 6, id: \.self) { _ in
                        HStack {
                            Text(verbatim: "Detail label")
                            Spacer()
                            Text(verbatim: "Detail value")
                        }
                        .font(Font.TS.bodySm)
                    }
                }
                .skeletonRedaction()
            }

            ProgressView()
                .frame(maxWidth: .infinity)
                .accessibilityLabel(Text("loading"))
        }
        .accessibilityLabel(Text("loading"))
    }
}

private extension View {
    /// Applies the system skeleton redaction for the loading state, isolated so the SwiftUI
    /// redaction-reason API token is opted out of the stub scan on one line.
    func skeletonRedaction() -> some View {
        redacted(reason: .placeholder) // parity:allow SwiftUI redaction API, not a stub
    }
}
