//
//  SortControl.swift
//  TeslaSync — P4 shared surface · 0159 · SortControl (Apple)
//
//  The public API of the list sort control — the SwiftUI parity of `components/forms/SortControl.tsx`. Like
//  the web component it is a CONTROLLED surface driven entirely by its props (`field`, `direction`,
//  `options`, `onFieldChange`, `onDirectionChange`, and the optional `directionAriaLabel` / `testId`); there
//  is no fetcher. The view binds through ``SortControlModel`` for the once-only `view.opened` telemetry
//  (P1/S11) and the field-selection / direction-flip routing, composes the token-driven row (P1/S9), reads
//  the environment for Reduce Motion, and pushes prop changes into the holder via `.onChange` so a reused
//  control re-renders faithfully. No networking, no Tailwind ports.
//
//  Controlled-component parity: exactly like the web, the caller owns `field` + `direction` (typically via
//  URL params so the user's sort survives a refresh). A field pick (the dropdown) is reported through
//  `onFieldChange`; a tap on the direction toggle is reported, already flipped, through `onDirectionChange`;
//  the surface never stores either value itself.
//

import SwiftUI

// MARK: - SortControl (the shared surface)

/// The list sort control — the SwiftUI parity of `components/forms/SortControl.tsx`. Renders a sort-field
/// dropdown (web `<Select>` → a `Menu`) next to an ascending / descending direction toggle (web `<button>`
/// with an up/down arrow). Mounted in list-page headers so the user can choose which column to sort by and
/// in which direction.
public struct SortControl: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SortControlSurface.slug

    private let input: SortControlInput
    private let onFieldChange: @MainActor (String) -> Void
    private let onDirectionChange: @MainActor (SortDirection) -> Void
    @State private var model: SortControlModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<SortControl field direction options onFieldChange
    /// onDirectionChange directionAriaLabel testId>`. `field` is the selected field key; `direction` is the
    /// current order; `options` are the sortable fields; `onFieldChange` / `onDirectionChange` report a new
    /// selection; `directionAriaLabel` overrides the default direction accessible name; `identifier` (web
    /// `testId`) drives the accessibility identifiers for UI tests.
    public init(
        field: String,
        direction: SortDirection,
        options: [SortOption],
        onFieldChange: @escaping @MainActor (String) -> Void,
        onDirectionChange: @escaping @MainActor (SortDirection) -> Void,
        directionAriaLabel: String? = nil,
        identifier: String? = nil,
        telemetry: any SortControlTelemetry = OSLogSortControlTelemetry()
    ) {
        let resolved = SortControlInput(
            field: field,
            direction: direction,
            options: options,
            directionAriaLabel: directionAriaLabel,
            identifier: identifier
        )
        input = resolved
        self.onFieldChange = onFieldChange
        self.onDirectionChange = onDirectionChange
        _model = State(initialValue: SortControlModel(
            input: resolved,
            onFieldChange: onFieldChange,
            onDirectionChange: onDirectionChange,
            telemetry: telemetry
        ))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, an identity resolver, a
    /// seeded input).
    public init(model: SortControlModel) {
        input = model.input
        onFieldChange = { _ in }
        onDirectionChange = { _ in }
        _model = State(initialValue: model)
    }

    public var body: some View {
        SortControlRow(
            projection: model.projection,
            reduceMotion: reduceMotion,
            onSelectField: { model.selectField($0) },
            onToggleDirection: { model.toggleDirection() }
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput, onFieldChange: onFieldChange, onDirectionChange: onDirectionChange)
        }
    }
}
