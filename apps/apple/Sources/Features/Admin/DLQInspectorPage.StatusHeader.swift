import SwiftUI

/// The DLQ status header (web `StatusHeader`): three summary stat tiles — total entries,
/// replayable entries, and the replay-mode flag — plus the persistent env-gate banner that
/// renders when the server's `replay_enabled` flag is false (web `AlertBanner`, so an
/// operator immediately sees the Replay action below will return HTTP 403). Adaptive: a
/// three-up row on macOS / iPad regular width, stacked on compact iPhone. All copy resolves
/// from `Localizable.xcstrings`.
struct DLQStatusHeader: View {
    let model: DLQInspectorPageModel

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
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            tiles
            if !model.isListLoading, !model.replayEnabled {
                disabledBanner
            }
        }
    }

    @ViewBuilder
    private var tiles: some View {
        if isCompact {
            VStack(spacing: TSSpacing.md) {
                totalTile
                replayableTile
                replayModeTile
            }
        } else {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                totalTile
                replayableTile
                replayModeTile
            }
        }
    }

    private var totalTile: some View {
        DLQStatTile(
            title: "admin.dlq.stats.total",
            value: model.isListLoading ? DLQInspectorFormat.emptyValue : model.totalCount.formatted(),
            sublabel: "admin.dlq.stats.totalSub",
            systemImage: "tray.full"
        )
    }

    private var replayableTile: some View {
        DLQStatTile(
            title: "admin.dlq.stats.replayable",
            value: model.isListLoading ? DLQInspectorFormat.emptyValue : model.replayableCount.formatted(),
            sublabel: "admin.dlq.stats.replayableSub",
            systemImage: "checkmark.shield"
        )
    }

    private var replayModeTile: some View {
        DLQStatTile(
            title: "admin.dlq.stats.replayMode",
            value: replayModeValue,
            sublabel: "admin.dlq.stats.replayModeSub",
            systemImage: "exclamationmark.octagon"
        )
    }

    /// Web `loading ? '—' : enabled ? 'Enabled' : 'Disabled'`.
    private var replayModeValue: String {
        guard !model.isListLoading else { return DLQInspectorFormat.emptyValue }
        return String(localized: model.replayEnabled ? "admin.dlq.stats.enabled" : "admin.dlq.stats.disabled")
    }

    private var disabledBanner: some View {
        TSAlertBanner(
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill",
            title: "admin.dlq.banners.disabledTitle",
            message: "admin.dlq.banners.disabledMessage"
        )
    }
}

/// One stat tile for the DLQ status header (web `StatCard`): a label + icon row, the headline
/// value, and a supporting sublabel. Composed from shared primitives so the header gets the
/// web's label/value/icon/sublabel layout that `TSStatCard` (no sublabel) does not cover.
struct DLQStatTile: View {
    let title: LocalizedStringKey
    let value: String
    let sublabel: LocalizedStringKey
    let systemImage: String

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(title)
                    Spacer(minLength: TSSpacing.sm)
                    TSIconBox(systemName: systemImage, tone: .accent)
                }
                TSMetricValue(value)
                TSCaption(sublabel)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}
