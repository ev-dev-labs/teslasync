//
//  AIRestorePanel.Views.swift
//  TeslaSync — P4 feature view · 0201 · AIRestorePanel (Apple)
//
//  The presentational subviews composed by `AIRestorePanel`: the alert body (web
//  description + the archived-feature preview list + the decline / restore actions)
//  and the loading / empty / error chrome. All consume the P1/S10 facade and the
//  shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the Helix accent (web purple) maps
//  to the brand `chartSeriesPower`; the decline action is a low-emphasis ghost button
//  and the restore action is the primary accent, mirroring the web `variant="ghost"`
//  / `variant="primary"` pair.
//

import SwiftUI

// MARK: - Data body (web non-empty render: description + list + actions)

/// The resolved alert body — the description, the archived-feature preview list, and
/// the decline / restore actions, wrapped in the shared fade-in (web `FadeIn`).
struct AIRestoreContent: View {
    let labels: [AIRestoreLabel]
    let onConfirm: () -> Void
    let onDecline: () -> Void

    private var description: String {
        AIRestoreStrings.string(
            "ai.settings.archive.description",
            "You previously had these features enabled. Re-enable them now?"
        )
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if !labels.isEmpty {
                    AIRestoreLabelList(labels: labels)
                }
                AIRestoreActions(onConfirm: onConfirm, onDecline: onDecline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Preview list (web `<ul class="list-disc">` of feature labels)

/// The archived-feature preview — a disc-bulleted list of the resolved feature names
/// (known features through the i18n facade, unknown ids verbatim), so the user can
/// decide without diffing against the live toggle list.
struct AIRestoreLabelList: View {
    let labels: [AIRestoreLabel]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(labels) { label in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                    Text(verbatim: "•")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    Text(verbatim: AIRestoreStrings.label(label))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Actions (web decline ghost + restore primary)

/// The decline / restore action row — a low-emphasis ghost "No thanks" and the primary
/// "Restore selection", trailing-aligned to match the web `justify-end` footer.
struct AIRestoreActions: View {
    let onConfirm: () -> Void
    let onDecline: () -> Void

    private var declineLabel: String {
        AIRestoreStrings.string("ai.settings.archive.decline", "No thanks")
    }

    private var restoreLabel: String {
        AIRestoreStrings.string("ai.settings.archive.restore", "Restore selection")
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton(variant: .ghost, size: .small, action: onDecline) {
                Text(verbatim: declineLabel)
            }
            .accessibilityLabel(Text(verbatim: declineLabel))
            TSButton(variant: .primary, size: .small, action: onConfirm) {
                Text(verbatim: restoreLabel)
            }
            .accessibilityLabel(Text(verbatim: restoreLabel))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

// MARK: - Loading / empty / error chrome (P4 leaf states)

/// The initial-fetch chrome: skeleton description + preview rows over a skeleton action
/// row, so the alert keeps its shape while the parent query resolves.
struct AIRestoreLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(height: 12)
            ForEach(0 ..< 2, id: \.self) { _ in
                TSSkeleton(width: 180, height: 10)
            }
            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSSkeleton(width: 88, height: 28, cornerRadius: TSRadius.md)
                TSSkeleton(width: 124, height: 28, cornerRadius: TSRadius.md)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: AIRestoreStrings.string(
            "airestore.loadingA11y", "Loading restore options"
        )))
    }
}

/// The empty render (web `archiveHasRestorableEntries` false): a friendly state, never
/// a blank surface.
struct AIRestoreEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: AIRestoreStrings.string(
                    "airestore.empty", "No archived Helix selection to restore."
                ))
            } icon: {
                Image(systemName: "sparkles.rectangle.stack")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

/// The fetch-failure state (web `QueryError` peer) with a retry affordance.
struct AIRestoreErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: AIRestoreStrings.string("airestore.errorTitle", "Couldn't load restore options"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: AIRestoreStrings.string("airestore.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: AIRestoreStrings.string("airestore.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
