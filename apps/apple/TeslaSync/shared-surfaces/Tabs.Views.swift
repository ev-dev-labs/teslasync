//
//  Tabs.Views.swift
//  TeslaSync — P4 shared surface · 0227 · Tabs (Apple)
//
//  The presentational pieces of the accessible tab strip — the native peers of the web elements: the
//  `role="tablist"` container (``TabsStrip``), each `role="tab"` `<button>` (``TabButton``), and the
//  friendly empty-state message shown when there are no tabs (``TabsEmptyView`` — the native "never a blank
//  box" branch the web leaves as an empty container). All chrome is token-driven (P1/S9): the selected tab
//  is the accent tone with a 2pt accent underline (web `border-b-2 border-blue-600 text-blue-600`); the
//  others are muted and brighten on hover (web `text-[var(--text-muted)]` → `hover:text-gray-700`); a
//  disabled tab dims to ``TabsLayout/disabledOpacity`` and stops responding (web `opacity-50
//  cursor-not-allowed`); and a hairline baseline runs under the whole strip (web `border-b border-gray-200`).
//  No raw hex, no Tailwind ports.
//
//  Accessibility + keyboard parity, reproduced faithfully:
//    • the strip is one VoiceOver container (web `role="tablist"`) named by the resolved `ariaLabel`.
//    • each tab is a button carrying its label + the `.isSelected` trait when active (web `aria-selected`),
//      and its `tabElementID` (web `id`) so a host can wire a `role="tabpanel"` back to it.
//    • Left / Right arrows move + activate between enabled tabs (wrap, skip disabled); Home / End jump to
//      the first / last enabled tab (web `handleKeyDown`, automatic activation) — driven through the
//      state-holder so the focus follows the activation, with the rule itself unit-tested in the adapter.
//    • the underline / hover have no animation (the web has none), so Reduce Motion is inherently respected.
//

import SwiftUI

// MARK: - TabsStrip (web `<div role="tablist">`)

/// The tab strip — the native peer of the web `role="tablist"` container. Lays the tabs out in a horizontal
/// row over a hairline baseline (web `flex gap-1 border-b`), binds each ``TabButton`` to the
/// ``TabsController`` (tap → activate, arrows / Home / End → roving move), and renders the friendly
/// ``TabsEmptyView`` empty-state message instead when there are no tabs. The roving `@FocusState` follows the active
/// tab so a keyboard move re-targets focus (web `refs.current.get(nextKey)?.focus()`).
struct TabsStrip: View {
    let controller: TabsController
    @FocusState private var focusedKey: String?

    var body: some View {
        let projection = controller.projection
        Group {
            if projection.isEmpty {
                TabsEmptyView(message: projection.emptyLabel)
            } else {
                populatedStrip(projection)
            }
        }
        .accessibilityIdentifier(TabsSurface.slug)
    }

    /// The populated strip (web `tabs.map`) — the tab row, the baseline, and the tablist accessibility.
    private func populatedStrip(_ projection: TabsProjection) -> some View {
        HStack(alignment: .bottom, spacing: TabsLayout.stripSpacing) {
            ForEach(projection.items) { item in
                TabButton(
                    item: item,
                    onSelect: { activate(item.key) },
                    onMove: { direction in move(direction, from: item.key) }
                )
                .focused($focusedKey, equals: item.key)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: TabsLayout.baselineThickness)
        }
        .accessibilityElement(children: .contain)
        .modifier(TablistAccessibility(label: projection.accessibilityLabel))
    }

    /// Activates a tab — the web `onChange(tab.key)` (a no-op for a disabled tab) — and moves focus to it.
    private func activate(_ key: String) {
        controller.select(key)
        focusedKey = key
    }

    /// Moves roving focus + activates — the web `moveFocus`. Updates `@FocusState` to the newly active tab
    /// when the move resolves to one.
    private func move(_ direction: TabsKeyMove, from key: String) {
        if let next = controller.moveFocus(direction, from: key) {
            focusedKey = next
        }
    }
}

