//
//  SLOTrackingCard.Sections.swift
//  TeslaSync — P4 feature view · 0253 · SLOTrackingCard (Apple)
//
//  The figure-region composition for `SLOTrackingCard` — the phase switch that sits
//  between the header and the window selector. The web always renders the figure
//  (showing "—" while loading) with the inline loading / error text below the tabs;
//  the prompt widens that into a single region that renders exactly one of the
//  loading skeleton, the populated figure, the friendly empty state, or the error +
//  retry, so no state is ever a blank box. Copy resolves through the P1/S10 facade;
//  the populated figure + the loading / empty / error states live in `.Views` /
//  `.States`.
//

import SwiftUI

// MARK: - Figure region (loading / content / empty / error)

/// The data region of the card — switches over the bound model's `SLOPhase` so
/// every prompt-required state renders. The window selector + caveat sit outside
/// this region (always visible), mirroring the web layout where the tabs persist
/// across loading / error.
struct SLOTrackingFigureRegion: View {
    let phase: SLOPhase
    let percentText: String
    let tone: SLOTone
    let windowLabel: String
    let componentsClause: String
    let figureSummary: String
    let onRetry: () -> Void

    var body: some View {
        switch phase {
        case .loading:
            SLOTrackingLoading()
        case .content:
            SLOFigureView(
                percentText: percentText,
                tone: tone,
                windowLabel: windowLabel,
                componentsClause: componentsClause,
                accessibilitySummary: figureSummary
            )
        case .empty:
            SLOTrackingEmpty()
        case let .error(message):
            SLOTrackingError(message: message, onRetry: onRetry)
        }
    }
}
