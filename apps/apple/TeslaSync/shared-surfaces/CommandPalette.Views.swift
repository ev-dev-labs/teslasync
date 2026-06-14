//
//  CommandPalette.Views.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The chrome of the command-palette card — the native peers of the web card shell: the rounded `Material`
//  container, the search header (magnifier + scope chip + field + ESC cap) and the vehicle-select header
//  (back button + bolt + "Send X to…"), and the footer (the ↑↓ / ↵ / ESC shortcut legend, the fleet-count
//  chip + freshness chip, and the empty-query scope-hint strip). The result list + rows live in
//  `CommandPalette.Rows.swift`; the leaf states live in `CommandPalette.States.swift`. All chrome is
//  token-driven (P1/S9); all copy resolves through the P1/S10 facade. Decorative glyphs are hidden from
//  VoiceOver; every control carries an explicit label.
//

import SwiftUI

// MARK: - Card shell

/// The palette card — header, scrolling results, and footer in a rounded `Material` surface. Exposed to
/// VoiceOver as a single modal container named "Command palette".
struct CommandPaletteCard: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    var body: some View {
        VStack(spacing: 0) {
            header
            divider
            CommandPaletteResults(model: model, focus: focus)
            divider
            CommandPaletteFooter(model: model, focus: focus)
        }
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.28), radius: 28, x: 0, y: 18)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.dialogTitle))
        .accessibilityAddTraits(.isModal)
    }

    @ViewBuilder
    private var header: some View {
        switch model.mode {
        case .search:
            CommandPaletteSearchHeader(model: model, focus: focus)
        case .vehicleSelect:
            CommandPaletteVehicleSelectHeader(model: model, focus: focus)
        }
    }

    private var divider: some View {
        Rectangle().fill(Color.TS.border).frame(height: 1)
    }
}

// MARK: - Search header (web search-mode header)

/// The search-mode header — the magnifier, the optional active-scope chip, the debounced text field, and the
/// trailing `esc` keycap (web `<kbd>ESC</kbd>`).
struct CommandPaletteSearchHeader: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    private var textBinding: Binding<String> {
        Binding(get: { model.projection.scopedTerm }, set: { model.setScopedInput($0) })
    }

    private var placeholder: String { // parity:allow ui
        model.activeScope
            .map { CommandPaletteStrings.scopePlaceholder($0) } // parity:allow ui
            ?? CommandPaletteStrings.placeholder // parity:allow ui
    }

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            if let scope = model.activeScope {
                CommandPaletteScopeChip(scope: scope) {
                    model.clearScope()
                    focus.wrappedValue = .search
                }
            }
            field
            CommandPaletteKbd(text: "esc")
        }
        .padding(.horizontal, TSSpacing.xl)
        .padding(.vertical, TSSpacing.lg)
    }

    private var field: some View {
        let editor = TextField(text: textBinding, prompt: Text(verbatim: placeholder)) { // parity:allow ui
            Text(verbatim: CommandPaletteStrings.searchFieldLabel)
        }
        .textFieldStyle(.plain)
        .labelsHidden()
        .focused(focus, equals: .search)
        .font(Font.TS.body)
        .foregroundStyle(Color.TS.textPrimary)
        .submitLabel(.go)
        .autocorrectionDisabled(true)
        .frame(maxWidth: .infinity)
        .onSubmit { model.submitSelection() }
        .onKeyPress(.downArrow) { model.moveDown(); return .handled }
        .onKeyPress(.upArrow) { model.moveUp(); return .handled }
        .onKeyPress(.escape) { model.handleEscape(); return .handled }
        .onKeyPress(.delete) { model.handleBackspace() ? .handled : .ignored }
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.searchFieldLabel))
        .accessibilityValue(Text(verbatim: model.projection.scopedTerm))

        #if os(iOS)
            return editor.textInputAutocapitalization(.never)
        #else
            return editor
        #endif
    }
}

