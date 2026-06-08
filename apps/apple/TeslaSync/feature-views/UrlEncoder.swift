//
//  UrlEncoder.swift
//  TeslaSync — P4 feature view · 0023 · UrlEncoder (Apple)
//
//  The native SwiftUI parity of
//  features/admin/components/devtools/tools/UrlEncoder.tsx — a `ToolCard`-framed
//  URL-component encoder/decoder. Binds through `UrlEncoderModel` (no transform
//  logic in the view) and renders every branch the web source has: the empty
//  hint, the encoded/decoded output panel (with copy), and the
//  invalid-input error. No networking — the web source has no data hooks beyond
//  `useTranslation`, so the network states (loading/error/stale/offline) do not
//  apply to this pure client-side transform.
//

import SwiftUI

// MARK: - UrlEncoderView (the feature surface)

/// The composable URL Encoder devtool — SwiftUI parity of `UrlEncoder.tsx`. Framed
/// like the web `ToolCard` (icon chip + title + description) over a glass panel,
/// it binds through `UrlEncoderModel` (P1/S8) and emits the P1/S11 `view.opened`
/// event on appear.
public struct UrlEncoderView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "UrlEncoder"

    @State private var model: UrlEncoderModel

    /// Builds the surface over a caller-provided model (the production seam +
    /// previews/tests inject their own; mirrors the dashboard-widget surfaces).
    public init(model: UrlEncoderModel) {
        _model = State(initialValue: model)
    }

    /// Convenience that builds the default model (MainActor-isolated so the
    /// `@Observable` model is constructed on the main actor).
    @MainActor
    public init() {
        self.init(model: UrlEncoderModel())
    }

    public var body: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                modeToggle(model)
                inputBlock(text: $model.input, example: model.exampleInput)
                outputSection(model.result)
            }
        }
        .padding(TSSpacing.xl)
        .tsGlassPanel()
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web ToolCard chrome)

private extension UrlEncoderView {
    var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                UrlEncoderStrings.text("Url Encoder", "Url Encoder")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                UrlEncoderStrings.text("Url Encoder Desc", "Url Encoder Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
    }

    var iconChip: some View {
        Image(systemName: "link")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.accent.opacity(0.16),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Mode toggle (web Encode/Decode buttons)

private extension UrlEncoderView {
    func modeToggle(_ model: UrlEncoderModel) -> some View {
        HStack(spacing: TSSpacing.sm) {
            modeButton(.encode, key: "Encode", model: model)
            modeButton(.decode, key: "Decode", model: model)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .contain)
    }

    func modeButton(_ mode: UrlEncoderMode, key: String, model: UrlEncoderModel) -> some View {
        let isActive = model.mode == mode
        return TSButton(variant: isActive ? .primary : .ghost, size: .small) {
            model.select(mode)
        } label: {
            Text(verbatim: UrlEncoderStrings.string(key, key))
        }
        .accessibilityAddTraits(isActive ? [.isSelected] : [])
    }
}

// MARK: - Input (web Textarea)

private extension UrlEncoderView {
    func inputBlock(text: Binding<String>, example: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            UrlEncoderStrings.text("Input Label", "Input Label")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField(text: text, prompt: Text(verbatim: example), axis: .vertical) {
                Text(verbatim: UrlEncoderStrings.string("Input Label", "Input Label"))
            }
            .labelsHidden()
            .textFieldStyle(.plain)
            .font(.system(.body, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .lineLimit(2 ... 6)
            .padding(TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(UrlEncoderStrings.text("urlEncoder.inputA11y", "Text to encode or decode"))
        }
    }
}

// MARK: - Output states (web `{output && …}` panel + empty + invalid)

private extension UrlEncoderView {
    @ViewBuilder
    func outputSection(_ result: UrlEncoderResult) -> some View {
        switch result {
        case .empty:
            emptyOutput
        case let .value(value):
            outputPanel(value)
        case .invalid:
            invalidOutput
        }
    }

    /// Friendly empty hint shown before there is any input — the web hides the
    /// panel here; native shows a hint so it is never a blank box.
    var emptyOutput: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "link")
                .font(.system(size: 22, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            UrlEncoderStrings.text("urlEncoder.emptyTitle", "Nothing to show yet")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
            UrlEncoderStrings.text(
                "urlEncoder.emptyHint",
                "Enter text above to see the encoded or decoded result."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .padding(.horizontal, TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    /// The successful output panel (web `pre` + `CopyButton`).
    func outputPanel(_ value: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                UrlEncoderStrings.text("Output Label", "Output Label")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                TSCopyButton(value: value)
            }
            Text(verbatim: value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(UrlEncoderStrings.text("Output Label", "Output Label"))
                .accessibilityValue(Text(verbatim: value))
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }

    /// The invalid-input error (web `t('Invalid Input')`). The web renders it in
    /// the same panel with a copy button; native keeps the verbatim "Invalid Input"
    /// text but swaps the copy affordance for a danger-toned warning, the
    /// HIG-idiomatic error rendering the surface contract asks for.
    var invalidOutput: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                UrlEncoderStrings.text("Output Label", "Output Label")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
            }
            UrlEncoderStrings.text("Invalid Input", "Invalid Input")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.statusDanger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(UrlEncoderStrings.text("Invalid Input", "Invalid Input"))
    }
}
