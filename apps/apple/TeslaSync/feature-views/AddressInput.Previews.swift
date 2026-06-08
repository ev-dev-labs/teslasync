//
//  AddressInput.Previews.swift
//  TeslaSync — P4 feature view · 0135 · AddressInput (Apple)
//
//  #if DEBUG previews exercising every state the surface renders (content / idle / loading / empty /
//  error / stale / offline), so the geocoded Address autocomplete can be eyeballed in Xcode without
//  the live store.
//

#if DEBUG
    import SwiftUI

    private enum AddressInputPreviewData {
        static let results: [GeocodeResultDTO] = [
            GeocodeResultDTO(
                displayName: "1600 Amphitheatre Parkway, Mountain View, CA 94043, USA",
                lat: 37.4221,
                lng: -122.0841
            ),
            GeocodeResultDTO(
                displayName: "1 Infinite Loop, Cupertino, CA 95014, USA",
                lat: 37.3318,
                lng: -122.0312
            ),
            GeocodeResultDTO(
                displayName: "Tesla Factory, 45500 Fremont Blvd, Fremont, CA 94538, USA",
                lat: 37.4946,
                lng: -121.9456
            )
        ]

        @MainActor
        static func model(query: String, update: AddressInputUpdate) -> AddressInputModel {
            AddressInputModel(
                source: InMemoryAddressInputSource(initial: update),
                copy: .fallback,
                initialQuery: query,
                debounceInterval: 0
            )
        }

        static func loaded(
            _ rows: [GeocodeResultDTO] = results,
            connection: AddressInputConnection = .live
        ) -> AddressInputUpdate {
            AddressInputUpdate(status: .loaded, results: rows, connection: connection, updatedAt: Date())
        }
    }

    private struct AddressInputPreviewStage: View {
        let model: AddressInputModel

        var body: some View {
            ScrollView {
                AddressInput(model: model)
                    .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("Content") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Amphitheatre",
                update: AddressInputPreviewData.loaded()
            )
        )
    }

    #Preview("Idle (keep typing)") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Am",
                update: AddressInputUpdate(status: .idle)
            )
        )
    }

    #Preview("Loading") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Amphitheatre",
                update: AddressInputUpdate(status: .loading)
            )
        )
    }

    #Preview("Empty (no matches)") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Nowhereville 99999",
                update: AddressInputUpdate(status: .loaded)
            )
        )
    }

    #Preview("Error") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Amphitheatre",
                update: AddressInputUpdate(status: .failed("Network unavailable"))
            )
        )
    }

    #Preview("Stale") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Amphitheatre",
                update: AddressInputPreviewData.loaded(connection: .stale)
            )
        )
    }

    #Preview("Offline") {
        AddressInputPreviewStage(
            model: AddressInputPreviewData.model(
                query: "Amphitheatre",
                update: AddressInputPreviewData.loaded(connection: .offline)
            )
        )
    }
#endif
