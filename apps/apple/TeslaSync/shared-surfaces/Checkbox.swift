//
//  Checkbox.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  The checkbox primitive surface — the SwiftUI parity of `components/ui/Checkbox.tsx`. The web
//  component is a thin wrapper over a visually-hidden `<input type="checkbox">`: a controlled (`checked`)
//  or uncontrolled (`defaultChecked`) value, an `indeterminate` (mixed) flag, a `disabled` flag, a
//  `size` variant (`sm` / `md` / `lg`), an optional `label` to the right, and an `onChange(checked)`
//  callback fired on every change. This surface reproduces that primitive with a native, accessible
//  control: a styled indicator box (check / minus glyph) plus the optional label, all inside one tap
//  target, binding through `CheckboxModel` (P1/S8) for the canonical state + the once-only `view.opened`
//  telemetry (P1/S11). No networking lives in the view.
//
//  States. The web source is presentational with no data fetch, so there is no loading / empty / error
//  / stale / offline axis — the box always renders. The genuine branches reproduced are the unchecked /
//  checked / indeterminate state, the disabled state, the optional label, and the three size variants.
//  See Checkbox.Adapter for the full parity note.
//

import SwiftUI

// MARK: - Checkbox (the shared surface)

/// The checkbox primitive surface — the SwiftUI parity of `components/ui/Checkbox.tsx`. Renders the
/// styled indicator box (check / minus / empty) and the optional trailing label, binding through
/// `CheckboxModel`. Offered in three forms: controlled (`isChecked:` + `onChange:`, the web `checked`),
/// uncontrolled (`defaultChecked:`, the web `defaultChecked`), and a SwiftUI `Binding<Bool>`
/// convenience.
public struct Checkbox: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static let surfaceSlug = CheckboxMeta.surfaceSlug

    /// The value-type input snapshot — the `onChange(of:)` key that re-syncs the model when the host
    /// re-renders with a changed prop (the parity of a controlled re-render).
    private let input: CheckboxInput

    @State private var model: CheckboxModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Controlled initializer — the parity of `<Checkbox checked={…} onChange={…} />`. The parent owns
    /// the value; every toggle routes the new value out through `onChange`. `telemetry` is injectable
    /// for tests; the production default logs `view.opened`.
    public init(
        isChecked: Bool,
        indeterminate: Bool = false,
        label: String? = nil,
        size: CheckboxSize = CheckboxMeta.defaultSize,
        isDisabled: Bool = false,
        id: String? = nil,
        telemetry: any CheckboxTelemetry = OSLogCheckboxTelemetry(),
        onChange: @escaping (Bool) -> Void
    ) {
        let snapshot = CheckboxInput(
            isControlled: true,
            controlledChecked: isChecked,
            defaultChecked: isChecked,
            isIndeterminate: indeterminate,
            isDisabled: isDisabled,
            label: label,
            size: size,
            identifier: CheckboxMeta.makeIdentifier(id)
        )
        input = snapshot
        _model = State(initialValue: CheckboxModel(
            input: snapshot,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Uncontrolled initializer — the parity of `<Checkbox defaultChecked={…} onChange={…} />`. The box
    /// owns its own value (seeded once from `defaultChecked`); `onChange` still fires on every toggle,
    /// matching the web uncontrolled `<input>`.
    public init(
        defaultChecked: Bool,
        indeterminate: Bool = false,
        label: String? = nil,
        size: CheckboxSize = CheckboxMeta.defaultSize,
        isDisabled: Bool = false,
        id: String? = nil,
        telemetry: any CheckboxTelemetry = OSLogCheckboxTelemetry(),
        onChange: @escaping (Bool) -> Void = { _ in }
    ) {
        let snapshot = CheckboxInput(
            isControlled: false,
            controlledChecked: false,
            defaultChecked: defaultChecked,
            isIndeterminate: indeterminate,
            isDisabled: isDisabled,
            label: label,
            size: size,
            identifier: CheckboxMeta.makeIdentifier(id)
        )
        input = snapshot
        _model = State(initialValue: CheckboxModel(
            input: snapshot,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    /// Idiomatic SwiftUI convenience — drives a `Binding<Bool>` instead of a controlled `isChecked` +
    /// `onChange` pair. Commits write back through the binding (the native parity of the web parent
    /// owning the value and re-rendering).
    public init(
        isChecked: Binding<Bool>,
        indeterminate: Bool = false,
        label: String? = nil,
        size: CheckboxSize = CheckboxMeta.defaultSize,
        isDisabled: Bool = false,
        id: String? = nil,
        telemetry: any CheckboxTelemetry = OSLogCheckboxTelemetry()
    ) {
        self.init(
            isChecked: isChecked.wrappedValue,
            indeterminate: indeterminate,
            label: label,
            size: size,
            isDisabled: isDisabled,
            id: id,
            telemetry: telemetry,
            onChange: { isChecked.wrappedValue = $0 }
        )
    }

    public var body: some View {
        Button {
            model.toggle()
        } label: {
            CheckboxRow(resolved: model.resolved, reduceMotion: reduceMotion)
        }
        .buttonStyle(.plain)
        .disabled(model.resolved.isDisabled)
        .opacity(model.resolved.isDisabled ? 0.6 : 1)
        .fixedSize(horizontal: true, vertical: false)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input, initial: true) { _, newInput in model.sync(newInput) }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isToggle)
        .accessibilityLabel(Text(verbatim: model.resolved.accessibilityLabel))
        .accessibilityValue(Text(verbatim: model.resolved.accessibilityValue))
        .accessibilityIdentifier(model.resolved.accessibilityIdentifier)
    }
}
