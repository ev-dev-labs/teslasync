//
//  LayoutManager.Views.swift
//  TeslaSync — P4 feature view · 0125 · LayoutManager (Apple)
//
//  The presentational subviews of the switcher — the native port of the web
//  layout tab (icon + name + "default" chip), the inline rename/create editor
//  (web `Input` + ✓/✕), the dashed "New Layout" button, and the P4 states-contract
//  chrome the web leaf delegates to its parent: the loading skeleton, the
//  never-a-blank-box empty state, the query-error retry, and the stale/offline
//  status chips. Each piece reads its copy through the injected
//  `LayoutManagerLocalizer`; no English is hardcoded, no Tailwind ports — only
//  shared P1/S9 tokens. The strip orchestration + local edit/create state live in
//  `LayoutManager.swift`.
//

import SwiftUI

// MARK: - Layout tab (web draggable layout chip)

/// One switcher tab: the layout glyph, the truncated name (accent-tinted when
/// active), and the protected-default chip. Tapping switches; the context menu
/// carries Rename/Duplicate/Settings/Delete; drag reorders; VoiceOver gets
/// explicit move-left/right actions so reordering is not pointer-only.
struct LayoutTabChip: View {
    let tab: LayoutTab
    let localize: LayoutManagerLocalizer
    let canMoveLeft: Bool
    let canMoveRight: Bool
    let onTap: () -> Void
    let onMenu: (LayoutMenuItemKind) -> Void
    let onMoveLeft: () -> Void
    let onMoveRight: () -> Void
    let onDrop: (String) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: tab.icon)
                .font(Font.TS.bodySm)
            Text(verbatim: tab.name)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(tab.isActive ? Color.TS.accent : Color.TS.textSecondary)
                .lineLimit(1)
                .frame(maxWidth: 120)
            if tab.isDefault {
                Text(verbatim: LayoutManagerCopy.defaultBadge.resolved(localize))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(background, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(borderColor, lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .onTapGesture(perform: onTap)
        .draggable(tab.id)
        .dropDestination(for: String.self) { items, _ in
            guard let dragged = items.first else { return false }
            onDrop(dragged)
            return true
        }
        .contextMenu { menuItems }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LayoutManagerAccessibility.tabLabel(tab, localize: localize)))
        .accessibilityAddTraits(tab.isActive ? [.isButton, .isSelected] : .isButton)
        .modifier(
            LayoutReorderActions(
                canMoveLeft: canMoveLeft,
                canMoveRight: canMoveRight,
                leftLabel: LayoutManagerAccessibility.moveLeftLabel(localize),
                rightLabel: LayoutManagerAccessibility.moveRightLabel(localize),
                onMoveLeft: onMoveLeft,
                onMoveRight: onMoveRight
            )
        )
    }

    private var menuItems: some View {
        ForEach(LayoutMenuItemKind.order, id: \.self) { kind in
            Button(role: kind.isDestructive ? .destructive : nil) {
                onMenu(kind)
            } label: {
                Label {
                    Text(verbatim: localize.string(kind.labelKey, kind.labelFallback))
                } icon: {
                    Image(systemName: kind.systemImage)
                }
            }
            .disabled(!LayoutMenuItemKind.isEnabled(kind, isDefault: tab.isDefault))
        }
    }

    private var background: Color {
        tab.isActive ? Color.TS.accent.opacity(0.1) : Color.TS.surface
    }

    private var borderColor: Color {
        tab.isActive ? Color.TS.accent.opacity(0.2) : Color.TS.border
    }
}

/// Adds VoiceOver "move left / move right" reorder actions, gated by the edge
/// guards so the rotor never advertises a no-op move at the ends of the strip.
private struct LayoutReorderActions: ViewModifier {
    let canMoveLeft: Bool
    let canMoveRight: Bool
    let leftLabel: String
    let rightLabel: String
    let onMoveLeft: () -> Void
    let onMoveRight: () -> Void

    func body(content: Content) -> some View {
        switch (canMoveLeft, canMoveRight) {
        case (true, true):
            content
                .accessibilityAction(named: Text(verbatim: leftLabel), onMoveLeft)
                .accessibilityAction(named: Text(verbatim: rightLabel), onMoveRight)
        case (true, false):
            content.accessibilityAction(named: Text(verbatim: leftLabel), onMoveLeft)
        case (false, true):
            content.accessibilityAction(named: Text(verbatim: rightLabel), onMoveRight)
        case (false, false):
            content
        }
    }
}

// MARK: - Inline editor (web `Input` + ✓/✕ for rename + create)

