//
//  TelemetryErrorsPanel.Views.swift
//  TeslaSync — P4 feature view · 0009 · TelemetryErrorsPanel (Apple)
//
//  The presentational subviews composed by `TelemetryErrorsPanel`: the labeled
//  surface box (web `rounded-lg bg-white/[0.02] p-3`), the idle / loading / error /
//  empty states, the danger code chip (web `Badge variant="danger"`), and the data
//  table (reusing the shared `TSDataTable`, the native parity of the web
//  `DataTable`) with the JSON download affordance. All consume the P1/S10 facade and
//  the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - Labeled surface box (web `rounded-lg bg-white/[0.02] p-3`)

/// The titled container shared by the idle / loading / error / empty states. `tone`
/// selects the neutral surface tint or the danger tint used by the error box (web
/// `bg-neon-red/5`).
struct TELabeledBox<Content: View>: View {
    enum Tone {
        case neutral, danger
    }

    let title: String
    var tone: Tone = .neutral
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: title)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(fill, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
    }

    private var fill: Color {
        switch tone {
        case .neutral: Color.TS.surfaceGlass
        case .danger: Color.TS.statusDanger.opacity(0.06)
        }
    }
}

// MARK: - Idle (web `!requested`)

/// The pre-request prompt (web idle branch): the title plus the italic hint to
/// press the button. Shown instead of a blank panel before any fetch.
struct TEIdleView: View {
    let title: String
    let message: String

    var body: some View {
        TELabeledBox(title: title) {
            Text(verbatim: message)
                .font(Font.TS.body)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
        }
    }
}

// MARK: - Loading (web `<Skeleton lines={3} />`)

/// The in-flight skeleton (web loading branch): three redacted lines that respect
/// Reduce Motion via the shared `TSSkeleton`.
struct TELoadingView: View {
    let title: String

    var body: some View {
        TELabeledBox(title: title) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(height: 12)
                TSSkeleton(height: 12)
                TSSkeleton(width: 180, height: 12)
            }
            .padding(.top, TSSpacing.xs)
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: TEStrings.string(
                "admin.telemetryErrors.loadingA11y", "Loading telemetry errors"
            )))
        }
    }
}

// MARK: - Error (web error branch + native retry affordance)

/// The failure box (web error branch). The web leaf only prints the message; the
/// native surface additionally exposes a retry affordance (the P4 states contract's
/// `QueryError`-equivalent), wired to the model's refresh.
struct TEErrorView: View {
    let title: String
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TELabeledBox(title: title, tone: .danger) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onRetry) {
                    Text(verbatim: TEStrings.string("admin.telemetryErrors.retry", "Retry"))
                        .font(Font.TS.caption)
                        .fontWeight(.semibold)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.xs)
                        .background(Color.TS.accent.opacity(0.16), in: Capsule())
                        .foregroundStyle(Color.TS.accent)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: TEStrings.string("admin.telemetryErrors.retry", "Retry")))
            }
        }
    }
}

// MARK: - Empty (web empty branch — badge + message + raw disclosure)

/// The zero-rows box (web empty branch): a status badge (`0` healthy / `?` unknown
/// shape), the empty message, and — only when the shape was unrecognised — the
/// collapsible raw Tesla response so the operator can debug wire-shape drift.
struct TEEmptyView: View {
    let title: String
    let ok: Bool
    let message: String
    let rawJSONText: String?

    var body: some View {
        TELabeledBox(title: title) {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack {
                    Spacer(minLength: 0)
                    TSStatusPill("\(ok ? "0" : "?")", tone: ok ? .success : .warning)
                        .accessibilityLabel(Text(verbatim: badgeA11y))
                }
                Text(verbatim: message)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let rawJSONText {
                    rawDisclosure(rawJSONText)
                }
            }
        }
    }

    private var badgeA11y: String {
        ok
            ? TEStrings.string("admin.telemetryErrors.okBadgeA11y", "Zero errors reported")
            : TEStrings.string("admin.telemetryErrors.unknownBadgeA11y", "Unrecognized response shape")
    }

    private func rawDisclosure(_ json: String) -> some View {
        DisclosureGroup {
            ScrollView([.vertical, .horizontal]) {
                Text(verbatim: json)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(TSSpacing.sm)
            }
            .frame(maxHeight: 256)
            .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        } label: {
            Text(verbatim: TEStrings.string("devtools.errorsRaw", "Show raw Tesla response"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .tint(Color.TS.textMuted)
    }
}

// MARK: - Code chip (web `<Badge variant="danger">`)

/// The danger-tinted error-code chip (web `Badge variant="danger"`), built like the
/// shared `TSBadge` tokens but taking the runtime code string the
/// `LocalizedStringKey`-only `TSBadge` cannot express.
struct TECodeChip: View {
    let code: String

    var body: some View {
        Text(verbatim: code)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(Color.TS.statusDanger)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.statusDanger.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: code))
    }
}

// MARK: - Data table (web `DataTable` + download)

/// The populated state (web `errors.length > 0`): the shared `TSDataTable` with the
/// timestamp / code / message columns, plus the JSON download affordance (web
/// download Blob → native `ShareLink`).
struct TEErrorsTable: View {
    let rows: [TelemetryErrorRow]
    let export: TelemetryErrorsExport
    let downloadLabel: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSDataTable(rows: rows, columns: columns, density: .compact)
            ShareLink(item: export.json) {
                Label {
                    Text(verbatim: downloadLabel).font(Font.TS.caption)
                } icon: {
                    Image(systemName: "square.and.arrow.down")
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            }
            .accessibilityLabel(Text(verbatim: downloadLabel))
        }
    }

    private var columns: [TSColumn<TelemetryErrorRow>] {
        [
            TSColumn(id: "timestamp", title: title("Timestamp", "Timestamp")) { row in
                Text(verbatim: TelemetryErrorsFormat.timestamp(row.timestamp))
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            },
            TSColumn(id: "code", title: title("Code", "Code")) { row in
                if row.code.isEmpty {
                    Text(verbatim: TelemetryErrorsFormat.dash)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                } else {
                    TECodeChip(code: row.code)
                }
            },
            TSColumn(id: "message", title: title("Message", "Message")) { row in
                Text(verbatim: row.message.isEmpty ? TelemetryErrorsFormat.dash : row.message)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        ]
    }

    private func title(_ key: String, _ fallback: String) -> LocalizedStringKey {
        "\(TEStrings.string(key, fallback))"
    }
}
