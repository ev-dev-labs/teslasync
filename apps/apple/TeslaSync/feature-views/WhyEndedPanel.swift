//
//  WhyEndedPanel.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  The Drive Detail "Why did this drive end?" diagnostic panel — the SwiftUI
//  parity of features/driving/components/drive-detail/WhyEndedPanel.tsx. A
//  collapsible glass panel (web `GlassPanel p-6`) that starts collapsed and, when
//  expanded, joins the FSM transition history with the raw signal window around
//  the drive end so an operator can correlate state changes with what the vehicle
//  was reporting. The query is lazy behind the disclosure (web `useDriveWhyEnded(…,
//  expanded)`); the server-validated window selector + `DataTable` pagination live
//  on the model. Binds through `WhyEndedPanelModel` (P1/S8) — no networking here.
//

import SwiftUI

/// The Drive Detail "Why did this drive end?" diagnostic panel, binding through
/// `WhyEndedPanelModel` (P1/S8). No networking lives here.
public struct WhyEndedPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = WhyEndedPanelSurface.slug

    @State private var model: WhyEndedPanelModel

    public init(model: WhyEndedPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.expanded {
                expandedBody
            }
        }
        .padding(TSSpacing.x2xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel()
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (disclosure button + freshness + window selector)

extension WhyEndedPanel {
    /// The web `flex flex-wrap items-center justify-between gap-3` header: the
    /// disclosure button on the leading edge; the freshness chip + window selector
    /// on the trailing edge, shown only while expanded (web `{expanded && …}`).
    private var header: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            disclosureButton
            Spacer(minLength: TSSpacing.sm)
            if model.expanded {
                WhyEndedFreshnessChip(connection: model.connection)
                WhyEndedWindowPicker(model: model)
            }
        }
    }

    /// The web ghost `Button` whose label is the panel title, with a leading
    /// chevron that points down when expanded / right when collapsed. Carries the
    /// web `aria-expanded` as an accessibility value, plus a header trait + hint.
    private var disclosureButton: some View {
        Button {
            model.toggleExpanded()
        } label: {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: model.expanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textSecondary)
                    .accessibilityHidden(true)
                Text(verbatim: WhyEndedPanelStrings.title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.title))
        .accessibilityValue(Text(verbatim: model.expanded
                ? WhyEndedPanelStrings.expandedState
                : WhyEndedPanelStrings.collapsedState))
        .accessibilityHint(Text(verbatim: WhyEndedPanelStrings.toggleHint))
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Expanded body (states)

extension WhyEndedPanel {
    /// The web `mt-4 space-y-6` expanded body: the connectivity banner (native
    /// HIG chrome, shown when not live), then the loading / error / content
    /// branches (web `isLoading ? Spinner : error ? EmptyState : <sections>`).
    private var expandedBody: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            if model.connection != .live {
                WhyEndedConnectivityBanner(connection: model.connection)
            }
            switch model.phase {
            case .loading:
                WhyEndedLoadingView()
            case let .error(message):
                WhyEndedErrorView(message: message) { model.refresh() }
            case .content:
                WhyEndedTransitionsSection(model: model)
                WhyEndedSignalSection(model: model)
            }
        }
    }
}

// MARK: - Window selector (web `Select` w-40)

/// The diagnostic-window selector — the web `Select` (options 30s/60s/5m/15m,
/// aria-label "Diagnostic window"), as a native menu `Picker`. Width mirrors the
/// web `w-40`. Strings resolve through the P1/S10 facade.
struct WhyEndedWindowPicker: View {
    let model: WhyEndedPanelModel

    var body: some View {
        let selection = Binding(
            get: { model.window },
            set: { model.selectWindow($0) }
        )
        Picker(selection: selection) {
            ForEach(DriveDiagnosticWindow.allCases, id: \.self) { window in
                Text(verbatim: WhyEndedPanelStrings.windowOption(window)).tag(window)
            }
        } label: {
            EmptyView()
        }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(Color.TS.accent)
        .frame(maxWidth: 160, alignment: .trailing)
        .accessibilityLabel(Text(verbatim: WhyEndedPanelStrings.windowAria))
        .accessibilityValue(Text(verbatim: WhyEndedPanelStrings.windowOption(model.window)))
    }
}