// MARK: - TabButton (web `<button role="tab">`)

/// One tab — the native peer of the web `<button role="tab" aria-selected aria-controls tabIndex disabled>`.
/// A plain button whose label is accent-toned + underlined when selected (web `border-b-2 border-blue-600
/// text-blue-600`), muted otherwise and brightened on hover (web `hover:text-gray-700`), and dimmed +
/// non-interactive when disabled (web `opacity-50 cursor-not-allowed`). Tap reports an activation; the four
/// navigation keys report a roving move. Carries its label + the `.isSelected` trait (web `aria-selected`)
/// and its `tabElementID` (web `id`) for VoiceOver / tests; the underline is decorative.
struct TabButton: View {
    let item: TabsItemProjection
    let onSelect: () -> Void
    let onMove: (TabsKeyMove) -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: onSelect) {
            Text(verbatim: item.label)
                .font(Font.TS.body.weight(.medium))
                .foregroundStyle(foreground)
                .padding(.horizontal, TabsLayout.tabHorizontalPadding)
                .padding(.vertical, TabsLayout.tabVerticalPadding)
                .overlay(alignment: .bottom) { underline }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(item.isDisabled)
        .opacity(item.isDisabled ? TabsLayout.disabledOpacity : 1)
        .onHover { isHovering = $0 && !item.isDisabled }
        .onKeyPress(.leftArrow) { onMove(.previous); return .handled }
        .onKeyPress(.rightArrow) { onMove(.next); return .handled }
        .onKeyPress(.home) { onMove(.first); return .handled }
        .onKeyPress(.end) { onMove(.last); return .handled }
        .accessibilityLabel(Text(verbatim: item.label))
        .accessibilityAddTraits(traits)
        .accessibilityIdentifier(item.tabElementID)
    }

    /// The selected tab's 2pt accent underline (web `border-b-2 border-blue-600`); absent otherwise.
    @ViewBuilder private var underline: some View {
        if item.isSelected {
            Rectangle()
                .fill(Color.TS.accent)
                .frame(height: TabsLayout.indicatorThickness)
        }
    }

    /// The label tone — accent when selected (web `text-blue-600`), the primary tone on hover, the muted
    /// tone at rest (web `text-[var(--text-muted)]` → `hover:text-gray-700`).
    private var foreground: Color {
        if item.isSelected { return Color.TS.accent }
        if isHovering { return Color.TS.textPrimary }
        return Color.TS.textMuted
    }

    /// The accessibility traits — a button, plus selected when active (web `aria-selected`).
    private var traits: AccessibilityTraits {
        item.isSelected ? [.isButton, .isSelected] : .isButton
    }
}

// MARK: - TabsEmptyView (native "never a blank box" branch)

/// The empty-state message — shown when there are no tabs. The web renders an empty `role="tablist"` (a blank
/// box); the native peer instead shows a friendly, localized message in the muted tone over the same
/// hairline baseline, satisfying the prompt's "never a blank box" rule. No interactive tab is rendered.
struct TabsEmptyView: View {
    let message: String

    var body: some View {
        Text(verbatim: message)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TabsLayout.tabHorizontalPadding)
            .padding(.vertical, TabsLayout.tabVerticalPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: TabsLayout.baselineThickness)
            }
            .accessibilityLabel(Text(verbatim: message))
    }
}

// MARK: - TablistAccessibility (web `aria-label={ariaLabel}`)

/// Applies the tablist's accessible name only when present — the native peer of the web
/// `aria-label={ariaLabel}` (which renders no attribute when `ariaLabel` is undefined), so an unnamed
/// tablist stays unnamed rather than carrying an empty label.
private struct TablistAccessibility: ViewModifier {
    let label: String?

    func body(content: Content) -> some View {
        if let label {
            content.accessibilityLabel(Text(verbatim: label))
        } else {
            content
        }
    }
}
