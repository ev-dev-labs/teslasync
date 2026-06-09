//
//  ResetSection.Chrome.swift
//  TeslaSync — P4 feature view · 0212 · ResetSection (Apple)
//
//  The surface's state + feedback chrome, split out of the panels: the section-list status
//  banner (the P4 states contract — error / stale / offline), the per-section destructive
//  confirmation sheet (web `ConfirmDialog variant="danger"`), the danger-zone typed-"RESET"
//  confirmation sheet (web `requireTypedConfirmation="RESET"`), the auto-dismissing toast
//  (web `useToast`), and the loading skeleton. All consume the P1/S10 facade + the shared
//  P1/S9 tokens; no networking, no Tailwind.
//

import SwiftUI

// MARK: - Status banner (the P4 states contract: error / stale / offline)

/// The section-list status banner shown above the panels when the list is failed, offline,
/// or stale. The cached catalog stays applied beneath it; a retry affordance is offered for
/// the failed + stale cases.
struct ResetStatusBannerView: View {
    let banner: ResetStatusBanner
    let onRetry: () -> Void

    private var tone: Color {
        switch banner.tone {
        case .error: Color.TS.statusDanger
        case .offline: Color.TS.textMuted
        case .stale: Color.TS.statusWarning
        }
    }

    private var systemImage: String {
        switch banner.tone {
        case .error: "exclamationmark.triangle.fill"
        case .offline: "wifi.slash"
        case .stale: "arrow.triangle.2.circlepath"
        }
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            Text(verbatim: banner.message(ResetStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: TSSpacing.sm)
            if banner.showsRetry {
                Button(action: onRetry) {
                    ResetStrings.text("settingsReset.status.retry", "Retry")
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(ResetStrings.text("settingsReset.status.retry", "Retry"))
            }
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Destructive confirmation scaffold (web `ConfirmDialog variant="danger"`)

/// The shared chrome for both destructive confirmation sheets: a tinted warning callout
/// (icon + title + message), optional extra content (the danger-zone typed field), and the
/// Cancel / Confirm actions. Confirm is destructive + loading-aware; Cancel is disabled
/// while the mutation is in flight.
struct ResetConfirmSheet<Extra: View>: View {
    let systemImage: String
    let title: String
    let message: String
    let confirmLabel: String
    let cancelLabel: String
    let confirmDisabled: Bool
    let loading: Bool
    let onConfirm: () -> Void
    let onCancel: () -> Void
    @ViewBuilder var extra: () -> Extra

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(verbatim: title)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    Text(verbatim: message)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.statusDanger.opacity(0.1),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.25), lineWidth: 1)
            )

            extra()

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(variant: .ghost, size: .large, action: onCancel) {
                    Text(verbatim: cancelLabel)
                }
                .disabled(loading)
                TSButton(variant: .destructive, size: .large, isLoading: loading, action: onConfirm) {
                    Text(verbatim: confirmLabel)
                }
                .disabled(confirmDisabled)
            }
        }
        .padding(TSSpacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(minWidth: 320)
        .background(Color.TS.bg)
        .accessibilityElement(children: .contain)
        .resetSheetDetents()
    }
}

// MARK: - Per-section confirm sheet (web danger `ConfirmDialog`)

/// The per-section confirmation — the native parity of the web danger `ConfirmDialog`:
/// the "Reset {name}?" title, the "{description} This action is permanent." message, and
/// the Cancel / Reset actions. Stays up (loading) until the mutation settles.
struct ResetSectionConfirmSheet: View {
    let row: ResetSectionRow
    let model: ResetSectionModel

    var body: some View {
        ResetConfirmSheet(
            systemImage: "exclamationmark.triangle.fill",
            title: ResetAdapter.confirmSectionTitle(
                name: row.title(ResetStrings.string),
                localize: ResetStrings.string
            ),
            message: ResetAdapter.confirmSectionMessage(
                description: row.description(ResetStrings.string),
                localize: ResetStrings.string
            ),
            confirmLabel: ResetStrings.string("settingsReset.confirm.confirmLabel", "Reset"),
            cancelLabel: ResetStrings.string("settingsReset.confirm.cancelLabel", "Cancel"),
            confirmDisabled: false,
            loading: model.isSectionBusy(row.id),
            onConfirm: { Task { await model.confirmResetSection() } },
            onCancel: { model.cancelResetSection() },
            extra: { EmptyView() }
        )
    }
}

