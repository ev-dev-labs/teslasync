//
//  LinearSidebar.Samples.swift
//  TeslaSync — P4 shared surface · 0174 · LinearSidebar (Apple)
//
//  DEBUG-only sample data + an inspector that stages EVERY real branch of the sidebar so the previews and
//  the view-composition tests have a concrete reference (and never a blank box). The sample nav tree mirrors
//  the canonical groups + uses the web badge trigger paths (`/vehicles`, `/notifications/alerts`,
//  `/data-repair`) so the notification-dot and count-chip branches render. All copy routes through the
//  P1/S10 facade (DEBUG keys → English fallbacks); none of this ships (it is compiled out in Release).
//

import SwiftUI

#if DEBUG

    // MARK: - Sample data

    /// A small, representative nav tree exercising every branch: a Favorites group, an active row, all
    /// three trailing-badge variants, pin (un-pinned section rows) + unpin (Favorites rows), and the
    /// default collapse (only the active section open on first paint).
    enum LinearSidebarSampleData {
        static func item(
            _ path: String,
            _ key: String,
            _ fallback: String,
            _ symbol: String,
            dataTour: String? = nil
        ) -> LinearSidebarItem {
            LinearSidebarItem(
                path: path,
                titleKey: key,
                titleFallback: fallback,
                systemImage: symbol,
                dataTour: dataTour
            )
        }

        static var sections: [LinearSidebarSection] {
            [
                LinearSidebarSection(
                    id: "overview",
                    titleKey: "linearSidebar.sample.group.overview",
                    titleFallback: "Overview",
                    items: [
                        item("/dashboard", "linearSidebar.sample.dashboard", "Dashboard", "square.grid.2x2.fill"),
                        item("/explore", "linearSidebar.sample.explore", "Explore", "safari.fill")
                    ]
                ),
                LinearSidebarSection(
                    id: "vehicle",
                    titleKey: "linearSidebar.sample.group.vehicle",
                    titleFallback: "Vehicle",
                    items: [
                        item(
                            "/vehicles",
                            "linearSidebar.sample.vehicles",
                            "Vehicles",
                            "car.2.fill",
                            dataTour: "tour-vehicles"
                        ),
                        item("/charging", "linearSidebar.sample.charging", "Charging", "bolt.fill"),
                        item("/trips", "linearSidebar.sample.trips", "Trips", "map.fill")
                    ]
                ),
                LinearSidebarSection(
                    id: "operations",
                    titleKey: "linearSidebar.sample.group.operations",
                    titleFallback: "Operations",
                    items: [
                        item(
                            LinearSidebarBadgePath.alerts,
                            "linearSidebar.sample.alerts",
                            "Alerts",
                            "bell.fill"
                        ),
                        item(
                            LinearSidebarBadgePath.dataRepair,
                            "linearSidebar.sample.dataRepair",
                            "Data Repair",
                            "wrench.and.screwdriver.fill"
                        )
                    ]
                )
            ]
        }

        static var pinnedItems: [LinearSidebarItem] {
            [
                item("/dashboard", "linearSidebar.sample.dashboard", "Dashboard", "square.grid.2x2.fill"),
                item("/charging", "linearSidebar.sample.charging", "Charging", "bolt.fill")
            ]
        }

        static let badges = LinearSidebarBadges(alertCount: 3, vehicleCount: 5, staleCount: 12)

        static func input(activePath: String = "/vehicles") -> LinearSidebarInput {
            LinearSidebarInput(
                sections: sections,
                pinnedItems: pinnedItems,
                badges: badges,
                activePath: activePath
            )
        }

        /// Builds a model from the sample input, optionally pre-seeding the filter (so the filtered + the
        /// empty-filter branches can be staged directly).
        @MainActor
        static func model(filter: String = "", activePath: String = "/vehicles") -> LinearSidebarModel {
            let model = LinearSidebarModel(input: input(activePath: activePath), localize: { _, fallback in fallback })
            if !filter.isEmpty { model.setFilter(filter) }
            return model
        }

        /// The empty (no-data) input — drives the friendly empty state branch.
        static let emptyInput = LinearSidebarInput(sections: [], pinnedItems: [], activePath: "/")
    }

    // MARK: - Inspector (every branch rendered — never a blank box)

    /// One labeled scenario column hosting a full sidebar at a fixed height.
    struct LinearSidebarScenarioColumn: View {
        let title: String
        let sidebar: LinearSidebar

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                sidebar
                    .frame(width: 240, height: 360)
                    .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
            }
        }
    }

    /// The DEBUG inspector: the default tree, a filtered tree, the empty-filter branch, and the no-data
    /// empty state — every real branch staged side by side.
    struct LinearSidebarInspector: View {
        var body: some View {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    LinearSidebarScenarioColumn(
                        title: "Default · favorites + active + badges",
                        sidebar: LinearSidebar(model: LinearSidebarSampleData.model())
                    )
                    LinearSidebarScenarioColumn(
                        title: "Filtered · 'char' (force-expanded)",
                        sidebar: LinearSidebar(model: LinearSidebarSampleData.model(filter: "char"))
                    )
                    LinearSidebarScenarioColumn(
                        title: "Empty filter · 'zzz'",
                        sidebar: LinearSidebar(model: LinearSidebarSampleData.model(filter: "zzz"))
                    )
                    LinearSidebarScenarioColumn(
                        title: "No data · friendly empty",
                        sidebar: LinearSidebar(
                            model: LinearSidebarModel(
                                input: LinearSidebarSampleData.emptyInput,
                                localize: { _, fallback in fallback }
                            )
                        )
                    )
                }
                .padding(TSSpacing.md)
            }
            .background(Color.TS.bg)
        }
    }
#endif