/// The inline text field used for both rename (seeded with the current name) and
/// create (empty, with the "Layout name..." prompt). Enter commits, the ✓ button
/// commits, the ✕ button cancels — parity with the web confirm/cancel
/// affordances. Auto-focuses on appear (web `inputRef.current?.focus()`).
struct LayoutInlineEditor: View {
    @Binding var text: String
    let prompt: String
    let fieldLabel: String
    let confirmLabel: String
    let cancelLabel: String
    let onCommit: () -> Void
    let onCancel: () -> Void

    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TextField(prompt, text: $text)
                .textFieldStyle(.plain)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textPrimary)
                .focused($focused)
                .frame(width: 120)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.accent.opacity(0.4), lineWidth: 1)
                )
                .submitLabel(.done)
                .onSubmit(onCommit)
                .accessibilityLabel(Text(verbatim: fieldLabel))
            iconButton(systemName: "checkmark", tone: .success, label: confirmLabel, action: onCommit)
            iconButton(systemName: "xmark", tone: .neutral, label: cancelLabel, action: onCancel)
        }
        .onAppear { focused = true }
    }

    private func iconButton(
        systemName: String,
        tone: TSTone,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tone.color)
                .frame(width: 24, height: 24)
                .background(
                    tone.color.opacity(0.1),
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - New layout button (web dashed `+ New Layout`)

/// The dashed-outline "New Layout" affordance at the trailing edge of the strip.
struct LayoutNewButton: View {
    let localize: LayoutManagerLocalizer
    let onTap: () -> Void

    var body: some View {
        let label = LayoutManagerCopy.newLayout.resolved(localize)
        return Button(action: onTap) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "plus")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(Color.TS.textMuted)
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(
                        Color.TS.border,
                        style: StrokeStyle(lineWidth: 1, dash: [4])
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Status chips (P4 stale + offline chrome)

/// A tinted status chip mirroring `TSBadge` (capsule, tone fill 0.15 + stroke
/// 0.3) but resolving its label through the per-surface facade. Used for the
/// stale + offline banners the web leaf has no notion of.
struct LayoutStatusChip: View {
    let copy: LayoutText
    let tone: TSTone
    let systemImage: String
    let localize: LayoutManagerLocalizer

    var body: some View {
        let label = copy.resolved(localize)
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 3)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Loading chrome (P4 states contract)

/// The initial load: three redacted tab-shaped skeletons over the shared
/// `TSSkeleton`, never a frozen/blank strip.
struct LayoutManagerLoading: View {
    let localize: LayoutManagerLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(0 ..< 3, id: \.self) { _ in
                TSSkeleton(width: 96, height: 30, cornerRadius: TSRadius.md)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LayoutManagerCopy.loading.resolved(localize)))
    }
}

// MARK: - Empty state (no saved layouts — never a blank box)

/// The healthy "no saved layouts" outcome: a friendly `ContentUnavailableView`
/// (the primitive the shared `TSEmptyState` wraps) so the strip is never a blank
/// box. The New Layout affordance is rendered by the parent alongside this.
struct LayoutManagerEmpty: View {
    let localize: LayoutManagerLocalizer

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: LayoutManagerCopy.emptyTitle.resolved(localize))
            } icon: {
                Image(systemName: "square.grid.2x2")
            }
        } description: {
            Text(verbatim: LayoutManagerCopy.emptyMessage.resolved(localize))
        }
        .accessibilityLabel(Text(verbatim: emptyA11y))
    }

    private var emptyA11y: String {
        let title = LayoutManagerCopy.emptyTitle.resolved(localize)
        let message = LayoutManagerCopy.emptyMessage.resolved(localize)
        return "\(title). \(message)"
    }
}

// MARK: - Error chrome (web `QueryError` equivalent — parent query failure)

/// The layouts-read failure branch: the shared `TSErrorDisplay`/`TSQueryError`
/// look (danger glyph + message + retry), resolved through the per-surface facade
/// and delegating retry to the bound `onRetry`.
struct LayoutManagerError: View {
    let message: String?
    let localize: LayoutManagerLocalizer
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message ?? LayoutManagerCopy.errorMessage.resolved(localize))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            LayoutRetryButton(localize: localize, action: onRetry)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The native retry control (web leaf delegates the fetch to its parent and has
/// no retry; this is the states-contract affordance, wired to `onRetry`).
struct LayoutRetryButton: View {
    let localize: LayoutManagerLocalizer
    let action: () -> Void

    var body: some View {
        let label = LayoutManagerCopy.retry.resolved(localize)
        return Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.16), in: Capsule())
            .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}
