//
//  BackupActionsCard.Views.swift
//  TeslaSync — P4 feature view · 0241 · BackupActionsCard (Apple)
//
//  The composed subviews for the BackupActionsCard surface: the wrapped backup-status
//  section (web `children` DefList → loading skeleton / rows / empty / error), the
//  action bar (web primary `Button` "Run quick backup now" + the "Manage backups &
//  restore" `Link`), and the transient toast banner (web `useToast`). Every user-facing
//  string routes through the P1/S10 facade; every interactive element carries a
//  VoiceOver label; icons are decorative (`accessibilityHidden`).
//

import SwiftUI

// MARK: - Tone → design-system color (web `toast` variant)

extension BackupActionTone {
    /// The status token the tone renders as (mirrors `TSTone`, kept local so the
    /// Adapter projection stays view-free + Sendable).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Wrapped backup-status section (web `children` DefList, every phase)

struct BackupStatusSection: View {
    let content: BackupStatusContent
    let onReload: (() -> Void)?

    var body: some View {
        switch content {
        case .loading:
            BackupStatusLoadingRows()
        case let .ready(rows):
            if rows.isEmpty {
                BackupStatusEmptyView()
            } else {
                BackupStatusRowsView(rows: rows)
            }
        case let .failed(message):
            BackupStatusErrorView(message: message, onReload: onReload)
        }
    }
}

/// The resolved key/value rows (web `DefList` `{ label, value }`). Labels + values are
/// already localized/formatted by the parent, so they render verbatim.
struct BackupStatusRowsView: View {
    let rows: [BackupStatusRow]

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    Text(verbatim: row.label)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    Spacer(minLength: TSSpacing.md)
                    Text(verbatim: row.value)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                        .multilineTextAlignment(.trailing)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Skeleton rows shown while the wrapped section loads (web query `isLoading`).
struct BackupStatusLoadingRows: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(0 ..< 5, id: \.self) { _ in
                HStack(spacing: TSSpacing.md) {
                    TSSkeleton(width: 132, height: 12)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 64, height: 12)
                }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BackupActionsCardStrings.string(
            "backup.actions.section.loading",
            "Loading backup status…"
        )))
    }
}

/// Friendly empty state (web resolved-but-empty `children`) — never a blank box.
struct BackupStatusEmptyView: View {
    var body: some View {
        let label = BackupActionsCardStrings.string("backup.actions.section.empty", "No backup status to show yet.")
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Image(systemName: "tray")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

/// Error state for the wrapped section with an optional retry (web `QueryError`).
struct BackupStatusErrorView: View {
    let message: String
    let onReload: (() -> Void)?

    var body: some View {
        let header = BackupActionsCardStrings.string("backup.actions.section.error", "Couldn’t load backup status.")
        let detail = message.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: detail.isEmpty ? header : "\(header) \(detail)")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            if let onReload {
                TSButton(variant: .secondary, size: .small, action: onReload) {
                    Text(verbatim: BackupActionsCardStrings.string("backup.actions.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: BackupActionsCardStrings.string("backup.actions.retry", "Retry")))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Action bar (web primary Button + manage Link, flex-wrap)

struct BackupActionsBar: View {
    let model: BackupActionsCardModel
    let onManageBackups: () -> Void

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: TSSpacing.sm) {
                BackupRunButton(model: model)
                BackupManageLink(action: onManageBackups)
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                BackupRunButton(model: model)
                BackupManageLink(action: onManageBackups)
            }
        }
    }
}

/// The primary "Run quick backup now" button (web `<Button variant="primary">`). Shows
/// a spinner + "Starting…" while in flight and is disabled then (web `disabled`/`isPending`).
struct BackupRunButton: View {
    let model: BackupActionsCardModel

    var body: some View {
        let label = model.buttonLabel
        let title = BackupActionsCardStrings.string(label.key, label.fallback)
        return TSButton(
            variant: .primary,
            size: .small,
            action: { Task { await model.run() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.isRunning {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                            .accessibilityHidden(true)
                    } else {
                        Image(systemName: "play.fill")
                            .font(.system(size: 12, weight: .semibold))
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: title)
                }
            }
        )
        .disabled(model.isRunDisabled)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityHint(Text(verbatim: BackupActionsCardStrings.string(
            "backup.actions.run.hint",
            "Starts an on-demand database backup."
        )))
        .accessibilityIdentifier(BackupActionsAccessibility.runTestID)
    }
}

/// The "Manage backups & restore" navigation affordance (web `<Link to="/backup">`).
/// The parent wires `action` to the router; the route is recorded in the Adapter.
struct BackupManageLink: View {
    let action: () -> Void

    var body: some View {
        let title = BackupActionsCardStrings.string("backup.actions.manage", "Manage backups & restore")
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: title)
                Image(systemName: "arrow.up.forward.square")
                    .font(.system(size: 12, weight: .semibold))
                    .accessibilityHidden(true)
            }
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier(BackupActionsAccessibility.manageTestID)
    }
}

// MARK: - Toast banner (web `useToast`)

/// The transient feedback banner — the native counterpart of the web `toast.success` /
/// `toast.error`. Tone-colored, dismissible, and self-clearing via the surface's timed
/// task. Covers the success, admin-permission, offline, and generic-failure branches.
struct BackupToastView: View {
    let toast: BackupActionToast
    let onDismiss: () -> Void

    var body: some View {
        let tint = toast.tone.color
        return HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: toast.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            Text(verbatim: toast.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: BackupActionsCardStrings.string("backup.actions.dismiss", "Dismiss")))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.3), lineWidth: 1)
        )
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}