// MARK: - Danger-zone typed confirm sheet (web `requireTypedConfirmation="RESET"`)

/// The danger-zone confirmation — the native parity of the web typed-confirmation
/// `ConfirmDialog`: the wipe-everything message, the field that must read "RESET" before
/// the destructive action enables, and the Cancel / Reset everything actions.
struct ResetAllConfirmSheet: View {
    @Bindable var model: ResetSectionModel

    var body: some View {
        ResetConfirmSheet(
            systemImage: "exclamationmark.octagon.fill",
            title: ResetStrings.string(
                "settingsReset.confirm.allTitle",
                "Reset every user-discoverable setting?"
            ),
            message: ResetStrings.string(
                "settingsReset.confirm.allMessage",
                "Every alert rule, geofence, channel, automation, dashboard layout preset, and preference "
                    + "row will be permanently deleted. This cannot be undone."
            ),
            confirmLabel: ResetStrings.string("settingsReset.confirm.allConfirmLabel", "Reset everything"),
            cancelLabel: ResetStrings.string("settingsReset.confirm.cancelLabel", "Cancel"),
            confirmDisabled: !model.canConfirmResetAll,
            loading: model.isResettingAll,
            onConfirm: { Task { await model.confirmResetAll() } },
            onCancel: { model.cancelResetAll() },
            extra: { typedField }
        )
    }

    private var typedField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: ResetStrings.string("settingsReset.confirm.typedLabel", "Type RESET to confirm"))
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField("", text: $model.resetAllInput)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                .resetConfirmCapitalization()
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .accessibilityLabel(
                    ResetStrings.text("settingsReset.confirm.typedLabel", "Type RESET to confirm")
                )
                .accessibilityIdentifier("reset-section-typed-confirm")
        }
    }
}

// MARK: - Toast (web `useToast().success` / error)

/// The auto-dismissing toast — a tone glyph + title + detail, posted after a reset
/// succeeds or fails. Honors Reduce Motion for its transition (applied by the parent).
struct ResetToastView: View {
    let toast: ResetToast
    let onDismiss: () -> Void

    private var tone: Color {
        toast.kind == .success ? Color.TS.statusSuccess : Color.TS.statusDanger
    }

    private var systemImage: String {
        toast.kind == .success ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(tone)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: toast.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !toast.detail.isEmpty {
                    Text(verbatim: toast.detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(ResetStrings.text("settingsReset.toasts.dismiss", "Dismiss"))
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.opacity(0.3), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.18), radius: 12, y: 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(toast.title). \(toast.detail)"))
    }
}

// MARK: - Loading skeleton

/// The initial-load skeleton chrome — a redacted header plus three redacted section rows
/// and a redacted danger bar, matching the loaded layout so the transition is stable.
struct ResetSkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        TSSkeleton(width: 160, height: 16)
                        TSSkeleton(height: 10)
                    }
                }
                ForEach(0 ..< 3, id: \.self) { _ in
                    rowSkeleton
                }
            }
            .padding(TSSpacing.xl)
            .tsGlassPanel()

            HStack(spacing: TSSpacing.md) {
                TSSkeleton(height: 12)
                TSSkeleton(width: 140, height: 36, cornerRadius: TSRadius.md)
            }
            .padding(TSSpacing.xl)
            .tsGlassPanel()
        }
        .accessibilityElement()
        .accessibilityLabel(ResetStrings.text("settingsReset.loading", "Loading reset options"))
    }

    private var rowSkeleton: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 36, height: 36, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 140, height: 14)
                TSSkeleton(height: 10)
            }
            Spacer(minLength: TSSpacing.md)
            TSSkeleton(width: 72, height: 28, cornerRadius: TSRadius.md)
        }
    }
}

// MARK: - Platform modifiers

private extension View {
    /// A medium/large detented sheet on iOS/iPadOS; the natural sheet sizing on macOS.
    @ViewBuilder
    func resetSheetDetents() -> some View {
        #if os(iOS)
            presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        #else
            self
        #endif
    }

    /// iOS character-capitalization for the typed "RESET" token; a no-op on macOS.
    func resetConfirmCapitalization() -> some View {
        #if os(iOS)
            return textInputAutocapitalization(.characters)
        #else
            return self
        #endif
    }
}
