//
//  SettingsExportImport.Panels.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The lower subviews for the SettingsExportImport surface: the inline parse-error banner
//  (web `parseError` → `ErrorText`), the dry-run preview (web `stage === 'preview'`), the
//  applied summary (web `stage === 'applied'`), the per-section diff list (web
//  `SectionDiffList`), and the transient toast (web `useToast`). Every string routes
//  through the P1/S10 facade; every interactive element carries a VoiceOver label.
//

import SwiftUI

// MARK: - Inline parse error (web `parseError` ErrorText)

struct SettingsImportErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(SettingsExportImportAccessibility.errorTestID)
    }
}

// MARK: - Dry-run preview (web `stage === 'preview'`)

struct SettingsImportPreview: View {
    let model: SettingsExportImportModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    if let header = model.previewHeaderText() {
                        Text(verbatim: header)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let summary = model.previewSummaryLine() {
                        Text(verbatim: summary)
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                TSButton(variant: .ghost, size: .small, action: model.resetImport) {
                    Text(verbatim: tsBackupString("backup.import.changeFile", "Change file"))
                }
                .accessibilityLabel(Text(verbatim: tsBackupString("backup.import.changeFile", "Change file")))
            }

            SettingsSectionDiffList(rows: model.sectionRows)

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(variant: .ghost, size: .small, action: model.resetImport) {
                    Text(verbatim: tsBackupString("backup.import.cancel", "Cancel"))
                }
                .disabled(model.applyInFlight)
                .accessibilityLabel(Text(verbatim: tsBackupString("backup.import.cancel", "Cancel")))

                applyButton
            }
        }
        .accessibilityIdentifier(SettingsExportImportAccessibility.previewTestID)
    }

    private var applyButton: some View {
        let label = model.applyButtonLabel
        let title = label.count.map { count in
            SettingsExportImportStrings.format(label.key, label.fallback, [count])
        } ?? tsBackupString(label.key, label.fallback)
        return TSButton(
            variant: .primary,
            size: .small,
            action: { Task { await model.apply() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.applyInFlight {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: title)
                }
            }
        )
        .disabled(model.isApplyDisabled)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityIdentifier(SettingsExportImportAccessibility.applyTestID)
    }
}

// MARK: - Applied summary (web `stage === 'applied'`)

struct SettingsImportApplied: View {
    let model: SettingsExportImportModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .accessibilityHidden(true)
                Text(verbatim: tsBackupString("backup.import.appliedHeader", "Import complete"))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
            }

            SettingsSectionDiffList(rows: model.sectionRows)

            HStack {
                Spacer(minLength: 0)
                TSButton(variant: .ghost, size: .small, action: model.resetImport) {
                    Text(verbatim: tsBackupString("backup.import.done", "Done"))
                }
                .accessibilityLabel(Text(verbatim: tsBackupString("backup.import.done", "Done")))
            }
        }
        .accessibilityIdentifier(SettingsExportImportAccessibility.appliedTestID)
    }
}

// MARK: - Section diff list (web `SectionDiffList`)

struct SettingsSectionDiffList: View {
    let rows: [SettingsSectionDiffRow]

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    Text(verbatim: tsBackupString(row.labelKey, row.labelFallback))
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.md)
                    if let code = row.codeText {
                        TSCode(code)
                    } else {
                        Text(verbatim: "—")
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier(SettingsExportImportAccessibility.sectionListTestID)
    }
}

// MARK: - Toast banner (web `useToast`)

/// The transient feedback banner — the native counterpart of web `toast.success` /
/// `toast.error`. Tone-colored, dismissible, and self-clearing via the surface's timed
/// task. Carries a title + detail line (web toast title/description).
struct SettingsBackupToastView: View {
    let toast: SettingsBackupToast
    let onDismiss: () -> Void

    var body: some View {
        let tint = toast.tone.color
        return HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: toast.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: toast.title)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: toast.message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: tsBackupString("backup.toast.dismiss", "Dismiss")))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tint.opacity(0.3), lineWidth: 1)
        )
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .accessibilityElement(children: .combine)
    }
}
