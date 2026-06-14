//
//  ComboboxMulti.Previews.swift
//  TeslaSync — P4 shared surface · 0149 · ComboboxMulti (Apple)
//
//  Xcode previews for every branch of the multi-select combobox: the field with chips + list closed, the
//  open + filtered list (selected rows hidden), the "No results" empty state, the "Maximum reached" cap
//  state, the in-flight loading row, the loader-error retry row, the "+N more — refine search" overflow
//  footer, the disabled field, and the stale / offline freshness chips. Each preview seeds an
//  ``InMemoryComboboxMultiSource`` and drives the model into the target state (start → open → type) so
//  the dropdown renders without a live host. DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum ComboboxMultiPreviewData {
        static let fruits: [ComboboxMultiItem] = [
            ComboboxMultiItem(id: "1", label: "Apple"),
            ComboboxMultiItem(id: "2", label: "Banana"),
            ComboboxMultiItem(id: "3", label: "Cherry"),
            ComboboxMultiItem(id: "4", label: "Date"),
            ComboboxMultiItem(id: "5", label: "Elderberry")
        ]

        static func many(_ count: Int) -> [ComboboxMultiItem] {
            (1 ... count).map { ComboboxMultiItem(id: "v\($0)", label: "Vehicle \($0)") }
        }

        /// Builds a model seeded with a snapshot, started + (optionally) opened + pre-typed, so a preview
        /// shows the target dropdown branch immediately.
        @MainActor
        static func model(
            snapshot: ComboboxMultiSnapshot,
            config: ComboboxMultiConfig = ComboboxMultiConfig(label: "Fruits", prompt: "Add a fruit"),
            provider: ComboboxMultiOptionProvider = .staticItems,
            open: Bool = false,
            query: String? = nil
        ) -> ComboboxMultiModel {
            let model = ComboboxMultiModel(
                config: config,
                provider: provider,
                source: InMemoryComboboxMultiSource(initial: snapshot)
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

    #Preview("Closed · chips") {
        staged("static · two chips, list closed") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(
                    selected: [ComboboxMultiPreviewData.fruits[0], ComboboxMultiPreviewData.fruits[1]],
                    staticItems: ComboboxMultiPreviewData.fruits
                )
            ))
        }
    }

    #Preview("Open · filtered") {
        staged("static · open, filtered by \"e\", selected hidden") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(
                    selected: [ComboboxMultiPreviewData.fruits[0]],
                    staticItems: ComboboxMultiPreviewData.fruits
                ),
                open: true,
                query: "e"
            ))
        }
    }

    #Preview("Empty · No results") {
        staged("static · open, query matches nothing") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(staticItems: ComboboxMultiPreviewData.fruits),
                open: true,
                query: "zzzz"
            ))
        }
    }

    #Preview("Maximum reached") {
        staged("static · cap of 2 reached · disabled rows") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(
                    selected: [ComboboxMultiPreviewData.fruits[0], ComboboxMultiPreviewData.fruits[1]],
                    staticItems: ComboboxMultiPreviewData.fruits
                ),
                config: ComboboxMultiConfig(label: "Fruits", prompt: "Add a fruit", maxItems: 2),
                open: true
            ))
        }
    }

    #Preview("Loading") {
        staged("async fetch in flight · loading row") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(isLoading: true),
                open: true
            ))
        }
    }

    #Preview("Error · retry") {
        staged("loader failed · QueryError peer") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(errorMessage: "Network request timed out"),
                open: true
            ))
        }
    }

    #Preview("Overflow · +N more") {
        staged("12 rows · maxVisible 5 · refine footer") {
            ComboboxMulti(
                label: "Vehicle",
                items: ComboboxMultiPreviewData.many(12),
                value: [],
                prompt: "Search vehicles",
                maxVisibleOptions: 5,
                onChange: { _ in }
            )
        }
    }

    #Preview("Disabled") {
        staged("disabled · non-interactive") {
            ComboboxMulti(
                label: "Fruits",
                items: ComboboxMultiPreviewData.fruits,
                value: [ComboboxMultiPreviewData.fruits[0]],
                prompt: "Add a fruit",
                disabled: true,
                onChange: { _ in }
            )
        }
    }

    #Preview("Stale freshness") {
        staged("static · stale chip + auto-refresh") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(
                    selected: [ComboboxMultiPreviewData.fruits[0]],
                    staticItems: ComboboxMultiPreviewData.fruits,
                    connection: .stale
                )
            ))
        }
    }

    #Preview("Offline freshness") {
        staged("static · offline chip, last loaded options") {
            ComboboxMulti(model: ComboboxMultiPreviewData.model(
                snapshot: ComboboxMultiSnapshot(
                    selected: [ComboboxMultiPreviewData.fruits[2]],
                    staticItems: ComboboxMultiPreviewData.fruits,
                    connection: .offline
                )
            ))
        }
    }
#endif
