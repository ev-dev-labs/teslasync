//
//  TreeSelect.Previews.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  Xcode previews for each surface state (populated tree, partial + expanded selection, with a disabled
//  leaf, searching, empty catalog, no-results, loading, error, stale, offline). DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TreeSelectPreviewData {
        /// The documented canonical use — a signal-catalog tree the user filters and multi-selects.
        static let groups: [TreeSelectGroup] = [
            TreeSelectGroup(
                id: "battery",
                label: "Battery",
                detail: "core",
                leaves: [
                    TreeSelectLeaf(id: "soc", label: "State of charge"),
                    TreeSelectLeaf(id: "pack_volts", label: "Pack voltage"),
                    TreeSelectLeaf(id: "cell_temp", label: "Cell temperature")
                ]
            ),
            TreeSelectGroup(
                id: "drive",
                label: "Drive",
                leaves: [
                    TreeSelectLeaf(id: "speed", label: "Vehicle speed"),
                    TreeSelectLeaf(id: "power", label: "Drive power"),
                    TreeSelectLeaf(
                        id: "torque",
                        label: "Motor torque",
                        isDisabled: true,
                        disabledReason: "Not available on this trim"
                    )
                ]
            ),
            TreeSelectGroup(
                id: "climate",
                label: "Climate",
                leaves: [
                    TreeSelectLeaf(id: "cabin", label: "Cabin temperature"),
                    TreeSelectLeaf(id: "hvac", label: "HVAC power", detail: "β")
                ]
            )
        ]

        static func snapshot(
            selected: [String] = [],
            search: String = "",
            expanded: [String]? = ["battery"],
            isLoading: Bool = false,
            errorMessage: String? = nil,
            connection: TreeSelectConnection = .live,
            emptyCatalog: Bool = false
        ) -> TreeSelectSnapshot {
            TreeSelectSnapshot(
                groups: emptyCatalog ? [] : groups,
                selectedIDs: selected,
                searchValue: search,
                expandedGroupIDs: expanded,
                isLoading: isLoading,
                errorMessage: errorMessage,
                connection: connection
            )
        }
    }

    @MainActor
    private func treeSelectPreviewModel(_ snapshot: TreeSelectSnapshot) -> TreeSelectModel {
        let source = InMemoryTreeSelectSource(initial: snapshot)
        let model = TreeSelectModel(source: source)
        model.start()
        return model
    }

    #Preview("Ready · Populated") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["soc", "pack_volts"], expanded: ["battery", "drive"])
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Collapsed") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["soc"], expanded: [])
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Disabled leaf") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["speed"], expanded: ["drive"])
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Searching") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["soc"], search: "temp")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · No results") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(search: "zzz")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · Empty") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(emptyCatalog: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(isLoading: true)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(errorMessage: "The catalog request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["soc"], connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        TreeSelect(model: treeSelectPreviewModel(
            TreeSelectPreviewData.snapshot(selected: ["soc"], connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
