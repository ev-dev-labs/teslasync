//
//  LiveIndicator.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The SwiftUI parity of `web/src/components/data-display/LiveIndicator.tsx`: an at-a-glance badge of
//  the live-data pipeline's health. It renders the four states surfaced by `useLiveConnection`
//  (connected / reconnecting / disconnected / unknown) in one of three variants — `pill` (the
//  default: a colored chip with an icon, a label, and a freshness stamp), `dot` (a bare colored dot
//  for dense headers), and `compact` (a chip with an icon + label, no stamp).
//
//  The view binds the `LiveIndicatorModel` state-holder (P1/S8) for the snapshot + the resolved
//  projection and the once-only `view.opened` telemetry (P1/S11); no networking lives in the view.
//  Copy resolves through the P1/S10 facade and color comes from the P1/S9 tokens — no Tailwind ports,
//  no raw hex. NOT to be confused with a per-datum freshness indicator: this reflects the HEALTH OF
//  THE WIRE, not the age of a single value.
//

import SwiftUI

// MARK: - Variant (web `LiveIndicatorVariant`)

/// The visual variants — the parity of the web `LiveIndicatorVariant` union:
///   - `pill`    → colored chip with icon, label, and freshness timestamp (default)
///   - `dot`     → bare colored dot, no text (dense navigation headers / the app shell)
///   - `compact` → colored chip with icon + label, but no timestamp
public enum LiveIndicatorVariant: String, Sendable, Equatable, CaseIterable {
    case pill
    case dot
    case compact
}

// MARK: - LiveIndicator (the shared surface)

/// The live-pipeline-health badge — the SwiftUI parity of the web `LiveIndicator`. Renders every
/// connection state in the chosen variant, binding through `LiveIndicatorModel`.
public struct LiveIndicator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = LiveIndicatorMeta.surfaceSlug

    private let variant: LiveIndicatorVariant
    @State private var model: LiveIndicatorModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Designated initializer — adopts a fully-formed model (the production app threads the live
    /// transport through `LiveConnectionIndicatorSource`; previews / tests inject an in-memory
    /// source + a telemetry spy).
    public init(variant: LiveIndicatorVariant = .pill, model: LiveIndicatorModel) {
        self.variant = variant
        _model = State(initialValue: model)
    }

    /// Convenience initializer mirroring the web prop signature — the parity of mounting
    /// `<LiveIndicator variant={…} />`. Wires the production source seeded with the `unknown` status;
    /// the host pushes wire-state updates through the source.
    public init(variant: LiveIndicatorVariant = .pill) {
        self.init(variant: variant, model: LiveIndicatorModel(source: LiveConnectionIndicatorSource()))
    }

    public var body: some View {
        let resolved = model.resolved(variant: variant)
        Group {
            switch resolved.variant {
            case .dot:
                LiveIndicatorDot(resolved: resolved)
            case .pill, .compact:
                LiveIndicatorChip(resolved: resolved, reduceMotion: reduceMotion)
            }
        }
        .accessibilityIdentifier("live-indicator")
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}
