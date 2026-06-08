//
//  NotificationGroupRow.swift
//  TeslaSync — P4 feature view · 0190 · NotificationGroupRow (Apple)
//
//  The composable "notification thread" surface — the SwiftUI parity of
//  features/notifications/components/NotificationGroupRow.tsx. Renders one
//  server-aggregated notification thread: the latest member row, the grouping
//  affordances (expand/collapse "+N similar", unread chip, "N vehicles affected",
//  "Mark group read"), and the lazily-loaded expanded member list. Fades in on
//  appear (web `FadeIn` intent), switches over the bound model's phase so every
//  prompt-required state renders (loading / empty / error / stale / offline /
//  content), and binds through `NotificationGroupRowModel` (P1/S8) — no networking
//  lives here.
//

import SwiftUI

/// The composable notification-thread row — the SwiftUI parity of the web
/// `NotificationGroupRow`, binding through `NotificationGroupRowModel` (P1/S8).
public struct NotificationGroupRow: View {
    @State private var model: NotificationGroupRowModel

    public init(model: NotificationGroupRowModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if model.connection != .live {
                    NotificationGroupConnectivityBanner(connection: model.connection)
                }
                content
                if let toast = model.toast {
                    NotificationGroupToastView(toast: toast)
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
                NotificationGroupFreshnessChip(connection: model.connection)
                    .padding(TSSpacing.sm)
            }
        }
        .animation(.easeInOut(duration: TSMotion.fastDuration), value: model.toast)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: NotificationGroupStrings.string(
            "notifications.group.a11y.thread",
            "Notification thread"
        )))
        .accessibilityValue(Text(verbatim: model.accessibilitySummary))
    }

    /// The load envelope (loading / error / empty) widened around the web prop-fed
    /// thread so no state is ever hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NotificationGroupLoadingView()
        case let .error(message):
            NotificationGroupErrorView(message: message) { model.refresh() }
        case .empty:
            NotificationGroupEmptyView()
        case .content:
            if let group = model.group {
                groupBody(group)
            } else {
                NotificationGroupEmptyView()
            }
        }
    }

    /// The populated thread: the latest member row, the grouping chip row, and the
    /// expanded member region.
    private func groupBody(_ group: NotificationGroupProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            NotificationMemberRowView(row: group.latest)
            if group.showsGroupChrome {
                NotificationGroupChips(
                    group: group,
                    expanded: model.expanded,
                    marking: model.marking,
                    onToggle: { withAnimation(.easeInOut(duration: TSMotion.fastDuration)) { model.toggleExpanded() } },
                    onMarkRead: { Task { await model.markGroupRead() } }
                )
            }
            if model.expanded, !group.isSingleton {
                NotificationMembersRegion(phase: model.membersPhase)
            }
        }
    }

    /// Holds the toast on screen briefly, then clears it (web toast `duration`).
    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(nanoseconds: 4_000_000_000)
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}
