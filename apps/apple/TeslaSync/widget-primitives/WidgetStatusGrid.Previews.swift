//
//  WidgetStatusGrid.Previews.swift
//  TeslaSync — P4 widget primitive · 0011 · WidgetStatusGrid (Apple)
//
//  Xcode previews for every real branch of the status grid: the populated grid across the 2-/3-/4-up column
//  targets (so the responsive collapse is visible), every status tone (ok / warning / error / inactive /
//  unknown), cells with and without an icon and a value, the compact variant (two columns, no value, tight
//  padding), a single cell, and the empty leaf. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func staged(
        _ label: String, width: CGFloat = 360,
        @ViewBuilder _ content: @escaping () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
            content()
                .padding(TSSpacing.lg)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md))
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: width, alignment: .leading)
        .background(Color.TS.bg)
    }

    private func sampleCells() -> [StatusCell] {
        [
            StatusCell(id: "battery", label: "Battery", status: .ok, value: "Healthy", systemImage: "battery.100"),
            StatusCell(id: "charge", label: "Charging", status: .warning, value: "Slow", systemImage: "bolt.fill"),
            StatusCell(id: "tpms", label: "Tire pressure", status: .error, value: "Low", systemImage: "gauge.medium"),
            StatusCell(id: "sentry", label: "Sentry", status: .inactive, value: "Off", systemImage: "shield"),
            StatusCell(id: "climate", label: "Climate", status: .unknown, value: "—", systemImage: "thermometer"),
            StatusCell(id: "lock", label: "Doors", status: .ok, value: "Locked", systemImage: "lock.fill")
        ]
    }

    #Preview("Two columns — every tone") {
        staged("cols 2 · ok / warning / error / inactive / unknown · icon + value") {
            WidgetStatusGrid(cells: sampleCells(), columns: .two)
        }
    }

    #Preview("Three columns — responsive") {
        staged("cols 3 · collapses 1→2→3 by width") {
            WidgetStatusGrid(cells: sampleCells(), columns: .three)
        }
    }

    #Preview("Four columns — responsive") {
        staged("cols 4 · collapses 2→4 by width") {
            WidgetStatusGrid(cells: sampleCells(), columns: .four)
        }
    }

    #Preview("Compact — two columns, no value") {
        staged("compact · forces 2 cols · value suppressed · tight padding") {
            WidgetStatusGrid(cells: sampleCells(), columns: .four, compact: true)
        }
    }

    #Preview("No icons, no values") {
        staged("label-only chips · dot is the only accent") {
            WidgetStatusGrid(
                cells: [
                    StatusCell(id: "a", label: "Online", status: .ok),
                    StatusCell(id: "b", label: "Degraded", status: .warning),
                    StatusCell(id: "c", label: "Faulted", status: .error),
                    StatusCell(id: "d", label: "Standby", status: .inactive)
                ],
                columns: .two
            )
        }
    }

    #Preview("Single cell") {
        staged("one cell · no separators, full-width column") {
            WidgetStatusGrid(
                cells: [StatusCell(id: "only", label: "Pack heater", status: .ok, value: "Idle", systemImage: "flame")],
                columns: .two
            )
        }
    }

    #Preview("Empty — no status data") {
        staged("no cells · friendly empty leaf · never a blank box") {
            WidgetStatusGrid(cells: [])
                .frame(height: 220)
        }
    }
#endif
