import SwiftUI

// MARK: - Severity styling (web `Badge variant` tints) — shared by status + level badges

extension LiveLogSeverity {
    /// The shared `TSTone` the design system tints badges with (web `Badge variant`).
    var tone: TSTone {
        switch self {
        case .neutral: .neutral
        case .info: .info
        case .warning: .warning
        case .danger: .danger
        }
    }
}

/// A compact tinted capsule (web `Badge`) carrying either a localized key (connection status)
/// or a verbatim token (the dynamic log level). Shared by the controls' status chip and the
/// table's level cell so the tint mapping lives in one place.
struct LiveLogsToneBadge: View {
    enum Content {
        case key(LocalizedStringKey)
        case verbatim(String)
    }

    let content: Content
    let severity: LiveLogSeverity

    var body: some View {
        label
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .foregroundStyle(severity.tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(severity.tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(severity.tone.color.opacity(0.3), lineWidth: 1))
    }

    @ViewBuilder private var label: some View {
        switch content {
        case let .key(key): Text(key)
        case let .verbatim(value): Text(verbatim: value)
        }
    }
}

// MARK: - Error panel (web `GlassPanel` #3 — stream.error)

/// The connection-error panel (web `GlassPanel` #3, rendered when `stream.error`). Shows the
/// "Could not connect to log stream" title plus the technical detail (falling back to the
/// localized hint), tinted with a danger border like the web `border-rose-500/30`.
struct LiveLogsErrorPanel: View {
    let detail: String

    var body: some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    Text("translation.liveLogs.error.title")
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    Text(verbatim: detailText)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: TSSpacing.sm)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var detailText: String {
        detail.isEmpty ? String(localized: "translation.liveLogs.error.hint") : detail
    }
}

// MARK: - Entries panel (web `GlassPanel` #4 — DataTable / EmptyState)

/// The entries panel (web `GlassPanel` #4). Renders the virtualized log table when the buffer
/// has rows (web `DataTable`) or the empty state otherwise (web `EmptyState`), switching on the
/// model's `tableState`. Adaptive (ADR-002/006): a columnar, horizontally + vertically
/// scrollable grid on macOS/iPad regular width; a stacked card list on compact iPhone.
struct LiveLogsEntriesPanel: View {
    @Bindable var model: LiveLogsPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private enum Layout {
        static let time: CGFloat = 96
        static let level: CGFloat = 72
        static let message: CGFloat = 360
        static let fields: CGFloat = 300
        static let maxHeight: CGFloat = 520
    }

    var body: some View {
        TSGlassPanel {
            switch model.tableState {
            case .empty:
                emptyState
            case .success:
                table
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("translation.liveLogs.title"))
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: Empty (web EmptyState — title + message + optional Reconnect)

    @ViewBuilder private var emptyState: some View {
        if model.offersReconnect {
            TSEmptyState(
                title: "translation.liveLogs.title",
                message: "translation.liveLogs.empty.noEvents",
                systemImage: "scroll"
            ) {
                TSButton("translation.liveLogs.controls.reconnect", variant: .secondary, size: .small) {
                    model.reconnect()
                }
            }
        } else {
            TSEmptyState(
                title: "translation.liveLogs.title",
                message: "translation.liveLogs.empty.noEvents",
                systemImage: "scroll"
            )
        }
    }

    // MARK: Table (web DataTable)

    @ViewBuilder private var table: some View {
        if isCompact {
            ScrollView(.vertical, showsIndicators: true) {
                LazyVStack(spacing: TSSpacing.sm) {
                    ForEach(model.filteredEvents) { entry in
                        LiveLogCard(entry: entry, regex: model.grepRegex)
                    }
                }
                .padding(.vertical, TSSpacing.xs)
            }
            .frame(maxHeight: Layout.maxHeight)
        } else {
            ScrollView([.horizontal, .vertical], showsIndicators: true) {
                VStack(spacing: 0) {
                    headerRow
                    Divider().overlay(Color.TS.border)
                    LazyVStack(spacing: 0) {
                        ForEach(model.filteredEvents) { entry in
                            LiveLogRow(entry: entry, regex: model.grepRegex, layout: layoutWidths)
                            Divider().overlay(Color.TS.border.opacity(0.5))
                        }
                    }
                }
            }
            .frame(maxHeight: Layout.maxHeight)
        }
    }

    private var layoutWidths: LiveLogColumnWidths {
        LiveLogColumnWidths(time: Layout.time, level: Layout.level, message: Layout.message, fields: Layout.fields)
    }

    private var headerRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
            headerCell("translation.liveLogs.table.time", width: Layout.time)
            headerCell("translation.liveLogs.table.level", width: Layout.level)
            headerCell("translation.liveLogs.table.message", width: Layout.message)
            headerCell("translation.liveLogs.table.fields", width: Layout.fields)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .background(Color.TS.surface)
    }

    private func headerCell(_ key: LocalizedStringKey, width: CGFloat) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .frame(width: width, alignment: .leading)
    }
}

