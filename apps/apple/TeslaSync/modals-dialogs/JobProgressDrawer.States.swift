//
//  JobProgressDrawer.States.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  The composition sub-views `JobProgressDrawer` builds — the minimized chip, the open panel
//  (header + body), and the two job sections. The job row, the per-status icon, and the
//  loading / empty / error / freshness leaf states live in JobProgressDrawer.Rows.swift. Copy
//  via P1/S10 (`JobProgressDrawerStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Minimized chip (web minimized state)

/// The collapsed chip: a spinner + "{{count}} export running" while active, or a package glyph
/// + "Exports" once settled (web minimized `<button>`). Tap to expand.
struct JobDrawerMinimizedChip: View {
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        Button { model.expand() } label: {
            HStack(spacing: TSSpacing.sm) {
                leading
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: model.minimizedAccessibilityLabel))
    }

    @ViewBuilder
    private var leading: some View {
        if model.activeCount > 0 {
            ProgressView()
                .controlSize(.mini)
                .accessibilityHidden(true)
        } else {
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .accessibilityHidden(true)
        }
    }

    private var label: String {
        if model.activeCount > 0 {
            return JobProgressDrawerStrings.string(
                "export.jobDrawer.activeCount", "{{count}} export running",
                "{{count}}", String(model.activeCount)
            )
        }
        return JobProgressDrawerStrings.string("export.jobDrawer.recentLabel", "Exports")
    }
}

// MARK: - Panel (web open state)

/// The open drawer panel: header, optional cached-data banner, and the body — clipped to the
/// elevated surface with the semantic border (web `surface-elevated` card).
struct JobDrawerPanel: View {
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            JobDrawerHeader(model: model)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.sm)
            Divider().overlay(Color.TS.border)
            if model.connection != .live {
                JobDrawerConnectivityBanner(connection: model.connection)
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.top, TSSpacing.sm)
            }
            JobDrawerBody(model: model)
        }
        .frame(maxWidth: 360, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.panelAccessibilityLabel))
    }
}

// MARK: - Header

/// The panel header: the package glyph, the "Export jobs" title, the optional freshness chip +
/// "{{count}} active" pill, and the Minimize / Dismiss icon buttons.
struct JobDrawerHeader: View {
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "shippingbox.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.title", "Export jobs"))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            if model.connection != .live {
                JobDrawerFreshnessChip(connection: model.connection)
            }
            if model.activeCount > 0 {
                JobDrawerActivePill(count: model.activeCount)
            }
            Spacer(minLength: TSSpacing.sm)
            buttons
        }
    }

    private var buttons: some View {
        HStack(spacing: TSSpacing.xs) {
            iconButton(
                system: "minus",
                key: "export.jobDrawer.minimize",
                fallback: "Minimize"
            ) { model.minimize() }
            iconButton(
                system: "xmark",
                key: "export.jobDrawer.close",
                fallback: "Dismiss"
            ) { model.dismiss() }
        }
    }

    private func iconButton(
        system: String,
        key: String,
        fallback: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: JobProgressDrawerStrings.string(key, fallback)))
    }
}

/// The "{{count}} active" header pill.
struct JobDrawerActivePill: View {
    let count: Int

    var body: some View {
        Text(verbatim: JobProgressDrawerStrings.string(
            "export.jobDrawer.activePill", "{{count}} active", "{{count}}", String(count)
        ))
        .font(Font.TS.caption)
        .fontWeight(.medium)
        .foregroundStyle(Color.TS.accent)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.accent.opacity(0.12), in: Capsule())
        .accessibilityHidden(true)
    }
}

// MARK: - Body

/// The scrollable panel body, switching over the resolved body phase (web loading vs sections,
/// widened with empty + error so the modal is never blank).
struct JobDrawerBody: View {
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                switch model.bodyPhase {
                case .loading:
                    JobDrawerLoadingState()
                case .empty:
                    JobDrawerEmptyState()
                case let .error(message):
                    JobDrawerErrorState(message: message) { model.refresh() }
                case .populated:
                    populated
                }
            }
            .padding(TSSpacing.sm)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 360)
    }

    private var populated: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if let message = model.inlineErrorMessage {
                JobDrawerInlineError(message: message)
            }
            JobDrawerSection(
                label: JobProgressDrawerStrings.string("export.jobDrawer.activeHeading", "In progress"),
                emptyLabel: JobProgressDrawerStrings.string("export.jobDrawer.activeEmpty", "No active exports"),
                jobs: model.activeJobs,
                model: model
            )
            JobDrawerSection(
                label: JobProgressDrawerStrings.string("export.jobDrawer.recentHeading", "Recent"),
                emptyLabel: JobProgressDrawerStrings.string("export.jobDrawer.recentEmpty", "No recent exports"),
                jobs: model.recentJobs,
                model: model
            )
        }
    }
}

// MARK: - Section

/// One labeled job group (web `DrawerSection`): an uppercase heading, then the rows or the
/// empty label (never an absent section).
struct JobDrawerSection: View {
    let label: String
    let emptyLabel: String
    let jobs: [ExportDrawerJob]
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityAddTraits(.isHeader)
            if jobs.isEmpty {
                Text(verbatim: emptyLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                ForEach(jobs) { job in
                    JobDrawerRow(job: job, model: model)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
