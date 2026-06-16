import SwiftUI

// The summary metric cards and the All-Locations list panel for the Locations surface (web summary
// `MetricCard`s + the All-Locations `GlassPanel` with its search, ranked rows, per-row AI auto-name
// affordance, and pagination). Durations format from raw SI seconds via `LocationsFormat` at this
// display boundary; every panel renders its own empty state, never a blank region. The two
// Top-Locations chart panels live in `LocationsPage.Charts.swift`.

// MARK: - Metric card (web `MetricCard` — label + value + tinted icon)

/// One labeled summary metric with a tinted SF Symbol (web `MetricCard` with its `color` prop).
/// Composes the shared `TSCard` + `TSIconBox` + typography, mirroring the sibling pages' own card
/// structs.
struct LocationsMetricCard: View {
    let title: LocalizedStringKey
    let value: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: tone)
                }
                TSMetricValue(value)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary cards (web 6 MetricCards)

/// The six summary cards (web Unique-Places, Unique-Cities, Total-Visits, Total-Time, Most-Visited,
/// Avg-Visit). Counts render as grouped integers; durations convert from SI seconds to the user's
/// unit; Most-Visited shows the top place's (truncated) address or an em dash.
struct LocationsSummarySection: View {
    let model: LocationsPageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var mostVisited: String {
        guard let top = model.topLocation else { return LocationsFormat.emptyValue }
        return LocationsFormat.chartLabel(top.addressName)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            LocationsMetricCard(
                title: "Unique Places",
                value: LocationsFormat.integer(model.uniquePlaces),
                systemImage: "mappin.and.ellipse",
                tone: .success
            )
            LocationsMetricCard(
                title: "Unique Cities",
                value: LocationsFormat.integer(model.uniqueCities),
                systemImage: "building.2.fill",
                tone: .info
            )
            LocationsMetricCard(
                title: "Total Visits",
                value: LocationsFormat.integer(model.totalVisits),
                systemImage: "number",
                tone: .accent
            )
            LocationsMetricCard(
                title: "Total Time",
                value: LocationsFormat.duration(model.totalTimeS, units),
                systemImage: "clock.fill",
                tone: .accent
            )
            LocationsMetricCard(
                title: "Most Visited",
                value: mostVisited,
                systemImage: "trophy.fill",
                tone: .warning
            )
            LocationsMetricCard(
                title: "Avg Visit",
                value: LocationsFormat.duration(model.averageDurationS, units),
                systemImage: "clock.arrow.circlepath",
                tone: .accent
            )
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - All Locations list (web GlassPanel9 — search + ranked rows + pagination)

/// The All-Locations panel (web GlassPanel9): the search field + active-filter chips, then the
/// ranked list of places (each its own GlassPanel10 row, with the AI auto-name affordance for
/// unnamed rows), or one of the two empty states (no visited locations / no search match), then the
/// pager. Binds directly to the model for the search text, pagination, applied-name hand-off, and
/// the per-row AI models.
struct LocationsListSection: View {
    @Bindable var model: LocationsPageModel
    let units: UnitPreferences
    let onViewDrives: () -> Void

    private var searchBinding: Binding<String> {
        Binding(get: { model.search }, set: { model.setSearch($0) })
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSSubhead("All Locations")
                TSFilterBar {
                    TSSearchInput(text: searchBinding, prompt: "Search by address\u{2026}")
                        .frame(maxWidth: 320)
                }
                if !model.search.isEmpty {
                    TSActiveFilterChips(
                        chips: [TSFilterChip(id: "q", label: searchChipLabel)],
                        onRemove: { _ in model.clearSearch() },
                        onClearAll: { model.clearSearch() }
                    )
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var searchChipLabel: LocalizedStringKey {
        "\(String(localized: "locations.filterLabel.search")): \(model.search)"
    }

    @ViewBuilder
    private var content: some View {
        if model.locations.isEmpty {
            // Web `!locations?.length` — no visited locations recorded at all (the manifest's
            // `empty` data state), with the "View drives" recovery CTA.
            TSEmptyState(
                title: "No locations",
                message: "No visited locations recorded yet",
                systemImage: "mappin.slash"
            ) {
                TSButton("locations.empty.cta", variant: .secondary, size: .small, action: onViewDrives)
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        } else if model.filteredLocations.isEmpty {
            // Web `!filteredLocations.length` — the search excluded every row.
            TSEmptyState(
                title: "No locations",
                message: "No locations match your search",
                systemImage: "magnifyingglass"
            ) {
                TSButton("Clear search", variant: .secondary, size: .small) { model.clearSearch() }
            }
            .frame(maxWidth: .infinity, minHeight: 200)
        } else {
            VStack(spacing: TSSpacing.sm) {
                ForEach(Array(model.filteredLocations.enumerated()), id: \.element.id) { index, location in
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        LocationsListRow(
                            location: location,
                            rank: index + 1,
                            appliedName: model.appliedName(for: location.id),
                            units: units
                        )
                        if location.isUnnamed {
                            AIAutoNameUnnamedLocations(model: model.nameDraftModel(for: location))
                        }
                    }
                }
            }
            LocationsPager(
                page: model.page,
                hasPrevious: model.hasPreviousPage,
                hasNext: model.hasNextPage,
                onChange: { newPage in Task { await model.setPage(newPage) } }
            )
        }
    }
}

// MARK: - List row (web GlassPanel10 — rank badge + name + caption + visit chip)

/// One ranked place row (web per-row GlassPanel10): a rank badge, the address + a
/// visits/total/avg/last caption, and a trailing visit-count chip. When an AI name has been applied
/// for this row, the "ready to save" confirmation (web `locations.aiAutoName.applied`) shows beneath
/// the address.
struct LocationsListRow: View {
    let location: VisitedLocation
    let rank: Int
    let appliedName: String?
    let units: UnitPreferences

    private var rankTone: TSTone {
        switch rank {
        case 1: .warning
        case 2, 3: .accent
        default: .neutral
        }
    }

    private var caption: String {
        let visits = String(localized: "visits")
        let total = String(localized: "total")
        let avg = String(localized: "avg")
        var parts =
            "\(location.visitCount) \(visits) · \(LocationsFormat.duration(location.totalDurationS, units)) \(total)"
        parts += " · ~\(LocationsFormat.duration(location.averageDurationS, units)) \(avg)"
        if let visited = location.lastVisited {
            parts += " · \(String(localized: "Last")): \(LocationsFormat.date(visited))"
        }
        return parts
    }

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                rankBadge
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: location.addressName.isEmpty ? LocationsFormat.emptyValue : location.addressName)
                        .font(Font.TS.body)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    Text(verbatim: caption)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .lineLimit(2)
                    if let appliedName {
                        appliedConfirmation(appliedName)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                visitChip
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var rankBadge: some View {
        Text(verbatim: "#\(rank)")
            .font(Font.TS.caption)
            .fontWeight(.bold)
            .monospacedDigit()
            .foregroundStyle(rankTone.color)
            .frame(width: 36, height: 32)
            .background(
                rankTone.color.opacity(0.15),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }

    private var visitChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "number")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: "\(location.visitCount)")
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .monospacedDigit()
        }
        .foregroundStyle(Color.TS.statusSuccess)
        .accessibilityHidden(true)
    }

    /// Web `appliedName?.id === loc.id` — the AI-proposed name parked and ready to save.
    private func appliedConfirmation(_ name: String) -> some View {
        (
            Text("locations.aiAutoName.applied")
                .foregroundStyle(Color.TS.statusSuccess)
                + Text(verbatim: " \(name)")
                .foregroundStyle(Color.TS.textPrimary)
        )
        .font(Font.TS.caption)
        .accessibilityElement()
        .accessibilityLabel(Text("locations.aiAutoName.applied"))
        .accessibilityValue(Text(verbatim: name))
    }
}

// MARK: - Pager (web `Pagination`)

/// Simple previous/next pager beneath the list (web `Pagination`): the current page plus disabled
/// guards at the first page and when the last page returned fewer than a full window.
struct LocationsPager: View {
    let page: Int
    let hasPrevious: Bool
    let hasNext: Bool
    let onChange: (Int) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            TSButton("pagination.previous", variant: .ghost, size: .small) { onChange(page - 1) }
                .disabled(!hasPrevious)
            Spacer()
            Text(verbatim: "\(page)")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .monospacedDigit()
                .accessibilityLabel(Text("pagination.currentPage"))
                .accessibilityValue(Text(verbatim: "\(page)"))
            Spacer()
            TSButton("pagination.next", variant: .ghost, size: .small) { onChange(page + 1) }
                .disabled(!hasNext)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web isLoading Skeletons)

/// Mirrors the page layout while the locations query loads (web `isLoading` skeleton cards +
/// panels): the six summary cards → the two chart panels → five list rows, all under SwiftUI
/// redaction (the manifest's `loading → redacted(reason:)`).
struct LocationsSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 84)
                }
            }
            skeletonBlock(height: 280)
            skeletonBlock(height: 240)
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< 5, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                        .fill(Color.TS.surfaceGlass)
                        .frame(height: 64)
                }
            }
        }
        .locationsRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("Visited Locations"))
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func locationsRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
