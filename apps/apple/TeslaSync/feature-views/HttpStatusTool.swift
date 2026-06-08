//
//  HttpStatusTool.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  The composable HTTP status-code reference surface — SwiftUI parity of
//  features/admin/components/devtools/tools/HttpStatusTool.tsx. Binds through
//  `HttpStatusModel` (no networking in the view); renders the web `ToolCard`
//  shell (icon box + title + description) with a search field and a sortable,
//  paginated reference table, plus every state (loading / empty / error /
//  content) and the in-table search-empty body the web `DataTable` shows.
//

import SwiftUI

// MARK: - HttpStatusTool (the feature surface)

/// The composable HTTP status-code tool — the SwiftUI parity of
/// `features/admin/components/devtools/tools/HttpStatusTool.tsx`. Renders the
/// web `ToolCard` (a `GlassPanel` with an amber icon box, title, and
/// description) wrapping the search field + reference table, binding through
/// `HttpStatusModel` (P1/S8). No networking lives here.
public struct HttpStatusTool: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "HttpStatusTool"

    @State private var model: HttpStatusModel

    /// Injects a model (previews/tests pass an `InMemoryHttpStatusSource`).
    public init(model: HttpStatusModel) {
        _model = State(initialValue: model)
    }

    /// The production composition: serves the canonical `HttpStatusCatalog`
    /// (the web `HTTP_CODES` module constant) through the static source.
    public init() {
        _model = State(initialValue: HttpStatusModel(source: StaticHttpStatusSource()))
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                header
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `ToolCard` icon box + title + description)

extension HttpStatusTool {
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "network", tone: .warning)
            VStack(alignment: .leading, spacing: 2) {
                HttpStatusStrings.text("Http Status", "Http Status")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                HttpStatusStrings.text("Http Status Desc", "Http Status Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
            Spacer(minLength: TSSpacing.sm)
            HStack(spacing: TSSpacing.sm) {
                HttpStatusFreshnessChip(connection: model.connection)
                refreshButton
            }
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 12, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(HttpStatusStrings.text("tool.httpStatus.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension HttpStatusTool {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingChrome
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            contentBody
        }
    }

    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 38, cornerRadius: TSRadius.md)
            ForEach(0 ..< 6, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 52, height: 18, cornerRadius: TSRadius.pill)
                    TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 14, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(HttpStatusStrings.text("tool.httpStatus.loading", "Loading status codes"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                HttpStatusStrings.text("tool.httpStatus.emptyTitle", "No status codes")
            } icon: {
                Image(systemName: "network.slash")
            }
        } description: {
            HttpStatusStrings.text(
                "tool.httpStatus.emptyHint",
                "The status-code reference is unavailable."
            )
        } actions: {
            retryButton
        }
        .frame(maxWidth: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            HttpStatusStrings.text("tool.httpStatus.errorTitle", "Couldn't load status codes")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            retryButton
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            HttpStatusStrings.text("tool.httpStatus.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(HttpStatusStrings.text("tool.httpStatus.retry", "Retry"))
    }
}

// MARK: - Content body (web search `Input` + `DataTable`)

extension HttpStatusTool {
    private var searchBinding: Binding<String> {
        Binding(get: { model.search }, set: { model.search = $0 })
    }

    private var contentBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HttpStatusSearchField(text: searchBinding)
            table
        }
    }

    private var table: some View {
        VStack(alignment: .leading, spacing: 0) {
            HttpStatusColumnHeader(sort: model.sort) { model.toggleSort() }
            Divider().overlay(Color.TS.border)
            if model.projection.isFilteredEmpty {
                searchEmptyState
            } else {
                rows
                HttpStatusPaginationBar(
                    projection: model.projection,
                    onPrevious: { model.previousPage() },
                    onNext: { model.nextPage() }
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityValue(Text(verbatim: HttpStatusAccessibility.summary(for: model.projection)))
    }

    private var rows: some View {
        let pageRows = model.projection.rows
        return ForEach(pageRows) { row in
            HttpStatusRowView(row: row)
            if row.id != pageRows.last?.id {
                Divider().overlay(Color.TS.border.opacity(0.5))
            }
        }
    }

    /// The web `DataTable` empty body when the search matches nothing — kept
    /// visible alongside the search field so the query can be changed.
    private var searchEmptyState: some View {
        ContentUnavailableView {
            Label {
                HttpStatusStrings.text("tool.httpStatus.noMatches", "No matching status codes")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            HttpStatusStrings.text(
                "tool.httpStatus.noMatchesHint",
                "Try a different code, name, or description."
            )
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
    }
}
