import SwiftUI

/// The two payload viewers in the entry drawer (web drawer tabs: inner payload vs raw
/// envelope).
enum DLQPayloadTab: Hashable {
    case inner
    case raw
}

/// The inspect drawer for `DLQInspectorPage` (web `EntryDrawer`). A slide-in HIG sheet that
/// lazy-loads the FULL entry (summary + base64 raw + inner payloads) on present. The header
/// summary always renders from the cached `selected` row; the payload viewer switches its
/// own data state (loading / error / success). The footer hosts the Replay CTA, disabled
/// when the env gate is off, the entry is not replayable, the entry is still loading, or a
/// replay is already in flight (web `replayDisabled`). The replay confirmation stacks on top
/// of this sheet, mirroring the web `ConfirmDialog` over the open `Drawer`. All copy resolves
/// from `Localizable.xcstrings`; state binds to the `@Observable` `DLQInspectorPageModel`.
struct DLQEntryDrawer: View {
    @Bindable var model: DLQInspectorPageModel
    let summary: DLQEntrySummary
    @State private var activeTab: DLQPayloadTab = .inner

    var body: some View {
        DLQSheetScaffold(title: titleText) {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSGlassPanel { TSKVList(rows: summaryRows) }
                TSGlassPanel { payloadSection }
            }
        } footer: {
            footer
        }
        .task { await model.loadEntry(summary.id) }
        .sheet(item: $model.pendingReplay) { target in
            DLQReplayConfirmSheet(model: model, target: target)
        }
    }

    /// Web `'DLQ entry #{{id}}'`.
    private var titleText: String {
        String(format: String(localized: "admin.dlq.drawer.title"), String(summary.id))
    }

    // MARK: - Summary (web KVList panel)

    private var summaryRows: [TSKVRow] {
        let arrived = DLQInspectorFormat.dateTime(summary.arrivedAt)
        let vin = summary.parsedVIN ?? DLQInspectorFormat.emptyValue
        let src = summary.parsedSourceTopic ?? DLQInspectorFormat.emptyValue
        let parseErr = summary.parseError ?? DLQInspectorFormat.emptyValue
        return [
            TSKVRow(id: "id", key: "admin.dlq.drawer.id", value: String(summary.id)),
            TSKVRow(id: "arrived", key: "admin.dlq.drawer.arrivedAt", value: arrived),
            TSKVRow(id: "dlqTopic", key: "admin.dlq.drawer.dlqTopic", value: dash(summary.dlqTopic)),
            TSKVRow(id: "reason", key: "admin.dlq.drawer.reason", value: dash(summary.parsedReason)),
            TSKVRow(id: "vin", key: "admin.dlq.drawer.vin", value: vin),
            TSKVRow(id: "src", key: "admin.dlq.drawer.sourceTopic", value: src),
            TSKVRow(id: "redel", key: "admin.dlq.drawer.redeliveries", value: redeliveries),
            TSKVRow(id: "parseErr", key: "admin.dlq.drawer.parseError", value: parseErr)
        ]
    }

    private var redeliveries: String {
        guard let count = summary.parsedRedeliveries else { return DLQInspectorFormat.emptyValue }
        return count.formatted()
    }

    private func dash(_ value: String) -> String {
        value.isEmpty ? DLQInspectorFormat.emptyValue : value
    }

    // MARK: - Payload (web tabs + CopyButton + decoded <pre>)

    private var payloadSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTabs(selection: $activeTab, tabs: [
                TSTab(.inner, "admin.dlq.drawer.tabs.inner"),
                TSTab(.raw, "admin.dlq.drawer.tabs.raw")
            ])
            payloadState
        }
    }

    @ViewBuilder
    private var payloadState: some View {
        switch model.entryState {
        case .loading:
            HStack {
                Spacer()
                TSSpinner(label: "admin.dlq.audit.loading")
                Spacer()
            }
            .padding(.vertical, TSSpacing.x2xl)
        case let .error(message):
            TSErrorDisplay(onRetry: { Task { await model.loadEntry(summary.id) } })
                .accessibilityValue(Text(verbatim: message))
        case let .loaded(full):
            payloadViewer(full)
        }
    }

    private func payloadViewer(_ full: DLQEntryFull) -> some View {
        let decoded = decodedText(full)
        return VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                Spacer()
                TSCopyButton(value: copyValue(full, decoded: decoded))
            }
            ScrollView {
                Text(verbatim: decoded ?? binaryMarker)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
            .frame(maxHeight: 280)
            .padding(TSSpacing.sm)
            .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }

    /// Decoded UTF-8 text for the active tab (web `innerText` / `rawText`); nil for binary.
    private func decodedText(_ full: DLQEntryFull) -> String? {
        let base64 = activeTab == .inner ? full.innerPayloadB64 : full.rawPayloadB64
        return DLQInspectorFormat.decodeBase64UTF8(base64)
    }

    /// Web `innerText || full.inner_payload_b64` — decoded text if available, else base64.
    private func copyValue(_ full: DLQEntryFull, decoded: String?) -> String {
        if let decoded { return decoded }
        return activeTab == .inner ? full.innerPayloadB64 : full.rawPayloadB64
    }

    /// Web binary fallback marker with the exact byte size.
    private var binaryMarker: String {
        let key: String.LocalizationValue = activeTab == .inner
            ? "admin.dlq.drawer.binaryPayload"
            : "admin.dlq.drawer.binaryEnvelope"
        let size = activeTab == .inner ? summary.innerPayloadSize : summary.rawPayloadSize
        return String(format: String(localized: key), String(size))
    }

    // MARK: - Footer (web Close + Replay)

    private var footer: some View {
        Group {
            Spacer(minLength: 0)
            TSButton("common.close", variant: .secondary) {
                model.closeDrawer()
            }
            .disabled(model.isReplaying)
            TSButton(variant: .primary, size: .medium, isLoading: model.isReplaying) {
                model.askReplay()
            } label: {
                Label("admin.dlq.drawer.replay", systemImage: "paperplane.fill")
            }
            .disabled(model.replayCTADisabled)
        }
    }
}
