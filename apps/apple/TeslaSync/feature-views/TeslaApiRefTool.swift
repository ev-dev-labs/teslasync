//
//  TeslaApiRefTool.swift
//  TeslaSync — P4 feature view · 0020 · TeslaApiRefTool (Apple)
//
//  The composable Tesla API Reference tool — SwiftUI parity of
//  features/admin/components/devtools/tools/TeslaApiRefTool.tsx. Binds through
//  `TeslaApiRefModel` (no networking in the view) and renders every state:
//  loading / empty / error / stale / offline / content (+ the filtered no-results
//  state from the web search), inside a ToolCard glass shell.
//

import SwiftUI

// MARK: - TeslaApiRefTool (the feature surface)

/// The searchable Tesla Fleet API endpoint reference — the SwiftUI parity of the web
/// `TeslaApiRefTool`. Renders a ToolCard header (book icon + title + description +
/// freshness chip) over the resolved render state: a search box, a result count, and a
/// Method / Path / Endpoint Desc table with per-path copy. Binds through
/// `TeslaApiRefModel` (P1/S8); no networking lives here.
public struct TeslaApiRefTool: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        TeslaApiRefModel.surfaceSlug
    }

    @State private var model: TeslaApiRefModel
    @State private var search = ""

    public init(model: TeslaApiRefModel) {
        _model = State(initialValue: model)
    }

    /// Convenience init binding the bundled reference catalog through the static source.
    public init() {
        _model = State(initialValue: TeslaApiRefModel())
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TeslaApiRefHeader(
                freshness: model.freshness,
                updatedAt: model.updatedAt,
                onRefresh: { model.refresh() }
            )
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Content states

extension TeslaApiRefTool {
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
            loadedContent
        }
    }

    private var loadedContent: some View {
        let filtered = TeslaApiRefBuilder.filter(model.endpoints, search: search)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            if model.connection != .live {
                connectivityBanner
            }
            TeslaApiRefSearchField(text: $search)
            TeslaApiRefResultsCount(shown: filtered.count, total: model.totalCount)
            if filtered.isEmpty {
                noResultsState
            } else {
                endpointTable(filtered)
            }
        }
    }

    private func endpointTable(_ rows: [TeslaApiEndpoint]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TeslaApiRefColumnHeader()
            Divider().overlay(Color.TS.border)
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(rows) { endpoint in
                        TeslaApiRefEndpointRow(endpoint: endpoint)
                        Divider().overlay(Color.TS.border.opacity(0.5))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

// MARK: - Empty / no-results / loading / error

extension TeslaApiRefTool {
    private var loadingChrome: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 44, cornerRadius: TSRadius.md)
            ForEach(0 ..< 6, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 48, height: 16, cornerRadius: TSRadius.sm)
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 80, height: 12)
                }
                .frame(minHeight: 32)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .accessibilityElement()
        .accessibilityLabel(TeslaApiRefStrings.text("apiRef.loading", "Loading endpoints"))
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                TeslaApiRefStrings.text("apiRef.noData", "No endpoints")
            } icon: {
                Image(systemName: "book")
            }
        } description: {
            TeslaApiRefStrings.text(
                "apiRef.emptyHint",
                "The Tesla Fleet API endpoint reference will appear here."
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResultsState: some View {
        ContentUnavailableView {
            Label {
                TeslaApiRefStrings.text("apiRef.noResults", "No matching endpoints")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            TeslaApiRefStrings.text("apiRef.noResultsHint", "Try a different search term.")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            TeslaApiRefStrings.text("apiRef.errorTitle", "Couldn't load endpoints")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            TeslaApiRefStrings.text("apiRef.retry", "Retry")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(TeslaApiRefStrings.text("apiRef.retry", "Retry"))
    }
}

// MARK: - Connectivity banner (stale / offline)

extension TeslaApiRefTool {
    private var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "apiRef.offlineBanner" : "apiRef.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the bundled reference"
            : "Reconnecting — the reference may be out of date"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            TeslaApiRefStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