// MARK: - Row layout widths

struct LiveLogColumnWidths {
    let time: CGFloat
    let level: CGFloat
    let message: CGFloat
    let fields: CGFloat
}

// MARK: - Regular row (web DataTable row)

/// One columnar log row for the regular (macOS/iPad) table: time · level badge · highlighted
/// message · field chips, mirroring the web column set (time / level / message / fields).
struct LiveLogRow: View {
    let entry: LiveLogEntry
    let regex: NSRegularExpression?
    let layout: LiveLogColumnWidths

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Text(verbatim: LiveLogsFormat.time(entry.receivedAt))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .frame(width: layout.time, alignment: .leading)
            LiveLogLevelBadge(entry: entry)
                .frame(width: layout.level, alignment: .leading)
            Text(LiveLogsHighlight.attributed(entry.message, regex: regex))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: layout.message, alignment: .leading)
            LiveLogFieldChips(fields: entry.fields)
                .frame(width: layout.fields, alignment: .leading)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }

    private var accessibilityText: String {
        "\(LiveLogsFormat.time(entry.receivedAt)) \(entry.level.uppercased()) \(entry.message)"
    }
}

// MARK: - Compact card (web DataTable compact density)

/// One stacked log card for compact iPhone width: time + level header, the highlighted
/// message, and the field chips — the same information as the regular row, reflowed.
struct LiveLogCard: View {
    let entry: LiveLogEntry
    let regex: NSRegularExpression?

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: LiveLogsFormat.time(entry.receivedAt))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer()
                LiveLogLevelBadge(entry: entry)
            }
            Text(LiveLogsHighlight.attributed(entry.message, regex: regex))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !entry.fields.isEmpty {
                LiveLogFieldChips(fields: entry.fields)
            }
        }
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Level badge (web level cell)

/// The level cell — the level token uppercased + tinted by severity (web `Badge`), or the
/// localized "no level" sentinel when the row carries no level.
struct LiveLogLevelBadge: View {
    let entry: LiveLogEntry

    var body: some View {
        if entry.level.isEmpty {
            LiveLogsToneBadge(content: .key("translation.liveLogs.table.noLevel"), severity: .neutral)
        } else {
            LiveLogsToneBadge(content: .verbatim(entry.level.uppercased()), severity: entry.severity)
        }
    }
}

// MARK: - Field chips (web fields cell — first 6 + "+N")

/// The fields cell (web `extractFields` chips): up to six `key=value` chips, each truncated to
/// 32 characters, plus a "+N" overflow marker — laid out in a horizontal scroller so the
/// fixed-width column never clips.
struct LiveLogFieldChips: View {
    let fields: [LiveLogField]

    private static let maxChips = 6
    private static let maxValue = 32

    var body: some View {
        if fields.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.xs) {
                    ForEach(fields.prefix(Self.maxChips)) { field in
                        chip(field)
                    }
                    if fields.count > Self.maxChips {
                        Text(verbatim: "+\(fields.count - Self.maxChips)")
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
            }
        }
    }

    private func chip(_ field: LiveLogField) -> some View {
        HStack(spacing: 0) {
            Text(verbatim: "\(field.key)=")
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: truncate(field.value))
                .foregroundStyle(Color.TS.textPrimary)
        }
        .font(.system(size: 10, design: .monospaced))
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .help(Text(verbatim: "\(field.key)=\(field.value)"))
    }

    private func truncate(_ value: String) -> String {
        value.count > Self.maxValue ? "\(value.prefix(Self.maxValue))…" : value
    }
}

// MARK: - Grep highlight (web `HighlightedText` → AttributedString)

/// Builds an `AttributedString` for a message with the grep matches tinted (web
/// `HighlightedText` `<mark>` over an amber background). Zero-width matches are skipped (web
/// guards the infinite loop); an absent/invalid pattern returns the plain message.
enum LiveLogsHighlight {
    static func attributed(_ message: String, regex: NSRegularExpression?) -> AttributedString {
        var attributed = AttributedString(message)
        guard let regex, !message.isEmpty else { return attributed }
        let range = NSRange(message.startIndex..., in: message)
        for match in regex.matches(in: message, range: range) where match.range.length > 0 {
            guard
                let stringRange = Range(match.range, in: message),
                let attributedRange = Range(stringRange, in: attributed)
            else { continue }
            attributed[attributedRange].backgroundColor = Color.TS.statusWarning.opacity(0.3)
            attributed[attributedRange].foregroundColor = Color.TS.textPrimary
        }
        return attributed
    }
}
