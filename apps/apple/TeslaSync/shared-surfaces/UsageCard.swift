//
//  UsageCard.swift
//  TeslaSync — P4 shared surface · 0109 · UsageCard (Apple)
//
//  The SwiftUI surface — the public API of the "spend / volume" usage card, the parity of the web
//  `<UsageCard budget bands details topLists banner footer emptyMessage />`. Like the web component it is
//  driven entirely by its props; the only "hook" is the i18n facade (P1/S10), so there is no data binding
//  to wire. The view binds through ``UsageCardModel`` (P1/S8) for the derived projection + the localized
//  VoiceOver labels + the once-only `view.opened` telemetry (P1/S11) + the host `onNavigate` seam (internal
//  footer links), and pushes prop changes into the holder via `.onChange` so a reused card re-renders
//  faithfully. No networking, no Tailwind ports — chrome is token-driven (P1/S9) and copy resolves through
//  P1/S10.
//

import SwiftUI

/// The usage card — the SwiftUI parity of `components/data-display/UsageCard.tsx`. Renders, top to bottom,
/// an optional budget progress bar, an at-a-glance bands grid, a key/value detail grid, top-list breakdown
/// blocks, a callout banner, and a footer link row — every section optional. When no section is present it
/// renders the muted empty message instead of a blank panel. Purely presentational: every branch is a
/// function of its props.
public struct UsageCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UsageCardSurface.slug

    private let input: UsageCardInput
    private let onNavigate: (@MainActor (UsageCardFooterLink) -> Void)?
    @State private var model: UsageCardModel

    /// The prop-style initializer — the parity of `<UsageCard … />`. Every section slot is optional and
    /// defaults to empty / absent, matching the web defaults; an all-empty card renders the empty message.
    /// `onNavigate` is the host seam for internal footer links (the native peer of react-router
    /// navigation); external footer links open their URL directly, so they do not use it.
    public init(
        budget: UsageCardBudget? = nil,
        bands: [UsageCardBand] = [],
        details: [UsageCardDetail] = [],
        topLists: [UsageCardTopList] = [],
        banner: UsageCardBanner? = nil,
        footer: [UsageCardFooterLink] = [],
        emptyMessage: String? = nil,
        onNavigate: (@MainActor (UsageCardFooterLink) -> Void)? = nil,
        telemetry: any UsageCardTelemetry = OSLogUsageCardTelemetry()
    ) {
        let resolved = UsageCardInput(
            budget: budget,
            bands: bands,
            details: details,
            topLists: topLists,
            banner: banner,
            footer: footer,
            emptyMessage: emptyMessage
        )
        input = resolved
        self.onNavigate = onNavigate
        _model = State(initialValue: UsageCardModel(
            input: resolved,
            onNavigate: onNavigate,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: UsageCardModel) {
        input = model.input
        onNavigate = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        UsageCardContentView(model: model)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput, onNavigate: onNavigate)
            }
    }
}
