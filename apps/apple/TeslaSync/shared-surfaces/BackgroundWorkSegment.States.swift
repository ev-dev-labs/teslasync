//
//  BackgroundWorkSegment.States.swift
//  TeslaSync — P4 shared surface · 0177 · BackgroundWorkSegment (Apple)
//
//  The P4 leaf-contract chrome composed by ``BackgroundWorkSegment`` when no job is active: the loading
//  skeleton (the segment shape while the first `/export/jobs` probe is in flight), the friendly empty pill
//  (resolved with no jobs — the "never a blank box" peer of the web `if (!hasJobs) return null`), and the
//  error chip with a retry affordance (the first probe failed with nothing cached — the web hook swallows
//  it, surfaced here per the leaf contract). All copy resolves through the P1/S10 facade; all colour comes
//  from the P1/S9 tokens. Each renders as a compact status-bar pill, matching the segment's footprint.
//

import SwiftUI

// MARK: - Loading (first export-jobs probe in flight)

/// The boot-probe chrome — a skeleton pill that keeps the segment's shape (a glyph + a short label) while
/// the first `/export/jobs` probe resolves.
struct BackgroundWorkLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 12, height: 12, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 48, height: 11, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BackgroundWorkStrings.string(
            "statusBar.background.loadingA11y", "Loading background work"
        )))
    }
}

// MARK: - Empty (resolved, no jobs — friendly quiet pill)

/// The empty render — a compact pill stating no background work is running, the native parity of the web
/// `if (!hasJobs) return null` made visible (never a blank box). A host that prefers the web's literal
/// quietness can hide the surface via ``BackgroundWorkSegmentModel/hasJobs``.
struct BackgroundWorkEmptyView: View {
    private var label: String {
        BackgroundWorkStrings.string("statusBar.background.empty", "No background work")
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: BackgroundWorkStrings.string(
            "statusBar.background.emptyA11y", "No background work in progress"
        )))
    }
}

// MARK: - Error (first probe failed — web swallows it)

/// The probe-failure chip — a compact danger-tinted pill with a retry affordance. The web hook swallows an
/// `/export/jobs` failure (the segment simply stays hidden); the P4 leaf surfaces it so a misconfigured
/// endpoint is visible. The runtime failure reason rides the VoiceOver label.
struct BackgroundWorkErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var label: String {
        BackgroundWorkStrings.string("statusBar.background.error", "Background work unavailable")
    }

    private var accessibilityText: String {
        let retry = BackgroundWorkStrings.string(
            "statusBar.background.retryA11y", "Background work check failed — tap to retry"
        )
        return message.isEmpty ? retry : "\(retry). \(message)"
    }

    var body: some View {
        Button(action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.statusDanger.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
