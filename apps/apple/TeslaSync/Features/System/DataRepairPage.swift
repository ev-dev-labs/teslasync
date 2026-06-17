//
//  DataRepairPage.swift
//  TeslaSync — P4 feature view · P7 · DataRepairPage (Apple)
//
//  The SwiftUI parity of web/src/features/system/pages/DataRepairPage.tsx —
//  fix incomplete charging sessions and drive records. Lists stale (open) sessions
//  with inline edit forms to update, close, or discard them.
//

import SwiftUI

// MARK: - Main Page View

public struct DataRepairPage: View {
    @State private var viewModel = DataRepairPageModel()

    public init() {}

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                headerSection

                switch viewModel.state {
                case .loading:
                    loadingView
                case .empty:
                    emptyView
                case let .error(message):
                    errorView(message)
                case .success:
                    successView
                }
            }
            .padding()
        }
        .navigationTitle(String(localized: "Data Repair"))
        .task {
            await viewModel.load()
        }
        .refreshable {
            await viewModel.refresh()
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(localized: "Data Repair"))
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(subtitleText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    private var subtitleText: String {
        let total = viewModel.totalStale
        if total > 0 {
            let baseText = String(localized: "incomplete session")
            let sessionWord = total == 1 ? baseText : baseText + "s"
            return "\(total) \(sessionWord) \(String(localized: "found"))"
        } else {
            return String(localized: "Fix incomplete or stale sessions")
        }
    }

    // MARK: - Loading State (Panel 1)

    private var loadingView: some View {
        VStack(spacing: 16) {
            ForEach(0 ..< 4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .frame(height: 100)
                    .redacted(reason: .privacy)
            }
        }
        .accessibilityLabel(String(localized: "Data Repair"))
        .accessibilityHint("Loading data")
    }

    // MARK: - Empty State (Panel 2)

    private var emptyView: some View {
        ContentUnavailableView {
            Label(String(localized: "All sessions are complete"), systemImage: "checkmark.circle")
        } description: {
            Text(String(localized: "Fix incomplete or stale sessions"))
        }
        .accessibilityLabel(String(localized: "All sessions are complete"))
    }

    // MARK: - Error State

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView {
            Label(String(localized: "Failed to load data"), systemImage: "exclamationmark.triangle")
        } description: {
            Text(message)
        } actions: {
            Button(String(localized: "Retry")) {
                Task {
                    await viewModel.load()
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .accessibilityLabel("Error: \(message)")
    }

    // MARK: - Success State

    private var successView: some View {
        VStack(alignment: .leading, spacing: 24) {
            statsSection // Panel 3-6
            tabSelector // Panel 7
            contentSection // Panel 8
        }
    }

    // MARK: - Stats Section (Panels 3-6: Total Stale, Stale Charging, Stale Drives, Status)

    private var statsSection: some View {
        #if os(iOS)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                statCards
            }
        #else
            HStack(spacing: 12) {
                statCards
            }
        #endif
    }

    @ViewBuilder
    private var statCards: some View {
        // Panel 3: Total Stale
        StatCard(
            label: String(localized: "Total Stale"),
            value: "\(viewModel.totalStale)",
            icon: "exclamationmark.triangle",
            color: .orange
        )

        // Panel 4: Stale Charging
        StatCard(
            label: String(localized: "Stale Charging"),
            value: "\(viewModel.staleCharging.count)",
            icon: "bolt.batteryblock",
            color: .cyan
        )

        // Panel 5: Stale Drives
        StatCard(
            label: String(localized: "Stale Drives"),
            value: "\(viewModel.staleDrives.count)",
            icon: "road.lanes",
            color: .purple
        )

        // Panel 6: Status
        StatCard(
            label: String(localized: "Status"),
            value: viewModel.totalStale == 0 ? String(localized: "Clean") : String(localized: "Needs Repair"),
            icon: "wrench",
            color: viewModel.totalStale == 0 ? .green : .red
        )
    }

    // MARK: - Tab Selector (Panel 7)

    private var tabSelector: some View {
        HStack(spacing: 8) {
            TabButton(
                title: String(localized: "Charging Sessions"),
                icon: "bolt.batteryblock",
                count: viewModel.staleCharging.count,
                isSelected: viewModel.selectedTab == .charging
            ) {
                viewModel.selectedTab = .charging
                viewModel.expandedId = nil
            }

            TabButton(
                title: String(localized: "Drives"),
                icon: "road.lanes",
                count: viewModel.staleDrives.count,
                isSelected: viewModel.selectedTab == .drives
            ) {
                viewModel.selectedTab = .drives
                viewModel.expandedId = nil
            }
        }
        .padding(4)
        .background(.quaternary.opacity(0.3))
        .cornerRadius(12)
    }

    // MARK: - Content Section (Panel 8)

    private var contentSection: some View {
        Group {
            if viewModel.selectedTab == .charging {
                chargingContent
            } else {
                drivesContent
            }
        }
    }

    private var chargingContent: some View {
        Group {
            if viewModel.staleCharging.isEmpty {
                ContentUnavailableView {
                    Label(String(localized: "All sessions are complete"), systemImage: "checkmark.circle")
                } description: {
                    Text("No stale charging sessions found.")
                }
            } else {
                VStack(spacing: 12) {
                    ForEach(viewModel.staleCharging) { session in
                        ChargingSessionRow(
                            session: session,
                            isExpanded: viewModel.expandedId == session.id,
                            onTap: {
                                let newId = viewModel.expandedId == session.id ? nil : session.id
                                viewModel.expandedId = newId
                            },
                            viewModel: viewModel
                        )
                    }
                }
            }
        }
    }

    private var drivesContent: some View {
        Group {
            if viewModel.staleDrives.isEmpty {
                ContentUnavailableView {
                    Label(String(localized: "All sessions are complete"), systemImage: "checkmark.circle")
                } description: {
                    Text("No stale drives found.")
                }
            } else {
                VStack(spacing: 12) {
                    ForEach(viewModel.staleDrives) { drive in
                        DriveRow(
                            drive: drive,
                            isExpanded: viewModel.expandedId == drive.id,
                            onTap: {
                                let newId = viewModel.expandedId == drive.id ? nil : drive.id
                                viewModel.expandedId = newId
                            },
                            viewModel: viewModel
                        )
                    }
                }
            }
        }
    }
}

// MARK: - Preview

#if DEBUG
    #Preview("Data Repair - Empty") {
        NavigationStack {
            DataRepairPage()
        }
    }

    #Preview("Data Repair - Loading") {
        NavigationStack {
            let page = DataRepairPage()
            page
        }
    }
#endif
