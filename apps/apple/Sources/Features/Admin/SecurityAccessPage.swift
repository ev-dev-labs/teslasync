import SwiftUI

/// Native SwiftUI parity of `web/src/features/admin/pages/SecurityAccessPage.tsx`
/// (route `/security-access`). Reproduces the web page chrome (web `PageContainer`:
/// title + subtitle + page-level loading / error, with the `VehicleSelect` +
/// `RangePicker` actions), the not-secure alert panel (web `GlassPanel` #1), the
/// digital-twin panel (web `GlassPanel` #2 wrapping `VehicleTwin`), and the column of
/// already-shipped security feature views in the same order as the web source:
/// summary stats → status cards → window detail → live state → sentry chart →
/// statistics → history table → timeline.
///
/// Adaptive (ADR-002/006): a single scrolling column; the actions lay out inline on
/// macOS / iPad (regular width) and stack on compact iPhone, and every section lays
/// itself out responsively. Every data state is implemented (loading redaction /
/// error + retry / populated success). All copy resolves from `Localizable.xcstrings`
/// with the web key names; data binds through the `@Observable` `SecurityAccessPageModel`
/// (no networking in the view, ADR-004), which feeds each section model.
public struct SecurityAccessPage: View {
    @State private var model: SecurityAccessPageModel

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(model: SecurityAccessPageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                actions
                stateContent
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.TS.bg.ignoresSafeArea())
        .task {
            if case .loaded = model.state { return }
            await model.load()
        }
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    // MARK: - Header (web PageContainer title + subtitle)

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSPageTitle("admin.security.title")
            Text("admin.security.subtitle")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    // MARK: - Actions (web VehicleSelect + RangePicker)

    @ViewBuilder
    private var actions: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                vehiclePicker
                rangePicker
            }
        } else {
            HStack(spacing: TSSpacing.md) {
                Spacer(minLength: 0)
                vehiclePicker
                rangePicker
            }
        }
    }

    private var vehiclePicker: some View {
        Menu {
            ForEach(model.vehicles) { vehicle in
                Button {
                    model.selectVehicle(vehicle.id)
                } label: {
                    if vehicle.id == model.selectedVehicleID {
                        Label(vehicle.displayName, systemImage: "checkmark")
                    } else {
                        Text(verbatim: vehicle.displayName)
                    }
                }
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "car.fill").font(.caption)
                selectedVehicleLabel
                Image(systemName: "chevron.up.chevron.down").font(.caption2)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .foregroundStyle(Color.TS.textPrimary)
        }
        .menuStyle(.borderlessButton)
        .fixedSize()
        .accessibilityLabel(Text("admin.security.vehicle"))
    }

    @ViewBuilder
    private var selectedVehicleLabel: some View {
        if let name = model.selectedVehicleName {
            Text(verbatim: name).font(Font.TS.bodySm)
        } else {
            Text("admin.security.allVehicles").font(Font.TS.bodySm)
        }
    }

    private var rangePicker: some View {
        Picker(
            "admin.security.range.label",
            selection: Binding(get: { model.range }, set: { model.setRange($0) })
        ) {
            ForEach(SecurityAccessRange.allCases) { option in
                Text(rangeLabel(option)).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .frame(maxWidth: isCompact ? .infinity : 280)
        .accessibilityLabel(Text("admin.security.range.label"))
    }

    private func rangeLabel(_ range: SecurityAccessRange) -> LocalizedStringKey {
        switch range {
        case .day: "admin.security.range.24h"
        case .week: "admin.security.range.7d"
        case .month: "admin.security.range.30d"
        case .all: "admin.security.range.all"
        }
    }

    // MARK: - State router (web PageContainer loading / error + body)

    @ViewBuilder
    private var stateContent: some View {
        switch model.state {
        case .loading:
            loadingState
        case let .error(message):
            errorState(message)
        case .loaded:
            content
        }
    }

    private var loadingState: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(spacing: TSSpacing.sm) {
                ProgressView().controlSize(.small)
                Text("admin.security.loading")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            ForEach(0 ..< 3, id: \.self) { _ in
                TSGlassPanel {
                    VStack(alignment: .leading, spacing: TSSpacing.sm) {
                        Text(verbatim: "—————————").font(Font.TS.section)
                        Text(verbatim: "————————————————").font(Font.TS.body)
                        Text(verbatim: "——————————").font(Font.TS.body)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .redacted(reason: .placeholder) // parity:allow loading-skeleton redaction reason, not a stub
            }
        }
        .accessibilityLabel(Text("admin.security.loading"))
    }

    private func errorState(_ message: String) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.sm) {
                TSErrorDisplay(
                    title: "error.loadFailed",
                    onRetry: { Task { await model.refresh() } }
                )
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    // MARK: - Success body (web column of sections, in source order)

    private var content: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if model.showsAlert {
                alertPanel
            }
            if model.showsTwin, let latest = model.latest {
                digitalTwinPanel(latest)
            }
            SummaryStatsRow(model: model.summary)
            SecurityStatusCards(model: model.cards)
            WindowStatusDetail(model: model.windows)
            LiveVehicleState(model: model.liveState)
            SentryModeChart(model: model.sentry)
            SecurityStatistics(model: model.statistics)
            EventHistoryTable(model: model.history)
            EventTimeline(model: model.timeline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - GlassPanel #1 — not-secure alert (web red-tinted GlassPanel)

    private var alertPanel: some View {
        TSFadeIn {
            TSGlassPanel {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusDanger)
                        .accessibilityHidden(true)
                    Text("admin.security.alert")
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.statusDanger)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
            )
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text("admin.security.alert"))
        }
    }

    // MARK: - GlassPanel #2 — digital twin (web GlassPanel + VehicleTwin)

    private func digitalTwinPanel(_ latest: SecurityReading) -> some View {
        TSFadeIn {
            TSGlassPanel {
                SecurityTwinView(reading: latest, isSecure: model.isSecure)
            }
        }
    }
}