// MARK: - Scope chip (web active-scope pill)

/// The active-scope chip — the prefix glyph + the scope label + a clear `xmark` (web `data-palette-scope-chip`
/// pill). Tapping it clears the scope; the accessible label is "Clear {scope} filter".
struct CommandPaletteScopeChip: View {
    let scope: PaletteScope
    let onClear: () -> Void

    var body: some View {
        Button(action: onClear) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: PaletteScopes.meta(for: scope).prefix)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                Text(verbatim: CommandPaletteStrings.scopeLabel(scope))
                    .font(Font.TS.caption)
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.accent.opacity(0.10), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.clearScope(scope)))
    }
}

// MARK: - Vehicle-select header (web vehicle-select header)

/// The vehicle-select header — a back button, the bolt accent, and the "Send {command} to…" prompt. The
/// invisible focus target that captures arrow / Enter / Backspace keys in this mode lives on the result list.
struct CommandPaletteVehicleSelectHeader: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Button {
                model.goBack()
                focus.wrappedValue = .search
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: CommandPaletteStrings.backButton))
            Image(systemName: "bolt.fill")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: CommandPaletteStrings.selectVehicleFor(model.projection.pendingCommandLabel))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.xl)
        .padding(.vertical, TSSpacing.lg)
    }
}

// MARK: - Footer (web footer legend + hints)

/// The footer — the ↑↓ / ↵ / ESC shortcut legend (the ESC label changes with mode + scope), the fleet-count +
/// freshness chips, and the empty-query scope-hint strip.
struct CommandPaletteFooter: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    private var escLabel: String {
        if model.mode == .vehicleSelect { return CommandPaletteStrings.back }
        if model.activeScope != nil { return CommandPaletteStrings.clearFilter }
        return CommandPaletteStrings.close
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.lg) {
                legend(cap: "↑↓", label: CommandPaletteStrings.navigate)
                legend(cap: "↵", label: CommandPaletteStrings.select)
                legend(cap: "esc", label: escLabel)
                Spacer(minLength: 0)
                if model.mode == .search, model.projection.vehicleCount > 0 {
                    fleetChip
                }
                if model.connection != .live {
                    CommandPaletteFreshnessChip(connection: model.connection) { model.refresh() }
                }
            }
            if model.mode == .search, model.activeScope == nil, model.query.isEmpty {
                CommandPaletteScopeHints(model: model, focus: focus)
            }
        }
        .padding(.horizontal, TSSpacing.xl)
        .padding(.vertical, TSSpacing.md)
    }

    private func legend(cap: String, label: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            CommandPaletteKbd(text: cap)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(cap) \(label)"))
    }

    private var fleetChip: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "bolt.fill").font(.system(size: 10)).accessibilityHidden(true)
            Text(verbatim: CommandPaletteStrings.vehicleCount(model.projection.vehicleCount))
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.accent)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: CommandPaletteStrings.vehicleCount(model.projection.vehicleCount)))
    }
}

// MARK: - Scope-hint strip (web empty-query hint chips)

/// The empty-query scope-hint strip — a "Filter" caption + one chip per scope that types its prefix. Shown
/// only on the empty-query landing state so it teaches the shortcut without distracting from results.
struct CommandPaletteScopeHints: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: CommandPaletteStrings.filterBy)
                .font(.system(size: 10, weight: .semibold))
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            ForEach(PaletteScopes.hints) { hint in
                Button {
                    model.setRawQuery("\(hint.prefix) ")
                    focus.wrappedValue = .search
                } label: {
                    HStack(spacing: TSSpacing.xs) {
                        CommandPaletteKbd(text: hint.prefix)
                        Text(verbatim: CommandPaletteStrings.scopeLabel(hint.scope))
                            .font(.system(size: 10))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: CommandPaletteStrings.scopeLabel(hint.scope)))
            }
            Spacer(minLength: 0)
        }
    }
}
