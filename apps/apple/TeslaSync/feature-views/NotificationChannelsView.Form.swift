//
//  NotificationChannelsView.Form.swift
//  TeslaSync — P4 feature view · 0188 · NotificationChannelsView (Apple)
//
//  The add/edit channel form — the SwiftUI parity of the web `ChannelFormModal`. The
//  `ChannelFormModel` (@Observable) owns the form's local state (kind, name, enabled,
//  per-field config, validation error, inline test outcome) exactly like the web
//  component's `useState` cluster, and drives `useSaveChannel` / `useTestChannel` through
//  the shared P1/S8 source seam. `NotificationChannelForm` renders it through the shared
//  P1/S9 tokens + components; no networking, no Tailwind ports, no raw hex.
//

import Observation
import SwiftUI

// MARK: - Inline test outcome (web `testResult`)

/// The inline test outcome shown in the form (web `testResult: { success, message }`).
public struct ChannelFormTestOutcome: Equatable, Sendable {
    public let success: Bool
    public let message: String

    public init(success: Bool, message: String) {
        self.success = success
        self.message = message
    }
}

// MARK: - Form view-model (web `ChannelFormModal` state)

/// The add/edit form's observable state — the native port of the web `ChannelFormModal`
/// `useState` cluster (`kind`, `name`, `enabled`, `config`, `formError`, `testResult`)
/// plus the two pending flags. Drives save/test through the shared source seam.
@MainActor
@Observable
public final class ChannelFormModel: Identifiable {
    public let id = UUID()
    public var kind: NotifChannelKind
    public var name: String
    public var enabled: Bool
    public private(set) var config: [String: String]
    public private(set) var formErrorMessage: String?
    public private(set) var testOutcome: ChannelFormTestOutcome?
    public private(set) var isSaving = false
    public private(set) var isTesting = false

    /// Web `isEdit = !!channel`.
    public let isEdit: Bool

    @ObservationIgnored private let editingID: Int64?
    @ObservationIgnored private let source: any NotificationChannelsSource
    @ObservationIgnored private let onSaved: () -> Void

    public init(
        source: any NotificationChannelsSource,
        editing channel: NotificationChannelData?,
        onSaved: @escaping () -> Void
    ) {
        self.source = source
        self.onSaved = onSaved
        isEdit = channel != nil
        editingID = channel?.id
        kind = channel?.kind ?? .discord
        name = channel?.name ?? ""
        enabled = channel?.enabled ?? true
        config = channel?.configMap ?? [:]
    }

    /// The selected kind's localized label (web `meta.label`).
    public var kindLabel: String {
        NotifChannelsStrings.string(kind.labelKey, kind.labelFallback)
    }

    /// Web `onClick={() => { setKind(ct.value); setConfig({}); setTestResult(null); }}`.
    public func selectKind(_ next: NotifChannelKind) {
        guard !isEdit else { return }
        kind = next
        config = [:]
        testOutcome = nil
    }

    /// A two-way binding for one config field's value.
    public func fieldBinding(_ key: String) -> Binding<String> {
        Binding(
            get: { [weak self] in self?.config[key] ?? "" },
            set: { [weak self] newValue in self?.config[key] = newValue }
        )
    }

    // MARK: Actions

    /// Web `handleSubmit`: validate, build the payload, save, then `onSaved`.
    public func submit() async {
        formErrorMessage = nil
        testOutcome = nil
        if let error = ChannelFormValidation.nameError(name) {
            formErrorMessage = NotifChannelsStrings.string(error.key, error.fallback)
            return
        }
        let payload = ChannelPayloadBuilder.build(
            kind: kind,
            name: name,
            enabled: enabled,
            rawConfig: config,
            id: editingID
        )
        isSaving = true
        defer { isSaving = false }
        do {
            try await source.save(payload)
            onSaved()
        } catch {
            formErrorMessage = NotifChannelsStrings.string(
                "notifications.channels.saveFailed",
                "Failed to save channel"
            )
        }
    }

    /// Web `handleTest`: only when editing; surfaces the inline outcome.
    public func test() async {
        guard isEdit, let editingID else { return }
        isTesting = true
        defer { isTesting = false }
        do {
            let result = try await source.test(editingID)
            if result.success {
                testOutcome = ChannelFormTestOutcome(
                    success: true,
                    message: NotifChannelsStrings.string(
                        "notifications.channels.testSuccess",
                        "Test notification sent successfully!"
                    )
                )
            } else {
                let failed = NotifChannelsStrings.string("notifications.channels.testFailed", "Test failed")
                testOutcome = ChannelFormTestOutcome(success: false, message: result.error ?? failed)
            }
        } catch {
            testOutcome = ChannelFormTestOutcome(
                success: false,
                message: NotifChannelsStrings.string("notifications.channels.testFailed", "Test failed")
            )
        }
    }
}

// MARK: - Form view (web `ChannelFormModal` body)

