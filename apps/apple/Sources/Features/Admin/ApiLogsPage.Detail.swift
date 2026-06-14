import SwiftUI

/// The expandable detail panel for one log row (web `ExpandedDetail`): the request URL
/// (web `GlassPanel`), an error box when the row failed (web red `GlassPanel`), and the
/// request- / response-body JSON viewers (web `JsonViewer` → `GlassPanel`). Adaptive: a
/// two-column body grid on regular width, stacked on compact. Renders only the sections the
/// row actually carries (web conditionals on `error_message` / body presence).
struct ApiLogsExpandedDetail: View {
    let log: ApiCallLog

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            requestURLSection
            if let errorMessage = log.errorMessage, !errorMessage.isEmpty {
                errorSection(errorMessage)
            }
            LazyVGrid(columns: bodyColumns, alignment: .leading, spacing: TSSpacing.md) {
                ApiLogsJsonViewer(
                    title: "translation.apiLogs.requestBody",
                    titleResolved: String(localized: "translation.apiLogs.requestBody"),
                    data: log.requestBody
                )
                ApiLogsJsonViewer(
                    title: "translation.apiLogs.responseBody",
                    titleResolved: String(localized: "translation.apiLogs.responseBody"),
                    data: log.responseBody
                )
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface.opacity(0.5),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
    }

    private var bodyColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    // MARK: - Request URL (web `GlassPanel` — `{method} {endpoint}`)

    private var requestURLSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSCaption("translation.apiLogs.requestUrl")
            ApiLogsMonoBox(text: "\(log.httpMethod) \(log.endpoint)")
        }
    }

    // MARK: - Error (web red `GlassPanel` — error_message)

    private func errorSection(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text("translation.apiLogs.error")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.statusDanger)
            ApiLogsMonoBox(text: message, tone: Color.TS.statusDanger)
        }
    }
}

/// One request/response body viewer (web `JsonViewer`): a label + a pretty-printed JSON box
/// when the body is present, or the italic "No {{label}}" fallback when it is nil.
struct ApiLogsJsonViewer: View {
    let title: LocalizedStringKey
    let titleResolved: String
    let data: String?

    var body: some View {
        if let data, !data.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSCaption(title)
                ApiLogsMonoBox(text: ApiLogsFormat.prettyJSON(data), scrolls: true)
            }
        } else {
            Text(verbatim: ApiLogsPage.noDataText(label: titleResolved))
                .font(Font.TS.caption)
                .italic()
                .foregroundStyle(Color.TS.textMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A monospaced glass box for the expanded-detail values (web inner `GlassPanel`, `!p-3`).
/// Scrollable (bounded height) for JSON bodies; single-block for the request URL / error.
struct ApiLogsMonoBox: View {
    let text: String
    var tone: Color = .TS.textPrimary
    var scrolls = false

    var body: some View {
        content
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel(cornerRadius: TSRadius.md)
    }

    @ViewBuilder
    private var content: some View {
        if scrolls {
            ScrollView(.vertical, showsIndicators: true) {
                textBlock
            }
            .frame(maxHeight: 200)
        } else {
            textBlock
        }
    }

    private var textBlock: some View {
        Text(verbatim: text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(tone)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
