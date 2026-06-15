import SwiftUI

// MARK: - Signals table panel (web GlassPanel6 state ladder)

/// The signals panel body (web GlassPanel6): the full select-prompt → skeleton → diagnostic →
/// no-match → table ladder, driven by the model's `tablePhase`. Implements every data state the
/// page renders (loading / empty / error / success) and never shows a blank region (ADR-011).
struct RedisSignalsTable: View {
    @Bindable var model: RedisSignalViewerPageModel

    var body: some View {
        switch model.tablePhase {
        case .selectPrompt:
            TSEmptyState(
                title: "redis.selectPrompt",
                systemImage: "cylinder.split.1x2.fill"
            )
            .frame(maxWidth: .infinity, minHeight: RedisSignalViewerPage.panelMinHeight)
        case .loading:
            loadingSkeleton
        case let .diagnostic(meta, errorMessage):
            RedisSignalDiagnostic(meta: meta, errorMessage: errorMessage) {
                Task { await model.refreshSignals() }
            }
        case .noMatch:
            TSEmptyState(
                title: "redis.noMatch",
                systemImage: "magnifyingglass"
            )
            .frame(maxWidth: .infinity, minHeight: RedisSignalViewerPage.panelMinHeight)
        case let .table(rows):
            TSDataTable(rows: rows, columns: Self.columns)
                .accessibilityLabel(Text("redis.title"))
        }
    }

    /// Web `<Skeleton>` rows shown while the snapshot loads.
    private var loadingSkeleton: some View {
        VStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 5, id: \.self) { _ in
                TSSkeleton(height: 28)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityLabel(Text("redis.title"))
    }

    // MARK: Columns (web `buildColumns`)

    static let columns: [TSColumn<RedisSignalRow>] = [
        TSColumn(
            id: "name",
            title: "redis.signalName",
            comparator: { lhs, rhs in lhs.name.localizedCompare(rhs.name) },
            cell: { row in
                Text(verbatim: row.name)
                    .font(.system(.body, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
            }
        ),
        TSColumn(id: "value", title: "redis.value") { row in
            RedisValueCell(row: row)
        },
        TSColumn(
            id: "type",
            title: "redis.type",
            comparator: { lhs, rhs in lhs.value.typeLabel.localizedCompare(rhs.value.typeLabel) },
            cell: { row in
                RedisChip(text: row.value.typeLabel, tone: Self.typeTone(row.value.typeLabel))
            }
        ),
        TSColumn(
            id: "category",
            title: "redis.category",
            comparator: { lhs, rhs in lhs.category.label.localizedCompare(rhs.category.label) },
            cell: { row in
                RedisChip(text: row.category.label, tone: row.category.tone.tsTone)
            }
        )
    ]

    /// Web `variant={row.type === 'number' ? 'info' : row.type === 'boolean' ? 'warning' :
    /// 'neutral'}`.
    static func typeTone(_ typeLabel: String) -> TSTone {
        switch typeLabel {
        case "number": .info
        case "boolean": .warning
        default: .neutral
        }
    }
}

// MARK: - Value cell (web value column render)

/// The Value column cell (web): location signals route through the masked-coordinate reveal so
/// a casual screen-share doesn't leak a parking spot; every other value uses the per-type
/// syntax-highlight color (number → info, boolean → accent, string → warning), mirroring the
/// web `text-cyan-300 / text-purple-300 / text-amber-300` convention with token colors.
struct RedisValueCell: View {
    let row: RedisSignalRow

    var body: some View {
        if row.isLocation {
            RedisMaskedValue(value: row.value.display)
        } else {
            Text(verbatim: row.value.display)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(color)
        }
    }

    private var color: Color {
        switch row.value {
        case .number: Color.TS.statusInfo
        case .boolean: Color.TS.accent
        case .string: Color.TS.statusWarning
        }
    }
}

/// A masked coordinate (web `MaskedValue variant="coords"`): shows `••.•••` until the operator
/// taps to reveal, keeping the structure visible while hiding the digits. The web key
/// `redis.maskedCoord` is the accessibility label.
struct RedisMaskedValue: View {
    let value: String
    @State private var revealed = false

    var body: some View {
        Button {
            revealed.toggle()
        } label: {
            Text(verbatim: revealed ? value : "••.•••")
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("redis.maskedCoord"))
        .accessibilityValue(Text(verbatim: revealed ? value : ""))
        .accessibilityAddTraits(.isButton)
    }
}

/// A verbatim token-styled chip for the Type and Category columns (web `Badge`). Local to the
/// viewer because the shared `TSBadge` only accepts a `LocalizedStringKey`, whereas these
/// columns render runtime tokens (`number`/`string`/`boolean`, `Battery`/`Charging`/…).
struct RedisChip: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Diagnostic empty / error state (web `RedisDiagnosticEmptyState` branch)

/// The diagnostic shown when the snapshot loaded with zero cached signals (empty) or the query
/// failed (error) — the in-scope native peer of the web `RedisDiagnosticEmptyState` (its five
/// branch-specific strings belong to that separate parity unit). The error path surfaces the
/// real server message and a Retry; both paths summarize the diagnostic meta so an engineer sees
/// mode / VIN / counts instead of a black box. Never blank (ADR-011).
struct RedisSignalDiagnostic: View {
    let meta: RedisSignalsMeta?
    let errorMessage: String?
    let onRetry: () -> Void

    private var isError: Bool {
        errorMessage != nil
    }

    private var tone: TSTone {
        isError ? .danger : .info
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.sm) {
                Image(systemName: isError ? "exclamationmark.triangle.fill" : "tray")
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text(isError ? "redis.diagnostic.error.title" : "redis.diagnostic.empty.title")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.textPrimary)
                        .accessibilityAddTraits(.isHeader)
                    if let errorMessage {
                        Text(verbatim: errorMessage)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Text("redis.diagnostic.empty.message")
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if let meta {
                metaSummary(meta)
            }
            TSButton("action.retry", variant: .secondary, size: .small, action: onRetry)
        }
        .frame(maxWidth: .infinity, minHeight: RedisSignalViewerPage.panelMinHeight, alignment: .topLeading)
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.08), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
    }

    private func metaSummary(_ meta: RedisSignalsMeta) -> some View {
        RedisAdaptiveStack {
            RedisMetaChip(
                text: String(format: String(localized: "redis.headerChip.mode"), meta.liveSignalStoreMode),
                tone: meta.isHybrid ? .success : .danger
            )
            if !meta.redisKey.isEmpty {
                RedisMetaChip(text: meta.redisKey, tone: .neutral, monospaced: true)
            }
        }
    }
}
