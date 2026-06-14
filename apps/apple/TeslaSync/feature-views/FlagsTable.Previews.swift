//
//  FlagsTable.Previews.swift
//  TeslaSync — P4 feature view · 0031 · FlagsTable (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline). DEBUG-only; skipped by release builds and the lint gate.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func flagsPreviewModel(_ update: FlagsTableUpdate) -> FlagsTableModel {
        let source = InMemoryFlagsTableSource(initial: update)
        let model = FlagsTableModel(source: source)
        model.start()
        return model
    }

    /// A representative registry covering every `previewValue` branch: boolean,
    /// number, string, nested object, and array values.
    private let flagsPreviewRows: [FlagsTableEntry] = [
        FlagsTableEntry(key: "beta_dashboard", value: .bool(true)),
        FlagsTableEntry(key: "max_export_rows", value: .number(5000)),
        FlagsTableEntry(key: "release_channel", value: .string("stable")),
        FlagsTableEntry(
            key: "rollout",
            value: .object(["percent": .number(25), "cohort": .string("internal")])
        ),
        FlagsTableEntry(
            key: "enabled_regions",
            value: .array([.string("us"), .string("eu"), .string("apac")])
        )
    ]

    private func flagsPreviewUpdate(
        status: FlagsLoadStatus = .loaded,
        connection: FlagsConnection = .live,
        rows: [FlagsTableEntry]? = flagsPreviewRows
    ) -> FlagsTableUpdate {
        FlagsTableUpdate(status: status, connection: connection, flags: rows, updatedAt: Date())
    }

    #Preview("Content") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate()))
            .padding()
    }

    #Preview("Loading") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate(status: .loading, rows: nil)))
            .padding()
    }

    #Preview("Empty") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate(status: .empty, rows: [])))
            .padding()
    }

    #Preview("Error") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate(status: .failed("503 Service Unavailable"), rows: nil)))
            .padding()
    }

    #Preview("Stale") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate(connection: .stale)))
            .padding()
    }

    #Preview("Offline") {
        FlagsTable(model: flagsPreviewModel(flagsPreviewUpdate(connection: .offline)))
            .padding()
    }
#endif
