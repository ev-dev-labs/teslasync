//
//  AlertStudioPage.Editor.Behavior.swift
//  TeslaSync — P4 feature view · 0192 · AlertStudioPage (Apple)
//
//  The AlertStudioPage rule-editor lower sections (part 3): cooldown + the alert-behavior
//  force-choose + recommendation banner, the repeat-only max-fires + escalation controls,
//  the message template + include-title toggle, the test-delivery channel picker, the
//  Save/Delete/Test/Reset actions, and the snooze sheet.
//

import SwiftUI

// MARK: - Cooldown + behavior + max fires + escalation

struct ASEditorBehaviorSection: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    private var isRepeat: Bool {
        viewModel.editor.triggerMode == .repeatMode
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ASResponsivePair {
                cooldown
            } trailing: {
                behavior
            }
            if isRepeat { maxFires }
            if isRepeat { escalation }
        }
    }

    private var cooldown: some View {
        TSTextField(
            localize.key(ASCopy.editorCooldownLabel),
            text: viewModel.editorIntBinding(\.cooldownMin),
            label: localize.key(ASCopy.editorCooldownLabel)
        )
        .asNumericKeyboard()
    }

    private var behavior: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorAlertBehaviorLabel, localize: localize)
            if viewModel.showRecommendBanner { recommendBanner }
            TSSelect(
                selection: Binding(
                    get: { viewModel.editor.triggerMode },
                    set: { viewModel.handleTriggerModeChange($0) }
                ),
                options: [
                    TSSelectOption(ASTriggerSelection.unset, localize.key(ASCopy.editorAlertBehaviorChoosePrompt)),
                    TSSelectOption(ASTriggerSelection.repeatMode, localize.key(ASCopy.behaviorRepeatLabel)),
                    TSSelectOption(ASTriggerSelection.once, localize.key(ASCopy.behaviorOnceLabel))
                ]
            )
            behaviorFootnote
        }
    }

    private var recommendBanner: some View {
        let recommended = localize.string(
            viewModel.recommendedMode == .once ? ASCopy.behaviorOnceLabel : ASCopy.behaviorRepeatLabel
        )
        let alternative = localize.string(
            viewModel.recommendedMode == .once ? ASCopy.behaviorRepeatLabel : ASCopy.behaviorOnceLabel
        )
        let banner = localize.format(ASCopy.behaviorRecommendBanner, "op", viewModel.editor.op.rawValue)
            .replacingOccurrences(of: "{{recommended}}", with: recommended)
        let alt = localize.format(ASCopy.behaviorRecommendBannerAlt, "alternative", alternative)
        return TSAlertBanner(
            tone: .info,
            systemImage: "lightbulb.fill",
            title: ASView.key(banner),
            message: ASView.key(alt)
        )
    }

    @ViewBuilder
    private var behaviorFootnote: some View {
        if viewModel.triggerModeBlocked {
            TSErrorText(localize.key(ASCopy.behaviorForceChoose))
        } else if viewModel.editor.triggerMode == .once {
            TSCaption(localize.key(ASCopy.behaviorOnceDesc))
        } else if viewModel.editor.triggerMode == .repeatMode {
            TSCaption(localize.key(
                ASCopy.behaviorRepeatDesc, "cooldown", String(viewModel.editor.cooldownMin)
            ))
        }
    }

    private var maxFires: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ASFieldLabel(text: ASCopy.editorMaxFiresLabel, localize: localize)
            TSTextField(
                localize.key(ASCopy.editorMaxFiresPrompt),
                text: viewModel.editorBinding(\.maxFiresPerResolution)
            )
            .asNumericKeyboard()
            TSCaption(localize.key(ASCopy.editorMaxFiresHint))
        }
    }

    private var escalation: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSToggle(
                localize.key(ASCopy.editorEscalationCheckboxLabel),
                isOn: Binding(
                    get: { viewModel.editor.escalationEnabled },
                    set: { viewModel.handleEscalationToggle($0) }
                )
            )
            if viewModel.editor.escalationEnabled { escalationFields }
        }
    }

    private var escalationFields: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ASResponsivePair {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ASFieldLabel(text: ASCopy.editorEscalationAfterLabel, localize: localize)
                    TSTextField(
                        localize.key(ASCopy.editorEscalationAfterPrompt),
                        text: viewModel.editorBinding(\.escalationAfterMin)
                    )
                    .asNumericKeyboard()
                }
            } trailing: {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    ASFieldLabel(text: ASCopy.editorEscalationSeverityLabel, localize: localize)
                    TSSelect(selection: viewModel.editorBinding(\.escalationSeverity), options: escalationOptions)
                }
            }
            TSCaption(localize.key(ASCopy.editorEscalationHint))
        }
    }

    private var escalationOptions: [TSSelectOption<ASSeverity?>] {
        var options: [TSSelectOption<ASSeverity?>] = [
            TSSelectOption(nil, localize.key(ASCopy.editorEscalationSeverityPrompt))
        ]
        let baseRank = AlertStudioAdapter.severityRank(viewModel.editor.severity)
        let higher = ASSeverity.allCases.filter { AlertStudioAdapter.severityRank($0) > baseRank }
        for severity in higher {
            options.append(TSSelectOption(severity, localize.key(ASCopy.severityLabel(severity))))
        }
        return options
    }
}

