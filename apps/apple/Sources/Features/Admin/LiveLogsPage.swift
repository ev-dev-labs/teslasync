import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/LiveLogsPage.tsx` (unrouted in the
/// web app; surfaced here in the System group + deep-linkable at `/live-logs`). Reproduces the
/// web page chrome (web `PageContainer`: title + subtitle) and the four `GlassPanel`s — the
/// filter panel (level / grep / vehicle id), the controls panel (connection badge + buffered /
/// received / drops stats + auto-scroll / pause / clear / download / reconnect), the connection
/// error panel, and the entries panel (the virtualized log table or its empty state).
///
/// The live tail binds through the `@Observable` `LiveLogsPageModel` over an injectable
/// `LiveLogsStreaming` seam (ADR-004/009 — no networking in the view); the subscription opens
/// from `.task(id:)` tied to the view lifecycle (web effect + `AbortController` cleanup) and is
/// restarted by a level/grep/reconnect change. All copy resolves from `Localizable.xcstrings`
/// with the web key names (the `translation.liveLogs.*` mirror). Adaptive across macOS/iPad
/// (regular) + iPhone (compact) per ADR-002/006; a >2-minute staleness indicator honors ADR-013.
public struct LiveLogsPage: View {
    @State private var model: LiveLogsPageModel

    public init(model: LiveLogsPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                LiveLogsFiltersPanel(model: model)
                LiveLogsControlsPanel(model: model)
                if let detail = model.errorDetail {
                    LiveLogsErrorPanel(detail: detail)
                }
                LiveLogsEntriesPanel(model: model)
                footerCaption
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task(id: model.subscription) {
            await model.run()
        }
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("translation.liveLogs.title")
            Text("translation.liveLogs.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Footer (web `Buffered: {{count}} / max LOG_STREAM_MAX_EVENTS` caption)

    private var footerCaption: some View {
        Text(verbatim: LiveLogsFormat.bufferedMaxText(
            count: model.events.count,
            max: LiveLogsPageModel.maxEvents
        ))
        .font(Font.TS.caption)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(Text("translation.liveLogs.stats.buffered"))
    }
}

#if DEBUG
    #Preview("Live") {
        LiveLogsPage(model: LiveLogsPageModel())
            .teslaSyncTheme()
    }

    #Preview("Empty") {
        LiveLogsPage(model: LiveLogsPageModel(source: ScriptedLiveLogsSource([.connected])))
            .teslaSyncTheme()
    }

    #Preview("Error") {
        LiveLogsPage(model: LiveLogsPageModel(
            source: ScriptedLiveLogsSource([.failed(detail: "log stream rejected: 403 Forbidden")])
        ))
        .teslaSyncTheme()
    }
#endif
