//
//  LiveSignalsTable.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  The Live Signal Inspector table — SwiftUI parity of
//  features/admin/components/live-signal-inspector/LiveSignalsTable.tsx. Renders a
//  filterable + sortable view of the Redis-cached live snapshot, binding through
//  `LiveSignalsTableModel` (P1/S8). Every state from the web source is reproduced:
//  loading, empty ("No live signals cached"), the filtered-empty message, the
//  populated table, plus the feature-level error / stale / offline surfaces. No
//  networking lives here.
//

import SwiftUI

// MARK: - LiveSignalsTable (the feature surface)

/// The Live Signal Inspector table surface. Shows the cached live signal snapshot
/// as a filterable, sortable table, formatted per the web source. Binds through
/// `LiveSignalsTableModel`; the production source polls the shared live store.
public struct LiveSignalsTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "LiveSignalsTable"

    @State private var model: LiveSignalsTableModel

    public init(model: LiveSignalsTableModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if showsFilter {
                LiveSignalsFilterField(text: $model.filterText)
            }
            content
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The filter is shown for every web-source state (loading / empty / content);
    /// the feature-only error surface hides it (nothing to filter).
    private var showsFilter: Bool {
        if case .error = model.phase { return false }
        return true
    }
}

// MARK: - State branches

extension LiveSignalsTable {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            LiveSignalsTableContent(model: model)
        }
    }

    /// Initial fetch with nothing cached — the web `DataTable` "Loading…" message.
    private var loadingState: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView().controlSize(.small)
            Text(verbatim: LiveSignalsTableStrings.tableLoading)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.x2xl)
        .accessibilityElement(children: .combine)
    }

    /// Resolved with no cached snapshot — the web `EmptyState`.
    private var emptyState: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: LiveSignalsTableStrings.emptyTitle)
            } icon: {
                Image(systemName: "dot.radiowaves.left.and.right")
            }
        } description: {
            Text(verbatim: LiveSignalsTableStrings.emptyMessage)
        }
        .frame(maxWidth: .infinity)
    }

    /// Fetch failed with nothing cached — feature-level error with retry.
    private func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: LiveSignalsTableStrings.errorTitle)
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
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.xl)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button {
            model.refresh()
        } label: {
            Text(verbatim: LiveSignalsTableStrings.retry)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: LiveSignalsTableStrings.retry))
    }
}

// MARK: - Filter field (web search `Input` with leading icon + aria-label)

/// The name filter — a search field with a leading magnifying-glass icon and the
/// web aria-label. Mirrors the web search `<Input>` (prompt "Filter signal names…",
/// aria-label "Filter signals").
struct LiveSignalsFilterField: View {
    @Binding var text: String

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $text,
                prompt: Text(verbatim: LiveSignalsTableStrings.filterPrompt)
            ) {
                Text(verbatim: LiveSignalsTableStrings.filterAria)
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .labelsHidden()
            .accessibilityLabel(Text(verbatim: LiveSignalsTableStrings.filterAria))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(maxWidth: 420, alignment: .leading)
    }
}
