//
//  BulkActionsToolbar.Views.swift
//  TeslaSync — P4 shared surface · 0078 · BulkActionsToolbar (Apple)
//
//  The presentational subviews composed by `BulkActionsToolbar`: the live count chip, the optional
//  noun (+ "of total") label, one action button per action (the web danger/secondary variant, the
//  per-action spinner, the disabled rule, the SF Symbol icon), the Clear button, the active toolbar
//  bar, the confirm dialog (web `useConfirm` / `<ConfirmDialog>`), and the freshness chip (P4
//  connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no
//  Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Count chip + noun (web count span + noun span)

/// The leading selection summary — the live count chip (web `rounded-full bg-blue-500/15 …
/// text-blue-200`, here an accent-tinted capsule) followed by the optional noun and "of total"
/// suffix (web secondary + muted text). The whole group is one VoiceOver element labelled with the
/// composed summary and marked as updating frequently (the web `aria-live="polite"`).
struct BulkActionsSelectionSummary: View {
    let resolved: BulkActionsResolved

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: resolved.countLabel)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.accent)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, 2)
                .background(Color.TS.accent.opacity(0.15), in: Capsule())
            if let nounText = resolved.nounText {
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: nounText)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                    if let totalText = resolved.totalText {
                        Text(verbatim: totalText)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: resolved.selectionSummary))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Action button (web action `<Button>`)

/// One action button — the web danger/secondary variant, the per-action spinner (`loading`), the
/// `disabled || pending` rule, and the optional leading SF Symbol (the web lucide icon). Runs the
/// action through the model on tap; carries a stable accessibility identifier (web
/// `data-bulk-action={id}`) and a busy / confirm hint.
struct BulkActionButton: View {
    let action: BulkActionViewState
    let onRun: () -> Void

    var body: some View {
        TSButton(
            variant: action.variant == .danger ? .destructive : .secondary,
            size: .small,
            isLoading: action.isPending,
            action: onRun
        ) {
            HStack(spacing: TSSpacing.xs) {
                if let systemImage = action.systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityHidden(true)
                }
                Text(verbatim: action.label)
            }
        }
        .disabled(action.isDisabled)
        .accessibilityLabel(Text(verbatim: action.accessibilityLabel))
        .bulkAccessibilityHint(action.accessibilityHint)
        .accessibilityIdentifier("bulk-action-\(action.id)")
    }
}

// MARK: - Clear button (web ghost Clear `<Button>`)

/// The Clear button — the web ghost-variant "Clear selection" action wired to `onClear`. Carries the
/// `bulk-action-clear` accessibility identifier (web `data-bulk-action="clear"`).
struct BulkActionsClearButton: View {
    let label: String
    let onClear: () -> Void

    var body: some View {
        TSButton(variant: .ghost, size: .small, action: onClear) {
            Text(verbatim: label)
        }
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityIdentifier("bulk-action-clear")
    }
}

// MARK: - Active toolbar (web sticky GlassPanel body)

/// The active render — the web sticky panel: the leading selection summary, then the trailing action
/// buttons + the Clear button, on a glass panel. Wrapped in the shared fade-in for entrance polish
/// (the native parity of the toolbar appearing as the first row is selected). Stickiness/z-index is
/// the host scroll view's concern; the surface renders the bar.
struct BulkActionsActiveView: View {
    let resolved: BulkActionsResolved
    let onRun: (String) -> Void
    let onClear: () -> Void

    var body: some View {
        TSFadeIn {
            HStack(alignment: .center, spacing: TSSpacing.md) {
                BulkActionsSelectionSummary(resolved: resolved)
                Spacer(minLength: TSSpacing.md)
                HStack(spacing: TSSpacing.sm) {
                    ForEach(resolved.actions) { action in
                        BulkActionButton(action: action) { onRun(action.id) }
                    }
                    BulkActionsClearButton(label: resolved.clearLabel, onClear: onClear)
                }
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
            .tsGlassPanel()
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: resolved.toolbarLabel))
        }
    }
}

// MARK: - Confirm dialog (web `useConfirm` / `<ConfirmDialog>`)

/// The confirm-before-mutate dialog — the native parity of the web `useConfirm` flow. Presented while
/// the model holds a `pendingConfirm`; the destructive role mirrors the web `variant="danger"`.
private struct BulkActionsConfirmDialog: ViewModifier {
    @Bindable var model: BulkActionsToolbarModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            Text(verbatim: model.pendingConfirm?.title ?? ""),
            isPresented: presented,
            titleVisibility: .visible,
            presenting: model.pendingConfirm
        ) { pending in
            Button(role: pending.isDestructive ? .destructive : nil) {
                Task { await model.confirmPending() }
            } label: {
                Text(verbatim: pending.confirmLabel)
            }
            Button(role: .cancel) {
                model.cancelPending()
            } label: {
                Text(verbatim: BulkActionsToolbarStrings.string("bulk.confirm.cancel", "Cancel"))
            }
        } message: { pending in
            Text(verbatim: pending.message)
        }
    }

    private var presented: Binding<Bool> {
        Binding(
            get: { model.pendingConfirm != nil },
            set: { isPresented in if !isPresented { model.cancelPending() } }
        )
    }
}

extension View {
    /// Attaches the bulk-action confirm dialog bound through the model. Applied once by
    /// `BulkActionsToolbar`.
    func bulkActionsConfirmDialog(model: BulkActionsToolbarModel) -> some View {
        modifier(BulkActionsConfirmDialog(model: model))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the bar when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the snapshot,
/// with an explicit label.
struct BulkActionsFreshnessChip: View {
    let connection: BulkActionsConnection
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
        case .live: BulkActionsToolbarStrings.string("bulk.live", "Live")
        case .stale: BulkActionsToolbarStrings.string("bulk.stale", "Stale")
        case .offline: BulkActionsToolbarStrings.string("bulk.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            BulkActionsToolbarStrings.string("bulk.staleA11y", "Stale — tap to refresh")
        case .offline:
            BulkActionsToolbarStrings.string("bulk.offlineA11y", "Offline — showing the last selection")
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

// MARK: - Accessibility helper

private extension View {
    /// Applies a VoiceOver hint only when one is present, so actions without a busy / confirm hint
    /// don't carry an empty announcement.
    @ViewBuilder
    func bulkAccessibilityHint(_ hint: String?) -> some View {
        if let hint, !hint.isEmpty {
            accessibilityHint(Text(verbatim: hint))
        } else {
            self
        }
    }
}
