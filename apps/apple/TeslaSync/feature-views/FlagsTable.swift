//
//  FlagsTable.swift
//  TeslaSync — P4 feature view · 0031 · FlagsTable (Apple)
//
//  The Feature Flags registry table — SwiftUI parity of
//  features/admin/components/feature-flags/FlagsTable.tsx. Renders the registry
//  rows with a monospaced key, a compact JSON value preview, and per-row Edit +
//  Delete actions, across every surface state (loading / empty / error / stale /
//  offline / content). Binds through `FlagsTableModel` (P1/S8); no networking
//  lives here. Editing / deleting stay parent-owned via `onEdit` / `onAskDelete`,
//  matching the web component's callback props.
//
//  Sort: the web `useSortToggle('key', 'asc')` + controlled `DataTable` maps to
//  the shared `TSDataTable`'s built-in, HIG-native key sort. Rows are fed in the
//  web default order (key ascending) via the pure `FlagsSort` port, and the key
//  column carries a comparator so VoiceOver / pointer users can re-sort.
//

import SwiftUI

// MARK: - FlagsTable (the feature surface)

/// The Feature Flags registry table — the SwiftUI parity of
/// `features/admin/components/feature-flags/FlagsTable.tsx`. Renders every state
/// from the web source (loading / empty / content) plus the P4 surface contract
/// states (error / stale / offline) inside a glass panel, binding through
/// `FlagsTableModel`.
public struct FlagsTable: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "FlagsTable"

    @State private var model: FlagsTableModel
    private let onEdit: (FlagsTableEntry) -> Void
    private let onAskDelete: (FlagsTableEntry) -> Void

    /// - Parameters:
    ///   - model: the bound state holder (web `rows` + `loading` arrive through it).
    ///   - onEdit: web `onEdit(entry)` — opens the parent-owned edit drawer.
    ///   - onAskDelete: web `onAskDelete(entry)` — opens the parent-owned confirm.
    public init(
        model: FlagsTableModel,
        onEdit: @escaping (FlagsTableEntry) -> Void = { _ in },
        onAskDelete: @escaping (FlagsTableEntry) -> Void = { _ in }
    ) {
        _model = State(initialValue: model)
        self.onEdit = onEdit
        self.onAskDelete = onAskDelete
    }

    /// The rows in the web default order (key ascending). The shared table layers
    /// interactive re-sorting on top via the key column comparator.
    private var sortedRows: [FlagsTableEntry] {
        FlagsSort.sorted(model.projection.rows, by: FlagsSortToggle())
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            if model.connection != .live {
                connectivityBanner
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .top)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: FlagsTableAccessibility.summary(for: model.projection)))
    }
}

// MARK: - Header (freshness + refresh)

private extension FlagsTable {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            FlagsTableStrings.text("admin.flags.title", "Feature Flags")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .tracking(0.6)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            freshnessChip
            refreshButton
        }
    }

    var freshnessChip: some View {
        let tone: Color
        let label: String
        switch model.connection {
        case .live:
            tone = Color.TS.statusSuccess
            label = FlagsTableStrings.string("admin.flags.live", "Live")
        case .stale:
            tone = Color.TS.statusWarning
            label = FlagsTableStrings.string("admin.flags.stale", "Stale")
        case .offline:
            tone = Color.TS.textMuted
            label = FlagsTableStrings.string("admin.flags.offline", "Offline")
        }
        return HStack(spacing: 4) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }

    var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(FlagsTableStrings.text("admin.flags.refresh", "Refresh"))
    }

    var connectivityBanner: some View {
        let isOffline = model.connection == .offline
        let key = isOffline ? "admin.flags.offlineBanner" : "admin.flags.staleBanner"
        let fallback = isOffline
            ? "Offline — showing last known data"
            : "Reconnecting — data may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            FlagsTableStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Content states (web shell loading / empty + the table body)

private extension FlagsTable {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            loadingState
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            table
        }
    }

    /// Web `emptyMessage = loading ? 'Loading flags…' : …` — the initial-fetch
    /// chrome with skeleton rows under the localized loading label.
    var loadingState: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(height: 12)
                    TSSkeleton(width: 96, height: 12)
                    TSSkeleton(width: 120, height: 28, cornerRadius: TSRadius.sm)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(FlagsTableStrings.text("admin.flags.table.loading", "Loading flags…"))
    }

    /// Web `emptyMessage` resolved state — "No feature flags are set on this
    /// server." Rendered as a friendly state, never a blank panel.
    var emptyState: some View {
        ContentUnavailableView {
            Label {
                FlagsTableStrings.text("admin.flags.table.empty", "No feature flags are set on this server.")
            } icon: {
                Image(systemName: "flag.slash")
            }
        }
        .frame(maxWidth: .infinity)
    }

    /// Fetch-failure state (web `QueryError` equivalent) with a retry affordance.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            FlagsTableStrings.text("admin.flags.errorTitle", "Couldn't load feature flags")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton("admin.flags.retry", variant: .secondary, size: .small) {
                model.refresh()
            }
            .accessibilityLabel(FlagsTableStrings.text("admin.flags.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }

    /// The registry table (web `DataTable` with the key / value / actions columns).
    var table: some View {
        TSDataTable(rows: sortedRows, columns: columns)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Columns (web `Column<FlagsTableEntry>[]`)

private extension FlagsTable {
    var columns: [TSColumn<FlagsTableEntry>] {
        [keyColumn, valueColumn, actionsColumn]
    }

    /// Localized column title resolved through the surface i18n facade. The
    /// shared `TSColumn` takes a `LocalizedStringKey`; the facade has already
    /// resolved the per-surface table value, so this renders it verbatim.
    func columnTitle(_ key: String, _ fallback: String) -> LocalizedStringKey {
        LocalizedStringKey(FlagsTableStrings.string(key, fallback))
    }

    var keyColumn: TSColumn<FlagsTableEntry> {
        TSColumn(
            id: "key",
            title: columnTitle("admin.flags.cols.key", "Flag key"),
            comparator: { FlagsSort.compareKeys($0, $1) },
            cell: { row in
                Text(verbatim: row.key)
                    .font(Font.TS.body.monospaced())
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .accessibilityLabel(Text(verbatim: FlagsTableAccessibility.rowLabel(row)))
            }
        )
    }

    var valueColumn: TSColumn<FlagsTableEntry> {
        TSColumn(
            id: "value",
            title: columnTitle("admin.flags.cols.value", "Value")
        ) { row in
            Text(verbatim: row.valuePreview)
                .font(Font.TS.caption.monospaced())
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)
        }
    }

    var actionsColumn: TSColumn<FlagsTableEntry> {
        TSColumn(
            id: "actions",
            title: columnTitle("admin.flags.cols.actions", "Actions")
        ) { row in
            HStack(spacing: TSSpacing.sm) {
                TSButton(variant: .secondary, size: .small) {
                    onEdit(row)
                } label: {
                    Label {
                        FlagsTableStrings.text("admin.flags.actions.edit", "Edit")
                    } icon: {
                        Image(systemName: "pencil")
                    }
                }
                .accessibilityLabel(Text(verbatim: FlagsTableAccessibility.editLabel(row)))

                TSButton(variant: .destructive, size: .small) {
                    onAskDelete(row)
                } label: {
                    Label {
                        FlagsTableStrings.text("admin.flags.actions.delete", "Delete")
                    } icon: {
                        Image(systemName: "trash")
                    }
                }
                .accessibilityLabel(Text(verbatim: FlagsTableAccessibility.deleteLabel(row)))
            }
        }
    }
}
