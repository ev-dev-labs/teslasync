//
//  Toggle.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  The switch toggle surface — the SwiftUI parity of `components/ui/Toggle.tsx`. The web component is
//  a controlled WAI-ARIA switch: a `role="switch"` button with `aria-checked`, an optional `label`
//  that doubles as the accessible name (`aria-labelledby`) and also toggles on tap, a `size` variant
//  (`sm` / `md`), and an `onChange(checked)` callback fired on every change. This surface reproduces
//  that primitive with the idiomatic native switch, binding through `ToggleModel` (P1/S8) for the
//  canonical state + the once-only `view.opened` telemetry (P1/S11); no networking lives in the view.
//
//  Naming. The public view is `ToggleSwitch`, not `Toggle`: a module-level type named `Toggle` would
//  shadow `SwiftUI.Toggle`, the native control this surface composes — the same disambiguation the
//  sibling `SliderField` (0226) surface applies. The file keeps the surface name (`Toggle.*`) and the
//  diagnostics slug stays "Toggle".
//
//  States. The web source is a controlled primitive with no data fetch (`useId` is id generation, not
//  a query), so there is no loading / empty / error / stale / offline axis — the switch always
//  renders. The genuine branches reproduced are the on / off state, the optional trailing label, and
//  the size variant. See Toggle.Adapter for the full parity note.
//

import SwiftUI

// MARK: - ToggleSwitch (the shared surface)

/// The switch toggle surface — the SwiftUI parity of `components/ui/Toggle.tsx`. Renders the native
/// switch and the optional trailing label, binding through `ToggleModel`.
public struct ToggleSwitch: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = ToggleMeta.surfaceSlug

    /// The value-type input snapshot — the `onChange(of:)` key that re-syncs the model when the host
    /// re-renders with a changed prop (the parity of a controlled re-render).
    private let input: ToggleInput

    @State private var model: ToggleModel

    /// Designated initializer mirroring the web prop signature — the parity of mounting
    /// `<Toggle checked={…} label={…} size={…} onChange={…} />`. `telemetry` is injectable for tests;
    /// the production default logs `view.opened`.
    public init(
        isOn: Bool,
        label: String? = nil,
        size: ToggleSize = ToggleMeta.defaultSize,
        id: String? = nil,
        telemetry: any ToggleTelemetry = OSLogToggleTelemetry(),
        onChange: @escaping (Bool) -> Void
    ) {
        let snapshot = ToggleInput(
            isOn: isOn,
            label: label,
            size: size,
            identifier: ToggleMeta.makeIdentifier(id)
        )
        input = snapshot
        _model = State(initialValue: ToggleModel(
            input: snapshot,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Idiomatic SwiftUI convenience — drives a `Binding<Bool>` instead of a controlled `isOn` +
    /// `onChange` pair. Commits write back through the binding (the native parity of the web parent
    /// owning the value and re-rendering).
    public init(
        isOn: Binding<Bool>,
        label: String? = nil,
        size: ToggleSize = ToggleMeta.defaultSize,
        id: String? = nil,
        telemetry: any ToggleTelemetry = OSLogToggleTelemetry()
    ) {
        self.init(
            isOn: isOn.wrappedValue,
            label: label,
            size: size,
            id: id,
            telemetry: telemetry,
            onChange: { isOn.wrappedValue = $0 }
        )
    }

    public var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ToggleSwitchControl(
                resolved: model.resolved,
                isOn: Binding(get: { model.isOn }, set: { model.setOn($0) })
            )
            if let labelText = model.resolved.labelText {
                ToggleLabel(text: labelText) { model.toggle() }
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input, initial: true) { _, newInput in model.sync(newInput) }
        .accessibilityElement(children: .contain)
    }
}
