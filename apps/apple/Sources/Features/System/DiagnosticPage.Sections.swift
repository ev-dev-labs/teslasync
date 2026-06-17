import SwiftUI

// MARK: - Panel rendering extensions

/// Panel rendering methods extracted from DiagnosticPage to reduce type body length.
extension DiagnosticPage {
    // MARK: - Panel 1: Error

    func errorPanel(_ error: String) -> some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: "exclamationmark.triangle.fill", tone: .danger)
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSPanelTitle("diagnostic.errorTitle")
                    TSText(LocalizedStringKey(error.isEmpty ? "diagnostic.errorBody" : error), variant: .small)
                }
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("diagnostic.errorTitle"))
    }

    // MARK: - Panel 2: Overall Hero

    func overallHeroPanel(_ report: DiagnosticReport) -> some View {
        TSGlassPanel {
            HStack(alignment: .top) {
                HStack(alignment: .center, spacing: TSSpacing.md) {
                    TSIconBox(
                        systemName: overallIcon(report.overallStatus),
                        tone: overallTone(report.overallStatus)
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        TSHeading(
                            "diagnostic.overall.\(report.overallStatus.rawValue)",
                            level: .h1
                        )
                        TSCaption(
                            LocalizedStringKey("diagnostic.lastRun \(formatDateTime(report.generatedAt))")
                        )
                    }
                }
                Spacer(minLength: TSSpacing.md)
                TSBadge(
                    LocalizedStringKey(
                        String(
                            localized: "diagnostic.checkCount",
                            defaultValue: "\(report.checks.count) checks"
                        )
                    ),
                    tone: overallTone(report.overallStatus)
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("diagnostic.overall.\(report.overallStatus.rawValue)"))
    }

    // MARK: - Panel 3: Actions Bar

    var actionsBar: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton("diagnostic.copyReport", variant: .secondary, size: .medium) {
                copyToClipboard(model.reportJSON)
                showCopyConfirm = true
            }
            TSButton("diagnostic.downloadReport", variant: .secondary, size: .medium) {
                downloadReport()
            }
        }
    }

    // MARK: - Panel 4: Loading

    var loadingPanel: some View {
        TSGlassPanel {
            HStack {
                Spacer()
                VStack(spacing: TSSpacing.md) {
                    ProgressView()
                    TSCaption("diagnostic.running")
                }
                .padding(TSSpacing.xl)
                Spacer()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("diagnostic.running"))
    }

    // MARK: - Panel 5: Empty

    var emptyPanel: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "diagnostic.title",
                message: "diagnostic.noReport",
                systemImage: "waveform.path.ecg"
            ) {
                TSButton("diagnostic.run", variant: .primary, size: .medium) {
                    Task { await model.run() }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("diagnostic.title"))
    }

    // MARK: - Check Cards Grid

    func checkCardsGrid(_ checks: [DiagnosticCheck]) -> some View {
        #if os(iOS)
            let columns = horizontalSizeClass == .regular ? 2 : 1
        #else
            let columns = 2
        #endif

        return LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columns),
            spacing: TSSpacing.md
        ) {
            ForEach(checks) { check in
                checkCard(check)
            }
        }
    }

    // MARK: - Check Card

    func checkCard(_ check: DiagnosticCheck) -> some View {
        TSGlassPanel {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                HStack(alignment: .top, spacing: TSSpacing.md) {
                    TSIconBox(
                        systemName: statusIcon(check.status),
                        tone: statusTone(check.status)
                    )
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSPanelTitle(LocalizedStringKey(check.name))
                        TSCaption(LocalizedStringKey(check.id))
                        TSText(LocalizedStringKey(check.detail), variant: .small)
                            .padding(.top, TSSpacing.xs)
                        if let remediation = check.remediation, !remediation.isEmpty {
                            remediationBox(remediation)
                                .padding(.top, TSSpacing.sm)
                        }
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                    TSBadge(
                        check.status.rawValue.uppercased(),
                        tone: statusTone(check.status)
                    )
                    TSCaption(
                        LocalizedStringKey(
                            String(
                                localized: "diagnostic.duration",
                                defaultValue: "\(check.durationMs)ms"
                            )
                        )
                    )
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(check.name): \(check.status.rawValue)"))
    }

    func remediationBox(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            TSMetricLabel("diagnostic.remediationLabel")
            TSText(LocalizedStringKey(text), variant: .small)
        }
        .padding(TSSpacing.sm)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.5), lineWidth: 1)
        )
    }
}
