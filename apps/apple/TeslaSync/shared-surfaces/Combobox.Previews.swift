//
//  Combobox.Previews.swift
//  TeslaSync — P4 shared surface · 0148 · Combobox (Apple)
//
//  Xcode previews for every branch of the combobox: the closed field with a selection, the open +
//  filtered list, the "No results" empty state, the in-flight loading row, the loader-error retry row,
//  the "+N more — refine search" overflow footer, free-text entry, the disabled field, and the stale /
//  offline freshness chips. Each preview seeds an ``InMemoryComboboxSource`` and drives the model into
//  the target state (start → open → type) so the dropdown renders without a live host. DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum ComboboxPreviewData {
        static let vehicles: [ComboboxItem] = [
            ComboboxItem(id: "1", label: "Model 3 — Performance"),
            ComboboxItem(id: "2", label: "Model Y — Long Range"),
            ComboboxItem(id: "3", label: "Model S — Plaid"),
            ComboboxItem(id: "4", label: "Model X — Long Range"),
            ComboboxItem(id: "5", label: "Cybertruck — Cyberbeast")
        ]

        static func many(_ count: Int) -> [ComboboxItem] {
            (1 ... count).map { ComboboxItem(id: "v\($0)", label: "Vehicle \($0)") }
        }

        /// Builds a model seeded with a snapshot, started + (optionally) opened + pre-typed, so a
        /// preview shows the target dropdown branch immediately.
        @MainActor
        static func model(
            snapshot: ComboboxSnapshot,
            provider: ComboboxOptionProvider = .staticItems,
            open: Bool = false,
            query: String? = nil
        ) -> ComboboxModel {
            let model = ComboboxModel(
                config: ComboboxConfig(label: "Vehicle", prompt: "Search vehicles"),
                provider: provider,
                source: InMemoryComboboxSource(initial: snapshot)
            )
            model.start()
            if open { model.open() }
            if let query { model.setQuery(query) }
            return model
        }
    }

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

    #Preview("Closed · selected") {
        staged("static · a selection, list closed") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(
                    selection: ComboboxPreviewData.vehicles[1],
                    staticItems: ComboboxPreviewData.vehicles
                )
            ))
        }
    }

    #Preview("Open · filtered") {
        staged("static · open, filtered by \"model\"") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(staticItems: ComboboxPreviewData.vehicles),
                open: true,
                query: "model"
            ))
        }
    }

    #Preview("Empty · No results") {
        staged("static · open, query matches nothing") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(staticItems: ComboboxPreviewData.vehicles),
                open: true,
                query: "zzzz"
            ))
        }
    }

    #Preview("Loading") {
        staged("async fetch in flight · loading row") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(isLoading: true),
                open: true
            ))
        }
    }

    #Preview("Error · retry") {
        staged("loader failed · QueryError peer") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(errorMessage: "Network request timed out"),
                open: true
            ))
        }
    }

    #Preview("Overflow · +N more") {
        staged("12 rows · maxVisible 5 · refine footer") {
            Combobox(
                label: "Vehicle",
                items: ComboboxPreviewData.many(12),
                selection: nil,
                prompt: "Search vehicles",
                maxVisibleOptions: 5,
                onChange: { _ in }
            )
        }
    }

    #Preview("Disabled") {
        staged("disabled · non-interactive") {
            Combobox(
                label: "Vehicle",
                items: ComboboxPreviewData.vehicles,
                selection: ComboboxPreviewData.vehicles[0],
                prompt: "Search vehicles",
                disabled: true,
                onChange: { _ in }
            )
        }
    }

    #Preview("Stale freshness") {
        staged("static · stale chip + auto-refresh") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(
                    selection: ComboboxPreviewData.vehicles[0],
                    staticItems: ComboboxPreviewData.vehicles,
                    connection: .stale
                )
            ))
        }
    }

    #Preview("Offline freshness") {
        staged("static · offline chip, last loaded options") {
            Combobox(model: ComboboxPreviewData.model(
                snapshot: ComboboxSnapshot(
                    selection: ComboboxPreviewData.vehicles[2],
                    staticItems: ComboboxPreviewData.vehicles,
                    connection: .offline
                )
            ))
        }
    }
#endif
