//
//  PillFilterBar.swift
//  TeslaSync — P4 shared surface · 0156 · PillFilterBar (Apple)
//
//  The public API of the single-select pill / tab filter row — the SwiftUI parity of
//  `components/forms/PillFilterBar.tsx`. Like the web component it is driven entirely by its props
//  (`items`, `activeKey`, `onChange`, `ariaLabel`, `variant`, `scrollable`); there is no fetcher. The view
//  binds through ``PillFilterBarModel`` for the once-only `view.opened` telemetry (P1/S11), the roving
//  keyboard-focus target, and the selection / arrow routing (web `onChange` / `moveFocus`); composes the
//  token-driven chrome (P1/S9) in a horizontal row (optionally scrollable); and pushes prop changes into
//  the holder via `.onChange` so a reused bar re-renders faithfully. No networking, no Tailwind ports.
//
//  Implements the WAI-ARIA Tabs pattern: the row is one VoiceOver container labelled by `ariaLabel`, each
//  pill is a button exposing the `.isSelected` trait, and Left / Right / Home / End move selection + focus
//  through the enabled ring (disabled pills skipped) — the page owns the active key and applies it through
//  the supplied `onChange`, exactly as the web does (the bar never owns the selection state itself).
//

import SwiftUI

// MARK: - PillFilterBar (the shared surface)

/// The single-select pill / tab filter row — the SwiftUI parity of `components/forms/PillFilterBar.tsx`.
/// Renders one pill (or tab) per item with an active fill / underline, an optional leading icon and muted
/// count suffix, and a friendly empty state when empty. Used for trend metric switchers, list-page
/// collections (All / Anomalies / Notable / …), and similar "pick one" surfaces.
public struct PillFilterBar: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PillFilterBarSurface.slug

    private let input: PillFilterBarInput
    private let onChange: (@MainActor (String) -> Void)?
    @State private var model: PillFilterBarModel
    @FocusState private var focusedKey: String?

    /// The prop-style initializer — the parity of `<PillFilterBar items activeKey onChange ariaLabel
    /// variant scrollable>`. `items` are the pills (each with a stable `key`, label, optional icon / count
    /// / accent / disabled); `activeKey` is the selected key; `onChange` is raised on tap and on arrow /
    /// Home / End travel; `ariaLabel` labels the whole row for assistive tech; `variant` picks `pills`
    /// (default) or `tabs`; `scrollable` (default true) allows horizontal overflow scrolling.
    public init(
        items: [PillItem],
        activeKey: String,
        ariaLabel: String,
        onChange: @escaping @MainActor (String) -> Void,
        variant: PillVariant = .pills,
        scrollable: Bool = true,
        telemetry: any PillFilterBarTelemetry = OSLogPillFilterBarTelemetry()
    ) {
        let resolved = PillFilterBarInput(
            items: items,
            activeKey: activeKey,
            ariaLabel: ariaLabel,
            variant: variant,
            scrollable: scrollable
        )
        input = resolved
        self.onChange = onChange
        _model = State(initialValue: PillFilterBarModel(
            input: resolved,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded input).
    public init(model: PillFilterBarModel) {
        input = model.input
        onChange = nil
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onChange(of: input) { _, newInput in
                model.update(newInput, onChange: onChange)
            }
            .onChange(of: model.focusedKey) { _, newKey in
                if focusedKey != newKey { focusedKey = newKey }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text(verbatim: input.ariaLabel))
    }

    /// The empty state or the populated row.
    @ViewBuilder private var content: some View {
        if model.projection.isEmpty {
            PillFilterBarEmptyView()
        } else {
            populatedRow
        }
    }

    /// The populated row — scrollable or static, with the faint baseline border under the `tabs` variant
    /// (web `border-b border-white/[0.06]`).
    private var populatedRow: some View {
        let projection = model.projection
        return Group {
            if projection.scrollable {
                ScrollView(.horizontal, showsIndicators: false) {
                    strip(projection)
                }
            } else {
                strip(projection)
            }
        }
        .overlay(alignment: .bottom) {
            if projection.variant == .tabs {
                Rectangle()
                    .fill(Color.TS.border)
                    .frame(height: 1)
            }
        }
    }

    /// The horizontal run of pills — tighter spacing for `tabs` (underline row) than `pills` (chips).
    private func strip(_ projection: PillFilterBarProjection) -> some View {
        HStack(spacing: projection.variant == .tabs ? TSSpacing.none : TSSpacing.sm) {
            ForEach(projection.pills) { pill in
                PillFilterBarPill(
                    resolved: pill,
                    variant: projection.variant,
                    model: model,
                    focus: $focusedKey
                )
            }
        }
        .padding(.vertical, TSSpacing.xs)
    }
}