// MARK: - Digital twin (native parity of the web `VehicleTwin` security summary)

/// A HIG-native digital twin of the vehicle's security posture (web `VehicleTwin`):
/// a vehicle glyph tinted by the overall posture, with lock / sentry / posture status
/// chips derived from the latest reading. SwiftUI-native, accessible, and adaptive —
/// not a web clone.
private struct SecurityTwinView: View {
    let reading: SecurityReading
    let isSecure: Bool

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            TSPanelTitle("admin.security.twin.title")
                .frame(maxWidth: .infinity, alignment: .leading)

            Image(systemName: "car.side.fill")
                .font(.system(size: 64))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(isSecure ? Color.TS.statusSuccess : Color.TS.statusWarning)
                .accessibilityHidden(true)

            chips
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary)
    }

    private var locked: Bool {
        reading.locked ?? false
    }

    private var sentryOn: Bool {
        reading.sentryMode.isTruthy
    }

    @ViewBuilder
    private var chips: some View {
        let layout = AnyLayout(
            HStackLayout(spacing: TSSpacing.sm)
        )
        layout {
            chip(
                locked ? "admin.security.twin.locked" : "admin.security.twin.unlocked",
                systemImage: locked ? "lock.fill" : "lock.open.fill",
                tone: locked ? .success : .danger
            )
            chip(
                sentryOn ? "admin.security.twin.sentryOn" : "admin.security.twin.sentryOff",
                systemImage: "video.fill",
                tone: sentryOn ? .info : .neutral
            )
            chip(
                isSecure ? "admin.security.twin.secure" : "admin.security.twin.attention",
                systemImage: isSecure ? "checkmark.shield.fill" : "exclamationmark.shield.fill",
                tone: isSecure ? .success : .warning
            )
        }
    }

    private func chip(_ title: LocalizedStringKey, systemImage: String, tone: TSTone) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.caption2)
            Text(title).font(Font.TS.caption).fontWeight(.medium)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .foregroundStyle(tone.color)
        .background(tone.color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.25), lineWidth: 1))
    }

    private var accessibilitySummary: Text {
        Text("admin.security.twin.title")
    }
}

#if DEBUG
    #Preview("Security & Access") {
        SecurityAccessPage(model: SecurityAccessPageModel())
            .teslaSyncTheme()
    }
#endif
