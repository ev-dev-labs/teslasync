//
//  JobProgressDrawer.Rows.swift
//  TeslaSync — P4 modal / dialog · 0005 · JobProgressDrawer (Apple)
//
//  The job-row + leaf-state sub-views `JobProgressDrawer` composes (split from
//  JobProgressDrawer.States.swift for the lint file-length budget): the job row, the
//  per-status icon, the loading / empty / error / inline-error states, the freshness chip,
//  and the cached-data banner. Every state renders real chrome — never a blank box. Copy via
//  P1/S10 (`JobProgressDrawerStrings`); chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Row

/// One job row (web `JobRow`): the status icon, the type + format, the status / size detail
/// line, any error, and the trailing Download (ready) / details glyph (failed).
struct JobDrawerRow: View {
    let job: ExportDrawerJob
    @Bindable var model: JobProgressDrawerModel

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            JobDrawerStatusIcon(status: job.status)
            VStack(alignment: .leading, spacing: 2) {
                titleRow
                Text(verbatim: model.detailLine(job))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                if let error = job.errorMessage, !error.isEmpty {
                    Text(verbatim: error)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusDanger)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: TSSpacing.xs)
            trailing
        }
        .padding(TSSpacing.xs)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .fill(job.isActive ? Color.TS.surfaceGlass : Color.clear)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(job)))
        .accessibilityAddTraits(job.status == .ready ? .isButton : [])
    }

    private var titleRow: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: model.typeLabel(job))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: model.formatLabel(job))
                .font(Font.TS.caption)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    @ViewBuilder
    private var trailing: some View {
        switch job.status {
        case .ready:
            Button { model.download(job) } label: {
                HStack(spacing: 3) {
                    Image(systemName: "arrow.down.circle")
                        .font(.system(size: 11, weight: .semibold))
                    Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.download", "Download"))
                        .font(Font.TS.caption)
                }
                .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: JobProgressDrawerStrings.string(
                "export.jobDrawer.download", "Download"
            )))
        case .failed:
            Image(systemName: "arrow.up.left.and.arrow.down.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        default:
            EmptyView()
        }
    }
}

// MARK: - Status icon

/// The per-status leading glyph (web `statusIcon`): a spinner while processing, otherwise a
/// toned SF Symbol.
struct JobDrawerStatusIcon: View {
    let status: ExportDrawerStatus

    var body: some View {
        icon
            .frame(width: 16, height: 16)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var icon: some View {
        if status == .processing {
            ProgressView()
                .controlSize(.mini)
        } else {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tone)
        }
    }

    private var symbol: String {
        switch status {
        case .queued: "clock"
        case .processing: "arrow.triangle.2.circlepath"
        case .ready: "checkmark.circle.fill"
        case .failed: "xmark.circle.fill"
        case .expired: "exclamationmark.triangle.fill"
        }
    }

    private var tone: Color {
        switch status {
        case .queued: Color.TS.textMuted
        case .processing: Color.TS.accent
        case .ready: Color.TS.statusSuccess
        case .failed: Color.TS.statusDanger
        case .expired: Color.TS.statusWarning
        }
    }
}

// MARK: - Loading

/// The first-paint loading line rendered inside the panel body (web "Loading export jobs…").
struct JobDrawerLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            ProgressView()
                .controlSize(.small)
            Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.loading", "Loading export jobs…"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty

/// The resolved-but-no-jobs state for an intentionally-presented drawer (engineering guideline
/// #6 — a friendly empty panel, never a blank box).
struct JobDrawerEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.emptyTitle", "No export jobs"))
            } icon: {
                Image(systemName: "shippingbox")
            }
        } description: {
            Text(verbatim: JobProgressDrawerStrings.string(
                "export.jobDrawer.emptyMessage", "Exports you start will appear here."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 140)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error

/// The fetch-failure state with a retry affordance (web `QueryError`), so a first-load failure
/// with no cached jobs isn't a blank box.
struct JobDrawerErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: JobProgressDrawerStrings.string(
                "export.jobDrawer.errorTitle", "Couldn't load export jobs"
            ))
            .font(Font.TS.body)
            .fontWeight(.semibold)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: JobProgressDrawerStrings.string("export.jobDrawer.retry", "Retry")))
    }
}

// MARK: - Inline error

/// The inline list-load error shown above the populated sections when a reload failed but
/// cached jobs remain.
struct JobDrawerInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: JobProgressDrawerStrings.string(
                "export.jobDrawer.errorTitle", "Couldn't load export jobs"
            ))
            .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct JobDrawerFreshnessChip: View {
    let connection: ExportDrawerConnection

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle()
                .fill(descriptor.tone)
                .frame(width: 6, height: 6)
            Text(verbatim: JobProgressDrawerStrings.string(descriptor.key, descriptor.fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: JobProgressDrawerStrings.string(descriptor.key, descriptor.fallback)))
    }

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    private static func descriptor(for connection: ExportDrawerConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "export.jobDrawer.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "export.jobDrawer.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "export.jobDrawer.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The cached-data banner shown above the body when the bound source is not live, so a cached
/// list is clearly labeled (ADR-013).
struct JobDrawerConnectivityBanner: View {
    let connection: ExportDrawerConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "export.jobDrawer.offlineBanner" : "export.jobDrawer.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded jobs"
            : "Reconnecting — this list may be out of date"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: JobProgressDrawerStrings.string(key, fallback))
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
