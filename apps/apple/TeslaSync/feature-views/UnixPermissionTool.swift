//
//  UnixPermissionTool.swift
//  TeslaSync — P4 feature view · 0022 · UnixPermissionTool (Apple)
//
//  The SwiftUI parity of
//  features/admin/components/devtools/tools/UnixPermissionTool.tsx — a devtools
//  tool that decodes a 3-digit octal permission into its symbolic `rwx` triads.
//  Binds through `UnixPermissionToolModel` (no networking in the view); renders
//  the web `ToolCard` chrome, the octal input + presets selector, and both
//  states (valid → owner/group/other + combined code with copy; invalid →
//  a friendly hint). Built from design tokens (P1/S9) + shared components.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension UnixPermissionToolStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in
    /// the model file) so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - UnixPermissionTool (the devtools feature view)

/// The composable Unix-permission devtools surface — SwiftUI parity of
/// `UnixPermissionTool.tsx`. Renders the `ToolCard` shell, the octal input and
/// preset selector, and the decoded breakdown (or a friendly hint when the
/// input is not a valid octal), binding through `UnixPermissionToolModel`.
public struct UnixPermissionTool: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = UnixPermissionToolSurface.slug

    @State private var model: UnixPermissionToolModel

    public init(model: UnixPermissionToolModel = UnixPermissionToolModel()) {
        _model = State(initialValue: model)
    }

    /// Two-way binding the octal text field + preset picker share, routing every
    /// edit through the model so the projection re-derives.
    private var octalBinding: Binding<String> {
        Binding(
            get: { model.octal },
            set: { newValue in model.octal = newValue }
        )
    }

    public var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    octalField
                    presetPicker
                    content
                }
            }
        }
        .onAppear { model.start() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `ToolCard` icon + title + description)

extension UnixPermissionTool {
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            iconChip
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                UnixPermissionToolStrings.text("Unix Perm", "Unix Perm")
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                UnixPermissionToolStrings.text("Unix Perm Desc", "Unix Perm Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// The web `ICON_COLOR_MAP.green` chip: tinted Lock glyph in a rounded,
    /// ringed square (neon-green → `statusSuccess`).
    private var iconChip: some View {
        Image(systemName: "lock.fill")
            .font(.system(size: 18, weight: .semibold))
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

// MARK: - Inputs (web `Input` + `Select`)

extension UnixPermissionTool {
    private var octalField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            UnixPermissionToolStrings.text("Octal Perm", "Octal Perm")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                octalTextField
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
        .accessibilityLabel(UnixPermissionToolStrings.text("Octal Perm", "Octal Perm"))
        .accessibilityValue(Text(verbatim: model.octal))
    }

    private var octalTextField: some View {
        TextField(text: octalBinding, prompt: Text(verbatim: "755")) {
            UnixPermissionToolStrings.text("Octal Perm", "Octal Perm")
        }
        .labelsHidden()
        .textFieldStyle(.plain)
        .font(.system(.body, design: .monospaced))
        .foregroundStyle(Color.TS.textPrimary)
        .autocorrectionDisabled(true)
        #if os(iOS)
            .keyboardType(.numberPad)
            .textInputAutocapitalization(.never)
        #endif
    }

    private var presetPicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            UnixPermissionToolStrings.text("Presets", "Presets")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Picker(selection: octalBinding) {
                ForEach(UnixPermissionPreset.all) { preset in
                    Text(verbatim: preset.label).tag(preset.octal)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .accessibilityLabel(UnixPermissionToolStrings.text("Presets", "Presets"))
        }
    }
}

// MARK: - Content states (web `symbolic ? … : null`)

extension UnixPermissionTool {
    @ViewBuilder
    private var content: some View {
        if let projection = model.projection {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                triadGrid(projection)
                combinedRow(projection)
            }
        } else {
            emptyHint
        }
    }

    private var triadColumns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: TSSpacing.sm), count: 3)
    }

    /// The three owner / group / other tiles (web `grid sm:grid-cols-3`), each
    /// tinted to match the web triad colors (emerald / cyan / amber).
    private func triadGrid(_ projection: UnixPermissionProjection) -> some View {
        let tiles = [
            UnixPermissionTriad(
                labelKey: "Owner", fallback: "Owner", value: projection.owner, tone: Color.TS.statusSuccess
            ),
            UnixPermissionTriad(
                labelKey: "Group", fallback: "Group", value: projection.group, tone: Color.TS.statusInfo
            ),
            UnixPermissionTriad(
                labelKey: "Other", fallback: "Other", value: projection.other, tone: Color.TS.statusWarning
            )
        ]
        return LazyVGrid(columns: triadColumns, spacing: TSSpacing.sm) {
            ForEach(tiles) { tile in
                UnixPermissionTriadTile(triad: tile)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: UnixPermissionAccessibility.summary(for: projection)))
    }

    /// The combined symbolic string with a copy affordance (web `code` +
    /// `CopyButton`). The copy button stays a separate accessibility element.
    private func combinedRow(_ projection: UnixPermissionProjection) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.symbolic)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityLabel(
                    UnixPermissionToolStrings.text("Unix Perm Symbolic A11y", "Symbolic permissions")
                )
                .accessibilityValue(Text(verbatim: projection.symbolic))
            Spacer(minLength: TSSpacing.sm)
            TSCopyButton(value: projection.symbolic)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }

    /// Friendly inline hint shown when the octal is not valid — the breakdown is
    /// hidden in the web source; native shows guidance instead of a blank box.
    private var emptyHint: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "lock.slash")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            UnixPermissionToolStrings.text(
                "Unix Perm Empty Hint",
                "Enter a 3-digit octal value using digits 0–7 (for example, 755) to see its symbolic permissions."
            )
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Triad tile

/// One owner / group / other permission tile: a localized label over the
/// monospaced triad value, tinted to the web triad color.
private struct UnixPermissionTriad: Identifiable {
    let labelKey: String
    let fallback: String
    let value: String
    let tone: Color

    var id: String {
        labelKey
    }
}

private struct UnixPermissionTriadTile: View {
    let triad: UnixPermissionTriad

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            UnixPermissionToolStrings.text(triad.labelKey, triad.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: triad.value)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(triad.tone)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(UnixPermissionToolStrings.text(triad.labelKey, triad.fallback))
        .accessibilityValue(Text(verbatim: triad.value))
    }
}
