//
//  InboxBody.States.swift
//  TeslaSync — P4 feature view · 0183 · InboxBody (Apple)
//
//  The non-content list states composed by `InboxBody`: the loading skeleton (web
//  five `<Skeleton h-14 />` blocks), the load-failure state (web `EmptyState`
//  error — "Could not load notifications" + Retry), and the zero-content state
//  (web `EmptyState` with the inbox / archived / grouped variants + the "Configure
//  alert rules" CTA). Each renders friendly chrome — never a blank panel — and
//  resolves its copy through the P1/S10 facade.
//

import SwiftUI

// MARK: - Loading (web `[1..5].map(<Skeleton h-14 />)`)

/// The initial-fetch skeleton: five redacted rows respecting Reduce Motion via
/// the shared `TSSkeleton`, exposed as one labeled accessibility element.
struct InboxLoadingView: View {
    let localize: (String, String) -> String

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 56, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: localize(
            "notifications.inbox.loading", "Loading notifications"
        )))
    }
}

// MARK: - Error (web `EmptyState` error variant + Retry)

/// The load-failure state (web `EmptyState` with `title` + technical `message` +
/// Retry): a bell glyph, the localized title, the upstream message, and a retry
/// affordance wired to the model.
struct InboxErrorView: View {
    let message: String
    let localize: (String, String) -> String
    let onRetry: () -> Void

    private var retryLabel: String {
        localize("common.retry", "Retry")
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bell.badge.slash")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: localize("notifications.inbox.error.title", "Could not load notifications"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(action: onRetry) {
                Text(verbatim: retryLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: retryLabel))
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Empty (web `EmptyState` inbox / archived / grouped variants)

/// The zero-content state with the web's three copy variants (grouped threads /
/// archived / inbox) and the "Configure alert rules" CTA (hidden on the archive
/// tab) — never a blank panel.
struct InboxEmptyView: View {
    @Bindable var model: InboxBodyModel

    private var grouped: Bool {
        model.isGrouped
    }

    private var archived: Bool {
        model.filters.archived
    }

    private var title: String {
        if grouped { return model.localize("notifications.group.emptyTitle", "No notification threads") }
        if archived { return model.localize("notifications.inbox.empty.archivedTitle", "No archived notifications") }
        return model.localize("notifications.inbox.empty.title", "No notifications")
    }

    private var message: String {
        if grouped {
            return model.localize(
                "notifications.group.emptyMessage",
                "When alert rules fire repeatedly, related notifications will be grouped here."
            )
        }
        if archived {
            return model.localize(
                "notifications.inbox.empty.archivedMessage", "Archived notifications will appear here."
            )
        }
        return model.localize(
            "notifications.inbox.empty.message",
            "When alert rules fire, the resulting notifications appear here."
        )
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "bell")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .multilineTextAlignment(.center)
            if !archived {
                cta
            }
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }

    private var cta: some View {
        Button {
            model.openContext("/notifications/studio")
        } label: {
            Text(verbatim: model.localize("notifications.inbox.empty.cta", "Configure alert rules"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.localize("notifications.inbox.empty.cta", "Configure alert rules")))
    }
}
