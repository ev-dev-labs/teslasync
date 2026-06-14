//
//  Toast.Views.swift
//  TeslaSync — P4 shared surface · 0144 · Toast (Apple)
//
//  The presentational subviews composed by the surface: the single toast card (the native parity of one
//  web `motion.div` toast — the severity icon, the title + optional message, the optional navigation /
//  callback action, and the dismiss control) and its action button. All consume the P1/S10 facade and the
//  shared P1/S9 tokens / components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web per-kind border / icon shades
//  (emerald / tesla-red / sky / amber) map to the brand status tokens, so each toast reads correctly in
//  light, dark, and high-contrast themes.
//
//  Accessibility note: the icon + title + message form one VoiceOver element labelled with the spoken
//  severity word + the content (the native peer of the web `role="status"` / `role="alert"` announcement),
//  while the action and dismiss controls stay individually focusable with their own labels (web real
//  `<Link>` / `<button>`).
//

import SwiftUI

// MARK: - Tint → token colour (web per-kind `styles`)

extension ToastTint {
    /// The brand status colour the view renders for this semantic tint (web `styles[type]` accent).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .warning: Color.TS.statusWarning
        }
    }
}

// MARK: - Single toast card (web one `motion.div` toast)

/// One toast card — the native parity of a single web toast: the severity icon, the title + optional
/// message, the optional action affordance, and the dismiss control, on a glass card with a tinted border
/// and a soft glow. The entrance / exit animation is owned by the enclosing ``ToastOverlay`` so it can
/// honour Reduce Motion; the card itself is a pure function of its ``ToastItem``.
struct ToastRowView: View {
    let item: ToastItem
    var onNavigate: (String) -> Void = { _ in }
    let onDismiss: () -> Void

    private var tint: Color {
        ToastPresentation.tint(for: item.kind).color
    }

    private var accessibilityLabelText: String {
        ToastAccessibility.label(
            severity: ToastStrings.severity(item.kind),
            title: item.title,
            message: item.message
        )
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: ToastPresentation.iconSystemName(for: item.kind))
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                statusText
                if let action = item.action, let style = action.resolvedStyle {
                    ToastActionButton(
                        action: action,
                        style: style,
                        tint: tint,
                        onNavigate: onNavigate,
                        onDismiss: onDismiss
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            dismissButton
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 380, alignment: .leading)
        .background(cardBackground)
        .overlay(cardBorder)
        .shadow(color: tint.opacity(0.15), radius: 12, y: 4)
    }

    /// The announced element (web `role="status"` / `role="alert"`): the spoken severity word, the title,
    /// and the message read in one pass. The controls below stay separately focusable.
    private var statusText: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: item.title)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
            if let message = item.message, !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var dismissButton: some View {
        Button(action: onDismiss) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.xs)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: ToastStrings.dismiss))
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
    }

    private var cardBorder: some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .strokeBorder(tint.opacity(0.3), lineWidth: 1)
    }
}

// MARK: - Action button (web `<Link>` / `<button>`)

/// A toast's optional action — the native parity of the web action affordance: a navigation link (web
/// `<Link to=>`, rendered with a trailing arrow) or a callback button (web `<button onClick>`). Either way
/// the action runs and then the toast dismisses, matching the web handlers. Navigation wins when both
/// fields are set (web behaviour, encoded in ``ToastAction/resolvedStyle``).
struct ToastActionButton: View {
    let action: ToastAction
    let style: ToastActionStyle
    let tint: Color
    var onNavigate: (String) -> Void = { _ in }
    let onDismiss: () -> Void

    var body: some View {
        Button(action: handleTap) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: action.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                if style == .navigation {
                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 10, weight: .semibold))
                }
            }
            .foregroundStyle(tint)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: action.label))
        .accessibilityAddTraits(style == .navigation ? .isLink : .isButton)
    }

    /// Web handler: navigation form resolves the path through the host's navigator and dismisses; callback
    /// form runs the handler and dismisses. Navigation wins when both are present.
    private func handleTap() {
        if let path = action.navigationPath {
            onNavigate(path)
        } else {
            action.perform?()
        }
        onDismiss()
    }
}
