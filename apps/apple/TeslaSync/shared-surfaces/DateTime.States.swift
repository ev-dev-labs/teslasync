//
//  DateTime.States.swift
//  TeslaSync — P4 shared surface · 0084 · DateTime (Apple)
//
//  The P4 leaf-contract chrome composed by `DateTime` when the surface is not rendering a value: the
//  loading skeleton (the value slot as shimmer while the formatting context resolves) and the error
//  tile with a retry affordance (the web `QueryError` peer). The empty state (a null / invalid value)
//  is rendered inline by `DateTimeValueView` as the muted "—" fallback — the web behavior — so it
//  needs no separate chrome here. All copy resolves through the P1/S10 facade; all color comes from
//  the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (context feed resolving)

/// The initial-fetch chrome — a single skeleton line shaped like a rendered timestamp, so the value
/// slot keeps its footprint while the settings / vehicle context resolves.
struct DateTimeLoadingView: View {
    var body: some View {
        TSSkeleton(width: 132, height: 14, cornerRadius: TSRadius.sm)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: DateTimeStrings.string(
                "format.dateTime.loadingA11y", "Loading time"
            )))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The context-feed-failure state (web `QueryError` peer) — a compact error tile with a retry
/// affordance. The message is the runtime failure reason, surfaced through the shared error display.
struct DateTimeErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
        .accessibilityIdentifier("datetime-error")
    }
}
