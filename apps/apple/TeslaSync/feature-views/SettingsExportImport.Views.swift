//
//  SettingsExportImport.Views.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The upper subviews for the SettingsExportImport surface: the panel header (web `IconBox`
//  + `Heading` + subtitle), the export row (web primary `Button` "Export JSON"), and the
//  import row (web "Import settings" + the drag-drop dropzone / "Choose a file"). The lower
//  subviews (parse-error banner, dry-run preview, applied summary, section diff list, and
//  toast) live in SettingsExportImport.Panels.swift. Every string routes through the P1/S10
//  facade; every interactive element carries a VoiceOver label; icons are decorative.
//

import SwiftUI

// MARK: - Localized helper

func tsBackupString(_ key: String, _ fallback: String) -> String {
    SettingsExportImportStrings.string(key, fallback)
}

// MARK: - Tone → design-system color (web `toast` variant)

extension SettingsBackupTone {
    /// The status token the tone renders as (kept local so the Adapter projection stays
    /// view-free + Sendable).
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .neutral: Color.TS.textMuted
        }
    }
}

// MARK: - Panel header (web `IconBox` + `Heading` + subtitle)

struct SettingsBackupHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            Image(systemName: "externaldrive.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 40, height: 40)
                .background(
                    Color.TS.accent.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.accent.opacity(0.25), lineWidth: 1)
                )
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: tsBackupString("backup.title", "Backup & Restore"))
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: tsBackupString(
                    "backup.subtitle",
                    "Export your TeslaSync configuration as a JSON file you can stash in a "
                        + "backup folder or git repo, and import it on a fresh install."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Export row (web primary Button "Export JSON")

struct SettingsExportRow: View {
    let model: SettingsExportImportModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: TSSpacing.lg) {
                    exportCopy
                    Spacer(minLength: TSSpacing.md)
                    exportButton
                }
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    exportCopy
                    exportButton
                }
            }
        }
    }

    private var exportCopy: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: tsBackupString("backup.export.title", "Export settings"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Text(verbatim: tsBackupString(
                "backup.export.help",
                "Includes general settings, alert rules, geofences, and your quiet-hours "
                    + "windows. Tesla credentials and notification-channel secrets are NEVER exported."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var exportButton: some View {
        let label = model.exportButtonLabel
        let title = tsBackupString(label.key, label.fallback)
        return TSButton(
            variant: .primary,
            size: .small,
            action: { Task { await model.export() } },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    if model.isExporting {
                        ProgressView()
                            .controlSize(.mini)
                            .tint(.white)
                            .accessibilityHidden(true)
                    } else {
                        Image(systemName: "square.and.arrow.down")
                            .font(.system(size: 12, weight: .semibold))
                            .accessibilityHidden(true)
                    }
                    Text(verbatim: title)
                }
            }
        )
        .disabled(model.isExportDisabled)
        .accessibilityLabel(Text(verbatim: tsBackupString("backup.export.cta", "Export JSON")))
        .accessibilityHint(Text(verbatim: tsBackupString(
            "backup.export.hint",
            "Saves your configuration as a JSON file."
        )))
        .accessibilityIdentifier(SettingsExportImportAccessibility.exportTestID)
    }
}

// MARK: - Import row (web "Import settings" + dropzone/preview/applied)

struct SettingsImportRow: View {
    let model: SettingsExportImportModel
    let onChooseFile: () -> Void
    let onDropFile: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: tsBackupString("backup.import.title", "Import settings"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: tsBackupString(
                    "backup.import.help",
                    "Drop or pick a previously exported bundle. Existing items with the same "
                        + "name are updated; nothing is deleted."
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }

            if model.showsDropzone {
                SettingsImportDropzone(model: model, onChooseFile: onChooseFile, onDropFile: onDropFile)
            }

            if let message = model.parseErrorMessage() {
                SettingsImportErrorBanner(message: message)
            }

            if model.importStage == .preview {
                SettingsImportPreview(model: model)
            }

            if model.importStage == .applied {
                SettingsImportApplied(model: model)
            }
        }
    }
}

// MARK: - Dropzone (web dashed drag-drop + "Choose a file")

struct SettingsImportDropzone: View {
    let model: SettingsExportImportModel
    let onChooseFile: () -> Void
    let onDropFile: (URL) -> Void

    @State private var isTargeted = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let label = model.chooseButtonLabel
        let title = tsBackupString(label.key, label.fallback)
        return VStack(spacing: TSSpacing.sm) {
            Image(systemName: "doc.text")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: tsBackupString("backup.import.dropPrompt", "Drag a JSON bundle here, or"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(
                variant: .ghost,
                size: .small,
                action: onChooseFile,
                label: {
                    HStack(spacing: TSSpacing.xs) {
                        if model.isParsing {
                            ProgressView()
                                .controlSize(.mini)
                                .accessibilityHidden(true)
                        } else {
                            Image(systemName: "square.and.arrow.up")
                                .font(.system(size: 12, weight: .semibold))
                                .accessibilityHidden(true)
                        }
                        Text(verbatim: title)
                    }
                }
            )
            .disabled(model.isParsing)
            .accessibilityLabel(Text(verbatim: tsBackupString("backup.import.choose", "Choose a file")))
            .accessibilityIdentifier(SettingsExportImportAccessibility.fileInputTestID)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.x2xl)
        .background(
            isTargeted ? Color.TS.accent.opacity(0.06) : Color.TS.surface.opacity(0.5),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(
                    isTargeted ? Color.TS.accent : Color.TS.border,
                    style: StrokeStyle(lineWidth: isTargeted ? 2 : 1.5, dash: [6, 4])
                )
        )
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isTargeted)
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            onDropFile(url)
            return true
        } isTargeted: { targeted in
            isTargeted = targeted
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: tsBackupString("backup.import.dropPrompt", "Drag a JSON bundle here, or")))
        .accessibilityIdentifier(SettingsExportImportAccessibility.dropzoneTestID)
    }
}
