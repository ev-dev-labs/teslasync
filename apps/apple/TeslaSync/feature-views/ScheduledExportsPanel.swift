//
//  ScheduledExportsPanel.swift
//  TeslaSync — P4 feature view · 0262 · ScheduledExportsPanel (Apple)
//
//  Scheduled exports — the SwiftUI parity of features/system/pages/ScheduledExportsPanel
//  .tsx. Fades in inside a GlassPanel-equivalent surface, shows the cached-data banner
//  when the bound live-state is not fresh, renders the header (title + subtitle + "New
//  schedule" action), the inline new/edit form when open, and switches over the model's
//  resolved phase so every prompt-required state renders (loading / empty / error /
//  content, with the inline-error + stale + offline branches) — never a blank box. The
//  delete confirmation is attached once and binds through `ScheduledExportsModel` (P1/S8);
//  no networking lives here.
//

import SwiftUI

/// The scheduled-exports panel — the SwiftUI parity of the web `ScheduledExportsPanel`,
/// binding through `ScheduledExportsModel` (P1/S8).
public struct ScheduledExportsPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ScheduledExportsSurface.slug

    @State private var model: ScheduledExportsModel

    public init(model: ScheduledExportsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ScheduledExportsHeader(model: model)
                    if model.connection != .live {
                        ScheduledExportsConnectivityBanner(connection: model.connection)
                    }
                    if model.showForm {
                        ScheduledExportForm(model: model)
                    }
                    content
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .scheduledExportsDeleteConfirmation(model: model)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web table-area branch ladder (loading → empty → table), widened with the error
    /// envelope so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ScheduledExportsLoadingState()
        case .empty:
            ScheduledExportsEmptyState()
        case let .error(message):
            ScheduledExportsErrorState(message: message) { model.refresh() }
        case .content:
            ScheduledExportsContent(model: model)
        }
    }
}

// MARK: - Content (web inline error + table)

/// The populated body shown for `.content`: the inline list-error (when a reload failed
/// while rows remain) and the schedule rows.
struct ScheduledExportsContent: View {
    @Bindable var model: ScheduledExportsModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = model.inlineErrorMessage {
                ScheduledExportsInlineError(message: message)
            }
            ScheduledExportsTable(model: model)
        }
    }
}

// MARK: - Header (web heading + subtitle + "New schedule" button)

/// The panel header: the calendar-clock glyph chip, the title + freshness chip, the
/// subtitle, and the trailing "New schedule" primary action (web header row).
struct ScheduledExportsHeader: View {
    @Bindable var model: ScheduledExportsModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSIconBox(systemName: "calendar.badge.clock", tone: .accent)
            titleBlock
            Spacer(minLength: TSSpacing.sm)
            newScheduleButton
        }
        .accessibilityElement(children: .contain)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: ScheduledExportsStrings.string("dataExport.scheduled.title", "Scheduled exports"))
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                ScheduledExportsFreshnessChip(connection: model.connection)
            }
            Text(verbatim: ScheduledExportsStrings.string(
                "dataExport.scheduled.subtitle", "Cron-driven recurring exports."
            ))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var newScheduleButton: some View {
        TSButton(
            variant: .primary,
            size: .small,
            action: { model.startCreate() },
            label: {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                    Text(verbatim: ScheduledExportsStrings.string("dataExport.scheduled.newSchedule", "New schedule"))
                }
            }
        )
        .accessibilityLabel(Text(verbatim: ScheduledExportsStrings.string(
            "dataExport.scheduled.newSchedule", "New schedule"
        )))
    }
}
