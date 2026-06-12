//
//  DensityToggle.swift
//  TeslaSync — P4 shared surface · 0153 · DensityToggle (Apple)
//
//  The public API of the list-density selector — the SwiftUI parity of `components/forms/DensityToggle.tsx`.
//  Like the web component it is a CONTROLLED surface driven entirely by its props (`value`, `onChange`, and
//  the optional `options` / `ariaLabel` / `testId`); there is no fetcher. The view binds through
//  ``DensityToggleModel`` for the once-only `view.opened` telemetry (P1/S11) and the selection / arrow-key
//  routing, composes the token-driven track (P1/S9), reads the environment for the responsive label
//  collapse (web `hidden sm:inline`) + Reduce Motion, and pushes prop changes into the holder via
//  `.onChange` so a reused selector re-renders faithfully. No networking, no Tailwind ports.
//
//  Controlled-component parity: exactly like the web, the caller owns the value (typically via a URL param
//  so the user's preference survives a refresh). Every selection — a tap on a segment or a Left / Right
//  arrow — is reported back out through the page-supplied `onChange`; the surface never stores the value
//  itself.
//

import SwiftUI

// MARK: - DensityToggle (the shared surface)

/// The list-density selector — the SwiftUI parity of `components/forms/DensityToggle.tsx`. Renders a
/// three-way Table / Compact / Comfortable segmented control (or a constrained subset) as a WAI-ARIA
/// radiogroup: a tap or a Left / Right arrow moves + commits the selection, wrapping at the ends. Mounted
/// in list-page headers so the user can switch row density.
public struct DensityToggle: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = DensityToggleSurface.slug

    private let input: DensityToggleInput
    private let onChange: @MainActor (Density) -> Void
    @State private var model: DensityToggleModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<DensityToggle value onChange options ariaLabel testId>`.
    /// `value` is the selected density; `onChange` reports a new selection; `options` (default `[table,
    /// compact, comfortable]`) constrains + orders the choices; `ariaLabel` overrides the default group
    /// name; `identifier` (web `testId`) drives the accessibility identifiers for UI tests.
    public init(
        value: Density,
        onChange: @escaping @MainActor (Density) -> Void,
        options: [Density] = Density.defaultOptions,
        ariaLabel: String? = nil,
        identifier: String? = nil,
        telemetry: any DensityToggleTelemetry = OSLogDensityToggleTelemetry()
    ) {
        let resolved = DensityToggleInput(
            value: value,
            options: options,
            ariaLabel: ariaLabel,
            identifier: identifier
        )
        input = resolved
        self.onChange = onChange
        _model = State(initialValue: DensityToggleModel(input: resolved, onChange: onChange, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, an identity resolver, a
    /// seeded input).
    public init(model: DensityToggleModel) {
        input = model.input
        onChange = { _ in }
        _model = State(initialValue: model)
    }

    public var body: some View {
        let projection = model.projection
        return Group {
            if projection.isEmpty {
                DensityToggleEmptyView()
            } else {
                DensityToggleTrack(
                    projection: projection,
                    showsLabels: showsLabels,
                    reduceMotion: reduceMotion,
                    onSelect: { model.select($0) },
                    onMove: { model.move($0) }
                )
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onChange: onChange)
        }
    }

    /// Whether the segment text labels are shown — the native peer of the web `hidden sm:inline`: hidden on
    /// a compact width (icon-only), shown otherwise. macOS (no size class) always shows them.
    private var showsLabels: Bool {
        #if os(iOS)
            horizontalSizeClass != .compact
        #else
            true
        #endif
    }
}
