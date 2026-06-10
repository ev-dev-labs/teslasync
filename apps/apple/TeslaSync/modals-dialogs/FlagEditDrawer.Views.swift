//
//  FlagEditDrawer.Views.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  The presented drawer + populated form for `FlagEditDrawer`: the drawer card shell (web `Drawer`
//  surface with a title header + footer), the always-on header (title + freshness chip + close), and
//  the `.content` body — the key panel (read-only + immutable note in edit mode), the JSON value
//  panel (prompt + parse-error helper), the reason panel, and the Cancel / Save footer. Each
//  field sits in its own `TSGlassPanel` (web `GlassPanel className="p-4"`). The loading / empty /
//  error envelopes + freshness chip / banner live in FlagEditDrawer.States.swift. All copy resolves
//  through the P1/S10 facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Drawer shell (web `Drawer` surface)

/// The presented drawer: the always-on header, an optional cached-data banner, and the phase body —
/// in a bordered surface card (web `Drawer` panel). Every phase renders real chrome under the header
/// so the drawer is never a blank box (engineering guideline #6).
struct FlagEditDrawerPanel: View {
    @Bindable var model: FlagEditDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            FlagEditDrawerHeader(title: model.titleText, connection: model.connection) { model.dismiss() }
            if model.connection != .live {
                FlagEditDrawerConnectivityBanner(connection: model.connection)
            }
            body(for: model.phase)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 480, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }

    /// The web drawer body under the header: the populated form for `.content`, else the loading /
    /// empty / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: FlagEditPhase) -> some View {
        switch phase {
        case .loading:
            FlagEditDrawerLoadingState()
        case .empty:
            FlagEditDrawerEmptyState()
        case let .error(message):
            FlagEditDrawerErrorState(message: message) { model.refresh() }
        case .content:
            FlagEditDrawerContent(model: model)
        }
    }
}

// MARK: - Header (web Drawer title + close)

/// The drawer header: the resolved title, the freshness chip, and the trailing close button (web
/// `Drawer` close "×" → `onClose`).
struct FlagEditDrawerHeader: View {
    let title: String
    let connection: FlagEditConnection
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                FlagEditDrawerFreshnessChip(connection: connection)
            }
            Spacer(minLength: TSSpacing.sm)
            closeButton
        }
        .accessibilityElement(children: .contain)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(FlagEditDrawerStrings.text("flagEdit.close", "Close"))
    }
}

// MARK: - Content (web populated form)

/// The `.content` body: the inline reload error (when a refresh failed while a cached request
/// remains), the key / value / reason field panels, and the Cancel / Save footer.
struct FlagEditDrawerContent: View {
    @Bindable var model: FlagEditDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                FlagEditDrawerInlineError(message: message)
            }
            FlagEditKeyField(model: model)
            FlagEditValueField(model: model)
            FlagEditReasonField(model: model)
            FlagEditDrawerActions(
                cancelLabel: model.cancelLabelText,
                saveLabel: model.saveLabelText,
                saving: model.isSaving,
                canSave: model.canSave,
                onCancel: { model.cancel() },
                onSave: { model.save() }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Field label (web `Input label` + `required`)

/// A required-aware field label. The asterisk is the native parity of the web `required` marker and
/// is hidden from VoiceOver (the combined field label already announces the field name).
struct FlagEditFieldLabel: View {
    let text: String
    var required = true

    var body: some View {
        HStack(spacing: 2) {
            Text(verbatim: text)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            if required {
                Text(verbatim: "*")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
            }
        }
    }
}

// MARK: - Key field (web `Input` — disabled when editing)

/// The flag-key field (web `Input`): read-only in edit mode (web `disabled={editing}`) with the
/// immutability note below, editable in create mode with the example prompt.
struct FlagEditKeyField: View {
    @Bindable var model: FlagEditDrawerModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                FlagEditFieldLabel(text: model.keyLabelText)
                TextField(text: $model.keyInput) { Text(verbatim: model.keyPromptText) }
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .autocorrectionDisabled(true)
                    .flagEditNoAutocapitalization()
                    .disabled(model.keyDisabled)
                    .modifier(FlagEditFieldChrome(hasError: false))
                    .opacity(model.keyDisabled ? 0.6 : 1)
                if model.showsImmutableNote {
                    Text(verbatim: model.immutableNoteText)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: model.keyFieldAccessibilityLabel))
        }
    }
}

