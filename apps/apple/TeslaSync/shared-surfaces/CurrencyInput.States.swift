//
//  CurrencyInput.States.swift
//  TeslaSync — P4 shared surface · 0150 · CurrencyInput (Apple)
//
//  The P4 leaf-contract chrome composed by `CurrencyInputField` when the surface is not in its ready
//  state: the loading skeleton (a label line over a field-shaped block, so the surface keeps its
//  shape while the bound value resolves) and the error tile with a retry affordance (the web
//  `QueryError` peer, for when the parent's settings fetch fails). All copy resolves through the
//  P1/S10 facade; all color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the bound value's fetch in flight)

/// The initial-fetch chrome — a skeleton label line over a field-shaped skeleton block, so the
/// surface keeps the field's footprint while the parent's value resolves.
struct CurrencyInputFieldLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSSkeleton(width: 120, height: 10)
            TSSkeleton(height: 38, cornerRadius: TSRadius.md)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: CurrencyInputFieldStrings.string(
            "currencyInput.loadingA11y", "Loading the currency field"
        )))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct CurrencyInputFieldErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: CurrencyInputFieldStrings.string(
                    "currencyInput.errorTitle", "Couldn't load the field"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: CurrencyInputFieldStrings.string("currencyInput.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: CurrencyInputFieldStrings.string("currencyInput.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
