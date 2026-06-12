//
//  EditableText.States.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  The P4 leaf-contract chrome composed by ``EditableTextField`` when the surface is not in its ready
//  state: the loading skeleton (a label line over an input-shaped block, so the surface keeps its shape
//  while the bound value resolves) and the error tile with a retry affordance (the web `QueryError` peer,
//  for when the parent's fetch fails). Neither branch exists in the controlled web source; both are the
//  P4 "never a blank box" additions. All copy resolves through the P1/S10 facade; all color comes from
//  the P1/S9 tokens — no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Loading (the bound value's fetch in flight)

/// The initial-fetch chrome — a skeleton label line over an input-shaped skeleton block, so the surface
/// keeps the field's footprint while the parent's value resolves.
struct EditableTextFieldLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSkeleton(width: 96, height: 10)
            TSSkeleton(width: 180, height: 18, cornerRadius: TSRadius.sm)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: EditableTextFieldStrings.loadingA11y))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct EditableTextFieldErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: EditableTextFieldStrings.errorTitle)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: EditableTextFieldStrings.retry)
                }
                .accessibilityLabel(Text(verbatim: EditableTextFieldStrings.retry))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
