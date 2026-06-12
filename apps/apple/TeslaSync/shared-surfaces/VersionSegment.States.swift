//
//  VersionSegment.States.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The P4 leaf-contract chrome composed by ``VersionSegment`` when no version has resolved yet: the
//  loading skeleton (the segment shape while the first `/system/version` probe is in flight), the empty
//  empty pill (resolved with no version — the friendly "never a blank box" parity, reachable only when
//  the host bakes no build version since the web always has the `dev` fallback), and the error chip with
//  a retry affordance (the first probe failed with nothing cached — the web swallows this, surfaced here
//  per the leaf contract). All copy resolves through the P1/S10 facade; all colour comes from the P1/S9
//  tokens. Each renders as a compact status-bar pill, matching the segment's footprint.
//

import SwiftUI

// MARK: - Loading (first version probe in flight)

/// The boot-probe chrome — a skeleton pill that keeps the segment's shape (a glyph + a short version
/// line) while the first `/system/version` probe resolves.
struct VersionSegmentLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: 12, height: 12, cornerRadius: TSRadius.sm)
            TSSkeleton(width: 54, height: 11, cornerRadius: TSRadius.sm)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass, in: Capsule())
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: VersionSegmentStrings.string(
            "statusBar.version.loadingA11y", "Loading version"
        )))
    }
}

// MARK: - Empty (resolved, no version — friendly empty pill)

/// The empty render — a compact pill stating the version is unavailable, the native parity of a resolved
/// feed with no version at all (never a blank box). Tappable to re-probe. Reachable only when the host
/// bakes no build version; a normal build always resolves at least `vdev`.
struct VersionSegmentEmptyView: View {
    let onRefresh: () -> Void

    private var label: String {
        VersionSegmentStrings.string("statusBar.version.unavailable", "Version unavailable")
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "tag")
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
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Error (first probe failed — web swallows to the dev fallback)

/// The probe-failure chip — a compact danger-tinted pill with a retry affordance. The web hook swallows
/// the failure (its `dev` build fallback keeps the button alive); the P4 leaf surfaces it so a
/// misconfigured `/system/version` is visible when no build version is baked. The runtime failure reason
/// rides the VoiceOver label.
struct VersionSegmentErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var label: String {
        VersionSegmentStrings.string("statusBar.version.unavailable", "Version unavailable")
    }

    private var accessibilityText: String {
        let retry = VersionSegmentStrings.string("statusBar.version.retryA11y", "Version check failed — tap to retry")
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
