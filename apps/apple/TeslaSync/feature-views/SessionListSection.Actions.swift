//
//  SessionListSection.Actions.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  The bulk-selection toolbar (web `BulkActionsToolbar` with the confirmed delete)
//  and the pager (web `Pagination`). Both bind through `SessionListModel`; the delete
//  awaits the model's deleter seam and the pager drives the client-side window over
//  the filtered list. Token-driven chrome (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Bulk actions toolbar (web `BulkActionsToolbar`)

/// The selection toolbar shown above the rows when bulk actions are wired: the
/// selected count, a clear affordance, and a destructive Delete guarded by a
/// confirmation dialog whose title pluralizes the noun (web `bulk.deleteConfirmTitle`).
struct SessionBulkToolbar: View {
    @Bindable var model: SessionListModel
    @State private var confirmingDelete = false

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(model.hasSelection ? Color.TS.accent : Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: selectedCountText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()
            Spacer(minLength: TSSpacing.sm)
            if model.hasSelection {
                Button { model.clearSelection() } label: {
                    SessionListStrings.text("bulk.clear", "Clear")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
            }
            deleteButton
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .confirmationDialog(
            Text(verbatim: model.deleteConfirmTitle),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await model.deleteSelected() }
            } label: {
                SessionListStrings.text("common.delete", "Delete")
            }
            Button(role: .cancel) {} label: {
                SessionListStrings.text("common.cancel", "Cancel")
            }
        } message: {
            Text(verbatim: model.deleteConfirmMessage)
        }
        .accessibilityElement(children: .contain)
    }

    private var deleteButton: some View {
        Button(role: .destructive) { confirmingDelete = true } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "trash").font(.system(size: 11, weight: .semibold))
                SessionListStrings.text("bulk.actions.delete", "Delete").font(Font.TS.caption)
            }
            .fontWeight(.semibold)
            .foregroundStyle(model.hasSelection ? Color.TS.statusDanger : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(
                (model.hasSelection ? Color.TS.statusDanger : Color.TS.textMuted).opacity(0.12),
                in: Capsule()
            )
        }
        .buttonStyle(.plain)
        .disabled(!model.hasSelection)
        .accessibilityLabel(SessionListStrings.text("bulk.actions.delete", "Delete"))
    }

    private var selectedCountText: String {
        let template = SessionListStrings.string("bulk.selectedCount", "{{count}} selected")
        return template.replacingOccurrences(of: "{{count}}", with: "\(model.selectedCount)")
    }
}

// MARK: - Pagination (web `Pagination`)

/// The pager over the filtered list: the visible range, a page-size menu, and the
/// previous / next controls bounded by the window (web `Pagination`). Hidden when
/// the filtered list is empty (the no-matches state already shows).
struct SessionPaginationBar: View {
    @Bindable var model: SessionListModel

    var body: some View {
        if model.filteredCount > 0 {
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: rangeText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
                Spacer(minLength: TSSpacing.sm)
                pageSizeMenu
                pager
            }
            .accessibilityElement(children: .contain)
        }
    }

    private var pager: some View {
        let window = model.pageWindow
        return HStack(spacing: TSSpacing.sm) {
            Button { model.previousPage() } label: {
                Image(systemName: "chevron.left").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .disabled(!window.hasPrevious)
            .foregroundStyle(window.hasPrevious ? Color.TS.textSecondary : Color.TS.textMuted)
            .accessibilityLabel(SessionListStrings.text("charging.sessions.prevPage", "Previous page"))

            Text(verbatim: pageText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .monospacedDigit()

            Button { model.nextPage() } label: {
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold))
            }
            .buttonStyle(.plain)
            .disabled(!window.hasNext)
            .foregroundStyle(window.hasNext ? Color.TS.textSecondary : Color.TS.textMuted)
            .accessibilityLabel(SessionListStrings.text("charging.sessions.nextPage", "Next page"))
        }
    }

    private var pageSizeMenu: some View {
        Menu {
            ForEach([10, 20, 50], id: \.self) { size in
                Button { model.setPageSize(size) } label: {
                    Text(verbatim: perPageLabel(size))
                }
            }
        } label: {
            HStack(spacing: 2) {
                Text(verbatim: perPageLabel(model.pageSize))
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityLabel(SessionListStrings.text("charging.sessions.pageSize", "Rows per page"))
    }

    private func perPageLabel(_ size: Int) -> String {
        SessionListStrings.string("charging.sessions.perPage", "{{count}} / page")
            .replacingOccurrences(of: "{{count}}", with: "\(size)")
    }

    private var rangeText: String {
        let window = model.pageWindow
        let range = window.range
        let start = model.filteredCount == 0 ? 0 : range.lowerBound + 1
        return SessionListStrings.string("charging.sessions.showingRange", "{{start}}–{{end}} of {{total}}")
            .replacingOccurrences(of: "{{start}}", with: "\(start)")
            .replacingOccurrences(of: "{{end}}", with: "\(range.upperBound)")
            .replacingOccurrences(of: "{{total}}", with: "\(model.filteredCount)")
    }

    private var pageText: String {
        let window = model.pageWindow
        return SessionListStrings.string("charging.sessions.pageOf", "Page {{page}} of {{count}}")
            .replacingOccurrences(of: "{{page}}", with: "\(window.clampedPage)")
            .replacingOccurrences(of: "{{count}}", with: "\(window.pageCount)")
    }
}
