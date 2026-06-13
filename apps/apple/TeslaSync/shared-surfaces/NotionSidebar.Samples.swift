//
//  NotionSidebar.Samples.swift
//  TeslaSync — P4 shared surface · 0175 · NotionSidebar (Apple)
//
//  DEBUG-only sample data + an inspector that stages EVERY real branch of the sidebar so the previews and the
//  view-composition tests have a concrete reference (and never a blank box). The sample nav tree mirrors the
//  canonical groups + uses the web badge trigger paths (`/vehicles`, `/notifications/alerts`, `/data-repair`)
//  so the notification-dot and count-chip branches render. All copy routes through the P1/S10 facade (DEBUG
//  keys → English fallbacks); none of this ships (it is compiled out in Release).
//

import SwiftUI

#if DEBUG

    // MARK: - Sample data

    /// A small, representative nav tree exercising every branch: a Favorites group, an active row, all three
    /// trailing-badge variants, pin (un-pinned section rows) + unpin (Favorites + already-pinned rows), and
    /// the default collapse (only the active section open on first paint).
    enum NotionSidebarSampleData {
        static func item(
            _ path: String,
            _ key: String,
            _ fallback: String,
            _ symbol: String,
            dataTour: String? = nil
        ) -> NotionSidebarItem {
            NotionSidebarItem(
                path: path,
                titleKey: key,
                titleFallback: fallback,
                systemImage: symbol,
                dataTour: dataTour
            )
        }

        static var sections: [NotionSidebarSection] {
            [
                NotionSidebarSection(
                    id: "overview",
                    titleKey: "notionSidebar.sample.group.overview",
                    titleFallback: "Overview",
                    items: [
                        item("/dashboard", "notionSidebar.sample.dashboard", "Dashboard", "square.grid.2x2"),
                        item("/explore", "notionSidebar.sample.explore", "Explore", "safari")
                    ]
                ),
                NotionSidebarSection(
                    id: "vehicle",
                    titleKey: "notionSidebar.sample.group.vehicle",
                    titleFallback: "Vehicle",
                    items: [
                        item(
                            "/vehicles",
                            "notionSidebar.sample.vehicles",
                            "Vehicles",
                            "car.2",
                            dataTour: "tour-vehicles"
                        ),
                        item("/charging", "notionSidebar.sample.charging", "Charging", "bolt"),
                        item("/trips", "notionSidebar.sample.trips", "Trips", "map")
                    ]
                ),
                NotionSidebarSection(
                    id: "operations",
                    titleKey: "notionSidebar.sample.group.operations",
                    titleFallback: "Operations",
                    items: [
                        item(
                            NotionSidebarBadgePath.alerts,
                            "notionSidebar.sample.alerts",
                            "Alerts",
                            "bell"
                        ),
                        item(
                            NotionSidebarBadgePath.dataRepair,
                            "notionSidebar.sample.dataRepair",
                            "Data Repair",
                            "wrench.and.screwdriver"
                        )
                    ]
                )
            ]
        }

        static var pinnedItems: [NotionSidebarItem] {
            [
                item("/dashboard", "notionSidebar.sample.dashboard", "Dashboard", "square.grid.2x2"),
                item("/charging", "notionSidebar.sample.charging", "Charging", "bolt")
            ]
        }

        static let badges = NotionSidebarBadges(alertCount: 3, vehicleCount: 5, staleCount: 12)

        static func input(activePath: String = "/vehicles") -> NotionSidebarInput {
            NotionSidebarInput(
                sections: sections,
                pinnedItems: pinnedItems,
                badges: badges,
                activePath: activePath
            )
        }

        /// Builds a model from the sample input, optionally pre-seeding the filter (so the filtered + the
        /// empty-filter branches can be staged directly).
        @MainActor
        static func model(filter: String = "", activePath: String = "/vehicles") -> NotionSidebarModel {
            let model = NotionSidebarModel(
                input: input(activePath: activePath),
                localize: { _, fallback in fallback }
            )
            if !filter.isEmpty { model.setFilter(filter) }
            return model
        }

        /// The empty (no-data) input — drives the friendly empty state branch.
        static let emptyInput = NotionSidebarInput(sections: [], pinnedItems: [], activePath: "/")
    }

    // MARK: - Inspector (every branch rendered — never a blank box)

    /// One labeled scenario column hosting a full sidebar at a fixed height.
    struct NotionSidebarScenarioColumn: View {
        let title: String
        let sidebar: NotionSidebar

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

    /// The DEBUG inspector: the default tree, a filtered tree, the empty-filter branch, and the no-data empty
    /// state — every real branch staged side by side.
    struct NotionSidebarInspector: View {
        var body: some View {
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    NotionSidebarScenarioColumn(
                        title: "Default · favorites + active + badges",
                        sidebar: NotionSidebar(model: NotionSidebarSampleData.model())
                    )
                    NotionSidebarScenarioColumn(
                        title: "Filtered · 'char' (force-expanded)",
                        sidebar: NotionSidebar(model: NotionSidebarSampleData.model(filter: "char"))
                    )
                    NotionSidebarScenarioColumn(
                        title: "Empty filter · 'zzz'",
                        sidebar: NotionSidebar(model: NotionSidebarSampleData.model(filter: "zzz"))
                    )
                    NotionSidebarScenarioColumn(
                        title: "No data · friendly empty",
                        sidebar: NotionSidebar(
                            model: NotionSidebarModel(
                                input: NotionSidebarSampleData.emptyInput,
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
