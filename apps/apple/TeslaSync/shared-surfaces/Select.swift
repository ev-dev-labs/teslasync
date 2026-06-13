//
//  Select.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The public API of the form select — the SwiftUI parity of `components/ui/Select.tsx`. Like the web
//  component it is driven entirely by its props (`options`, `label`, `help`, `error`, `hint`, `prompt`
//  → `prompt`, `size`, `id`, `required`, `disabled`, and the controlled `value` / `onChange`); there is no
//  fetcher. It composes the existing native primitives the web source composes — ``FormLabel`` (the web
//  `<Label>`) and ``HelpIcon`` (the web `<HelpIcon>`) — over a native menu `Picker` peer of the `<select>`,
//  binds through ``SelectModel`` for the selection + the derived projection + the once-only `view.opened`
//  telemetry (P1/S11), resolves its a11y copy through the P1/S10 facade, and composes token-driven chrome
//  (P1/S9). No networking, no Tailwind ports.
//
//  Named `FormSelect` (not `Select`): a bare module-level `Select` reads ambiguously beside the SwiftUI
//  `Picker` / `Menu` primitives this surface composes, and `FormSelect` mirrors the sibling `FormLabel`
//  (0218) naming. The diagnostics slug stays "Select".
//
//  States rendered (every real branch of the web source): the labelled / unlabelled field, the help
//  affordance after the label, the unselected prompt option, each option (honouring the per-option disabled
//  flag), the four size scales, the required control, the errored control (red border + error caption +
//  invalid + described-by), the hinted control (muted caption, suppressed by an error), and the native
//  "never a blank box" empty leaf when no options resolve. The generic data-feed leaf states (loading /
//  stale / offline) do not apply to a stateless, networkless presentational primitive and are intentionally
//  absent — the same precedent as the sibling presentational surfaces Label (0218) and HelpIcon (0215).
//

import SwiftUI

// MARK: - FormSelect (the shared surface)

/// The form select — the SwiftUI parity of `components/ui/Select.tsx`. A native menu over the supplied
/// options, with an optional label + help affordance, an unselected prompt, per-option disabling, four size
/// scales, and the error / hint captions. Bind a `selection` + `onChange` for the controlled value.
public struct FormSelect: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SelectSurface.slug
    }

    private let input: SelectInput
    @State private var model: SelectModel

    /// Injects a pre-built model — the host / preview / test seam (a spy telemetry, a seeded selection).
    public init(model: SelectModel) {
        input = model.input
        _model = State(initialValue: model)
    }

    /// The prop-style initializer — the parity of `<Select options label help error hint prompt size id
    /// required disabled value onChange />`. `prompt` is the web unselected-option prop (the empty
    /// `<option value="">`); the
    /// `label` / `error` / `hint` / option labels arrive already localized (web `children`-style props).
    public init(
        options: [SelectOptionInput],
        selection: String = "",
        label: String? = nil,
        help: HelpIconInput? = nil,
        error: String? = nil,
        hint: String? = nil,
        prompt: String? = nil,
        size: SelectSize = .defaultSize,
        id: String? = nil,
        required: Bool = false,
        disabled: Bool = false,
        onChange: (@MainActor (String) -> Void)? = nil,
        telemetry: any SelectTelemetry = OSLogSelectTelemetry()
    ) {
        let resolved = SelectInput(
            options: options,
            label: label,
            help: help,
            error: error,
            hint: hint,
            prompt: prompt,
            size: size,
            explicitID: id,
            isRequired: required,
            isDisabled: disabled
        )
        input = resolved
        _model = State(initialValue: SelectModel(
            input: resolved,
            selection: selection,
            onChange: onChange,
            telemetry: telemetry
        ))
    }

    public var body: some View {
        let projection = model.projection
        let style = SelectSizeStyle.resolve(for: projection.size)
        return VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if projection.showsLabel, let label = projection.label {
                labelRow(label: label, projection: projection)
            }
            control(projection: projection, style: style)
            if projection.showsError, let errorText = projection.errorText {
                SelectCaption(text: errorText, kind: .error, elementID: projection.errorID)
            }
            if projection.showsHint, let hintText = projection.hintText {
                SelectCaption(text: hintText, kind: .hint, elementID: projection.hintID)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: input) { _, newInput in
            model.update(newInput)
        }
    }

    // MARK: - Label row (web `{label && <Label/>}{help && <HelpIcon/>}`)

    /// The label row — the native `FormLabel` (web `<Label htmlFor required>`) plus the optional `HelpIcon`
    /// (web `<HelpIcon {...help} for={help.for ?? selectId} />`), the help's `for` already resolved against
    /// the control id by the projector.
    private func labelRow(label: String, projection: SelectProjection) -> some View {
        HStack(spacing: TSSpacing.xs) {
            FormLabel(label, required: projection.isRequired, fieldIdentifier: projection.resolvedID)
            if projection.showsHelp, let help = projection.help {
                HelpIcon(
                    i18nKey: help.i18nKey,
                    content: help.content,
                    for: help.forID,
                    side: help.side,
                    ariaLabel: help.ariaLabelOverride
                )
            }
        }
    }

    // MARK: - Control (the `<select>` peer)

    /// The control — the native menu over the options, or the "never a blank box" empty leaf when no options
    /// and no prompt resolve.
    @ViewBuilder
    private func control(projection: SelectProjection, style: SelectSizeStyle) -> some View {
        if projection.isEmpty, !projection.showsPrompt {
            SelectEmptyControl(projection: projection, style: style)
        } else {
            menu(projection: projection, style: style)
        }
    }

    /// The native menu — the collapsed trigger reveals the option rows (web `<select>` → the open dropdown).
    /// Carries the consolidated accessibility name (label + required), the selected value, and the error /
    /// hint as the spoken hint (the native peer of `aria-describedby`).
    private func menu(projection: SelectProjection, style: SelectSizeStyle) -> some View {
        Menu {
            SelectMenuContent(projection: projection, selection: model.selection) { value in
                model.select(value)
            }
        } label: {
            SelectTriggerLabel(
                title: model.displayTitle,
                isMuted: model.isShowingPrompt,
                font: style.font
            )
            .modifier(SelectFieldChrome(
                isInvalid: projection.isInvalid,
                horizontalPadding: style.horizontalPadding,
                verticalPadding: style.verticalPadding
            ))
        }
        .controlSize(style.controlSize)
        .disabled(projection.isDisabled)
        .opacity(projection.isDisabled ? 0.5 : 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
        .accessibilityValue(Text(verbatim: model.selectedOption?.label ?? model.displayTitle))
        .selectDescribedBy(projection.errorText ?? projection.hintText)
        .accessibilityIdentifier(projection.resolvedID ?? "")
    }
}

// MARK: - Described-by hint (web `aria-describedby`)

private extension View {
    /// Applies the error / hint text as the control's spoken hint — the native peer of the web
    /// `aria-describedby` pointing at the error / hint caption. A no-op when neither is present so the
    /// accessibility tree is not polluted with an empty hint.
    @ViewBuilder
    func selectDescribedBy(_ text: String?) -> some View {
        if let text, !text.isEmpty {
            accessibilityHint(Text(verbatim: text))
        } else {
            self
        }
    }
}
