//
//  GeofencesPageListViews.swift
//  TeslaSync — P4 feature view · P7 · maps/Geofences (Apple) — List-side panels
//
//  The list-side panels around the geofence cards: the summary stat grid (web
//  GlassPanel 1 + four MetricCards), the loading skeleton (web GlassPanel 6), the
//  AI location-id picker, the bulk-action toolbar, the search/filter bar, the
//  page empty state, the search-no-match empty, and the transient toast. Split
//  from the shared furniture purely to keep each file within the lint budget.
//

import SwiftUI

// MARK: - GlassPanel 1 — summary stats grid + four MetricCards

/// The summary panel (web GlassPanel 1): four metric cards (Total / Active /
/// Entry Alerts / Exit Alerts) or the `common.noData` empty when there are none.
struct GeofencesSummaryPanel: View {
    let stats: GeofencesStats
    let hasAnyZone: Bool

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        GeofencesCard {
            if hasAnyZone {
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    GeofencesMetricCard(
                        label: String(localized: "Total Geofences", defaultValue: "Total Geofences"),
                        value: stats.total,
                        systemImage: "mappin.circle.fill",
                        accent: Color.TS.chartSeriesPower
                    )
                    GeofencesMetricCard(
                        label: String(localized: "Active", defaultValue: "Active"),
                        value: stats.active,
                        systemImage: "checkmark.circle.fill",
                        accent: Color.TS.statusSuccess
                    )
                    GeofencesMetricCard(
                        label: String(localized: "Entry Alerts", defaultValue: "Entry Alerts"),
                        value: stats.entryAlerts,
                        systemImage: "arrow.right.to.line",
                        accent: Color.TS.accent
                    )
                    GeofencesMetricCard(
                        label: String(localized: "Exit Alerts", defaultValue: "Exit Alerts"),
                        value: stats.exitAlerts,
                        systemImage: "arrow.left.to.line",
                        accent: Color.TS.statusWarning
                    )
                }
            } else {
                ContentUnavailableView {
                    Label(
                        String(localized: "common.noData", defaultValue: "No data available"),
                        systemImage: "mappin.slash"
                    )
                }
            }
        }
    }
}

// MARK: - GlassPanel 6 — loading skeleton

/// The loading skeleton (web GlassPanel 6) — a header bar + three row shimmers.
struct GeofencesLoadingPanel: View {
    var body: some View {
        GeofencesCard {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                skeletonBar(height: 24, width: 180)
                ForEach(0 ..< 3, id: \.self) { _ in
                    skeletonBar(height: 72, width: nil)
                }
            }
        }
        .redacted(reason: .placeholder) // parity:allow native shimmer for the list loading state
        .accessibilityLabel(Text(String(localized: "Geofences", defaultValue: "Geofences")))
    }

    private func skeletonBar(height: CGFloat, width: CGFloat?) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.sm)
            .fill(Color.TS.surface)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
    }
}

// MARK: - AI location-id picker (web `aiLocationIdRaw` Input)

/// The AI-suggest location-id field (web `geofences.aiSuggest.pickLocation`). The
/// page owns this input; the AI suggestion surface itself is gated/separate.
struct GeofencesAILocationPicker: View {
    @Binding var rawValue: String

    var body: some View {
        GeofencesLabeledField(
            label: String(
                localized: "geofences.aiSuggest.pickLocation",
                defaultValue: "Pick a visited location to draft a geofence around"
            ),
            text: $rawValue,
            prompt: "501",
            systemImage: "sparkles",
            keyboard: .decimal
        )
    }
}

// MARK: - Bulk action toolbar (web `BulkActionToolbar`)

/// The bulk-action bar (web `BulkActionToolbar`): the selected count + noun, a
/// clear control, and a danger Delete action (the page hosts the confirm).
struct GeofencesBulkToolbar: View {
    let count: Int
    let onClear: () -> Void
    let onDelete: () -> Void

