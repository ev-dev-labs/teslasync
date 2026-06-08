//
//  EndpointSidebar.swift
//  TeslaSync — P4 feature view · 0029 · EndpointSidebar (Apple)
//
//  The API-playground endpoint sidebar — SwiftUI parity of
//  features/admin/components/EndpointSidebar.tsx. A search box, a live endpoint
//  count, and tag-grouped collapsible endpoint rows. Binds through
//  `EndpointSidebarModel` (P1/S8); the view performs NO networking and renders
//  every state (loading / empty / error / stale / offline / content).
//

import SwiftUI

/// The endpoint sidebar surface. Mirrors the web layout — a bordered column with
/// a search field, a "{n} endpoints" meta row, and a scrolling list of
/// collapsible tag groups — while adding the seam-driven loading/empty/error and
/// stale/offline chrome the native surface owns.
public struct EndpointSidebarView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "EndpointSidebar"

    @State private var model: EndpointSidebarModel

    public init(model: EndpointSidebarModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(spacing: 0) {
            EndpointSearchField(text: $model.search)
                .padding(TSSpacing.sm)
            tokenDivider
            metaRow
            tokenDivider
            bodyArea
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.bg)
        .overlay(alignment: .trailing) {
            Rectangle().fill(Color.TS.border).frame(width: 1).accessibilityHidden(true)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

private extension EndpointSidebarView {
    var tokenDivider: some View {
        Rectangle().fill(Color.TS.border).frame(height: 1).accessibilityHidden(true)
    }

    // MARK: Meta row (web "{filtered.length} endpoints" + native freshness chip)

    var metaRow: some View {
        HStack(spacing: TSSpacing.sm) {
            switch model.phase {
            case .loading:
                TSSkeleton(width: 90, height: 10)
            case .error:
                EmptyView()
            case .empty, .content:
                endpointCountLabel
            }
            Spacer(minLength: TSSpacing.sm)
            EndpointFreshnessChip(connection: model.connection)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
    }

    var endpointCountLabel: some View {
        HStack(spacing: 4) {
            Text(verbatim: "\(model.projection.filteredCount)")
                .font(.system(size: 11, design: .monospaced))
            EndpointSidebarStrings.text("playground.endpoints", "endpoints")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityElement(children: .combine)
    }

    // MARK: Body — every web/seam state renders

    @ViewBuilder
    var bodyArea: some View {
        switch model.phase {
        case .loading:
            loadingList
        case .empty:
            catalogEmptyState
        case let .error(message):
            errorState(message)
        case .content:
            contentList
        }
    }

    var loadingList: some View {
        ScrollView {
            VStack(spacing: 0) {
                ForEach(0 ..< 8, id: \.self) { _ in loadingRow }
            }
            .padding(.vertical, TSSpacing.xs)
        }
        .accessibilityLabel(Text("playground.endpointsLoading"))
    }

    var loadingRow: some View {
        HStack(spacing: TSSpacing.sm) {
            TSSkeleton(width: 50, height: 16, cornerRadius: TSRadius.sm)
            TSSkeleton(height: 12)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
    }

    var catalogEmptyState: some View {
        ContentUnavailableView {
            Label {
                EndpointSidebarStrings.text("playground.noEndpoints", "No endpoints available")
            } icon: {
                Image(systemName: "list.bullet.rectangle")
            }
        } description: {
            EndpointSidebarStrings.text(
                "playground.noEndpointsHint",
                "The API description hasn't loaded any endpoints yet."
            )
        } actions: {
            refreshButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            EndpointSidebarStrings.text("playground.errorTitle", "Couldn't load endpoints")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            refreshButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            EndpointSidebarStrings.text("playground.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("playground.retry"))
    }

    // MARK: Content — search + groups (+ web "No matching endpoints")

    var contentList: some View {
        let projection = model.projection
        return ScrollView {
            LazyVStack(spacing: 0) {
                if model.connection != .live {
                    EndpointConnectivityBanner(connection: model.connection)
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.top, TSSpacing.sm)
                }
                ForEach(projection.groups) { group in
                    EndpointTagGroupView(
                        group: group,
                        isSelected: { model.isSelected($0) },
                        onSelect: { model.select($0) }
                    )
                }
                if projection.hasNoMatches {
                    noMatchesState
                }
            }
            .padding(.vertical, TSSpacing.xs)
        }
    }

    var noMatchesState: some View {
        EndpointSidebarStrings.text("playground.noResults", "No matching endpoints")
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.x2xl)
    }
}
