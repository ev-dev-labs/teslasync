import SwiftUI

// The per-automation card the `AutomationsListPage` lists (native parity of the web
// `AutomationCard`, composed here by the list page). Reproduces the header (name + status badge
// + firing chip + pin/toggle/actions menu), the vehicle row, the run-stats row, the
// auto-disabled reason callout, and the conflict callouts. Token-driven; every string resolves
// from `Localizable.xcstrings`; all actions route to the bound `@Observable` model.

struct AutomationCardView: View {
    let item: AutomationListItem
    let vehicleName: String?
    let isFiring: Bool
    let isPinned: Bool
    let onToggle: (Bool) -> Void
    let onTestRun: () -> Void
    let onReEnable: () -> Void
    let onDelete: () -> Void
    let onTogglePin: () -> Void

    @State private var confirmingDelete = false

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            vehicleRow
            statsRow
            if item.autoDisabled, let reason = item.autoDisabledReason {
                AutomationInlineCallout(text: reason, severity: .warning, systemImage: "exclamationmark.triangle.fill")
            }
            ForEach(item.conflicts) { conflict in
                AutomationConflictCallout(conflict: conflict)
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .overlay(cardEmphasis)
        .confirmationDialog(
            Text("automations.deleteTitle"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) { onDelete() } label: { Text("automations.deleteConfirm") }
            Button(role: .cancel) {} label: { Text("common.cancel") }
        } message: {
            Text(verbatim: deleteMessage)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: item.name))
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: item.name)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .lineLimit(1)
                    TSBadge(LocalizedStringKey(item.status.labelKey), tone: statusTone)
                    if isFiring { firingChip }
                }
                if let description = item.description {
                    Text(verbatim: description)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            controls
        }
    }

    private var controls: some View {
        HStack(spacing: TSSpacing.sm) {
            Button(action: onTogglePin) {
                Image(systemName: isPinned ? "pin.fill" : "pin")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isPinned ? Color.TS.accent : Color.TS.textMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(isPinned ? "automations.unpin" : "automations.pin"))

            Toggle(isOn: toggleBinding) { EmptyView() }
                .labelsHidden()
                .tint(Color.TS.accent)
                .accessibilityLabel(Text("automations.toggleLabel"))

            menu
        }
    }

    private var menu: some View {
        Menu {
            Button(action: onTestRun) { Label("automations.testRun", systemImage: "play.fill") }
            if item.autoDisabled {
                Button(action: onReEnable) { Label("automations.reEnable", systemImage: "arrow.counterclockwise") }
            }
            // Duplicate / Export mirror the web menu, whose handlers only dismiss the menu.
            Button {} label: { Label("automations.duplicate", systemImage: "doc.on.doc") }
            Button {} label: { Label("automations.export", systemImage: "square.and.arrow.down") }
            Button(role: .destructive) { confirmingDelete = true } label: {
                Label("automations.delete", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 32, height: 32)
                .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel(Text("automations.menu"))
    }

    private var firingChip: some View {
        HStack(spacing: 2) {
            Image(systemName: "bolt.fill").font(.system(size: 10, weight: .bold))
            Text("automations.firing").font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.accent)
        .accessibilityElement(children: .combine)
    }

    // MARK: Vehicle row

    private var vehicleRow: some View {
        HStack(spacing: TSSpacing.xs) {
            if let vehicleName {
                Image(systemName: "car.fill").font(.system(size: 11)).foregroundStyle(Color.TS.textMuted)
                Text(verbatim: vehicleName)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            } else {
                Text("automations.allVehicles")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }

    // MARK: Stats row

    private var statsRow: some View {
        HStack(spacing: TSSpacing.md) {
            lastRunChip
            statChip(labelKey: "automations.runs", value: "\(item.executionCount)", tone: Color.TS.textSecondary)
            if item.showsFailures {
                statChip(
                    labelKey: "automations.fails",
                    value: "\(item.failureCount)",
                    tone: Color.TS.statusDanger,
                    systemImage: "xmark.circle.fill"
                )
            }
            if let next = AutomationListFormat.dateTime(item.nextFireTime) {
                statChip(labelKey: "automations.nextFire", value: next, tone: Color.TS.accent)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var lastRunChip: some View {
        HStack(spacing: TSSpacing.xs) {
            if item.lastTriggeredAt != nil {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 11)).foregroundStyle(Color.TS.statusSuccess)
                Text("automations.lastRun").font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                Text(verbatim: item.lastRunText).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            } else {
                Image(systemName: "forward.end.fill")
                    .font(.system(size: 11)).foregroundStyle(Color.TS.textMuted)
                Text("automations.neverRun").font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private func statChip(
        labelKey: LocalizedStringKey,
        value: String,
        tone: Color,
        systemImage: String? = nil
    ) -> some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage).font(.system(size: 11)).foregroundStyle(tone)
            }
            Text(labelKey).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value).font(Font.TS.caption).foregroundStyle(tone)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Helpers

    private var toggleBinding: Binding<Bool> {
        Binding(get: { item.toggleIsOn }, set: { onToggle($0) })
    }

    private var statusTone: TSTone {
        switch item.status {
        case .active: .success
        case .disabled: .neutral
        case .autoDisabled: .danger
        }
    }

    @ViewBuilder private var cardEmphasis: some View {
        if isFiring {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.5), lineWidth: 2)
        } else if item.autoDisabled {
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.35), lineWidth: 1)
        }
    }

    private var deleteMessage: String {
        let template = String(localized: "automations.deleteMessage")
        return String(format: template, item.name)
    }
}

/// A tinted inline callout (web `bg-{tone}-500/10` rows) used for the auto-disabled reason and
/// the conflict warnings.
struct AutomationInlineCallout: View {
    let text: String
    let severity: AutomationConflictInfo.Severity
    var systemImage = "exclamationmark.triangle.fill"

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage).font(.system(size: 12)).foregroundStyle(tone)
            Text(verbatim: text).font(Font.TS.caption).foregroundStyle(tone)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var tone: Color {
        severity == .warning ? Color.TS.statusWarning : Color.TS.statusInfo
    }
}

/// One conflict callout (web `Conflict with "{name}" — {reason}`).
struct AutomationConflictCallout: View {
    let conflict: AutomationConflictInfo

    var body: some View {
        AutomationInlineCallout(text: text, severity: conflict.severity)
    }

    private var text: String {
        let template = String(localized: "automations.conflictWith")
        return String(format: template, conflict.automationName, conflict.reason)
    }
}