    var body: some View {
        GeofencesCard(padding: TSSpacing.md) {
            HStack(spacing: TSSpacing.md) {
                Text(selectionSummary)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                Button(action: onClear) {
                    Image(systemName: "xmark")
                }
                .buttonStyle(.borderless)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityLabel(Text(String(
                    localized: "geofences.bulk.clearSelection",
                    defaultValue: "Clear selection"
                )))
                Button(role: .destructive, action: onDelete) {
                    Label(
                        String(localized: "geofences.bulk.delete", defaultValue: "Delete"),
                        systemImage: "trash"
                    )
                }
                .buttonStyle(.borderedProminent)
                .tint(Color.TS.statusDanger)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var selectionSummary: String {
        let noun = count == 1
            ? String(localized: "geofences.noun.one", defaultValue: "geofence")
            : String(localized: "geofences.noun.other", defaultValue: "geofences")
        return "\(GeofencesFormat.integer(count)) \(noun)"
    }
}

// MARK: - Search / filter bar (web FilterBar + SearchInput + ActiveFilterChips)

/// The search field + active-filter chip (web `FilterBar` / `SearchInput` /
/// `ActiveFilterChips`). Filtering happens in the model; this is pure chrome.
struct GeofencesSearchBar: View {
    @Binding var search: String
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                TextField(searchPrompt, text: $search)
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                if !search.isEmpty {
                    Button(action: onClear) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(Text(String(localized: "Clear search", defaultValue: "Clear search")))
                }
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .frame(maxWidth: 360, alignment: .leading)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Text(searchPrompt))

            if !GeofencesText.trim(search).isEmpty {
                activeChip
            }
        }
    }

    private var activeChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Text("\(filterLabel): \(search)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Button(action: onClear) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
            }
            .buttonStyle(.borderless)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(String(localized: "Clear search", defaultValue: "Clear search")))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.accent.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .combine)
    }

    private var filterLabel: String {
        String(localized: "geofences.filterLabel.search", defaultValue: "Search")
    }

    private var searchPrompt: String {
        String(localized: "geofences.searchPlaceholder", defaultValue: "Search by name…") // parity:allow web i18n key
    }
}

// MARK: - Page empty state (web "No geofences defined")

/// The whole-page empty state (web `EmptyState` with the shield icon + add action).
struct GeofencesEmptyState: View {
    let onAdd: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "No geofences defined", defaultValue: "No geofences defined"),
                systemImage: "shield"
            )
        } description: {
            Text(String(
                localized: "Add a geofence to track when your vehicle arrives or leaves a location.",
                defaultValue: "Add a geofence to track when your vehicle arrives or leaves a location."
            ))
        } actions: {
            Button(action: onAdd) {
                Label(
                    String(localized: "Add Geofence", defaultValue: "Add Geofence"),
                    systemImage: "plus"
                )
            }
            .buttonStyle(.borderedProminent)
        }
    }
}

// MARK: - No-match empty (web "No geofences match your search.")

/// The search-no-match empty (web `EmptyState` with a Clear-search action).
struct GeofencesNoMatchState: View {
    let onClear: () -> Void

    var body: some View {
        ContentUnavailableView {
            Label(
                String(localized: "geofences.noMatches", defaultValue: "No geofences match your search."),
                systemImage: "magnifyingglass"
            )
        } actions: {
            Button(String(localized: "Clear search", defaultValue: "Clear search"), action: onClear)
                .buttonStyle(.bordered)
        }
    }
}

// MARK: - Transient toast (web `useToast`)

/// A transient success/error banner (web toast). Auto-clears via the model.
struct GeofencesToastView: View {
    let toast: GeofencesToast

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: toast.isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .foregroundStyle(toast.isError ? Color.TS.statusDanger : Color.TS.statusSuccess)
            Text(toast.message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .shadow(radius: 8, y: 4)
        .frame(maxWidth: 420)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
    }
}
