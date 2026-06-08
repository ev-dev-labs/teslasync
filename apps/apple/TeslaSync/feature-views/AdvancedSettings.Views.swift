//
//  AdvancedSettings.Views.swift
//  TeslaSync — P4 feature view · 0198 · AdvancedSettings (Apple)
//
//  The presentational chrome for the "Restore confirmation prompts" panel: the header (web `IconBox` +
//  title + description + the trailing "Restore all" ghost button), one restore row (web `<li>` — the
//  friendly label + a per-row "Restore" ghost button), the bordered list (web `<ul divide-y border>`),
//  the live-state freshness chip, and the stale / offline banner. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9) and reuses the shared component library (`TSIconBox`,
//  `TSButton`). The load-state chrome lives in AdvancedSettings.States.swift.
//

import SwiftUI

// MARK: - Header (web `IconBox` + title + description + "Restore all")

/// The panel header: a cyan `TSIconBox` (web `IconBox color="cyan"` + `ShieldQuestion`), the title +
/// description, the freshness chip (when not live), and the "Restore all" ghost button shown only when
/// there are silenced prompts (web `silenced.length > 0`).
struct AdvancedSettingsHeader: View {
    let connection: AdvancedSettingsConnection
    let showsRestoreAll: Bool
    let onRestoreAll: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "questionmark.circle.fill", tone: .info)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                AdvancedSettingsStrings.text("advanced.restoreConfirms.title", "Confirmation prompts")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                AdvancedSettingsStrings.text(
                    "advanced.restoreConfirms.description",
                    "Re-enable “Don’t ask again” prompts you previously silenced."
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
        }
    }

    private var trailing: some View {
        HStack(spacing: TSSpacing.sm) {
            if connection != .live {
                AdvancedSettingsFreshnessChip(connection: connection)
            }
            if showsRestoreAll {
                restoreAllButton
            }
        }
    }

    private var restoreAllButton: some View {
        TSButton(variant: .ghost, size: .small, action: onRestoreAll) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "arrow.counterclockwise")
                    .font(.system(size: 13, weight: .semibold))
                AdvancedSettingsStrings.text("advanced.restoreConfirms.restoreAll", "Restore all")
            }
        }
        .accessibilityLabel(AdvancedSettingsStrings.text("advanced.restoreConfirms.restoreAll", "Restore all"))
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The freshness chip reflecting the bound store's live-state (ADR-013). A purely-local store stays
/// `.live` (so the chip is hidden); `.stale` / `.offline` surface it.
struct AdvancedSettingsFreshnessChip: View {
    let connection: AdvancedSettingsConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            AdvancedSettingsStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(AdvancedSettingsStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: AdvancedSettingsConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "advanced.restoreConfirms.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "advanced.restoreConfirms.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "advanced.restoreConfirms.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the list when the bound store is not live, so the rows are
/// clearly labelled as cached (web `DataFreshness` intent).
struct AdvancedSettingsConnectivityBanner: View {
    let connection: AdvancedSettingsConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "advanced.restoreConfirms.offlineBanner" : "advanced.restoreConfirms.staleBanner"
        let fallback = offline
            ? "Offline — showing the last synced prompts"
            : "Reconnecting — silenced prompts may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            AdvancedSettingsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Restore row (web `<li>` — label + per-row "Restore" button)

/// One restore row: the friendly prompt label (web `labelFor(key)`, single-line truncated like the web
/// `truncate`) and a trailing "Restore" ghost button (web `Button` + `RotateCcw`).
struct SilencedPromptRowView: View {
    let row: SilencedPromptRow
    let restoreLabel: String
    let onRestore: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: row.label)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.sm)
            TSButton(variant: .ghost, size: .small, action: onRestore) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "arrow.counterclockwise")
                        .font(.system(size: 12, weight: .semibold))
                    AdvancedSettingsStrings.text("advanced.restoreConfirms.restore", "Restore")
                }
            }
            .accessibilityLabel(Text(verbatim: restoreLabel))
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Restore list (web `<ul divide-y border rounded-lg bg-white/[0.02]>`)

/// The resolved restore list: the rows separated by hairlines inside a bordered, tinted container —
/// the SwiftUI parity of the web `<ul>` with `divide-y` / `border` / `rounded-lg`.
struct SilencedPromptList: View {
    let rows: [SilencedPromptRow]
    let listSummary: String
    let restoreLabel: (SilencedPromptRow) -> String
    let onRestore: (SilencedPromptRow) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                SilencedPromptRowView(row: row, restoreLabel: restoreLabel(row)) { onRestore(row) }
                if index < rows.count - 1 {
                    Divider().overlay(Color.TS.border)
                }
            }
        }
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: listSummary))
    }
}
