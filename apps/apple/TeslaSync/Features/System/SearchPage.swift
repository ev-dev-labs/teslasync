//
//  SearchPage.swift
//  TeslaSync — P7 System · SearchPage (Apple)
//
//  The SwiftUI parity of web/src/features/system/pages/SearchPage.tsx — global search
//  across vehicles, drives, charging sessions, alerts, notifications, geofences, automations,
//  locations, and trips. Provides a search input field, type filter chips, and grouped results.
//  Follows Apple HIG with adaptive layout for macOS (regular) and iOS (compact/regular).
//  All strings resolve from Localizable.xcstrings; all styling uses P2 design tokens (ADR-005, ADR-014).
//

import SwiftUI

// MARK: - Main Page View

public struct SearchPage: View {
    @State private var viewModel = SearchPageModel()
    @State private var searchTask: Task<Void, Never>?

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                SearchInputPanel(
                    query: $viewModel.query,
                    selectedTypes: viewModel.selectedTypes,
                    onSubmit: { triggerSearch() },
                    onQueryChange: { debounceSearch() },
                    onClearQuery: { clearQuery() },
                    onToggleType: { viewModel.toggleType($0) },
                    onClearFilters: { viewModel.clearFilters() }
                )

                SearchContentArea(
                    viewModel: viewModel,
                    onRetry: { triggerSearch() }
                )
            }
            .padding()
        }
        .navigationTitle(
            String(localized: "search.title", defaultValue: "Search")
        )
        .task {}
    }

    private func debounceSearch() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            if !Task.isCancelled {
                await viewModel.search()
            }
        }
    }

    private func clearQuery() {
        viewModel.query = ""
        viewModel.groupedHits = []
        viewModel.state = .empty
    }

    private func triggerSearch() {
        searchTask?.cancel()
        Task {
            await viewModel.search()
        }
    }
}

// MARK: - Previews

#Preview("Search Page") {
    NavigationStack {
        SearchPage()
    }
}
