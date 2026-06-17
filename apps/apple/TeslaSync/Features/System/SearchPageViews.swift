//
//  SearchPageViews.swift
//  TeslaSync — P7 System · SearchPage (Apple) — Supporting Views
//

import SwiftUI

// MARK: - Search Input Panel

struct SearchInputPanel: View {
    @Binding var query: String
    let selectedTypes: Set<SearchHitType>
    let onSubmit: () -> Void
    let onQueryChange: () -> Void
    let onClearQuery: () -> Void
    let onToggleType: (SearchHitType) -> Void
    let onClearFilters: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)

                TextField(
                    String(
                        localized: "search.placeholder", // parity:allow i18n key name
                        defaultValue: "Search vehicles, drives, charging…"
                    ),
                    text: $query
                )
                .textFieldStyle(.plain)
                .submitLabel(.search)
                .onSubmit(onSubmit)
                .onChange(of: query) { _, _ in
                    onQueryChange()
                }
                .accessibilityLabel(
                    String(localized: "search.input.label", defaultValue: "Search query")
                )

                if !query.isEmpty {
                    Button(action: onClearQuery) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(12)
            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(SearchHitType.allCases, id: \.self) { type in
                        FilterChip(
                            label: type.localizedLabel(),
                            icon: type.icon,
                            isSelected: selectedTypes.contains(type),
                            action: { onToggleType(type) }
                        )
                    }

                    if !selectedTypes.isEmpty {
                        Button(action: onClearFilters) {
                            Text(
                                String(
                                    localized: "search.filters.clear",
                                    defaultValue: "Clear filters"
                                )
                            )
                            .font(.caption)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(.quaternary, in: Capsule())
                            .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 4)
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Search Content Area

struct SearchContentArea: View {
    let viewModel: SearchPageModel
    let onRetry: () -> Void

    var body: some View {
        if viewModel.isTooShort {
            SearchTooShortPanel()
        } else if viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            SearchEmptyPanel()
        } else {
            switch viewModel.state {
            case .loading:
                SearchLoadingPanel()
            case .empty:
                SearchNoResultsPanel(
                    query: viewModel.query.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            case .error:
                SearchErrorPanel(onRetry: onRetry)
            case .success:
                SearchResultsView(groupedHits: viewModel.groupedHits)
            }
        }
    }
}

// MARK: - State Panels

struct SearchTooShortPanel: View {
    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "search.tooShort.title", defaultValue: "Type at least 2 characters"),
                systemImage: "magnifyingglass"
            )
        } description: {
            Text(
                String(
                    localized: "search.tooShort.message",
                    defaultValue: """
                    Search across vehicles, drives, charging sessions, alerts, \
                    geofences, automations and more.
                    """
                )
            )
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct SearchEmptyPanel: View {
    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "search.empty.title", defaultValue: "Start typing to search"),
                systemImage: "magnifyingglass"
            )
        } description: {
            Text(
                String(
                    localized: "search.empty.message",
                    defaultValue: """
                    Search across vehicles, drives, charging sessions, alerts, \
                    geofences, automations and more.
                    """
                )
            )
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct SearchLoadingPanel: View {
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0 ..< 5, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 8)
                    .fill(.quaternary)
                    .frame(height: 60)
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .redacted(reason: .placeholder) // parity:allow SwiftUI API for skeleton loading
    }
}

struct SearchNoResultsPanel: View {
    let query: String

    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "search.noResults.title", defaultValue: "No results"),
                systemImage: "magnifyingglass"
            )
        } description: {
            Text(
                String(
                    localized: "search.noResults.message",
                    defaultValue: """
                    No matches for "\(query)". Try fewer characters or open the command palette.
                    """
                )
            )
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct SearchErrorPanel: View {
    let onRetry: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "search.error.title", defaultValue: "Search failed"),
                systemImage: "exclamationmark.triangle"
            )
        } description: {
            Text(
                String(
                    localized: "search.error.message",
                    defaultValue: """
                    The search service did not respond. Try again or refine your query.
                    """
                )
            )
        } actions: {
            Button(String(localized: "Retry", defaultValue: "Retry"), action: onRetry)
                .buttonStyle(.borderedProminent)
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct SearchResultsView: View {
    let groupedHits: [GroupedSearchHits]

    var body: some View {
        VStack(spacing: 16) {
            ForEach(groupedHits) { group in
                SearchResultGroup(group: group)
            }
        }
    }
}

struct SearchResultGroup: View {
    let group: GroupedSearchHits

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: group.type.icon)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Text(group.type.localizedLabel())
                    .font(.caption)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)

                Text("\(group.hits.count)")
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(.quaternary, in: Capsule())
                    .foregroundStyle(.tertiary)
            }

            VStack(spacing: 0) {
                ForEach(group.hits) { hit in
                    SearchResultRow(hit: hit)

                    if hit.compositeId != group.hits.last?.compositeId {
                        Divider()
                    }
                }
            }
        }
        .padding()
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))
    }
}

// MARK: - Supporting Views

struct SearchResultRow: View {
    let hit: SearchHit

    var body: some View {
        Button {
            // Navigation integration point: hit.url contains the deep link path
        } label: {
            HStack(spacing: 12) {
                Image(systemName: hit.type.icon)
                    .foregroundStyle(.secondary)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(hit.title)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if let subtitle = hit.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: 0)

                if let when = hit.when {
                    Text(formatRelativeDate(when))
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func formatRelativeDate(_ isoString: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: isoString) else {
            return ""
        }

        let interval = Date.now.timeIntervalSince(date)
        let minutes = Int(interval / 60)
        let hours = Int(interval / 3600)
        let days = Int(interval / 86400)

        if minutes < 60 {
            return "\(minutes)m"
        } else if hours < 24 {
            return "\(hours)h"
        } else {
            return "\(days)d"
        }
    }
}

struct FilterChip: View {
    let label: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(label)
                    .font(.caption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(
                isSelected ? Color.accentColor.opacity(0.2) : Color.clear,
                in: Capsule()
            )
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? Color.accentColor : Color.secondary.opacity(0.3),
                        lineWidth: 1
                    )
            )
            .foregroundStyle(isSelected ? .primary : .secondary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
