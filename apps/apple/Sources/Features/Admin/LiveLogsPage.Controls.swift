import SwiftUI

/// The controls panel for `LiveLogsPage` (web `GlassPanel` #2 — the controls bar). Reproduces
/// the web row: the connection badge (+ an ADR-013 staleness chip), the buffered / received /
/// server-drop stat captions, and the auto-scroll toggle, Pause/Resume, Clear buffer, Download
/// (.txt), and Reconnect actions. Kept as a dedicated surface so the page file stays focused.
///
/// Adaptive (ADR-002/006): the status group and the action group each scroll horizontally so
/// nothing clips on compact iPhone width while staying a single tidy bar on macOS/iPad. All
/// copy resolves from `Localizable.xcstrings`; the panel binds to the `@Observable` model.
struct LiveLogsControlsPanel: View {
    @Bindable var model: LiveLogsPageModel

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                statusBar
                Divider().overlay(Color.TS.border)
                actionBar
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: - Status group (web connection badge + stats)

    private var statusBar: some View {
        TimelineView(.periodic(from: .now, by: 15)) { context in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.md) {
                    LiveLogsToneBadge(
                        content: .key(LocalizedStringKey(model.status.labelKey)),
                        severity: model.status.severity
                    )
                    .accessibilityLabel(Text(LocalizedStringKey(model.status.labelKey)))

                    if model.isStale(asOf: context.date) {
                        LiveLogsToneBadge(content: .key("translation.liveLogs.status.stale"), severity: .warning)
                    }

                    statCaption("translation.liveLogs.stats.buffered", count: model.events.count)
                    statCaption("translation.liveLogs.stats.received", count: model.totalReceived)
                    if model.drops > 0 {
                        statCaption(
                            "translation.liveLogs.stats.drops",
                            count: model.drops,
                            color: Color.TS.statusWarning
                        )
                    }
                }
            }
        }
    }

    private func statCaption(_ key: String, count: Int, color: Color = Color.TS.textMuted) -> some View {
        Text(verbatim: LiveLogsFormat.countText(key, count: count))
            .font(Font.TS.caption)
            .foregroundStyle(color)
            .fixedSize()
    }

    // MARK: - Action group (web toggle + buttons)

    private var actionBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: TSSpacing.md) {
                autoscrollToggle
                pauseButton
                clearButton
                downloadButton
                reconnectButton
            }
        }
    }

    private var autoscrollToggle: some View {
        Toggle(isOn: $model.autoscroll) {
            Text("translation.liveLogs.controls.autoscroll").font(Font.TS.caption)
        }
        .toggleStyle(.switch)
        .controlSize(.mini)
        .tint(Color.TS.accent)
        .fixedSize()
    }

    private var pauseButton: some View {
        TSButton(variant: .secondary, size: .small) {
            model.togglePause()
        } label: {
            Label(
                model.paused ? "translation.liveLogs.controls.resume" : "translation.liveLogs.controls.pause",
                systemImage: model.paused ? "play.fill" : "pause.fill"
            )
        }
    }

    private var clearButton: some View {
        TSButton(variant: .ghost, size: .small) {
            model.clear()
        } label: {
            Label("translation.liveLogs.controls.clear", systemImage: "trash")
        }
    }

    private var downloadButton: some View {
        ShareLink(item: model.downloadBody()) {
            Label("translation.liveLogs.controls.download", systemImage: "square.and.arrow.down")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(model.canDownload ? Color.TS.accent : Color.TS.textMuted)
        }
        .disabled(!model.canDownload)
    }

    private var reconnectButton: some View {
        TSButton(variant: .ghost, size: .small) {
            model.reconnect()
        } label: {
            Label("translation.liveLogs.controls.reconnect", systemImage: "arrow.clockwise")
        }
    }
}
