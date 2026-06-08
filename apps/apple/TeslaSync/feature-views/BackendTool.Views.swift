//
//  BackendTool.Views.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  The composed subviews for the BackendTool surface: the header (icon + title +
//  description + method/freshness chips, web `ToolCard`), the action row (Run
//  button + run-status badge), and the result panel (idle / loading / error / JSON
//  with copy + stale/offline banners, web `ResultPanel`). Every user-facing string
//  routes through the P1/S10 facade; every interactive element carries a VoiceOver
//  label.
//

import SwiftUI

// MARK: - Header (web `ToolCard`: icon box + title + description)

struct BackendToolHeader: View {
    let descriptor: BackendToolDescriptor
    let connection: BackendToolConnection
    let showsFreshness: Bool

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: descriptor.systemImage, tone: descriptor.tone)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: descriptor.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(verbatim: descriptor.description)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: TSSpacing.sm)
            VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                BackendToolMethodChip(method: descriptor.method)
                if showsFreshness {
                    BackendToolFreshnessChip(connection: connection)
                }
            }
        }
    }
}

// MARK: - Method chip (the dev-tool verb)

struct BackendToolMethodChip: View {
    let method: BackendToolMethod

    var body: some View {
        Text(verbatim: method.rawValue)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(method.tone.color)
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .background(method.tone.color.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(method.tone.color.opacity(0.25), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: method.rawValue))
    }
}

// MARK: - Freshness chip (live / stale / offline)

struct BackendToolFreshnessChip: View {
    let connection: BackendToolConnection

    var body: some View {
        let chip = BackendToolConnectionChip.project(connection)
        let label = BackendToolStrings.string(chip.labelKey, chip.labelFallback)
        return HStack(spacing: 4) {
            Circle()
                .fill(chip.tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Run-status badge (web `Badge variant danger/success dot`)

struct BackendToolStatusBadge: View {
    let status: BackendToolStatus

    var body: some View {
        let label = BackendToolStrings.string(status.labelKey, status.labelFallback)
        return HStack(spacing: 4) {
            Circle()
                .fill(status.tone.color)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(status.tone.color)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(status.tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(status.tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Action row (web Run `Button` + status `Badge`)

struct BackendToolActionRow: View {
    let title: String
    let phase: BackendToolModel.Phase
    let status: BackendToolStatus
    let onRun: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .primary, size: .small, isLoading: phase == .running, action: onRun) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .bold))
                        .accessibilityHidden(true)
                    Text(verbatim: BackendToolStrings.string("Run", "Run"))
                }
            }
            .accessibilityLabel(
                Text(verbatim: BackendToolAccessibility.runLabel(title: title, localize: BackendToolStrings.string))
            )
            if status.kind != .hidden {
                BackendToolStatusBadge(status: status)
            }
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Inline banner (stale / offline)

struct BackendToolBanner: View {
    let tone: TSTone
    let key: String
    let fallback: String
    let systemImage: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            Text(verbatim: BackendToolStrings.string(key, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Result panel (web `ResultPanel`)

struct BackendToolResultPanel: View {
    let title: String
    let phase: BackendToolModel.Phase
    let result: BackendToolResult?
    let connection: BackendToolConnection
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            banner
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var banner: some View {
        if connection == .offline, result?.hasData == true {
            BackendToolBanner(
                tone: .neutral,
                key: "devtools.tool.offlineBanner",
                fallback: "Offline — showing last result",
                systemImage: "wifi.slash"
            )
        } else if connection == .stale {
            BackendToolBanner(
                tone: .warning,
                key: "devtools.tool.staleBanner",
                fallback: "Result may be out of date",
                systemImage: "clock.arrow.circlepath"
            )
        }
    }

    @ViewBuilder
    private var content: some View {
        if let result {
            if let error = result.error {
                errorBody(error)
            } else if let json = result.json {
                jsonBody(json)
            } else {
                idleBody
            }
        } else if phase == .running {
            loadingBody
        } else {
            idleBody
        }
    }

    private func panelHeader(copyValue: String?) -> some View {
        HStack {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if let copyValue {
                TSCopyButton(value: copyValue)
                    .accessibilityLabel(
                        Text(verbatim: BackendToolStrings.string("devtools.tool.copy", "Copy result"))
                    )
            }
        }
    }

    private func jsonBody(_ json: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            panelHeader(copyValue: json)
            ScrollView {
                Text(verbatim: json)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 240)
            .padding(TSSpacing.sm)
            .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.statusSuccess.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: BackendToolStrings.string("Success", "Success")))
    }

    private func errorBody(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            panelHeader(copyValue: nil)
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: BackendToolStrings.string("devtools.tool.retry", "Retry"))
            }
        }
        .padding(TSSpacing.sm)
        .background(
            Color.TS.statusDanger.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }

    private var loadingBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 120, height: 12)
            TSSkeleton(height: 12)
            TSSkeleton(width: 200, height: 12)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BackendToolStrings.string("devtools.tool.running", "Running…")))
    }

    private var idleBody: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "terminal")
                .font(.system(size: 14))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: BackendToolStrings.string("devtools.tool.noResult", "No result yet"))
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass.opacity(0.4),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}
