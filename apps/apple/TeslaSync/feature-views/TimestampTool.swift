//
//  TimestampTool.swift
//  TeslaSync — P4 feature view · 0021 · TimestampTool (Apple)
//
//  The composable Timestamp devtools surface — SwiftUI parity of
//  features/admin/components/devtools/tools/TimestampTool.tsx, a converter between
//  Unix epoch seconds and ISO-8601. Binds through `TimestampToolModel` (no
//  networking in the view); renders the web `ToolCard` chrome, the always-on live
//  "now" row (ticking 1 Hz) with its "Now" autofill button, and the two converter
//  fields (Unix → Iso/Local/Relative; Iso → Unix/Local/Relative). Every field
//  renders content / empty / invalid — never a blank box. Built from design tokens
//  (P1/S9) + shared components.
//

import Combine
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TimestampToolStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TimestampTool (the devtools feature view)

/// The composable Timestamp devtools surface — SwiftUI parity of
/// `TimestampTool.tsx`. Renders the `ToolCard` shell, the live "now" row + "Now"
/// button, and the two converter fields, binding through `TimestampToolModel`.
public struct TimestampTool: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TimestampToolSurface.slug

    @State private var model: TimestampToolModel

    /// 1 Hz clock driving the live header + relative-time rows (web `setInterval`).
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    public init(model: TimestampToolModel = TimestampToolModel()) {
        _model = State(initialValue: model)
    }

    private var unixBinding: Binding<String> {
        Binding(get: { model.unixInput }, set: { model.unixInput = $0 })
    }

    private var isoBinding: Binding<String> {
        Binding(get: { model.isoInput }, set: { model.isoInput = $0 })
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    nowRow
                    fields
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onReceive(ticker) { instant in model.tick(instant) }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `ToolCard` icon + title + description)

extension TimestampTool {
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TimestampToolStrings.text("Timestamp", "Timestamp")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                TimestampToolStrings.text("Timestamp Desc", "Timestamp Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// The web `ICON_COLOR_MAP.green` chip: a tinted Clock glyph in a rounded,
    /// ringed square (neon-green → `statusSuccess`).
    private var iconChip: some View {
        Image(systemName: "clock.fill")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(Color.TS.statusSuccess)
            .frame(width: 40, height: 40)
            .background(
                Color.TS.statusSuccess.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusSuccess.opacity(0.2), lineWidth: 1)
            )
            .accessibilityHidden(true)
    }
}

// MARK: - Live "now" row (web clock + `Now` button)

extension TimestampTool {
    private var nowRow: some View {
        let snapshot = model.nowSnapshot
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: "clock")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
            nowValues(snapshot)
            Spacer(minLength: TSSpacing.sm)
            TSButton(
                variant: .ghost,
                size: .small,
                action: { model.useNow() },
                label: { TimestampToolStrings.text("Now", "Now") }
            )
            .accessibilityLabel(TimestampToolStrings.text("Now", "Now"))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }

    private func nowValues(_ snapshot: TimestampNow) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: String(snapshot.unixSeconds))
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: "|")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: snapshot.iso)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: TimestampAccessibility.nowSummary(snapshot)))
    }
}

// MARK: - Converter fields (web `grid sm:grid-cols-2`)

extension TimestampTool {
    /// Two converter columns that wrap to one on narrow widths (web
    /// `sm:grid-cols-2`).
    private var fields: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                unixColumn
                isoColumn
            }
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                unixColumn
                isoColumn
            }
        }
    }

    private var unixColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TimestampInputField(
                labelKey: "Unix Timestamp",
                labelFallback: "Unix Timestamp",
                systemImage: "number",
                promptText: "1700000000",
                text: unixBinding,
                isNumeric: true
            )
            unixInterpretation
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var isoColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TimestampInputField(
                labelKey: "Iso Timestamp",
                labelFallback: "Iso Timestamp",
                systemImage: "clock",
                promptText: "2024-01-01T00:00:00Z",
                text: isoBinding,
                isNumeric: false
            )
            isoInterpretation
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Interpretation states (web `{fromUnix && …}` / `{fromIso && …}`)

extension TimestampTool {
    @ViewBuilder
    private var unixInterpretation: some View {
        switch model.unixPhase {
        case .content:
            if let interpretation = model.fromUnix {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TimestampValueRow(labelKey: "Iso", labelFallback: "Iso", value: interpretation.iso)
                    TimestampValueRow(labelKey: "Local", labelFallback: "Local", value: interpretation.local)
                    TimestampValueRow(
                        labelKey: "Relative",
                        labelFallback: "Relative",
                        value: TimestampToolStrings.relative(interpretation.relative)
                    )
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: TimestampAccessibility.unixSummary(interpretation)))
            }
        case .empty:
            TimestampHint(
                systemImage: "number",
                key: "Timestamp Unix Empty Hint",
                fallback: "Enter Unix epoch seconds (for example, 1700000000) to convert to ISO and local time."
            )
        case .invalid:
            TimestampHint(
                systemImage: "exclamationmark.triangle",
                key: "Timestamp Unix Invalid Hint",
                fallback: "That is not a readable Unix timestamp — enter whole epoch seconds or milliseconds."
            )
        }
    }

    @ViewBuilder
    private var isoInterpretation: some View {
        switch model.isoPhase {
        case .content:
            if let interpretation = model.fromISO {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TimestampValueRow(
                        labelKey: "Unix",
                        labelFallback: "Unix",
                        value: String(interpretation.unixSeconds)
                    )
                    TimestampValueRow(labelKey: "Local", labelFallback: "Local", value: interpretation.local)
                    TimestampValueRow(
                        labelKey: "Relative",
                        labelFallback: "Relative",
                        value: TimestampToolStrings.relative(interpretation.relative)
                    )
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: TimestampAccessibility.isoSummary(interpretation)))
            }
        case .empty:
            TimestampHint(
                systemImage: "clock",
                key: "Timestamp Iso Empty Hint",
                fallback: "Enter an ISO-8601 string (for example, 2024-01-01T00:00:00Z) to convert to Unix time."
            )
        case .invalid:
            TimestampHint(
                systemImage: "exclamationmark.triangle",
                key: "Timestamp Iso Invalid Hint",
                fallback: "That is not a readable ISO-8601 date — try a value like 2024-01-01T00:00:00Z."
            )
        }
    }
}

// MARK: - Input field (web `Input` with leading icon + label)

private struct TimestampInputField: View {
    let labelKey: String
    let labelFallback: String
    let systemImage: String
    let promptText: String
    let text: Binding<String>
    let isNumeric: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TimestampToolStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                field
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(TimestampToolStrings.text(labelKey, labelFallback))
        .accessibilityValue(Text(verbatim: text.wrappedValue))
    }

    private var field: some View {
        TextField(text: text, prompt: Text(verbatim: promptText)) {
            TimestampToolStrings.text(labelKey, labelFallback)
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(.system(.body, design: .monospaced))
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        #if os(iOS)
            .keyboardType(isNumeric ? .numbersAndPunctuation : .default)
            .textInputAutocapitalization(.never)
        #endif
    }
}

// MARK: - Value row (web `label: <span mono cyan>value</span>`)

private struct TimestampValueRow: View {
    let labelKey: String
    let labelFallback: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            (
                TimestampToolStrings.text(labelKey, labelFallback)
                    + Text(verbatim: ":")
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.statusInfo)
                .textSelection(.enabled)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Friendly hint (web hides the block; native always shows a state)

private struct TimestampHint: View {
    let systemImage: String
    let key: String
    let fallback: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TimestampToolStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
