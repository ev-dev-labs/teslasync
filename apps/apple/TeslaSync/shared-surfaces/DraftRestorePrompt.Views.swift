//
//  DraftRestorePrompt.Views.swift
//  TeslaSync — P4 shared surface · 0117 · DraftRestorePrompt (Apple)
//
//  The presentational subviews composed by the surface: the bottom-left toast card (the native parity
//  of the web `role="status"` prompt — the warning chip, the "Unsaved drafts restored" title, the
//  count-pluralised body, and the Review / Dismiss / Close affordances), the review-modal body (the web
//  `Modal` content — the intro line plus the per-draft list or the empty line plus a Close action), one
//  draft row (label + "Saved {when}" + Resume / Discard), and the freshness chip (P4 connectivity
//  axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components — no networking, no
//  Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web prompt's amber accent (`amber-300/30`) maps
//  to the brand amber `statusWarning`, so the card reads as "attention / unsaved" in both light and
//  dark themes.
//
//  Accessibility note: the title + body form one VoiceOver "status" element (the web `role="status"` /
//  `aria-live="polite"` region), while the Review / Dismiss / Close controls and each row's Resume /
//  Discard controls stay individually focusable with their own labels (web real `<button>`s).
//

import SwiftUI

// MARK: - Toast card (web `role="status"` bottom-left prompt)

/// The bottom-left toast card — the native parity of the web prompt card. Shows the amber warning chip,
/// the title, the count-pluralised body, the Review (primary) + Dismiss (ghost) actions, and a Close
/// (X) affordance.
struct DraftRestorePromptCard: View {
    let count: Int
    let onReview: () -> Void
    let onDismiss: () -> Void

    private var titleText: String {
        DraftRestoreStrings.string("draft.recovery.promptTitle", "Unsaved drafts restored")
    }

    private var bodyText: String {
        DraftRestorePromptBody.text(count: count, resolve: DraftRestoreStrings.resolve)
    }

    private var statusLabel: String {
        DraftRestoreAccessibility.promptLabel(title: titleText, body: bodyText)
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                statusContent
                actionRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            closeButton
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 384, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.35), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
    }

    private var iconChip: some View {
        Image(systemName: "exclamationmark.triangle.fill")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color.TS.statusWarning)
            .padding(TSSpacing.xs)
            .background(Color.TS.statusWarning.opacity(0.15), in: RoundedRectangle(
                cornerRadius: TSRadius.sm,
                style: .continuous
            ))
            .accessibilityHidden(true)
    }

    /// The announced "status" element (web `role="status"`): title + body, spoken in one pass. The
    /// controls below stay separately focusable.
    private var statusContent: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: titleText)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: bodyText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: statusLabel))
        .accessibilityAddTraits(.isStaticText)
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .primary, size: .small, action: onReview) {
                Text(verbatim: DraftRestoreStrings.string("draft.recovery.review", "Review"))
            }
            .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string("draft.recovery.review", "Review")))
            TSButton(variant: .ghost, size: .small, action: onDismiss) {
                Text(verbatim: DraftRestoreStrings.string("draft.recovery.dismiss", "Dismiss"))
            }
            .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string("draft.recovery.dismiss", "Dismiss")))
        }
        .padding(.top, TSSpacing.xs)
    }

    private var closeButton: some View {
        Button(action: onDismiss) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string("draft.recovery.close", "Close")))
    }
}

// MARK: - Review modal body (web `Modal` content)

/// The review modal's body — the native parity of the web `Modal` content: an intro line, then either
/// the per-draft list or the empty line, then a Close action. The modal title + its own X are provided
/// by the `tsModal` container, so this view supplies only the inner content.
struct DraftRestoreReviewList: View {
    let drafts: [DraftEntry]
    let onResume: (DraftEntry) -> Void
    let onDiscard: (DraftEntry) -> Void
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            Text(verbatim: DraftRestoreStrings.string(
                "draft.recovery.modalBody",
                "These drafts were saved on this device before this session. "
                    + "Resume to continue editing or discard to clear them."
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)

            if drafts.isEmpty {
                Text(verbatim: DraftRestoreStrings.string("draft.recovery.empty", "No drafts to restore."))
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(drafts) { entry in
                        DraftRestoreRow(
                            entry: entry,
                            onResume: { onResume(entry) },
                            onDiscard: { onDiscard(entry) }
                        )
                    }
                }
            }

            HStack {
                Spacer(minLength: 0)
                TSButton(variant: .ghost, size: .small, action: onClose) {
                    Text(verbatim: DraftRestoreStrings.string("draft.recovery.close", "Close"))
                }
                .accessibilityLabel(Text(verbatim: DraftRestoreStrings.string("draft.recovery.close", "Close")))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Draft row (web `<li>` per draft)

/// One draft row — the native parity of the web list item: the label (or the localized fallback), the
/// "Saved {when}" relative time, and the Resume (primary) + Discard (ghost) actions. The label + time
/// form one element; the controls name the draft they act on for VoiceOver.
struct DraftRestoreRow: View {
    let entry: DraftEntry
    let onResume: () -> Void
    let onDiscard: () -> Void

    private var label: String {
        entry.displayLabel(DraftRestoreStrings.resolve)
    }

    private var savedAtText: String {
        DraftRestoreSavedAt.text(for: entry.savedAt, now: Date(), resolve: DraftRestoreStrings.resolve)
    }

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: label)
                    .font(Font.TS.body)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(verbatim: savedAtText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: DraftRestoreAccessibility.promptLabel(
                title: label, body: savedAtText
            )))

            HStack(spacing: TSSpacing.sm) {
                TSButton(variant: .primary, size: .small, action: onResume) {
                    Text(verbatim: DraftRestoreStrings.string("draft.recovery.resume", "Resume"))
                }
                .accessibilityLabel(Text(verbatim: DraftRestoreAccessibility.actionLabel(
                    action: DraftRestoreStrings.string("draft.recovery.resume", "Resume"), label: label
                )))
                TSButton(variant: .ghost, size: .small, action: onDiscard) {
                    Text(verbatim: DraftRestoreStrings.string("draft.recovery.discard", "Discard"))
                }
                .accessibilityLabel(Text(verbatim: DraftRestoreAccessibility.actionLabel(
                    action: DraftRestoreStrings.string("draft.recovery.discard", "Discard"), label: label
                )))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beside the prompt when the index feed is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct DraftRestoreFreshnessChip: View {
    let connection: DraftRestoreConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: DraftRestoreStrings.string("draft.recovery.live", "Live")
        case .stale: DraftRestoreStrings.string("draft.recovery.stale", "Stale")
        case .offline: DraftRestoreStrings.string("draft.recovery.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            DraftRestoreStrings.string("draft.recovery.staleA11y", "Stale — tap to refresh")
        case .offline:
            DraftRestoreStrings.string("draft.recovery.offlineA11y", "Offline — showing your last saved drafts")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
