//
//  StatusHero.swift
//  TeslaSync — P4 shared surface · 0199 · StatusHero (Apple)
//
//  The public API of the large at-a-glance status card — the SwiftUI parity of
//  components/status/StatusHero.tsx. Like the web component it is driven entirely by its props (`status`,
//  the optional `headline` override, the optional `subline`, the `live` flag, and the optional `cta`);
//  there is no fetcher. It surfaces the answer to "is my instance healthy?" in under a second: the status
//  drives the medallion glyph, the headline, the ring, and the glow. The view binds through
//  ``StatusHeroModel`` for the once-only `view.opened` telemetry (P1/S11) + the derived projection,
//  composes the token-driven chrome via ``StatusHeroContainer`` (P1/S9), and pushes prop changes into the
//  holder via `.onChange` so a reused hero re-renders faithfully. No networking, no Tailwind ports.
//
//  Rich-content note: the web `subline` is a `ReactNode`; in practice it carries a single inline string
//  (e.g. "Last checked 12s ago · 8 services"), so this surface's prop initializer takes a
//  `subline: String?`. A host that needs richer inline content composes ``StatusHeroContainer`` directly
//  (the same primitive this surface uses), keeping full parity without a generic public surface.
//

import SwiftUI

// MARK: - StatusHeroAction (web `cta`)

/// The optional call-to-action — the native peer of the web `cta` prop (`{ label, onClick, loading? }`).
/// `onTap` maps the web `onClick`; `isLoading` maps the web `loading` (spins + disables the button). The
/// closure is held by the surface's state-holder so the `Equatable` ``StatusHeroInput`` stays
/// closure-free.
public struct StatusHeroAction {
    /// The button label (web `cta.label`) — caller-supplied + already localized, rendered verbatim.
    public let label: String
    /// Whether the button is in its loading state (web `cta.loading`).
    public let isLoading: Bool
    /// The host's tap handler (web `cta.onClick`).
    public let onTap: (@MainActor () -> Void)?

    public init(label: String, isLoading: Bool = false, onTap: (@MainActor () -> Void)? = nil) {
        self.label = label
        self.isLoading = isLoading
        self.onTap = onTap
    }
}

// MARK: - StatusHero (the shared surface)

/// The large at-a-glance status card — the SwiftUI parity of `components/status/StatusHero.tsx`. Renders
/// a tinted, ringed status medallion beside (or above, on compact width) a status-coloured headline + an
/// optional sub-line with an optional "Live" chip, and an optional trailing action button — all inside a
/// frosted panel carrying a status-tinted glow. Reusable across the System-Status hero, incident
/// summaries, and embedded dashboard status banners.
public struct StatusHero: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = StatusHeroSurface.slug

    private let input: StatusHeroInput
    @State private var model: StatusHeroModel

    /// The prop-style initializer — the parity of `<StatusHero status headline subline live cta id />`.
    /// `headline` overrides the per-status default (web `headline ?? cfg.defaultHeadline`); `subline` is
    /// the optional sub-line (its absence also hides the live chip, per the web nesting); `live` shows
    /// the "Live" chip when a sub-line is present; `cta` is the optional action button; `anchorID` is the
    /// web `id` (in-page anchor / UI-test target).
    public init(
        status: HeroStatus,
        headline: String? = nil,
        subline: String? = nil,
        live: Bool = false,
        cta: StatusHeroAction? = nil,
        anchorID: String? = nil,
        telemetry: any StatusHeroTelemetry = OSLogStatusHeroTelemetry()
    ) {
        let resolved = StatusHeroInput(
            status: status,
            headlineOverride: headline,
            subline: subline,
            isLive: live,
            ctaLabel: cta?.label,
            ctaIsLoading: cta?.isLoading ?? false,
            anchorID: anchorID
        )
        input = resolved
        _model = State(initialValue: StatusHeroModel(
            input: resolved,
            onActivate: cta?.onTap,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: StatusHeroModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    public var body: some View {
        StatusHeroContainer(
            projection: model.projection,
            onActivate: { model.activate() }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }
}