// MARK: - Value field (web `Textarea` — JSON with parse error)

/// The JSON value field (web `Textarea`): a multi-line editor with a prompt hint and the
/// parse-error helper below (web `error={parsed.ok ? undefined : parsed.error}`), disabled while a
/// save is in flight.
struct FlagEditValueField: View {
    @Bindable var model: FlagEditDrawerModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                FlagEditFieldLabel(text: model.valueLabelText)
                editor
                if let error = model.valueErrorMessage {
                    Text(verbatim: error)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: model.valueFieldAccessibilityLabel))
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if model.valueInput.isEmpty {
                Text(verbatim: model.valuePromptText)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .padding(.horizontal, TSSpacing.sm + 1)
                    .padding(.vertical, TSSpacing.sm)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $model.valueInput)
                .font(Font.TS.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 140)
                .autocorrectionDisabled(true)
                .flagEditNoAutocapitalization()
                .disabled(model.isSaving)
        }
        .modifier(FlagEditFieldChrome(hasError: model.valueErrorMessage != nil))
        .opacity(model.isSaving ? 0.6 : 1)
    }
}

// MARK: - Reason field (web `Input` — required audit reason)

/// The audit-reason field (web `Input`): required free text logged with the change, disabled while a
/// save is in flight.
struct FlagEditReasonField: View {
    @Bindable var model: FlagEditDrawerModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                FlagEditFieldLabel(text: model.reasonLabelText)
                TextField(text: $model.reason) { Text(verbatim: model.reasonPromptText) }
                    .textFieldStyle(.plain)
                    .font(Font.TS.body)
                    .disabled(model.isSaving)
                    .modifier(FlagEditFieldChrome(hasError: false))
                    .opacity(model.isSaving ? 0.6 : 1)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: model.reasonFieldAccessibilityLabel))
        }
    }
}

// MARK: - Footer (web Cancel / Save)

/// The footer actions: the secondary "Cancel" (disabled while saving) and the primary "Save flag"
/// (disabled until the save gate opens, spinner while saving) — web `Button variant=secondary/primary`.
struct FlagEditDrawerActions: View {
    let cancelLabel: String
    let saveLabel: String
    let saving: Bool
    let canSave: Bool
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .secondary, size: .small, action: onCancel) {
                Text(verbatim: cancelLabel)
            }
            .disabled(saving)
            .accessibilityLabel(Text(verbatim: cancelLabel))
            TSButton(variant: .primary, size: .small, isLoading: saving, action: onSave) {
                Text(verbatim: saveLabel)
            }
            .disabled(!canSave)
            .accessibilityLabel(Text(verbatim: saveLabel))
        }
    }
}

// MARK: - Field chrome + helpers

/// Shared field chrome: token surface, rounded border (red when errored) — the parity of the web
/// `Input` / `Textarea` border treatment.
private struct FlagEditFieldChrome: ViewModifier {
    let hasError: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(hasError ? Color.TS.statusDanger : Color.TS.border, lineWidth: 1)
            )
    }
}

extension FlagEditDrawerStrings {
    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are never
    /// re-localized.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

private extension View {
    /// Disables autocapitalization where the platform supports it (iOS), a no-op on macOS, so the
    /// flag key + JSON value never auto-capitalize.
    @ViewBuilder
    func flagEditNoAutocapitalization() -> some View {
        #if os(iOS)
            textInputAutocapitalization(.never)
        #else
            self
        #endif
    }
}
