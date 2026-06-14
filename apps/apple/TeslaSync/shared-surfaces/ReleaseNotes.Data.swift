//
//  ReleaseNotes.Data.swift
//  TeslaSync — P4 shared surface · 0135 · ReleaseNotes (Apple)
//
//  The built-in canonical changelog snapshot — the native peer of the web `@/generated/changelog` module
//  the web `<ReleaseNotes>` imports directly. The web data is produced by `web/scripts/buildChangelog.mjs`
//  from `CHANGELOG.md`; the native app cannot run that Node generator, so this file ships a faithful,
//  newest-first snapshot of the same releases (version / date / badge verbatim from the generated module).
//  The change lines are the real changelog headlines, condensed to a single concise sentence each so they
//  stay within the SwiftLint line-length budget — no invented content (Honesty #9, "no silent drift").
//
//  A host that has the full generated changelog injects it via `ReleaseNotes(entries:)`; this default is the
//  standalone / preview value, exactly the role the web static import plays when no data is threaded in.
//

import Foundation

/// The built-in newest-first changelog snapshot — the native default for the surface (web
/// `@/generated/changelog` `CHANGELOG`). Newest release first, matching the web ordering so
/// `ReleaseNotesProjector.visibleEntries` slices the most recent `limit` releases.
public enum ReleaseNotesData {
    /// The canonical releases, newest-first. The default `limit` of 3 renders the top three, mirroring the
    /// web component's default footprint.
    public static let canonical: [ReleaseNotesEntry] = [
        ReleaseNotesEntry(
            version: "0.7.0",
            date: "2026-03-29",
            badge: .latest,
            changes: [
                ReleaseNotesChange(
                    type: .added,
                    text: "Telemetry expansion to all 228 Tesla fields, adding 78 columns and 6 tables."
                ),
                ReleaseNotesChange(
                    type: .added,
                    text: "Five new pages: Energy Flow, Drivetrain Health, Media Player, Safety, and Navigation."
                ),
                ReleaseNotesChange(
                    type: .added,
                    text: "Four new Grafana dashboards and four new Tesla Fleet API integrations."
                ),
                ReleaseNotesChange(
                    type: .changed,
                    text: "Fleet telemetry configuration now uses the MQTT dispatcher instead of HTTP."
                ),
                ReleaseNotesChange(
                    type: .changed,
                    text: "Added the vehicle_location OAuth scope for location telemetry fields."
                ),
                ReleaseNotesChange(
                    type: .fixed,
                    text: "Disconnect now clears the stored token and in-memory client state cleanly."
                )
            ]
        ),
        ReleaseNotesEntry(
            version: "0.6.0",
            date: "2026-03-28",
            badge: .stable,
            changes: [
                ReleaseNotesChange(
                    type: .added,
                    text: "Ten new pages, including Driving Dynamics, Climate Control, and Security & Access."
                ),
                ReleaseNotesChange(
                    type: .added,
                    text: "New telemetry storage: motor, climate, and security snapshot tables (migration 000016)."
                ),
                ReleaseNotesChange(
                    type: .changed,
                    text: "Vehicle Detail now shows powertrain, climate, security, and tire-pressure panels."
                ),
                ReleaseNotesChange(
                    type: .fixed,
                    text: "Unit conversion now respects the user's km/mi and °C/°F preferences across 14 pages."
                ),
                ReleaseNotesChange(
                    type: .fixed,
                    text: "Mobile layout no longer cuts off the last panel; switched to dynamic viewport height."
                )
            ]
        ),
        ReleaseNotesEntry(
            version: "0.5.0",
            date: "2026-03-23",
            badge: .stable,
            changes: [
                ReleaseNotesChange(
                    type: .added,
                    text: "Sleep backoff for asleep vehicles, backing off polling exponentially up to a 10-minute cap."
                ),
                ReleaseNotesChange(
                    type: .added,
                    text: "API suspend toggle to pause all Tesla Fleet API calls while a vehicle is in service."
                ),
                ReleaseNotesChange(
                    type: .changed,
                    text: "Single-route ingress: all traffic routes through teslasync-web with internal API proxying."
                ),
                ReleaseNotesChange(
                    type: .fixed,
                    text: "SPA routing fallback replaces the Go file-server catch-all with a proper NotFound handler."
                )
            ]
        ),
        ReleaseNotesEntry(
            version: "0.4.0",
            date: "2026-03-23",
            badge: .stable,
            changes: [
                ReleaseNotesChange(
                    type: .added,
                    text: "Developer Tools page with 25-plus built-in utilities accessible from the sidebar."
                ),
                ReleaseNotesChange(
                    type: .added,
                    text: "Fleet Telemetry status card showing supported signals, endpoint, protocol, and host."
                ),
                ReleaseNotesChange(
                    type: .changed,
                    text: "API call logs now distinguish tesla_api from fleet_telemetry sources (migration 000009)."
                )
            ]
        )
    ]
}
