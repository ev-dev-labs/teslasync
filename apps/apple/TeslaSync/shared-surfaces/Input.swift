//
//  Input.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  The text-field primitive surface — the SwiftUI parity of `components/ui/Input.tsx`. The web
//  component is a thin wrapper over a single `<input>`: an optional `label` (with a `required` marker
//  and an optional `<HelpIcon>`), an optional leading `icon` and trailing `suffix`, an `error`
//  message (red border, suppresses the hint), a supporting `hint`, a `size` variant (`sm` / `md` /
//  `lg` / `auto`), and the native input attributes (`placeholder`, `required`, `disabled`, the
//  controlled value). This surface reproduces that primitive with a native, accessible control,
//  binding the value through a SwiftUI `Binding<String>` (the native peer of the web controlled
//  `value` + `onChange`) and the chrome through `InputFieldModel` (P1/S8) for the resolved projection
//  + the once-only `view.opened` telemetry (P1/S11). No networking lives in the view.
//
//  Type-name note: `Input` is a deliberately generic web name; following the sibling-collision
//  precedent set by CurrencyInput (0150), the view is named `InputField` while the diagnostics slug
//  stays the web source name "Input".
//
//  States. The web source is presentational with no data fetch, so there is no loading / empty /
//  stale / offline axis — the field always renders. The genuine branches reproduced are the optional
//  label / help / icon / suffix, the error and hint lines, the disabled / secure state, and the four
//  size variants. See Input.Adapter for the full parity note.
//

import SwiftUI

// MARK: - InputField (the shared surface)

/// The text-field primitive surface — the SwiftUI parity of `components/ui/Input.tsx`. Renders the
/// optional label row (label + required marker + help trigger), the bordered field box (optional
/// leading icon, the editable field, optional trailing suffix), and the error / hint message line,
/// binding the value through a `Binding<String>` and the chrome through `InputFieldModel`. The
/// `icon` / `suffix` builders default to `EmptyView`, so a bare `InputField(text:)` renders just the
/// field — mirroring the web optional regions.
public struct InputField<Icon: View, Suffix: View>: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`) — the web source name.
    public static var surfaceSlug: String {
        InputFieldMeta.surfaceSlug
    }

    /// The value-type input snapshot — the `onChange(of:)` key that re-syncs the model when the host
    /// re-renders with a changed prop (the parity of a controlled re-render).
    private let input: InputFieldInput
    @Binding private var text: String
    private let icon: Icon
    private let suffix: Suffix
    @State private var model: InputFieldModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The prop-style initializer — the parity of `<Input label help error hint icon suffix size
    /// required disabled placeholder value … />`. Resolves the element id from `id` or the slugified
    /// label (the web `inputId`), wires the value `Binding`, and seeds the model. The `icon` / `suffix`
    /// builders default to `EmptyView` so their presence is detected structurally (the web `icon !=
    /// null` / `suffix != null`).
    public init(
        text: Binding<String>,
        label: String? = nil,
        help: String? = nil,
        helpFor: String? = nil,
        placeholder: String? = nil,
        error: String? = nil,
        hint: String? = nil,
        size: InputFieldSize = InputFieldMeta.defaultSize,
        isRequired: Bool = false,
        isDisabled: Bool = false,
        isSecure: Bool = false,
        id: String? = nil,
        telemetry: any InputFieldTelemetry = OSLogInputFieldTelemetry(),
        @ViewBuilder icon: () -> Icon = { EmptyView() },
        @ViewBuilder suffix: () -> Suffix = { EmptyView() }
    ) {
        let identifier = InputFieldMeta.resolveIdentifier(id: id, label: label)
        let snapshot = InputFieldInput(
            identifier: identifier,
            label: label,
            helpText: help,
            helpFieldName: helpFor ?? identifier,
            placeholder: placeholder,
            error: error,
            hint: hint,
            hasIcon: Icon.self != EmptyView.self,
            hasSuffix: Suffix.self != EmptyView.self,
            size: size,
            isRequired: isRequired,
            isDisabled: isDisabled,
            isSecure: isSecure
        )
        _text = text
        input = snapshot
        self.icon = icon()
        self.suffix = suffix()
        _model = State(initialValue: InputFieldModel(input: snapshot, telemetry: telemetry))
    }

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, an echo i18n
    /// resolver, a seeded snapshot). The value still flows through the supplied `Binding`.
    public init(
        text: Binding<String>,
        model: InputFieldModel,
        @ViewBuilder icon: () -> Icon = { EmptyView() },
        @ViewBuilder suffix: () -> Suffix = { EmptyView() }
    ) {
        _text = text
        input = model.input
        self.icon = icon()
        self.suffix = suffix()
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if model.resolved.showsLabel || model.resolved.showsHelp {
                InputFieldLabelRow(resolved: model.resolved)
            }
            InputFieldControl(
                resolved: model.resolved,
                text: $text,
                reduceMotion: reduceMotion,
                icon: icon,
                suffix: suffix
            )
            if model.resolved.showsError || model.resolved.showsHint {
                InputFieldMessage(resolved: model.resolved)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input, initial: true) { _, newInput in model.sync(newInput) }
    }
}