// MARK: - Message template (web `AlertMessageEditor` controls)

struct ASMessageEditorPanel: View {
    @Bindable var viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSTextArea(
                text: viewModel.editorBinding(\.msgTemplate),
                label: localize.key(ASCopy.editorMessageTemplateLabel)
            )
            TSToggle(
                localize.key(ASCopy.editorIncludeTitleLabel),
                isOn: viewModel.editorBinding(\.includeTitle)
            )
            TSHelperText(localize.key(ASCopy.editorMessageHelp))
        }
    }
}

// MARK: - Test delivery target (web channels picker)

struct ASTestTargetSection: View {
    let viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ASFieldLabel(text: ASCopy.channelsTestTargetLabel, localize: localize)
            alwaysOnRow(ASCopy.channelsBrowserToast)
            alwaysOnRow(ASCopy.channelsAlertHistory)
            TSGlassPanel { channelsBody }
        }
    }

    private func alwaysOnRow(_ text: ASText) -> some View {
        HStack(spacing: TSSpacing.sm) {
            TSStatusDot(tone: .success)
            Text(localize.key(text)).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
            Spacer(minLength: 0)
        }
    }

    @ViewBuilder
    private var channelsBody: some View {
        switch viewModel.channelsModel.presentation {
        case .loading:
            channelsLoading
        case let .error(retryable):
            TSErrorDisplay(
                title: localize.key(ASCopy.channelsErrorTitle),
                onRetry: retryable ? { viewModel.channelsModel.refresh() } : nil
            )
        case .offlineNoData:
            TSCaption(localize.key(ASCopy.stateOfflineMessage))
        case .empty:
            channelsEmpty
        case let .content(channels, _, _):
            channelChips(channels)
        }
    }

    private var channelsLoading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 200, height: 14)
            TSSkeleton(height: 32, cornerRadius: TSRadius.md)
        }
    }

    private var channelsEmpty: some View {
        TSEmptyState(
            title: localize.key(ASCopy.channelsEmptyTitle),
            message: localize.key(ASCopy.channelsEmptyDescription),
            systemImage: "bell.slash"
        )
    }

    private func channelChips(_ channels: [ASNotificationChannel]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSCaption(localize.key(ASCopy.channelsExternalChannels))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.sm) {
                    ForEach(channels) { channel in
                        channelChip(channel)
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private func channelChip(_ channel: ASNotificationChannel) -> some View {
        let isSelected = viewModel.isTestChannelSelected(channel.id)
        let kind = localize.string(ASCopy.channelKindLabel(channel.kind))
        return Button {
            viewModel.toggleTestChannel(channel.id)
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "bell").font(.system(size: 11))
                Text(verbatim: "\(channel.name) (\(kind))").font(Font.TS.caption)
            }
            .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(isSelected ? Color.TS.accent.opacity(0.12) : Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(
                isSelected ? Color.TS.accent.opacity(0.3) : Color.TS.border, lineWidth: 1
            ))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Action row (web Save / Delete / Test / Reset)

struct ASEditorActions: View {
    let viewModel: AlertStudioViewModel
    private var localize: ASLocalizer {
        viewModel.localize
    }

    private var saveLabel: ASText {
        if viewModel.savePending { return ASCopy.actionsSaving }
        return viewModel.isEditing ? ASCopy.actionsUpdateRule : ASCopy.actionsCreateRule
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Divider().overlay(Color.TS.border)
            HStack(spacing: TSSpacing.sm) {
                TSButton(
                    localize.key(saveLabel),
                    variant: .primary,
                    size: .small,
                    isLoading: viewModel.savePending,
                    action: { viewModel.save() }
                )
                .disabled(!viewModel.canSave)

                if viewModel.isEditing, let id = viewModel.editor.id {
                    TSButton(localize.key(ASCopy.actionsDelete), variant: .destructive, size: .small) {
                        viewModel.performDelete(id: id)
                    }
                }

                TSButton(
                    localize.key(ASCopy.actionsTest),
                    variant: .secondary,
                    size: .small,
                    isLoading: viewModel.testPending,
                    action: { viewModel.test() }
                )
                .disabled(viewModel.editor.name.trimmingCharacters(in: .whitespaces).isEmpty)

                Spacer(minLength: 0)
                TSButton(localize.key(ASCopy.actionsReset), variant: .ghost, size: .small) {
                    viewModel.requestNewRule()
                }
            }
        }
    }
}

// MARK: - Snooze sheet (web `Modal`)

struct ASSnoozeSheet: View {
    let viewModel: AlertStudioViewModel
    let rule: ASAlertRule
    private var localize: ASLocalizer {
        viewModel.localize
    }

    private var displayName: String {
        rule.name.isEmpty ? localize.string(ASCopy.untitled) : rule.name
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack {
                Text(ASView.key(localize.format(ASCopy.snoozeTitle, "name", displayName)))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button {
                    viewModel.snoozeTargetID = nil
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(localize.key(ASCopy.commonCancel)))
            }
            Text(localize.key(ASCopy.snoozeDescription))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            if viewModel.snoozeTargetActive, let snoozedUntil = rule.snoozedUntil {
                let time = viewModel.dates.dateTime(snoozedUntil)
                TSAlertBanner(
                    tone: .warning,
                    systemImage: "moon.stars.fill",
                    title: localize.key(ASCopy.snoozeCurrentlySnoozed, "time", time)
                )
            }
            buttons
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.bg.ignoresSafeArea())
    }

    private var buttons: some View {
        VStack(spacing: TSSpacing.sm) {
            snoozeButton(ASCopy.snooze1h, minutes: 60)
            snoozeButton(ASCopy.snooze4h, minutes: 240)
            snoozeButton(ASCopy.snooze24h, minutes: 1440)
            if viewModel.snoozeTargetActive {
                TSButton(localize.key(ASCopy.snoozeCancel), variant: .ghost) {
                    viewModel.snooze(id: rule.id, minutes: 0)
                }
            }
        }
    }

    private func snoozeButton(_ text: ASText, minutes: Int) -> some View {
        TSButton(
            localize.key(text),
            variant: .secondary,
            isLoading: viewModel.snoozePending,
            action: { viewModel.snooze(id: rule.id, minutes: minutes) }
        )
    }
}
