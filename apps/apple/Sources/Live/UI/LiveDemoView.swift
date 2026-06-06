import SwiftUI

/// A self-contained demo of the live-data lifecycle, used by SwiftUI previews and
/// the XCUITest demo path (`-uiTestLiveDemo`). It proves the live indicator and
/// stale banner behavior on both idioms: the controls drive a `DemoLiveSource`
/// turn by turn — push a fresh update, go stale, reconnect, or simulate a 401 —
/// while the badge and `LiveStateView` react. It is real infrastructure (the same
/// store + modifier + views the app ships), not a mock screen.
public struct LiveDemoView: View {
    @State private var source = DemoLiveSource()
    @State private var store: LiveDataStore<LiveDemoSnapshot, LiveFleetEvent>

    public init() {
        let source = DemoLiveSource()
        _source = State(initialValue: source)
        _store = State(initialValue: .demo(source: source, auth: DemoAuthChallenge()))
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    header
                    LiveStateView(
                        status: store.status,
                        onRetry: { store.refresh() },
                        onReconnect: { source.reconnect() },
                        content: { snapshotCard }
                    )
                    controls
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .navigationTitle("live.demo.title")
            .liveData(store)
        }
    }

    private var header: some View {
        HStack {
            Text("live.demo.title")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Spacer()
            LiveConnectionBadge(store.status)
        }
    }

    private var snapshotCard: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text("live.demo.updates \(store.value?.updateCount ?? 0)")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityIdentifier("live.demo.updates")
                Text(verbatim: "\(store.value?.lastField ?? "—"): \(store.value?.lastValue ?? "—")")
                    .font(Font.TS.title)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityIdentifier("live.demo.lastValue")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var controls: some View {
        VStack(spacing: TSSpacing.sm) {
            TSButton("live.demo.pushUpdate") { source.emitUpdate() }
                .accessibilityIdentifier("live.demo.pushUpdate")
            TSButton("live.demo.goStale", variant: .secondary) { source.goStale() }
                .accessibilityIdentifier("live.demo.goStale")
            TSButton("live.demo.reconnect", variant: .secondary) { source.reconnect() }
                .accessibilityIdentifier("live.demo.reconnect")
            TSButton("live.demo.fail401", variant: .destructive) { source.fail401() }
                .accessibilityIdentifier("live.demo.fail401")
        }
    }
}

#if DEBUG
    #Preview("Live demo") {
        LiveDemoView()
            .teslaSyncTheme()
    }

    #Preview("Stale banner") {
        LiveStaleBanner(onReconnect: {})
            .padding()
    }

    #Preview("Connection badge") {
        VStack(spacing: 16) {
            LiveConnectionBadge(LiveStatus(
                phase: .open, presentation: .fresh, isActive: true, isStale: false, hasError: false
            ))
            LiveConnectionBadge(LiveStatus(
                phase: .stale, presentation: .stale, isActive: true, isStale: true, hasError: false
            ))
            LiveConnectionBadge(LiveStatus(
                phase: .reconnecting, presentation: .stale, isActive: true, isStale: false, hasError: false
            ))
        }
        .padding()
    }
#endif
