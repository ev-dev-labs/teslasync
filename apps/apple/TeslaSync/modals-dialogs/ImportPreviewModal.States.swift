//
//  ImportPreviewModal.States.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The non-content leaf states the ImportPreviewModal renders so no branch is ever a blank box: the
//  tinted message banner (web `<AlertBanner variant="danger|warning">` — the parse error on the input
//  screen, and the validation errors / warnings on the preview screen) and the "Cannot preview this
//  layout" empty state (web `<EmptyState>` when validation produced no dashboard). Copy resolves
//  through the P1/S10 facade at the call site; chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Message banner (web `<AlertBanner variant=…>` with a `<ul>` of messages)

/// A tinted, icon-led banner listing one or more messages — the parity of the web `AlertBanner`
/// used for the parse error (single message) and the validation errors / warnings (a list).
struct ImportPreviewBanner: View {
    /// The semantic tone (web `variant="danger" | "warning"`).
    enum Tone {
        case danger
        case warning

        var color: Color {
            switch self {
            case .danger: Color.TS.statusDanger
            case .warning: Color.TS.statusWarning
            }
        }
    }

    let tone: Tone
    let systemImage: String
    let messages: [String]

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                    Text(verbatim: message)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (web `<EmptyState message="Cannot preview this layout" />`)

/// The friendly empty state shown when the validation resolved without a previewable dashboard (web
/// `<EmptyState>`), rendered over `ContentUnavailableView` so it never reads as a blank panel.
struct ImportPreviewEmptyState: View {
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: message)
            } icon: {
                Image(systemName: "rectangle.on.rectangle.slash")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: message))
    }
}
