//
//  SessionExpiringModal.Views.swift
//  TeslaSync — P4 modal / dialog · 0009 · SessionExpiringModal (Apple)
//
//  The presented panel + populated content for `SessionExpiringModal`: the panel shell (web
//  `Modal` card, faded in inside a `TSGlassPanel`), the always-on header (clock chip + title +
//  freshness chip + close), and the `.content` body — the live countdown line, the optional
//  unsaved-drafts panel, and the Sign-out / Stay footer. The loading / empty / error envelopes +
//  the freshness chip / cached-data banner live in SessionExpiringModal.States.swift. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports
//  live here.
//

import SwiftUI

// MARK: - Panel shell (web `Modal` card)

/// The presented dialog: the always-on header, an optional cached-data banner, and the phase body
/// — wrapped in a `TSGlassPanel` (web `Modal` surface). Every phase renders real chrome under the
/// header so the dialog is never a blank box (engineering guideline #6).
struct SessionExpiringPanel: View {
    @Bindable var model: SessionExpiringModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                SessionExpiringHeader(connection: model.connection) { model.dismiss() }
                if model.connection != .live {
                    SessionExpiringConnectivityBanner(connection: model.connection)
                }
                body(for: model.phase)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: 420)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }

    /// The web modal body under the header: the populated countdown content for `.content`, else the
    /// loading / empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: SessionExpiringPhase) -> some View {
        switch phase {
        case .loading:
            SessionExpiringLoadingState()
        case .empty:
            SessionExpiringEmptyState()
        case let .error(message):
            SessionExpiringErrorState(message: message) { model.refresh() }
        case .content:
            SessionExpiringContent(model: model)
        }
    }
}

// MARK: - Header (web title block + Modal close)

/// The dialog header: the amber clock chip, the "Your session is about to expire" title, the
/// freshness chip, and the trailing close button (web `Modal` close "×" → `handleClose`).
struct SessionExpiringHeader: View {
    let connection: SessionExpiringConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            iconChip
            HStack(spacing: TSSpacing.sm) {
                SessionExpiringStrings.text("session.expiring.title", "Your session is about to expire")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                SessionExpiringFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var iconChip: some View {
        Image(systemName: "clock.badge.exclamationmark")
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(Color.TS.statusWarning)
            .frame(width: 32, height: 32)
            .background(Color.TS.statusWarning.opacity(0.15), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md)
                    .strokeBorder(Color.TS.statusWarning.opacity(0.20), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SessionExpiringStrings.text("session.expiring.close", "Close"))
    }
}

// MARK: - Content (web populated body)

/// The `.content` body: the live countdown line, the inline reload error (when a refresh failed
/// while a cached countdown remains), the optional unsaved-drafts panel, and the footer actions.
/// A 1Hz ticker re-derives the session state so the countdown animates (web local clock tick).
struct SessionExpiringContent: View {
    @Bindable var model: SessionExpiringModel
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                SessionExpiringInlineError(message: message)
            }
            countdownLine
            if model.hasDrafts {
                SessionExpiringUnsavedDraftsPanel(model: model)
            }
            SessionExpiringFooter(
                staying: model.staying,
                onSignOut: { model.signOut() },
                onStay: { Task { await model.stay() } }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onReceive(ticker) { _ in model.tick() }
    }

    private var countdownLine: some View {
        Text(verbatim: SessionExpiringStrings.string(
            "session.expiring.body", "You will be signed out in {{countdown}}.",
            "{{countdown}}", model.countdownText
        ))
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textSecondary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text(verbatim: model.countdownAccessibilityLabel))
    }
}

// MARK: - Unsaved drafts panel (web amber drafts block)

/// The unsaved-drafts panel (web amber `<div>`): the warning heading, the explanatory body, up to
/// five draft rows, and the "+N more" overflow. Listed only when drafts exist (web `drafts.length
/// > 0`), so the rest of the dialog is unaffected when there are none.
struct SessionExpiringUnsavedDraftsPanel: View {
    @Bindable var model: SessionExpiringModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            heading
            SessionExpiringStrings.text(
                "session.expiring.unsavedBody",
                "Sign out will keep these drafts in your browser, but you must sign in again to finish them."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            draftList
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusWarning.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.20), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.draftsAccessibilityLabel))
    }

    private var heading: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            SessionExpiringStrings.text("session.expiring.unsavedTitle", "Unsaved drafts")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .textCase(.uppercase)
        }
        .foregroundStyle(Color.TS.statusWarning)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var draftList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(model.visibleDrafts) { draft in
                Text(verbatim: "• \(draft.label)")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if model.overflowDraftCount > 0 {
                Text(verbatim: SessionExpiringStrings.string(
                    "session.expiring.moreDrafts", "+{{count}} more",
                    "{{count}}", String(model.overflowDraftCount)
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Footer (web Sign out / Stay)

/// The footer actions: the ghost "Sign out now" and the primary "Stay signed in", the latter
/// showing "Refreshing…" and disabled while the renewal poll is in flight (web `disabled` +
/// label swap).
struct SessionExpiringFooter: View {
    let staying: Bool
    let onSignOut: () -> Void
    let onStay: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onSignOut) {
                Text(verbatim: SessionExpiringStrings.string("session.expiring.signOut", "Sign out now"))
            }
            .accessibilityLabel(SessionExpiringStrings.text("session.expiring.signOut", "Sign out now"))
            TSButton(variant: .primary, size: .small, action: onStay) {
                Text(verbatim: stayLabel)
            }
            .disabled(staying)
            .accessibilityLabel(Text(verbatim: stayLabel))
        }
    }

    private var stayLabel: String {
        staying
            ? SessionExpiringStrings.string("session.expiring.staying", "Refreshing…")
            : SessionExpiringStrings.string("session.expiring.stay", "Stay signed in")
    }
}

// MARK: - Localization Text helper

extension SessionExpiringStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
