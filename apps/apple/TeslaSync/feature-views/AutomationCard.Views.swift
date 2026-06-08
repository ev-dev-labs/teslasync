//
//  AutomationCard.Views.swift
//  TeslaSync — P4 feature view · 0082 · AutomationCard (Apple)
//
//  The presentational subviews of the loaded AutomationCard — the native port of
//  the web card's header (name + status badge + firing chip + description), the
//  trailing controls (pin + toggle + kebab menu), the vehicle row, the stat row,
//  the auto-disabled warning, and the conflict list. Each piece reads its copy
//  through the injected `AutomationCardLocalizer`; no English is hardcoded. The
//  load/empty/error chrome + the card container live in `AutomationCard.swift`.
//

import SwiftUI

// MARK: - Header (name + status badge + firing chip + description)

struct AutomationCardHeader: View {
    let data: AutomationCardData
    let status: AutomationStatus
    let chip: AutomationFreshnessChip?
    let localize: AutomationCardLocalizer

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: data.name)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                TSBadge(LocalizedStringKey(status.labelKey), tone: status.tone)
                if let chip {
                    AutomationFiringChip(chip: chip, localize: localize)
                }
            }
            if let description = data.description, !description.isEmpty {
                Text(verbatim: description)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityLabel(Text(verbatim: AutomationCardAccessibility.headerLabel(
            data, status: status, chip: chip, localize: localize
        )))
    }
}

// MARK: - Firing / freshness chip (web `Firing` pulse)

struct AutomationFiringChip: View {
    let chip: AutomationFreshnessChip
    let localize: AutomationCardLocalizer

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: chip.systemImage)
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: localize.string(chip.labelKey, chip.labelFallback))
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(chip.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(chip.tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(chip.tone.color.opacity(0.25), lineWidth: 1))
        .opacity(shouldPulse && pulse ? 0.45 : 1)
        .animation(
            shouldPulse ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : nil,
            value: pulse
        )
        .onAppear { if shouldPulse { pulse = true } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: localize.string(chip.labelKey, chip.labelFallback)))
    }

    private var shouldPulse: Bool {
        chip.showsLivePulse && !reduceMotion
    }
}

private extension AutomationFreshnessChip {
    var showsLivePulse: Bool {
        self == .firing
    }
}

// MARK: - Trailing controls (pin + toggle + kebab menu)

