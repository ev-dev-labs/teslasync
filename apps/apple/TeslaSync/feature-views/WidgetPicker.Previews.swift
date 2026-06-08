//
//  WidgetPicker.Previews.swift
//  TeslaSync — P4 feature view · 0134 · WidgetPicker (Apple)
//
//  Xcode previews — one per branch the web source produces: the default grouped
//  browse, the browse with a populated "Recently Added" row over a partly-filled
//  dashboard, a multi-result search (flat list + "Add all"), a no-results search
//  (the friendly empty state), a single-category filter, and the post-add state
//  with the session "added" footer. Preview-only; excluded from release builds
//  via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentWidgetPickerTelemetry: WidgetPickerTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A fixed recents source so previews are deterministic (no real defaults).
    private struct StaticWidgetRecentsStore: WidgetRecentsStore {
        let ids: [String]
        func load() -> [String] {
            ids
        }

        func save(_: [String]) {}
    }

    private enum WidgetPickerPreviewData {
        static let telemetry = SilentWidgetPickerTelemetry()

        @MainActor
        static func model(
            active: [String] = [],
            category: WidgetCatalogCategory? = nil,
            recents: [String] = [],
            search: String = "",
            preAdd: [String] = []
        ) -> WidgetPickerModel {
            let model = WidgetPickerModel(
                activeWidgetIDs: active,
                categoryFilter: category,
                recentsStore: StaticWidgetRecentsStore(ids: recents),
                telemetry: telemetry
            )
            model.search = search
            if !preAdd.isEmpty { model.addMany(preAdd) }
            return model
        }
    }

    #Preview("Browse") {
        WidgetPicker(model: WidgetPickerPreviewData.model())
            .frame(width: 420, height: 760)
    }

    #Preview("Recently added · partial dashboard") {
        WidgetPicker(model: WidgetPickerPreviewData.model(
            active: ["vehicle-hero", "battery-gauge"],
            recents: ["range-estimate", "charge-status", "climate-status"]
        ))
        .frame(width: 420, height: 760)
    }

    #Preview("Search results") {
        WidgetPicker(model: WidgetPickerPreviewData.model(search: "charge"))
            .frame(width: 420, height: 760)
    }

    #Preview("No results") {
        WidgetPicker(model: WidgetPickerPreviewData.model(search: "zzzzz"))
            .frame(width: 420, height: 760)
    }

    #Preview("Category · battery") {
        WidgetPicker(model: WidgetPickerPreviewData.model(category: .battery))
            .frame(width: 420, height: 760)
    }

    #Preview("Added footer") {
        WidgetPicker(model: WidgetPickerPreviewData.model(preAdd: ["battery-gauge", "range-estimate"]))
            .frame(width: 420, height: 760)
    }
#endif
