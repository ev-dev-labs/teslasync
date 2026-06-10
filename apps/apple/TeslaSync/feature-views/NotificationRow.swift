//
//  NotificationRow.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The SwiftUI parity of features/notifications/components/NotificationRow.tsx — one
//  inbox row: the selection checkbox, the severity badge, the timestamp, the vehicle +
//  rule meta, the title (bold when unread, with the unread left-edge accent bar), the
//  message, and the trailing action cluster (mark read/unread, archive/restore, and
//  the "View context" drill-through). Fades in on appear (web `FadeIn` intent),
//  switches over the bound model's phase so every prompt-required state renders
//  (loading / empty / error / stale / offline / content), and binds through
//  `NotificationRowModel` (P1/S8) — no networking lives here.
//

import SwiftUI

/// The inbox notification row — the SwiftUI parity of the web `NotificationRow`,
/// binding through `NotificationRowModel` (P1/S8).
public struct NotificationRow: View {
    @State private var model: NotificationRowModel

    public init(model: NotificationRowModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    NotificationRowConnectivityBanner(connection: model.connection)
                }
                content
                if let toast = model.toast {
                    NotificationRowToastView(toast: toast)
                        .transition(.opacity)
                }
            }
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .overlay(alignment: .topTrailing) {
                NotificationRowFreshnessChip(connection: model.connection)
                    .padding(TSSpacing.sm)
            }
        }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: NotificationRowStrings.string(
            "notifications.inbox.row.a11y.row",
            "Notification"
        )))
        .accessibilityValue(Text(verbatim: model.accessibilitySummary))
    }

    /// The load envelope (loading / error / empty) widened around the web prop-fed row
    /// so no state is ever hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NotificationRowLoadingView()
        case let .error(message):
            NotificationRowErrorView(message: message) { model.refresh() }
        case .empty:
            NotificationRowEmptyView()
        case .content:
            if let row = model.row {
                card(row)
            } else {
                NotificationRowEmptyView()
            }
        }
    }

    /// The populated row card, with every per-row action wired to the bound model.
    private func card(_ row: NotificationRowProjection) -> some View {
        NotificationRowCardView(
            row: row,
            selected: model.selected,
            selectionValue: model.selectionAccessibilityValue,
            capabilities: model.capabilities,
            busy: model.busy,
            onSelectionChange: { model.setSelected($0) },
            onActivate: { model.activate() },
            onMarkRead: { Task { await model.markRead() } },
            onMarkUnread: { Task { await model.markUnread() } },
            onArchive: { Task { await model.archive() } },
            onUnarchive: { Task { await model.unarchive() } },
            onViewContext: { model.openContext() }
        )
    }

    /// Holds the toast on screen briefly, then clears it.
    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}

// MARK: - Surface identity

public extension NotificationRow {
    /// Diagnostics surface slug (P1/S11 `view.opened`). `nonisolated` so it is
    /// reachable off the main actor (SwiftUI `View` is `@MainActor` by default).
    nonisolated static var surfaceSlug: String {
        NotificationRowSurface.slug
    }
}
