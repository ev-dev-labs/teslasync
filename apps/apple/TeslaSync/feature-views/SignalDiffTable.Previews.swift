//
//  SignalDiffTable.Previews.swift
//  TeslaSync — P4 feature view · 0268 · SignalDiffTable (Apple)
//
//  Xcode previews for each surface state (content / loading / empty-no-diff /
//  empty-filtered / error / stale / offline). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalDiffTableUpdate) -> SignalDiffTableModel {
        let source = InMemorySignalDiffTableSource(initial: update)
        let model = SignalDiffTableModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    // swiftlint:disable:next function_parameter_count
    private func diffEntry(
        _ name: String,
        _ valueA: SignalDiffCellValue,
        _ valueB: SignalDiffCellValue,
        _ sourceA: SignalDiffSourceLayer,
        _ sourceB: SignalDiffSourceLayer,
        _ ageMsA: Double?,
        _ ageMsB: Double?,
        changed: Bool = true
    ) -> SignalDiffEntry {
        SignalDiffEntry(
            name: name,
            valueA: valueA,
            valueB: valueB,
            sourceA: sourceA,
            sourceB: sourceB,
            ageMsA: ageMsA,
            ageMsB: ageMsB,
            changed: changed
        )
    }

    private func previewEntries() -> [SignalDiffEntry] {
        [
            diffEntry("battery_level", .number(78), .number(82), .l1, .l1, 1500, 800),
            diffEntry("charge_rate", .number(11.5), .number(7.2), .l2, .log, 45000, 120_000),
            diffEntry("charging_state", .string("Charging"), .string("Complete"), .l1, .stale, 2000, 200_000),
            diffEntry("locked", .bool(true), .bool(true), .l1, .l1, 500, 500, changed: false),
            diffEntry("shift_state", .null, .string("P"), .unknown, .l2, nil, 9000),
            diffEntry("est_battery_range", .number(240), .number(232), .log, .log, 300_000, 300_000)
        ]
    }

    @MainActor
    private func previewContainer(_ model: SignalDiffTableModel) -> some View {
        SignalDiffTable(model: model)
            .padding(TSSpacing.lg)
            .frame(width: 560, height: 460, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewContainer(previewModel(
            SignalDiffTableUpdate(
                status: .loaded,
                entries: previewEntries(),
                pinned: ["charge_rate"],
                vehicleId: 7,
                updatedAt: Date()
            )
        ))
    }

    #Preview("Loading") {
        previewContainer(previewModel(SignalDiffTableUpdate(status: .loading)))
    }

    #Preview("Empty — no diff") {
        previewContainer(previewModel(SignalDiffTableUpdate(status: .loaded)))
    }

    #Preview("Empty — filtered") {
        previewContainer(previewModel(SignalDiffTableUpdate(status: .loaded, filterActive: true)))
    }

    #Preview("Error") {
        previewContainer(previewModel(SignalDiffTableUpdate(status: .failed("Network unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            SignalDiffTableUpdate(
                status: .loaded,
                connection: .stale,
                entries: previewEntries(),
                pinned: ["charge_rate"],
                vehicleId: 7,
                updatedAt: Date().addingTimeInterval(-180)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            SignalDiffTableUpdate(
                status: .loaded,
                connection: .offline,
                entries: previewEntries(),
                vehicleId: 7,
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }
#endif
