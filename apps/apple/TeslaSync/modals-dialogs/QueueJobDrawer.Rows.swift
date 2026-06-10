//
//  QueueJobDrawer.Rows.swift
//  TeslaSync — P4 modal / dialog · 0020 · QueueJobDrawer (Apple)
//
//  The job-row + leaf-state sub-views `QueueJobDrawer` composes (split from QueueJobDrawer
//  .Views.swift for the lint file-length budget): the job row (web `QueueJobRow`), the status-tone
//  → token-colour mapping, and the loading / empty / error (+ retry) / inline-error states. Every
//  state renders real chrome — never a blank box. Copy via P1/S10 (`QueueJobDrawerStrings`);
//  chrome via P1/S9 tokens.
//

import SwiftUI

// MARK: - Status tone → token colour

extension QueueJobStatusTone {
    /// Resolves the pure tone bucket to a P1/S9 semantic token (web `STATUS_TONE` Tailwind class
    /// → token). Toned-down body colours per the project palette: emerald/amber/cyan/rose →
    /// the success / warning / info / danger tokens; muted / neutral → the text tokens.
    var tokenColor: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .info: Color.TS.statusInfo
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        case .neutral: Color.TS.textPrimary
        }
    }
}

// MARK: - Row (web `QueueJobRow`)

/// One recent-job row (web `<li>`): the title (web `title || id`), the toned status word, the
/// "Started … · Took …" caption, and the optional inline error block.
struct QueueJobRow: View {
    let job: QueueJobRowData
    @Bindable var model: QueueJobDrawerModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            titleRow
            Text(verbatim: model.detailLine(job))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if job.hasError, let error = job.error {
                QueueJobRowError(message: error)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .fill(Color.TS.surfaceGlass)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: model.rowAccessibilityLabel(job)))
    }

    /// The web top row: the title (truncated) and the trailing toned status word.
    private var titleRow: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Text(verbatim: model.displayTitle(job))
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: model.statusLabel(job))
                .font(Font.TS.caption)
                .foregroundStyle(model.statusTone(job).tokenColor)
                .lineLimit(1)
        }
    }
}

/// The row's inline error block (web `job.error ? <div border-rose>…`): a warning glyph + the
/// wrapped error text.
struct QueueJobRowError: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
    }
}

// MARK: - Loading (web loading state)

/// The first-paint loading line (web `<Spinner/> Loading recent jobs…`).
struct QueueJobDrawerLoadingState: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ProgressView()
                .controlSize(.small)
            Text(verbatim: QueueJobDrawerStrings.string("queueStatus.drawer.loading", "Loading recent jobs…"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty (web empty state)

/// The resolved-but-no-jobs state (web italic `No recent jobs to show…`). A friendly empty
/// panel, never a blank box (engineering guideline #6).
struct QueueJobDrawerEmptyState: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: QueueJobDrawerStrings.string("queueStatus.drawer.emptyTitle", "No recent jobs"))
            } icon: {
                Image(systemName: "tray")
            }
        } description: {
            Text(verbatim: QueueJobDrawerStrings.string(
                "queueStatus.drawer.empty",
                "No recent jobs to show. New jobs will appear here as the worker processes them."
            ))
        }
        .frame(maxWidth: .infinity, minHeight: 160)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Error (web error state + P4 retry)

/// The fetch-failure state (web `<AlertTriangle/> Could not load recent jobs…`) with a retry
/// affordance (P4 `QueryError` equivalent), so a first-load failure with no cached jobs isn't a
/// blank box.
struct QueueJobDrawerErrorState: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: QueueJobDrawerStrings.string(
                    "queueStatus.drawer.error",
                    "Could not load recent jobs. Check API logs and try again."
                ))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.statusDanger)
                .fixedSize(horizontal: false, vertical: true)
            }
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            retryButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.08),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var retryButton: some View {
        Button(action: onRetry) {
            Text(verbatim: QueueJobDrawerStrings.string("queueStatus.drawer.retry", "Retry"))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                .foregroundStyle(Color.TS.accent)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: QueueJobDrawerStrings.string("queueStatus.drawer.retry", "Retry")))
    }
}

// MARK: - Inline error (cached rows survive a failed reload)

/// The inline list-load error shown above the populated rows when a reload failed but cached
/// jobs remain on screen.
struct QueueJobDrawerInlineError: View {
    let message: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: QueueJobDrawerStrings.string(
                "queueStatus.drawer.error",
                "Could not load recent jobs. Check API logs and try again."
            ))
            .font(Font.TS.caption)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(Color.TS.statusDanger)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
