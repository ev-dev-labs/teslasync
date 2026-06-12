//
//  StatusBar.Version.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The version segment + the "About this build" sheet — the native parity of the web `VersionSegment` and
//  its `<Modal>`. The chip shows the version label, the optional SHA, and the update / unseen-changelog dot;
//  tapping opens a sheet with the provenance rows, the update banner, and the changelog / release-notes /
//  close actions. Every value is pre-resolved by the projection; this view never reaches past the sheet
//  view model.
//

import SwiftUI

// MARK: - Version segment (web VersionSegment chip)

/// The version segment chip — a tag glyph + the `vN` label, the optional SHA suffix, and the
/// update-available (amber) / unseen-changelog (info) dot. Tapping opens the About sheet.
public struct StatusBarVersionView: View {
    private let vm: StatusBarVersionVM
    private let iconOnly: Bool
    @Binding private var isPresented: Bool
    private let onChangelog: () -> Void
    private let onReleaseNotes: () -> Void

    public init(
        vm: StatusBarVersionVM,
        iconOnly: Bool,
        isPresented: Binding<Bool>,
        onChangelog: @escaping () -> Void,
        onReleaseNotes: @escaping () -> Void
    ) {
        self.vm = vm
        self.iconOnly = iconOnly
        _isPresented = isPresented
        self.onChangelog = onChangelog
        self.onReleaseNotes = onReleaseNotes
    }

    public var body: some View {
        Button { isPresented = true } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "tag")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                if !iconOnly {
                    Text(verbatim: vm.label)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                    if let sha = vm.shaText {
                        StatusBarMutedSuffix(text: sha)
                    }
                    dot
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(vm.tooltip)
        .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
        .sheet(isPresented: $isPresented) {
            StatusBarVersionSheetView(
                sheet: vm.sheet,
                onChangelog: onChangelog,
                onReleaseNotes: onReleaseNotes,
                onClose: { isPresented = false }
            )
        }
    }

    /// The update-available (amber) / unseen-changelog (info) dot — web `bg-amber-400` / `bg-cyan-400`.
    @ViewBuilder
    private var dot: some View {
        if vm.updateAvailable {
            Circle().fill(Color.TS.statusWarning).frame(width: 6, height: 6).accessibilityHidden(true)
        } else if vm.hasUnseenChangelog {
            Circle().fill(Color.TS.statusInfo).frame(width: 6, height: 6).accessibilityHidden(true)
        }
    }
}

// MARK: - About sheet (web Modal body)

/// The "About this build" sheet — the provenance rows, the optional update banner, and the actions.
public struct StatusBarVersionSheetView: View {
    let sheet: StatusBarVersionSheet
    let onChangelog: () -> Void
    let onReleaseNotes: () -> Void
    let onClose: () -> Void

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: sheet.title)
                    .font(Font.TS.section)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    ForEach(sheet.rows) { row in
                        StatusBarKVRow(row: row)
                    }
                }
                if let banner = sheet.updateBanner {
                    StatusBarUpdateBannerView(banner: banner)
                }
                actions
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minWidth: 360)
        .background(Color.TS.bg)
    }

    private var actions: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            StatusBarSheetButton(
                title: sheet.whatsNewLabel,
                systemName: "sparkles",
                prominent: false,
                action: onChangelog
            )
            StatusBarSheetButton(
                title: sheet.releaseNotesLabel,
                systemName: "arrow.up.right.square",
                prominent: false,
                action: onReleaseNotes
            )
            StatusBarSheetButton(
                title: sheet.closeLabel,
                systemName: "xmark",
                prominent: true,
                action: onClose
            )
        }
    }
}

/// One provenance row — a muted label + the value (monospaced for versions / SHAs / platforms).
public struct StatusBarKVRow: View {
    let row: StatusBarKV

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            Text(verbatim: row.label)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: row.value)
                .font(row.monospaced ? Font.TS.bodySm.monospaced() : Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(row.label): \(row.value)"))
    }
}

/// The "newer release available" banner — web `updateAvailable && <div class="border-amber">`.
public struct StatusBarUpdateBannerView: View {
    let banner: StatusBarUpdateBanner

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: banner.title)
                .font(Font.TS.body)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
            if let message = banner.message, !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.statusWarning.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// A token-styled sheet action button (ghost or prominent) — the native peer of the web `<Button>`.
public struct StatusBarSheetButton: View {
    let title: String
    let systemName: String
    let prominent: Bool
    let action: () -> Void

    public var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemName).font(Font.TS.caption).accessibilityHidden(true)
                Text(verbatim: title).font(Font.TS.bodySm)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .fill(prominent ? Color.TS.accent.opacity(0.18) : Color.TS.textPrimary.opacity(0.06))
            )
            .foregroundStyle(prominent ? Color.TS.accent : Color.TS.textSecondary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
    }
}
