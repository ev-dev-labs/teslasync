//
//  Drawer.Views.swift
//  TeslaSync — P4 modal / dialog · 0013 · Drawer (Apple)
//
//  The populated chrome for `Drawer`: the dimming scrim (web backdrop), the titled header (web `<h3>` +
//  close "×"), the scrollable label/value content body (web `children`), and the footer action bar
//  (web optional `footer`). All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9). No web Tailwind classes are ported here — platform materials + tokens reproduce the glass
//  panel.
//

import SwiftUI

// MARK: - Scrim (web backdrop)

/// The dimming backdrop behind the panel (web `bg-[var(--surface-overlay)] backdrop-blur` scrim). Tap
/// dismisses (web `onClick={onClose}`); it is decorative to VoiceOver (web `aria-hidden="true"`) since
/// the close button + the panel's escape action carry the accessible dismissal.
struct DrawerScrim: View {
    let onTap: () -> Void

    var body: some View {
        Rectangle()
            .fill(Color.black.opacity(0.45))
            .ignoresSafeArea()
            .contentShape(Rectangle())
            .onTapGesture(perform: onTap)
            .accessibilityHidden(true)
    }
}

// MARK: - Header (web `<h3>` + close)

/// The panel header rendered only when a title is present (web `title && <header/>`): the title, the
/// freshness chip, and the trailing close button (web `<button aria-label="Close"><X/></button>`).
struct DrawerHeader: View {
    let title: String
    let connection: DrawerConnection
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            DrawerFreshnessChip(connection: connection)
            Spacer(minLength: TSSpacing.sm)
            DrawerCloseButton(label: closeLabel, action: onClose)
        }
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .contain)
    }
}

/// The header's close affordance (web close "×"). Carries the Escape keyboard shortcut so a hardware
/// keyboard dismisses the panel (web `Escape` → `onClose`).
struct DrawerCloseButton: View {
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .keyboardShortcut(.cancelAction)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Content body (web `children`)

/// The scrollable label/value body (web `flex-1 overflow-y-auto` children). One `DrawerRow` per
/// resolved item.
struct DrawerContentBody: View {
    let items: [DrawerContentItem]

    var body: some View {
        VStack(spacing: TSSpacing.none) {
            ForEach(items) { item in
                DrawerRow(item: item)
                if item.id != items.last?.id {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.lg)
    }
}

/// One detail row: a muted label and a primary value, read as a single VoiceOver element.
struct DrawerRow: View {
    let item: DrawerContentItem

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: item.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.lg)
            Text(verbatim: item.value)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(item.label), \(item.value)"))
    }
}

// MARK: - Footer (web optional `footer`)

/// The footer action bar rendered only when enabled (web `footer &&`), over a bar material with a top
/// border: a row-count summary and the primary Done action that dismisses the panel.
struct DrawerFooter: View {
    let countSummary: String
    let doneLabel: String
    let onDone: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: countSummary)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            doneButton
        }
        .padding(.horizontal, TSSpacing.x2xl)
        .padding(.vertical, TSSpacing.lg)
        .background(.bar)
        .overlay(alignment: .top) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
        .accessibilityElement(children: .contain)
    }

    private var doneButton: some View {
        Button(action: onDone) {
            Text(verbatim: doneLabel)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.accent, in: Capsule())
                .foregroundStyle(Color.white)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: doneLabel))
    }
}

// MARK: - Localization Text helper

extension DrawerStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
