//
//  RoadmapPage.swift
//  TeslaSync — P4 feature view · P7 · RoadmapPage (Apple)
//
//  The SwiftUI parity of web/src/features/system/pages/RoadmapPage.tsx —
//  displays TeslaSync roadmap with completed, in-progress, upcoming, and future features.
//

import SwiftUI

// MARK: - Main Page View

public struct RoadmapPage: View {
    @State private var viewModel = RoadmapPageModel()

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
                case .success:
                    successView
                }
            }
            .padding()
        }
        .navigationTitle(String(
            localized: "roadmap.title",
            defaultValue: "Roadmap"
        ))
        .task {
            await viewModel.load()
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(String(
                localized: "roadmap.title",
                defaultValue: "Roadmap"
            ))
            .font(.largeTitle)
            .fontWeight(.bold)

            Text(String(
                localized: "roadmap.subtitle",
                defaultValue: "What's been built, what's in progress, and what's coming next"
            ))
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Loading State (Panel 1)

    private var loadingView: some View {
        VStack(spacing: 16) {
            ForEach(0..<3, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(.quaternary)
                    .frame(height: 100)
                    .redacted(reason: .privacy)
            }
        }
        .accessibilityLabel(String(
            localized: "roadmap.title",
            defaultValue: "Roadmap"
        ))
        .accessibilityHint("Loading roadmap data")
    }

    // MARK: - Empty State (Panel 2)

    private var emptyView: some View {
        ContentUnavailableView {
            Label("No roadmap items", systemImage: "doc.text")
        } description: {
            Text("Roadmap data is not available.")
        }
        .accessibilityLabel("No roadmap items available")
    }

    // MARK: - Success State

    private var successView: some View {
        VStack(alignment: .leading, spacing: 24) {
            phaseProgressBar
            roadmapContent
        }
    }

    // MARK: - Phase Progress Bar (GlassPanel 1)

    private var phaseProgressBar: some View {
        GroupBox {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 16) {
                    ForEach(
                        Array(RoadmapPhase.allCases.enumerated()),
                        id: \.element
                    ) { index, phase in
                        HStack(spacing: 8) {
                            Circle()
                                .fill(phaseColor(phase))
                                .frame(width: 10, height: 10)

                            Text(phase.label)
                                .font(.caption)
                                .fontWeight(.medium)
                                .foregroundStyle(phaseColor(phase))

                            Text("\(viewModel.itemCount(for: phase))")
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(phaseColor(phase).opacity(0.2))
                                .clipShape(Capsule())

                            if index < RoadmapPhase.allCases.count - 1 {
                                Rectangle()
                                    .fill(Color.secondary.opacity(0.3))
                                    .frame(width: 32, height: 1)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Roadmap phases")
    }

    // MARK: - Roadmap Content (GlassPanel 2)

    private var roadmapContent: some View {
        VStack(alignment: .leading, spacing: 24) {
            ForEach(RoadmapPhase.allCases, id: \.self) { phase in
                let items = viewModel.items(for: phase)
                if !items.isEmpty {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(spacing: 8) {
                            Image(systemName: phase.icon)
                                .foregroundStyle(phaseColor(phase))
                            Text(phase.label)
                                .font(.title2)
                                .fontWeight(.bold)
                                .foregroundStyle(phaseColor(phase))
                        }

                        #if os(iOS)
                        VStack(spacing: 12) {
                            ForEach(items) { item in
                                RoadmapCard(item: item)
                            }
                        }
                        #else
                        LazyVGrid(
                            columns: [
                                GridItem(.flexible()),
                                GridItem(.flexible())
                            ],
                            spacing: 12
                        ) {
                            ForEach(items) { item in
                                RoadmapCard(item: item)
                            }
                        }
                        #endif
                    }
                }
            }
        }
    }

    private func phaseColor(_ phase: RoadmapPhase) -> Color {
        switch phase.color {
        case "green": return .green
        case "cyan": return .cyan
        case "purple": return .purple
        case "orange": return .orange
        default: return .secondary
        }
    }
}

// MARK: - Roadmap Card Component

private struct RoadmapCard: View {
    let item: RoadmapEntry

    var body: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(phaseColor.opacity(0.15))
                            .frame(width: 44, height: 44)
                        Image(systemName: item.icon)
                            .foregroundStyle(phaseColor)
                            .font(.system(size: 20))
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.title)
                            .font(.headline)
                            .fontWeight(.semibold)
                        Text(item.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer()

                    Text(item.phase.label)
                        .font(.caption2)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(phaseColor.opacity(0.2))
                        .foregroundStyle(phaseColor)
                        .clipShape(Capsule())
                }

                Divider()

                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(item.features.enumerated()), id: \.offset) { _, feature in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: item.phase.featureIcon)
                                .foregroundStyle(featureIconColor)
                                .font(.caption)
                                .frame(width: 14, height: 14)

                            Text(feature)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding(8)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.title), \(item.phase.label)")
    }

    private var phaseColor: Color {
        switch item.phase.color {
        case "green": return .green
        case "cyan": return .cyan
        case "purple": return .purple
        case "orange": return .orange
        default: return .secondary
        }
    }

    private var featureIconColor: Color {
        switch item.phase {
        case .done: return .green
        case .current: return .cyan
        case .next, .future: return .secondary
        }
    }
}

// MARK: - View Model

@Observable
@MainActor
public final class RoadmapPageModel {
    enum State {
        case loading
        case empty
        case success
    }

    var state: State = .loading
    private var roadmapItems: [RoadmapEntry] = []

    func load() async {
        try? await Task.sleep(for: .milliseconds(300))
        roadmapItems = RoadmapDataSource.allItems
        state = roadmapItems.isEmpty ? .empty : .success
    }

    func items(for phase: RoadmapPhase) -> [RoadmapEntry] {
        roadmapItems.filter { $0.phase == phase }
    }

    func itemCount(for phase: RoadmapPhase) -> Int {
        items(for: phase).count
    }
}

// MARK: - Preview

#if DEBUG
#Preview("Roadmap - Success") {
    NavigationStack {
        RoadmapPage()
    }
}

#Preview("Roadmap - Empty") {
    NavigationStack {
        let page = RoadmapPage()
        page
    }
}
#endif
