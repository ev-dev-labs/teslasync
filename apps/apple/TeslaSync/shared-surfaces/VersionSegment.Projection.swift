//
//  VersionSegment.Projection.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  The pure derivation for the footer version segment — split from VersionSegment.Adapter.swift (the
//  value types) for the SwiftLint file-length budget. Holds the ``VersionSegmentProjection`` (combined
//  input → view-ready resolved, across loading / empty / error / ready and every modal-row presence
//  guard) and the ``VersionSegmentAccessibility`` builders (the tooltip + the VoiceOver segment label).
//  Everything is Foundation-only and pure — no store, no bundle, no rendered view.
//

import Foundation

// MARK: - Projection (web render branches + P4 leaf contract)

/// The pure projection from the combined input to the resolved view-state — the native port of the web
/// component's derivation: the `appVersion` resolution order (server truth `&& !== 'unknown'` → build →
/// `dev`), the `sha` + `hasSHA` rule, `updateAvailable`, the uptime label, the `hasUnseen` rule, and the
/// presence-guarded modal provenance rows. The P4 leaf states (loading / empty / error) precede the
/// ready render and are reachable only when no version resolves (host baked nothing). Unit tested across
/// every phase + every row guard.
public enum VersionSegmentProjection {
    public static func resolve(_ input: VersionSegmentInput) -> VersionSegmentResolved {
        let snapshot = input.snapshot
        let resolvedVersion = resolveAppVersion(
            server: snapshot.versionInfo?.appVersion,
            build: input.buildInfo.buildVersion
        )

        // No version resolvable at all → the P4 leaf states (web always has the `dev` fallback, so this
        // branch is reachable only when the host bakes no build version).
        guard let appVersion = resolvedVersion else {
            if let message = snapshot.errorMessage, !message.isEmpty {
                return VersionSegmentResolved(phase: .error(message), data: nil)
            }
            if snapshot.isLoading {
                return VersionSegmentResolved(phase: .loading, data: nil)
            }
            return VersionSegmentResolved(phase: .empty, data: nil)
        }

        let sha = input.buildInfo.buildSHA ?? VersionSegmentSurface.devSentinel
        let hasSHA = !sha.isEmpty && sha != VersionSegmentSurface.devSentinel
        let updateAvailable = snapshot.updateCheck?.updateAvailable ?? false
        let uptime = VersionUptimeFormatter.label(snapshot.versionInfo?.uptimeSeconds)
        let hasUnseen = snapshot.changelogUnseenCount > 0

        let data = VersionSegmentData(
            appVersion: appVersion,
            sha: sha,
            hasSHA: hasSHA,
            updateAvailable: updateAvailable,
            latestVersion: nonEmpty(snapshot.updateCheck?.latest),
            updateMessage: nonEmpty(snapshot.updateCheck?.message),
            uptimeLabel: uptime,
            hasUnseenChangelog: hasUnseen,
            unseenChangelogCount: snapshot.changelogUnseenCount,
            provenanceRows: provenanceRows(appVersion: appVersion, sha: sha, info: snapshot.versionInfo, uptime: uptime)
        )
        return VersionSegmentResolved(phase: .ready, data: data)
    }

    /// The web `appVersion` resolution order: server `app_version` when present and not the `"unknown"`
    /// sentinel, else the build version when non-empty, else `nil` (the leaf-state trigger). The web's
    /// trailing `|| 'dev'` is supplied by the default build info, not invented here.
    static func resolveAppVersion(server: String?, build: String?) -> String? {
        if let server = nonEmpty(server), server != VersionSegmentSurface.unknownSentinel {
            return server
        }
        return nonEmpty(build)
    }

    /// The presence-guarded modal rows — the native port of the web `<dl>`: App version + Commit always
    /// render; Helm chart / Go runtime / Platform / Server uptime each render only when present (web
    /// `chart_version && !== 'unknown'`, `go_version`, `os || arch`, `uptime`).
    static func provenanceRows(
        appVersion: String,
        sha: String,
        info: VersionSegmentInfo?,
        uptime: String?
    ) -> [VersionProvenanceRow] {
        var rows: [VersionProvenanceRow] = [
            VersionProvenanceRow(
                id: "appVersion", labelKey: "statusBar.version.appVersion",
                labelFallback: "App version", value: "v\(appVersion)", mono: true
            ),
            VersionProvenanceRow(
                id: "commit", labelKey: "statusBar.version.commit",
                labelFallback: "Commit", value: sha, mono: true
            )
        ]
        if let chart = nonEmpty(info?.chartVersion), chart != VersionSegmentSurface.unknownSentinel {
            rows.append(VersionProvenanceRow(
                id: "chart", labelKey: "statusBar.version.chart",
                labelFallback: "Helm chart", value: "v\(chart)", mono: true
            ))
        }
        if let go = nonEmpty(info?.goVersion) {
            rows.append(VersionProvenanceRow(
                id: "go", labelKey: "statusBar.version.go",
                labelFallback: "Go runtime", value: go, mono: true
            ))
        }
        if let platform = platformLabel(os: info?.os, arch: info?.arch) {
            rows.append(VersionProvenanceRow(
                id: "platform", labelKey: "statusBar.version.platform",
                labelFallback: "Platform", value: platform, mono: true
            ))
        }
        if let uptime {
            rows.append(VersionProvenanceRow(
                id: "uptime", labelKey: "statusBar.version.uptimeLabel",
                labelFallback: "Server uptime", value: uptime, mono: false
            ))
        }
        return rows
    }

    /// The web `[os, arch].filter(Boolean).join('/')` platform string; `nil` when both are absent.
    static func platformLabel(os: String?, arch: String?) -> String? {
        let parts = [nonEmpty(os), nonEmpty(arch)].compactMap(\.self)
        return parts.isEmpty ? nil : parts.joined(separator: "/")
    }

    /// Trims and nils-out an empty/whitespace string — the native peer of the web truthiness guards.
    static func nonEmpty(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

// MARK: - Accessibility (testable seams — web tooltip + aria-label)

/// Builds the segment's tooltip and VoiceOver label from already-localised fragments, so the spoken /
/// hovered content is asserted without rendering the view. Mirrors the web `<Tooltip content>` row and
/// the `aria-label` string exactly: the tooltip is the non-empty parts joined with `" · "` (web template
/// literal), and the label is `"{version}: v{appVersion} ({sha}), {unseen}"` with the SHA + unseen
/// clauses applied only under the same guards the web uses.
public enum VersionSegmentAccessibility {
    /// The hover tooltip — the non-empty fragments joined with the web `" · "` separator. The caller
    /// supplies the already-localised parts (e.g. "TeslaSync version", "v2026.6.2", the SHA, "up 3d 4h",
    /// "2 new release(s)"); empties are dropped so the separators never double up.
    public static func tooltip(parts: [String]) -> String {
        parts
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// The VoiceOver label — the native port of the web `aria-label`:
    /// `"{versionLabel}: v{appVersion}" (+ " ({sha})" when hasSHA) (+ ", {unseenLabel}" when present)`.
    public static func segmentLabel(
        versionLabel: String,
        appVersion: String,
        sha: String,
        hasSHA: Bool,
        unseenLabel: String?
    ) -> String {
        var label = "\(versionLabel): v\(appVersion)"
        if hasSHA {
            label += " (\(sha))"
        }
        if let unseenLabel, !unseenLabel.isEmpty {
            label += ", \(unseenLabel)"
        }
        return label
    }
}
