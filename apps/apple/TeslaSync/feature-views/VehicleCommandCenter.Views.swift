//
//  VehicleCommandCenter.Views.swift
//  TeslaSync — P4 feature view · 0261 · VehicleCommandCenter (Apple)
//
//  The presentational chrome composed by `VehicleCommandCenter`: the vehicle header +
//  live telemetry stat row, the last-command status feedback + asleep / stale / status
//  banners, the search box, the favorites bar, the collapsible category groups, the
//  individual command tile (action / toggle / input), and the loading skeleton. All
//  consume pre-localized strings from the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Header (web vehicle header + telemetry row)

/// The always-visible panel header: the vehicle name + lifecycle badge + freshness chip
/// (web `FreshnessIndicator`), the model · VIN sub-line, and the live battery / range /
/// inside-temperature stats (web `{state && …}` row).
struct VCCHeader: View {
    let model: VehicleCommandCenterModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                titleBlock
                Spacer(minLength: TSSpacing.sm)
                if !model.stats.isEmpty {
                    statRow
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
                Text(verbatim: model.projection?.vehicleName ?? "")
                    .font(Font.TS.section)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                TSBadge(
                    LocalizedStringKey(model.projection?.stateLabel ?? ""),
                    tone: model.isAsleep ? .neutral : .success
                )
                VCCFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    ageLabel: model.ageLabel
                )
            }
            Text(verbatim: model.projection?.modelLine ?? "")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var statRow: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(model.stats) { stat in
                VCCStatChip(stat: stat)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// One header telemetry stat chip: an SF Symbol + the toned value (web battery / range /
/// temperature spans).
struct VCCStatChip: View {
    let stat: VCCStat

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: stat.systemImage)
                .font(.system(size: 13))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: stat.value)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(stat.tone.color)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: stat.spoken))
    }
}

/// The header freshness chip reflecting the bound source's live-state (ADR-013): a
/// tinted dot, a localized status word, and the relative age (web `FreshnessIndicator`).
struct VCCFreshnessChip: View {
    let connection: VCCConnection
    let isFetching: Bool
    let ageLabel: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(VehicleCommandCenterStrings.text("commands.freshness.label", "Data freshness"))
        .accessibilityValue(Text(verbatim: label))
    }

    private var tone: Color {
        if isFetching { return Color.TS.accent }
        switch connection {
        case .live: return Color.TS.statusSuccess
        case .stale: return Color.TS.statusWarning
        case .offline: return Color.TS.statusDanger
        }
    }

    private var label: String {
        if isFetching {
            return VehicleCommandCenterStrings.string("commands.freshness.updating", "Updating")
        }
        return ageLabel
    }
}

// MARK: - Search (web `CommandSearch`)

/// The command search field (web `CommandSearch` controlled input): a glass field with a
/// leading magnifier and a trailing clear button.
struct VCCSearchField: View {
    @Binding var text: String
    let hasQuery: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TextField(
                text: $text,
                prompt: Text(VehicleCommandCenterStrings.string("commands.search.prompt", "Search commands..."))
            ) {
                Text(VehicleCommandCenterStrings.string("commands.search.prompt", "Search commands..."))
            }
            .textFieldStyle(.plain)
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textPrimary)
            .accessibilityLabel(VehicleCommandCenterStrings.text("commands.search.label", "Search commands"))
            if hasQuery {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(VehicleCommandCenterStrings.text("commands.search.clear", "Clear search"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Command area (favorites + groups OR search results)

/// Switches between the not-searching layout (favorites bar + collapsible category
/// groups) and the searching layout (flat result grid or the no-results line) — the web
/// `filteredCommands ? … : …` branch.
struct VCCCommandArea: View {
    let model: VehicleCommandCenterModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let filtered = model.filteredCommands {
                if filtered.isEmpty {
                    noResults
                } else {
                    VCCCommandGrid(commands: filtered, model: model)
                }
            } else {
                VCCFavoritesBar(model: model)
                ForEach(model.commandGroups) { group in
                    VCCCategoryGroupView(group: group, model: model)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Web `commands.search.noResults` — never a blank box.
    private var noResults: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                VehicleCommandCenterStrings.string("commands.search.noResults", "No commands match your search")
            ),
            systemImage: "magnifyingglass"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }
}

/// The favorites quick-actions bar (web `FavoritesBar`): a titled grid of the favorite
/// command tiles, with a friendly empty state when none are pinned (the web bar hides
/// when empty; the native surface always shows a hint, never a blank box).
struct VCCFavoritesBar: View {
    let model: VehicleCommandCenterModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "star.fill")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                VehicleCommandCenterStrings.text("commands.favorites.title", "Favorites")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
            }
            if model.favoriteCommands.isEmpty {
                Text(verbatim: VehicleCommandCenterStrings.string(
                    "commands.favorites.empty",
                    "Star a command to pin it here"
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, TSSpacing.sm)
            } else {
                VCCCommandGrid(commands: model.favoriteCommands, model: model)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// A collapsible category group (web `CollapsibleCommandGroup`): a header with the
/// category title + count that expands/collapses its command grid.
struct VCCCategoryGroupView: View {
    let group: VehicleCommandGroup
    let model: VehicleCommandCenterModel
    @State private var expanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Button {
                withAnimation(.easeInOut(duration: TSMotion.fastDuration)) { expanded.toggle() }
            } label: {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: group.category.systemImage)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    Text(verbatim: VehicleCommandCenterStrings.string(
                        group.category.labelKey,
                        group.category.labelFallback
                    ))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: "\(group.commands.count)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.xs)
                        .background(Color.TS.surfaceGlass, in: Capsule())
                    Spacer(minLength: TSSpacing.sm)
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: VehicleCommandCenterStrings.string(
                group.category.labelKey,
                group.category.labelFallback
            )))
            .accessibilityValue(Text(verbatim: "\(group.commands.count)"))
            .accessibilityHint(
                expanded
                    ? VehicleCommandCenterStrings.text("commands.group.collapse", "Collapse")
                    : VehicleCommandCenterStrings.text("commands.group.expand", "Expand")
            )

            if expanded {
                VCCCommandGrid(commands: group.commands, model: model)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

/// The responsive command tile grid (web `grid-cols-2 sm:3 lg:4`).
struct VCCCommandGrid: View {
    let commands: [VehicleCommand]
    let model: VehicleCommandCenterModel

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(commands) { command in
                VCCCommandTileView(
                    command: command,
                    isFavorite: model.isFavorite(command),
                    isOn: model.isOn(command),
                    isExecuting: model.isExecuting(command),
                    isDisabled: model.isBusy && !model.isExecuting(command),
                    statusLine: model.statusLine(for: command),
                    onActivate: { model.activate(command) },
                    onToggleFavorite: { model.toggleFavorite(command) }
                )
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Loading skeleton (web initial-fetch chrome)

/// The initial-fetch skeleton chrome: a header bar + a grid of tile-shaped skeletons,
/// respecting Reduce Motion via the shared `TSSkeleton`.
struct VCCLoadingChrome: View {
    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md, alignment: .top)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 160, height: 20)
                Spacer(minLength: TSSpacing.sm)
                TSSkeleton(width: 60, height: 14)
            }
            TSSkeleton(height: 38, cornerRadius: TSRadius.md)
            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                ForEach(0 ..< 8, id: \.self) { _ in
                    TSSkeleton(height: 92, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(VehicleCommandCenterStrings.text("commands.loading", "Loading vehicle commands"))
    }
}
