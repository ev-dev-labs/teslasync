//
//  FleetApiSection.Panels.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The composite panels each tool reuses: the glass tool card (port of `ToolCard`),
//  the JSON result panel with its idle / loading / success / failure branches (port
//  of `ResultPanel`), and the five-state telemetry-errors panel (port of
//  `TelemetryErrorsPanel`: idle / loading / error / table / empty + raw disclosure).
//

import SwiftUI

// MARK: - Tool card (port of `ToolCard`)

/// A glass panel with an accent icon chip, a title, a description, and a content
/// slot — the native port of the web `ToolCard`.
struct FleetToolCard<Content: View>: View {
    let icon: String
    var tone: FleetTone = .cyan
    let titleKey: String
    let titleFallback: String
    let descKey: String
    let descFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(tone.color)
                    .frame(width: 40, height: 40)
                    .background(
                        tone.color.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(tone.color.opacity(0.2), lineWidth: 1)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    FleetApiStrings.text(titleKey, titleFallback)
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                    FleetApiStrings.text(descKey, descFallback)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            content()
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Result panel (port of `ResultPanel`)

/// The JSON result panel: an idle hint, a loading skeleton, a green success body
/// (pretty JSON + copy), or a red failure message.
struct FleetResultPanel: View {
    let titleKey: String
    let titleFallback: String
    let result: ToolResult

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                FleetApiStrings.text(titleKey, titleFallback)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                if case let .success(value) = result {
                    FleetCopyButton(value: FleetApiBuilder.prettyJSON(value))
                }
            }
            body(for: result)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func body(for result: ToolResult) -> some View {
        switch result {
        case let .idle(messageKey, fallback):
            Text(verbatim: idleMessage(messageKey, fallback))
                .font(Font.TS.body)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
        case .loading:
            TSSkeleton(height: 14)
            TSSkeleton(width: 180, height: 14)
        case let .success(value):
            jsonBlock(FleetApiBuilder.prettyJSON(value))
        case let .failure(message):
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
                .textSelection(.enabled)
        }
    }

    private func idleMessage(_ key: String, _ fallback: String) -> String {
        guard !key.isEmpty else {
            return FleetApiStrings.string("devtools.fleet.noResult", "No result yet")
        }
        return FleetApiStrings.string(key, fallback)
    }

    private func jsonBlock(_ json: String) -> some View {
        ScrollView([.horizontal, .vertical]) {
            Text(verbatim: json)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.sm)
        }
        .frame(maxHeight: 240)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }

    private var tint: Color {
        switch result {
        case .failure: Color.TS.statusDanger.opacity(0.06)
        case .success: Color.TS.statusSuccess.opacity(0.06)
        case .idle, .loading: Color.TS.surfaceGlass.opacity(0.5)
        }
    }
}

// MARK: - Telemetry errors panel (port of `TelemetryErrorsPanel`)

/// The five-state fleet-telemetry errors panel: idle / loading / error / table /
/// empty (with the raw-response disclosure when the wire shape is unrecognised).
struct FleetTelemetryErrorsPanel: View {
    let titleKey: String
    let titleFallback: String
    let phase: TelemetryErrorsPhase
    let vin: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            switch phase {
            case .idle: idle
            case .loading: loading
            case let .failed(message): failed(message)
            case let .table(rows): table(rows)
            case let .empty(ok, raw): empty(ok: ok, raw: raw)
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private var header: some View {
        FleetApiStrings.text(titleKey, titleFallback)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
    }

    private var idle: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            Text(verbatim: FleetApiStrings.string(
                "devtools.errorsIdle",
                "Click View Errors to fetch recent Fleet Telemetry errors for this vehicle."
            ))
            .font(Font.TS.body)
            .italic()
            .foregroundStyle(Color.TS.textMuted)
        }
    }

    private var loading: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            TSSkeleton(height: 14)
            TSSkeleton(height: 14)
            TSSkeleton(width: 160, height: 14)
        }
    }

    private func failed(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            Text(verbatim: message)
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
                .textSelection(.enabled)
        }
    }

    private func table(_ rows: [TelemetryErrorRow]) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            VStack(spacing: 0) {
                ForEach(rows) { FleetErrorRow(row: $0) }
            }
            ShareLink(item: FleetApiBuilder.prettyJSON(.array(rows.map(rowJSON)))) {
                Label {
                    FleetApiStrings.text("devtools.fleet.downloadErrors", "Download Errors")
                        .font(Font.TS.caption).fontWeight(.semibold)
                } icon: {
                    Image(systemName: "square.and.arrow.down").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(Color.TS.accent)
            }
            .accessibilityLabel(FleetApiStrings.text("devtools.fleet.downloadErrors", "Download Errors"))
        }
    }

    private func empty(ok: Bool, raw: JSONValue?) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                header
                Spacer(minLength: TSSpacing.sm)
                FleetBadge(text: Text(verbatim: ok ? "0" : "?"), tone: ok ? .green : .amber, dot: true)
            }
            FleetApiStrings.text("devtools.errorsEmpty", "No Fleet Telemetry errors reported for this vehicle.")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
            if !ok, let raw {
                DisclosureGroup {
                    rawBlock(FleetApiBuilder.prettyJSON(raw))
                } label: {
                    FleetApiStrings.text("devtools.errorsRaw", "Show raw Tesla response")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
                .tint(Color.TS.textMuted)
            }
        }
    }

    private func rawBlock(_ json: String) -> some View {
        ScrollView([.horizontal, .vertical]) {
            Text(verbatim: json)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .padding(TSSpacing.sm)
        }
        .frame(maxHeight: 240)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
    }

    private func rowJSON(_ row: TelemetryErrorRow) -> JSONValue {
        .object([
            "timestamp": .string(row.timestamp),
            "code": .string(row.code),
            "message": .string(row.message)
        ])
    }

    private var background: Color {
        if case .failed = phase { return Color.TS.statusDanger.opacity(0.06) }
        return Color.TS.surfaceGlass.opacity(0.5)
    }
}

// MARK: - One telemetry error row

/// A single telemetry-error row: formatted timestamp, a danger code badge, and the
/// message — one VoiceOver element.
struct FleetErrorRow: View {
    let row: TelemetryErrorRow

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Text(verbatim: row.timestamp.isEmpty ? "—" : FleetApiBuilder.formatDateTime(row.timestamp))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: 120, alignment: .leading)
            if row.code.isEmpty {
                Text(verbatim: "—").font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            } else {
                FleetBadge(text: Text(verbatim: row.code), tone: .red)
            }
            Text(verbatim: row.message.isEmpty ? "—" : row.message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, TSSpacing.xs)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FleetApiAccessibility.errorRowLabel(row)))
    }
}