struct AutomationCardControls: View {
    let data: AutomationCardData
    let actions: AutomationCardActions
    let localize: AutomationCardLocalizer
    let onRequestDelete: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            pinButton
            toggle
            menu
        }
    }

    private var pinButton: some View {
        Button { actions.onTogglePin(data.id) } label: {
            Image(systemName: data.isPinned ? "pin.fill" : "pin")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(data.isPinned ? Color.TS.accent : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: localize.string(
            data.isPinned ? "automations.unpin" : "automations.pin",
            data.isPinned ? "Unpin" : "Pin"
        )))
    }

    private var toggle: some View {
        Toggle(isOn: toggleBinding) { EmptyView() }
            .labelsHidden()
            .tint(Color.TS.accent)
            .accessibilityLabel(Text(verbatim: AutomationCardAccessibility.toggleLabel(localize)))
    }

    private var menu: some View {
        Menu {
            ForEach(AutomationMenuItemKind.items(autoDisabled: data.autoDisabled), id: \.self) { item in
                menuButton(item)
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .accessibilityLabel(Text(verbatim: AutomationCardAccessibility.menuLabel(localize)))
    }

    private func menuButton(_ item: AutomationMenuItemKind) -> some View {
        Button(role: item.role == .destructive ? .destructive : nil) {
            handle(item)
        } label: {
            Label(LocalizedStringKey(item.labelKey), systemImage: item.systemImage)
        }
    }

    private var toggleBinding: Binding<Bool> {
        Binding(
            get: { AutomationToggleIntent.displayedChecked(data) },
            set: { actions.dispatchToggle(AutomationToggleIntent.resolve(data, checked: $0)) }
        )
    }

    private func handle(_ item: AutomationMenuItemKind) {
        switch item {
        case .testRun: actions.onTestRun(data.id)
        case .reEnable: actions.onReEnable(data.id)
        case .duplicate: actions.onDuplicate(data.id)
        case .export: actions.onExport(data.id)
        case .delete: onRequestDelete()
        }
    }
}

// MARK: - Vehicle row (web vehicle name / "All vehicles")

struct AutomationVehicleRow: View {
    let data: AutomationCardData
    let localize: AutomationCardLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let vehicleName = data.vehicleName, !vehicleName.isEmpty {
                Image(systemName: "car.fill").font(.system(size: 11))
                Text(verbatim: vehicleName)
            } else {
                Text(verbatim: localize.string("automations.allVehicles", "All vehicles"))
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Stat row (last run / runs / fails / next fire)

struct AutomationStatRow: View {
    let data: AutomationCardData
    let now: Date
    let localize: AutomationCardLocalizer

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            lastRun
            separator
            Text(verbatim: runsText)
            if data.failureCount > 0 {
                separator
                fails
            }
            if let nextFire = nextFireText {
                separator
                Text(verbatim: nextFire).foregroundStyle(Color.TS.accent)
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textSecondary)
        .accessibilityElement(children: .combine)
    }

    private var lastRun: some View {
        HStack(spacing: TSSpacing.xs) {
            if data.lastTriggeredAt != nil {
                Image(systemName: "checkmark.circle.fill").foregroundStyle(Color.TS.statusSuccess)
                Text(verbatim: lastRunText)
            } else {
                Image(systemName: "forward.end.fill").foregroundStyle(Color.TS.textMuted)
                Text(verbatim: localize.string("automations.neverRun", "Never run"))
            }
        }
    }

    private var fails: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "xmark.circle.fill")
            Text(verbatim: failsText)
        }
        .foregroundStyle(Color.TS.statusDanger)
    }

    private var separator: some View {
        Text(verbatim: "·").foregroundStyle(Color.TS.textMuted)
    }

    private var lastRunText: String {
        let label = localize.string("automations.lastRun", "Last")
        let ago = AutomationTimeFormat.timeAgo(data.lastTriggeredAt, now: now, localize: localize)
        return "\(label): \(ago)"
    }

    private var runsText: String {
        "\(localize.string("automations.runs", "Runs")): \(data.executionCount)"
    }

    private var failsText: String {
        "\(localize.string("automations.fails", "Fails")): \(data.failureCount)"
    }

    private var nextFireText: String? {
        guard let nextFireTime = data.nextFireTime, !nextFireTime.isEmpty else { return nil }
        let label = localize.string("automations.nextFire", "Next")
        let when = AutomationTimeFormat.dateTime(nextFireTime, localize: localize)
        return "\(label): \(when)"
    }
}

// MARK: - Auto-disabled warning + conflicts

struct AutomationWarningBanner: View {
    let reason: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
            Text(verbatim: reason).font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.statusDanger.opacity(0.1), in: RoundedRectangle(
            cornerRadius: TSRadius.sm, style: .continuous
        ))
        .accessibilityElement(children: .combine)
    }
}

struct AutomationConflictsList: View {
    let conflicts: [AutomationConflictData]
    let localize: AutomationCardLocalizer

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(conflicts) { conflict in
                AutomationConflictRow(conflict: conflict, localize: localize)
            }
        }
    }
}

struct AutomationConflictRow: View {
    let conflict: AutomationConflictData
    let localize: AutomationCardLocalizer

    var body: some View {
        let tone = AutomationConflictSeverity.project(conflict.severity).tone
        return HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 11))
            Text(verbatim: text).font(Font.TS.caption)
        }
        .foregroundStyle(tone.color)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, 6)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var text: String {
        let prefix = localize.string("automations.conflictWith", "Conflict with")
        return "\(prefix) \"\(conflict.automationName)\" — \(conflict.reason)"
    }
}