/// The add/edit channel form content, rendered inside the surface's modal sheet.
struct NotificationChannelForm: View {
    @Bindable var model: ChannelFormModel
    let onCancel: () -> Void

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                if !model.isEdit {
                    typePicker
                }
                nameField
                configSection
                enabledToggle
                if let outcome = model.testOutcome {
                    ChannelTestOutcomeBanner(outcome: outcome)
                }
                if let error = model.formErrorMessage {
                    TSErrorText(LocalizedStringKey(error))
                }
                buttonRow
            }
        }
    }

    // MARK: Type picker (web channel-type grid)

    private var typePicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSLabel(LocalizedStringKey(NotifChannelsStrings.string("notifications.channels.typeLabel", "Channel Type")))
            LazyVGrid(columns: Self.typeColumns, spacing: TSSpacing.sm) {
                ForEach(NotifChannelKind.allCases) { kind in
                    ChannelTypeTile(kind: kind, selected: kind == model.kind) {
                        model.selectKind(kind)
                    }
                }
            }
        }
    }

    private static let typeColumns = [GridItem(.adaptive(minimum: 96), spacing: TSSpacing.sm)]

    // MARK: Name + config

    private var nameField: some View {
        TSTextField(
            LocalizedStringKey(namePrompt),
            text: $model.name,
            label: LocalizedStringKey(NotifChannelsStrings.string("notifications.channels.nameLabel", "Channel Name"))
        )
    }

    private var namePrompt: String {
        let key = "notifications.channels.namePlaceholderPrefix" // parity:allow web i18n key, not a stub
        let prefix = NotifChannelsStrings.string(key, "My")
        return "\(prefix) \(model.kindLabel)"
    }

    private var configSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Text(verbatim: configTitle)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            ForEach(model.kind.fields) { field in
                ChannelConfigField(field: field, value: model.fieldBinding(field.key))
            }
            Text(verbatim: NotifChannelsStrings.string(
                "notifications.channels.testHint",
                "Save then click \"Send Test\" to verify the configuration."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var configTitle: String {
        let label = NotifChannelsStrings.string("notifications.channels.configLabel", "Configuration")
        return "\(model.kindLabel) \(label)"
    }

    private var enabledToggle: some View {
        let key = model.enabled ? "notifications.channels.enabled" : "notifications.channels.disabled"
        let fallback = model.enabled ? "Enabled" : "Disabled"
        return TSToggle(LocalizedStringKey(NotifChannelsStrings.string(key, fallback)), isOn: $model.enabled)
    }

    // MARK: Buttons (web Test / Cancel / Save row)

    private var buttonRow: some View {
        HStack(spacing: TSSpacing.md) {
            if model.isEdit {
                testButton
            }
            Spacer(minLength: 0)
            TSButton(
                LocalizedStringKey(NotifChannelsStrings.string("common.cancel", "Cancel")),
                variant: .ghost,
                action: onCancel
            )
            saveButton
        }
        .padding(.top, TSSpacing.xs)
    }

    private var testButton: some View {
        let title = model.isTesting
            ? NotifChannelsStrings.string("notifications.channels.testing", "Testing…")
            : NotifChannelsStrings.string("notifications.channels.test", "Test Connection")
        return TSButton(variant: .secondary, isLoading: model.isTesting) {
            Task { await model.test() }
        } label: {
            Label {
                Text(verbatim: title)
            } icon: {
                Image(systemName: "testtube.2")
            }
        }
        .accessibilityLabel(Text(verbatim: title))
    }

    private var saveButton: some View {
        let title = saveTitle
        return TSButton(variant: .primary, isLoading: model.isSaving) {
            Task { await model.submit() }
        } label: {
            Text(verbatim: title)
        }
        .accessibilityLabel(Text(verbatim: title))
    }

    private var saveTitle: String {
        if model.isSaving {
            return NotifChannelsStrings.string("common.saving", "Saving…")
        }
        return model.isEdit
            ? NotifChannelsStrings.string("common.update", "Update")
            : NotifChannelsStrings.string("common.create", "Create")
    }
}

// MARK: - Form pieces

/// One selectable channel-type tile (web channel-type grid cell).
struct ChannelTypeTile: View {
    let kind: NotifChannelKind
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        let tint = TSChartPalette.color(at: kind.paletteIndex)
        Button(action: onTap) {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: kind.systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(selected ? tint : Color.TS.textSecondary)
                Text(verbatim: NotifChannelsStrings.string(kind.labelKey, kind.labelFallback))
                    .font(Font.TS.caption)
                    .foregroundStyle(selected ? tint : Color.TS.textSecondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.md)
            .background(
                selected ? tint.opacity(0.12) : Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(selected ? tint.opacity(0.4) : Color.TS.border, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel(Text(verbatim: NotifChannelsStrings.string(kind.labelKey, kind.labelFallback)))
    }
}

/// One config input — a masked secure field for secrets, else a plain text field.
struct ChannelConfigField: View {
    let field: NotificationChannelField
    @Binding var value: String

    var body: some View {
        let label = LocalizedStringKey(NotifChannelsStrings.string(field.labelKey, field.labelFallback))
        Group {
            if field.secure {
                TSSecureField(LocalizedStringKey(field.example), text: $value, label: label)
            } else {
                TSTextField(LocalizedStringKey(field.example), text: $value, label: label)
            }
        }
    }
}

/// The inline test-result banner (web `testResult` panel: green success / red failure).
struct ChannelTestOutcomeBanner: View {
    let outcome: ChannelFormTestOutcome

    var body: some View {
        let tone: Color = outcome.success ? Color.TS.statusSuccess : Color.TS.statusDanger
        return HStack(spacing: TSSpacing.sm) {
            Image(systemName: outcome.success ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(tone)
            Text(verbatim: outcome.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(tone)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(tone.opacity(0.2), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
