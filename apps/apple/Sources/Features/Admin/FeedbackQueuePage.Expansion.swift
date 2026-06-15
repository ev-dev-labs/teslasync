import SwiftUI

/// The expandable detail panel for one feedback row (web `FeedbackExpansion`): the
/// report body, a metadata grid (app version, user agent, submitter, masked email),
/// the optional recent-errors + console-tail disclosures, and the inline action row
/// (status change, manual GitHub URL save, and — when the bridge is configured and the
/// row has no issue yet — Forward to GitHub). Adaptive: a two-column metadata grid on
/// regular width, stacked on compact iPhone. All copy resolves from
/// `Localizable.xcstrings`; the actions write through the bound `FeedbackQueuePageModel`.
struct FeedbackExpansion: View {
    let row: FeedbackEntry
    let model: FeedbackQueuePageModel

    @State private var issueURL: String

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    init(row: FeedbackEntry, model: FeedbackQueuePageModel) {
        self.row = row
        self.model = model
        _issueURL = State(initialValue: row.githubIssueURL)
    }

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            bodySection
            metadataGrid
            if let errors = row.recentErrors, !errors.isEmpty {
                jsonDisclosure("feedback.queue.expand.recentErrors", value: errors)
            }
            if let tail = row.consoleTail, !tail.isEmpty {
                textDisclosure("feedback.queue.expand.consoleTail", value: tail)
            }
            actionRow
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.surface.opacity(0.5),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    // MARK: - Report body (web expand.body)

    private var bodySection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text("feedback.queue.expand.body")
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: FeedbackQueueFormat.dash(row.body))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: - Metadata grid (web appVersion / userAgent / submitter / userEmail)

    private var metadataGrid: some View {
        LazyVGrid(columns: gridColumns, alignment: .leading, spacing: TSSpacing.md) {
            field("feedback.queue.expand.appVersion", value: FeedbackQueueFormat.dash(row.appVersion), monospaced: true)
            field("feedback.queue.expand.userAgent", value: FeedbackQueueFormat.dash(row.userAgent))
            field("feedback.queue.expand.submitter", value: row.submitterDisplay, monospaced: true)
            emailField
        }
    }

    private var gridColumns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    private func field(_ label: LocalizedStringKey, value: String, monospaced: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(label).font(Font.TS.caption).fontWeight(.semibold).foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(monospaced ? .system(.caption, design: .monospaced) : Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var emailField: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text("feedback.queue.expand.userEmail")
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
            if row.userEmail.isEmpty {
                Text(verbatim: FeedbackQueueFormat.emptyValue)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
            } else {
                TSMaskedValue(row.userEmail)
                    .accessibilityLabel(Text("feedback.queue.maskedEmail"))
            }
        }
    }

    // MARK: - Recent errors / console tail (web `<details>` disclosures)

    private func jsonDisclosure(_ label: LocalizedStringKey, value: String) -> some View {
        DisclosureGroup {
            ScrollView {
                Text(verbatim: FeedbackQueueFormat.prettyJSON(value))
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 200)
            .padding(TSSpacing.sm)
            .background(Color.TS.bg.opacity(0.6), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        } label: {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
        .tint(Color.TS.accent)
    }

    private func textDisclosure(_ label: LocalizedStringKey, value: String) -> some View {
        DisclosureGroup {
            ScrollView {
                Text(verbatim: value)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 200)
            .padding(TSSpacing.sm)
            .background(Color.TS.bg.opacity(0.6), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        } label: {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
        .tint(Color.TS.accent)
    }

    // MARK: - Inline actions (web status `Select` + URL `Input` + Save / Forward)

    private var actionRow: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            Divider().overlay(Color.TS.border)
            if isCompact {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    statusPicker
                    urlField
                    actionButtons
                }
            } else {
                HStack(alignment: .bottom, spacing: TSSpacing.md) {
                    statusPicker
                    urlField
                    actionButtons
                }
            }
        }
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel("feedback.queue.action.changeStatus")
            Picker(selection: statusBinding) {
                ForEach(FeedbackStatus.allCases) { status in
                    Text(LocalizedStringKey(status.labelKey)).tag(status)
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.menu)
            .tint(Color.TS.accent)
            .disabled(model.isUpdating)
            .accessibilityLabel(Text("feedback.queue.action.changeStatus"))
        }
    }

    private var urlField: some View {
        TSTextField("", text: $issueURL, label: "feedback.queue.action.githubUrl")
            .disabled(model.isUpdating)
            .frame(minWidth: isCompact ? nil : 240)
    }

    private var actionButtons: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton("feedback.queue.action.saveUrl", variant: .secondary, size: .small) {
                Task { await model.applyUpdate(id: row.id, update: FeedbackUpdate(githubIssueURL: issueURL)) }
            }
            .disabled(model.isUpdating || issueURL == row.githubIssueURL)

            if model.bridgeEnabled, row.githubIssueURL.isEmpty {
                TSButton(variant: .primary, size: .small) {
                    Task { await model.applyUpdate(id: row.id, update: FeedbackUpdate(forwardToGitHub: true)) }
                } label: {
                    Label("feedback.queue.action.forward", systemImage: "ladybug")
                }
                .disabled(model.isUpdating)
            }
        }
    }

    /// Web status `Select` `onChange` → `onUpdate({ id, update: { status } })`. The
    /// selection reads the current row status; a change posts the single status field.
    private var statusBinding: Binding<FeedbackStatus> {
        Binding(
            get: { row.status },
            set: { newStatus in
                guard newStatus != row.status else { return }
                Task { await model.applyUpdate(id: row.id, update: FeedbackUpdate(status: newStatus)) }
            }
        )
    }
}
