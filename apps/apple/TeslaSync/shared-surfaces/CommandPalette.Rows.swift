//
//  CommandPalette.Rows.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The result list of the command palette — the native peers of the web results pane: the phase switch
//  (loading skeleton / error tile / content), the friendly empty message, the section-grouped scrolling list,
//  one selectable row (icon + label + command bolt + sublabel + shortcut cap + selected chevron), and the
//  "View all results" footer affordance. The list is the keyboard-focus target in vehicle-select mode (where
//  the web wires arrow / Enter / Backspace to the results container). Token-driven (P1/S9); copy via the
//  P1/S10 facade; each row exposes its label + sublabel + selected trait to VoiceOver.
//

import SwiftUI

// MARK: - Results pane (phase switch)

/// The scrolling results region — renders the P4 leaf phase, then either the friendly empty message or the
/// grouped row list with the optional "view all" affordance. Owns the vehicle-select keyboard focus target.
struct CommandPaletteResults: View {
    @Bindable var model: CommandPaletteModel
    var focus: FocusState<CommandPaletteField?>.Binding

    private var emptyKind: PaletteEmptyMessageKind {
        CommandPaletteProjector.emptyMessageKind(
            mode: model.mode,
            activeScope: model.projection.activeScope,
            scopedTerm: model.projection.scopedTerm,
            rawQuery: model.query
        )
    }

    var body: some View {
        Group {
            switch model.phase {
            case .loading:
                CommandPaletteLoadingRows()
            case let .error(message):
                CommandPaletteErrorTile(message: message) { model.refresh() }
            case .content:
                content
            }
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: 360)
    }

    @ViewBuilder
    private var content: some View {
        if model.projection.isEmpty {
            CommandPaletteEmptyMessage(kind: emptyKind)
                .frame(maxWidth: .infinity)
                .padding(.vertical, TSSpacing.x3xl)
        } else {
            list
        }
    }

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(model.projection.groups) { group in
                        CommandPaletteGroup(
                            group: group,
                            selectedIndex: model.projection.selectedIndex,
                            onSelect: { model.activate($0) },
                            onHover: { model.setSelectedIndex($0) }
                        )
                    }
                    if model.projection.showViewAllResults {
                        CommandPaletteViewAllButton(query: model.projection.scopedTerm) {
                            model.openAllResults()
                        }
                    }
                }
                .padding(TSSpacing.sm)
            }
            .focusable(model.mode == .vehicleSelect)
            .focused(focus, equals: .list)
            .onKeyPress(.downArrow) { model.moveDown(); return .handled }
            .onKeyPress(.upArrow) { model.moveUp(); return .handled }
            .onKeyPress(.return) { model.submitSelection(); return .handled }
            .onKeyPress(.escape) { model.handleEscape(); return .handled }
            .onKeyPress(.delete) { model.handleBackspace() ? .handled : .ignored }
            .onChange(of: model.selectedIndex) { _, _ in
                proxy.scrollTo(model.projection.selectedIndex, anchor: .center)
            }
        }
    }
}

// MARK: - Section group (web `groupedItems` group)

/// One section group — an uppercase heading over its rows. The heading may repeat (the same section can
/// appear more than once after ranking), matching the web `groupedItems`.
struct CommandPaletteGroup: View {
    let group: PaletteGroup
    let selectedIndex: Int
    let onSelect: (PaletteItem) -> Void
    let onHover: (Int) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(verbatim: group.section)
                .font(.system(size: 10, weight: .semibold))
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.top, TSSpacing.sm)
                .padding(.bottom, TSSpacing.xs)
                .accessibilityHidden(true)
            ForEach(group.items) { entry in
                CommandPaletteRow(
                    item: entry.item,
                    isSelected: entry.globalIndex == selectedIndex,
                    onSelect: { onSelect(entry.item) },
                    onHover: { onHover(entry.globalIndex) }
                )
                .id(entry.globalIndex)
            }
        }
    }
}

// MARK: - Row (web result row)

/// One result row — a leading glyph (accented for vehicle commands), the label with an optional command bolt,
/// an optional sublabel, a trailing shortcut cap, and a selected-row chevron. The whole row tints + rings when
/// selected (web `aria-current`) and exposes the `isSelected` trait to VoiceOver.
struct CommandPaletteRow: View {
    let item: PaletteItem
    let isSelected: Bool
    let onSelect: () -> Void
    let onHover: () -> Void

    private var iconColor: Color {
        if item.kind == .command {
            return isSelected ? Color.TS.accent : Color.TS.accent.opacity(0.7)
        }
        return isSelected ? Color.TS.accent : Color.TS.textMuted
    }

    private var accessibilityText: String {
        guard let sublabel = item.sublabel, !sublabel.isEmpty else { return item.label }
        return "\(item.label), \(sublabel)"
    }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: item.iconName)
                    .font(.system(size: 15))
                    .foregroundStyle(iconColor)
                    .frame(width: 20)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: TSSpacing.xs) {
                        Text(verbatim: item.label)
                            .font(Font.TS.body.weight(.medium))
                            .foregroundStyle(isSelected ? Color.TS.textPrimary : Color.TS.textSecondary)
                            .lineLimit(1)
                        if item.kind == .command {
                            Image(systemName: "bolt.fill")
                                .font(.system(size: 9))
                                .foregroundStyle(Color.TS.accent.opacity(0.7))
                                .accessibilityHidden(true)
                        }
                    }
                    if let sublabel = item.sublabel, !sublabel.isEmpty {
                        Text(verbatim: sublabel)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                if let shortcut = item.shortcut {
                    CommandPaletteKbd(text: shortcut)
                }
                if isSelected {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, TSSpacing.lg)
            .padding(.vertical, TSSpacing.md)
            .frame(minHeight: 44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in if hovering { onHover() } }
        .accessibilityLabel(Text(verbatim: accessibilityText))
        .accessibilityHint(Text(verbatim: CommandPaletteStrings.rowSelectHint))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    @ViewBuilder
    private var rowBackground: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.accent.opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.accent.opacity(0.18), lineWidth: 1)
                )
        } else {
            Color.clear
        }
    }
}

// MARK: - View-all-results (web search footer affordance)

/// The "View all results for …" affordance shown under the live search hits — navigates to the full search
/// page (web `go('/search?q=…')`).
struct CommandPaletteViewAllButton: View {
    let query: String
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
                .padding(.vertical, TSSpacing.xs)
            Button(action: onTap) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12))
                        .accessibilityHidden(true)
                    Text(verbatim: CommandPaletteStrings.viewAllResults(query))
                        .font(Font.TS.caption)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.right")
                        .font(.system(size: 12))
                        .accessibilityHidden(true)
                }
                .foregroundStyle(Color.TS.textSecondary)
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.sm)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: CommandPaletteStrings.viewAllResults(query)))
        }
    }
}
