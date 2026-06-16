import SwiftUI

/// The adaptive export-jobs table for `ExportsPage` (web `<table>` inside `GlassPanel1`):
/// a columnar `Grid` on macOS / iPad regular width and per-row cards on compact iPhone.
/// Reproduces the web columns — the master select-all checkbox, Type, Format (uppercased),
/// Size (`formatBytes`), Created (`formatDateTime`), the status `Badge`, and the per-row
/// Download link for `ready` jobs — plus the per-row selection checkbox. Kept as a
/// dedicated surface (mirroring `DLQEntriesTable`) so the page file stays focused on
/// chrome + states. All copy resolves from `Localizable.xcstrings`; data binds through the
/// `@Observable` `ExportsPageModel` (no networking in the view).
struct ExportsTable: View {
    let model: ExportsPageModel
    let jobs: [ExportJobSummary]

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
        if isCompact {
            compactList
        } else {
            regularTable
        }
    }

    // MARK: - Regular (macOS / iPad) columnar grid

    private var regularTable: some View {
        Grid(alignment: .leading, horizontalSpacing: TSSpacing.md, verticalSpacing: TSSpacing.sm) {
            GridRow {
                selectAllToggle
                header("exportsList.col.type")
                header("exportsList.col.format")
                header("exportsList.col.size")
                header("exportsList.col.created")
                header("exportsList.col.status")
                Color.clear.frame(width: 1, height: 1).gridCellUnsizedAxes([.horizontal, .vertical])
            }
            Divider().overlay(Color.TS.border).gridCellColumns(7)
            ForEach(jobs) { job in
                GridRow {
                    rowToggle(job)
                    primaryText(job.type)
                    mutedText(ExportsFormat.upper(job.format))
                    mutedText(ExportsFormat.bytes(job.fileSize))
                    mutedText(ExportsFormat.dateTime(job.createdAt))
                    statusBadge(job)
                    downloadCell(job).gridColumnAlignment(.trailing)
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text(verbatim: rowAccessibilitySummary(job)))
                Divider().overlay(Color.TS.border.opacity(0.5)).gridCellColumns(7)
            }
        }
    }

    private func header(_ key: LocalizedStringKey) -> some View {
        Text(key)
            .font(Font.TS.label)
            .foregroundStyle(Color.TS.textSecondary)
            .accessibilityAddTraits(.isHeader)
    }

    private func primaryText(_ value: String) -> some View {
        Text(verbatim: value).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
    }

    private func mutedText(_ value: String) -> some View {
        Text(verbatim: value).font(Font.TS.bodySm).foregroundStyle(Color.TS.textSecondary)
    }

    // MARK: - Compact (iPhone) cards

    private var compactList: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                selectAllToggle
                TSCaption("bulk.selectAll")
            }
            ForEach(jobs) { job in
                rowCard(job)
            }
        }
    }

    private func rowCard(_ job: ExportJobSummary) -> some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    rowToggle(job)
                    Text(verbatim: job.type)
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textPrimary)
                    Spacer(minLength: TSSpacing.sm)
                    statusBadge(job)
                }
                labeledRow("exportsList.col.format", ExportsFormat.upper(job.format))
                labeledRow("exportsList.col.size", ExportsFormat.bytes(job.fileSize))
                labeledRow("exportsList.col.created", ExportsFormat.dateTime(job.createdAt))
                if model.downloadURL(for: job) != nil {
                    downloadCell(job).frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func labeledRow(_ label: LocalizedStringKey, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(Font.TS.caption).foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    // MARK: - Status badge (web `<Badge variant={statusVariant(j.status)}>{status}</Badge>`)

    /// The status badge. Web renders the raw status token
    /// (`t('exportsList.status.${status}', status)` with the status value as the i18n
    /// fallback — no per-status keys are defined), so the badge text is the wire token
    /// tinted by `statusVariant`. Passing the token as a `LocalizedStringKey` reproduces
    /// that: with no catalog entry, SwiftUI renders the token verbatim.
    private func statusBadge(_ job: ExportJobSummary) -> some View {
        TSBadge(LocalizedStringKey(job.rawStatus), tone: job.status.tone)
    }

    // MARK: - Download (web `<a href={exportDownloadUrl(j.id)} download>`)

    @ViewBuilder
    private func downloadCell(_ job: ExportJobSummary) -> some View {
        if let url = model.downloadURL(for: job) {
            Link(destination: url) {
                Text("exportsList.download")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.accent)
                    .underline()
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isLink)
            .accessibilityLabel(Text("exportsList.download"))
        } else {
            // A real (tiny) view keeps the columnar Grid aligned — an EmptyView would be
            // skipped, collapsing the trailing column for non-`ready` rows.
            Color.clear.frame(width: 1, height: 1)
        }
    }

    // MARK: - Selection controls (web master + per-row checkboxes)

    private var selectAllToggle: some View {
        Button {
            model.toggleAll()
        } label: {
            Image(systemName: selectAllSymbol)
                .foregroundStyle(model.selectAllState == .none ? Color.TS.textMuted : Color.TS.accent)
                .imageScale(.large)
        }
        .buttonStyle(.plain)
        .disabled(jobs.isEmpty)
        .accessibilityLabel(Text("bulk.selectAll"))
        .accessibilityAddTraits(model.selectAllState == .all ? [.isButton, .isSelected] : .isButton)
    }

    private var selectAllSymbol: String {
        switch model.selectAllState {
        case .all: "checkmark.square.fill"
        case .some: "minus.square.fill"
        case .none: "square"
        }
    }

    private func rowToggle(_ job: ExportJobSummary) -> some View {
        let isSelected = model.isSelected(job.id)
        return Button {
            model.toggle(job.id)
        } label: {
            Image(systemName: isSelected ? "checkmark.square.fill" : "square")
                .foregroundStyle(isSelected ? Color.TS.accent : Color.TS.textMuted)
                .imageScale(.large)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: selectExportLabel(job.id)))
        .accessibilityHint(Text("bulk.selectRow"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    /// Web `aria-label={t('exportsList.selectExport', 'Select export {{id}}', { id })}` —
    /// looks up the exact `exportsList.selectExport` key and injects the job id.
    private func selectExportLabel(_ id: String) -> String {
        String(format: String(localized: "exportsList.selectExport"), id)
    }

    /// A combined VoiceOver summary for a row so the columnar grid reads as one element.
    private func rowAccessibilitySummary(_ job: ExportJobSummary) -> String {
        "\(job.type), \(ExportsFormat.upper(job.format)), \(job.rawStatus)"
    }
}
