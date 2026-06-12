//
//  StatusBar.ResolveVersion.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The version-segment slice of the projection (split from StatusBar.Resolve.swift to keep each function +
//  file within the SwiftLint budget). The VERBATIM port of the web `VersionSegment`: the version label + SHA
//  chip, the update / unseen-changelog dots and their interpolated tooltip / aria, and the fully-resolved
//  "About this build" sheet (the provenance rows, the update banner, the actions).
//

import Foundation

extension StatusBarProjection {
    static func resolveVersion(
        _ input: StatusBarInput,
        iconOnly: Bool,
        localize: StatusBarLocalize
    ) -> StatusBarVersionVM {
        let appVersion = displayVersion(input.version.appVersion)
        let hasSHA = input.version.hasRealSHA
        return StatusBarVersionVM(
            label: "v\(appVersion)",
            shaText: (hasSHA && !iconOnly) ? input.version.sha : nil,
            updateAvailable: input.updateCheck.updateAvailable,
            hasUnseenChangelog: input.hasUnseenChangelog,
            tooltip: versionTooltip(input, appVersion: appVersion, hasSHA: hasSHA, localize: localize),
            accessibilityLabel: versionAria(input, appVersion: appVersion, hasSHA: hasSHA, localize: localize),
            sheet: buildSheet(input, appVersion: appVersion, localize: localize)
        )
    }

    /// The web `appVersion` fallback — a missing / `unknown` value collapses to the `dev` sentinel.
    private static func displayVersion(_ raw: String) -> String {
        (raw.isEmpty || raw == "unknown") ? "dev" : raw
    }

    private static func versionTooltip(
        _ input: StatusBarInput,
        appVersion: String,
        hasSHA: Bool,
        localize: StatusBarLocalize
    ) -> String {
        var tooltip = "\(localize("statusBar.version.tooltip", "TeslaSync version")) · v\(appVersion)"
        if hasSHA { tooltip += " · \(input.version.sha)" }
        if let uptime = StatusBarFormat.uptime(seconds: input.version.uptimeSeconds) {
            tooltip += " · " + StatusBarInterpolation.format(
                localize("statusBar.version.uptime", "up {{uptime}}"), ["uptime": uptime]
            )
        }
        if input.hasUnseenChangelog {
            tooltip += " · " + StatusBarInterpolation.format(
                localize("changelog.unseenHint", "{{count}} new release(s)"),
                ["count": String(input.newChangelogEntries)]
            )
        }
        return tooltip
    }

    private static func versionAria(
        _ input: StatusBarInput,
        appVersion: String,
        hasSHA: Bool,
        localize: StatusBarLocalize
    ) -> String {
        var aria = "\(localize("statusBar.version.aria", "TeslaSync version")): v\(appVersion)"
        if hasSHA { aria += " (\(input.version.sha))" }
        if input.hasUnseenChangelog {
            aria += ", \(localize("changelog.unseenAria", "unseen changelog"))"
        }
        return aria
    }

    private static func buildSheet(
        _ input: StatusBarInput,
        appVersion: String,
        localize: StatusBarLocalize
    ) -> StatusBarVersionSheet {
        StatusBarVersionSheet(
            title: localize("statusBar.version.modalTitle", "About this build"),
            rows: buildRows(input, appVersion: appVersion, localize: localize),
            updateBanner: buildBanner(input, localize: localize),
            whatsNewLabel: localize("changelog.openModal", "What's new"),
            releaseNotesLabel: localize("statusBar.version.changelog", "Release notes"),
            closeLabel: localize("statusBar.version.close", "Close"),
            hasUnseenChangelog: input.hasUnseenChangelog
        )
    }

    private static func buildRows(
        _ input: StatusBarInput,
        appVersion: String,
        localize: StatusBarLocalize
    ) -> [StatusBarKV] {
        let info = input.version
        var rows: [StatusBarKV] = [
            StatusBarKV(
                id: "appVersion",
                label: localize("statusBar.version.appVersion", "App version"),
                value: "v\(appVersion)",
                monospaced: true
            ),
            StatusBarKV(
                id: "commit",
                label: localize("statusBar.version.commit", "Commit"),
                value: info.sha,
                monospaced: true
            )
        ]
        if let chart = info.chartVersion, !chart.isEmpty, chart != "unknown" {
            rows.append(StatusBarKV(
                id: "chart",
                label: localize("statusBar.version.chart", "Helm chart"),
                value: "v\(chart)",
                monospaced: true
            ))
        }
        if let goVersion = info.goVersion, !goVersion.isEmpty {
            rows.append(StatusBarKV(
                id: "go",
                label: localize("statusBar.version.go", "Go runtime"),
                value: goVersion,
                monospaced: true
            ))
        }
        if let platform = info.platform {
            rows.append(StatusBarKV(
                id: "platform",
                label: localize("statusBar.version.platform", "Platform"),
                value: platform,
                monospaced: true
            ))
        }
        if let uptime = StatusBarFormat.uptime(seconds: info.uptimeSeconds) {
            rows.append(StatusBarKV(
                id: "uptime",
                label: localize("statusBar.version.uptimeLabel", "Server uptime"),
                value: uptime,
                monospaced: false
            ))
        }
        return rows
    }

    private static func buildBanner(_ input: StatusBarInput, localize: StatusBarLocalize) -> StatusBarUpdateBanner? {
        guard input.updateCheck.updateAvailable else { return nil }
        var title = localize("statusBar.version.updateBanner", "A newer release is available")
        if let latest = input.updateCheck.latest, !latest.isEmpty { title += ": v\(latest)" }
        return StatusBarUpdateBanner(title: title, message: input.updateCheck.message)
    }
}
