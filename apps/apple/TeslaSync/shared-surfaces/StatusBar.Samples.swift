//
//  StatusBar.Samples.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  DEBUG-only sample data + an inspector that stages EVERY real branch of the status bar so the previews and
//  the view-composition tests have a concrete reference (and never a blank box): the full ready bar, the
//  loading skeleton, the offline / stale / error chips, the empty (0 vehicles + 0 jobs) bar, the dense
//  icon-only variant, and the hidden (disabled) bar. All copy routes through the P1/S10 facade (fallbacks);
//  none of this ships (compiled out in Release).
//

import SwiftUI

#if DEBUG

    // MARK: - Sample data

    /// A representative bar input exercising every branch, with one-knob variants for the inspector +
    /// previews + tests.
    enum StatusBarSampleData {
        /// Fallback localizer — returns the English default so the projection stays deterministic.
        static let localize: StatusBarLocalize = { _, fallback in fallback }
        /// A fixed reference clock so age formatting is stable in snapshots.
        static let now = Date(timeIntervalSince1970: 1_700_000_000)

        static var vehicles: [StatusBarVehicleRef] {
            [
                StatusBarVehicleRef(id: 1, displayName: "Garage Model 3", vin: "5YJ3E", model: "Model 3"),
                StatusBarVehicleRef(id: 2, displayName: "Road Trip Y", vin: "7SAYG", model: "Model Y"),
                StatusBarVehicleRef(id: 3, displayName: nil, vin: "5YJSA", model: "Model S")
            ]
        }

        static var jobs: [StatusBarJob] {
            [
                StatusBarJob(id: "exp", kind: .export, label: "Export drives.csv", detail: "12,408 rows"),
                StatusBarJob(id: "mut", kind: .mutation, label: "Saving settings", detail: nil)
            ]
        }

        static var version: StatusBarVersionInfo {
            StatusBarVersionInfo(
                appVersion: "1.8.2",
                sha: "a1b2c3d",
                chartVersion: "1.8.0",
                goVersion: "go1.25",
                os: "linux",
                arch: "arm64",
                uptimeSeconds: 93600
            )
        }

        /// Builds an input. Each knob defaults to the rich, ready bar; variants flip a single one.
        static func input(
            prefs: StatusBarPrefs = .defaults,
            compact: Bool = false,
            isNarrow: Bool = false,
            phase: StatusBarPhase = .ready,
            connectivity: StatusBarConnectivity = .online,
            apiHealth: StatusBarApiHealth = .ok,
            liveStatus: StatusBarLiveStatus = .connected,
            vehicleCount: Int = 3,
            jobCount: Int = 2,
            updateAvailable: Bool = false,
            hasUnseenChangelog: Bool = true
        ) -> StatusBarInput {
            StatusBarInput(
                prefs: prefs,
                compact: compact,
                isNarrow: isNarrow,
                phase: phase,
                connectivity: connectivity,
                apiHealth: apiHealth,
                latencyMs: 42,
                liveStatus: liveStatus,
                lastMessageAt: now.addingTimeInterval(-5),
                vehicles: Array(vehicles.prefix(vehicleCount)),
                selectedVehicleID: vehicleCount > 0 ? 1 : nil,
                batteryLevel: 82,
                ratedRangeMeters: 386_240,
                hasVehicleState: vehicleCount > 0,
                distanceUnit: .km,
                jobs: Array(jobs.prefix(jobCount)),
                version: version,
                updateCheck: StatusBarUpdateCheck(
                    updateAvailable: updateAvailable,
                    latest: updateAvailable ? "1.9.0" : nil,
                    message: updateAvailable ? "Security + telemetry fixes." : nil
                ),
                hasUnseenChangelog: hasUnseenChangelog,
                newChangelogEntries: hasUnseenChangelog ? 2 : 0,
                now: now
            )
        }

        /// Builds a model from an input, with an in-memory prefs store + the fallback localizer.
        @MainActor
        static func model(
            _ input: StatusBarInput,
            prefs: StatusBarPrefs = .defaults,
            commands: StatusBarCommands = .noop
        ) -> StatusBarModel {
            StatusBarModel(
                input: input,
                telemetry: OSLogStatusBarTelemetry(),
                localize: localize,
                prefsStore: InMemoryStatusBarPrefsStore(prefs),
                commands: commands
            )
        }
    }

    // MARK: - Inspector (every branch — never a blank box)

    /// One labeled scenario row hosting a full bar at a fixed width.
    struct StatusBarScenarioRow: View {
        let title: String
        let content: AnyView

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                content
                    .frame(width: 520)
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
            }
        }
    }

    /// The DEBUG inspector: every real branch staged top to bottom.
    struct StatusBarInspector: View {
        var body: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ForEach(StatusBarInspectorScenario.all) { scenario in
                        StatusBarScenarioRow(title: scenario.title, content: scenario.view)
                    }
                }
                .padding(TSSpacing.lg)
            }
            .background(Color.TS.bg)
        }
    }

    /// A staged scenario — a title + a concrete bar (or a "hidden" caption for the disabled branch).
    struct StatusBarInspectorScenario: Identifiable {
        let id: String
        let title: String
        let view: AnyView

        @MainActor
        static var all: [StatusBarInspectorScenario] {
            [
                scenario("ready", "Ready · all segments + badges", StatusBarSampleData.input()),
                scenario("loading", "Loading · skeleton chrome", StatusBarSampleData.input(phase: .loading)),
                scenario(
                    "offline",
                    "Offline · cached + chip",
                    StatusBarSampleData.input(connectivity: .offline, liveStatus: .disconnected)
                ),
                scenario("stale", "Stale · freshness chip", StatusBarSampleData.input(liveStatus: .stale)),
                scenario("error", "Error · backend + retry", StatusBarSampleData.input(apiHealth: .offline)),
                scenario(
                    "empty",
                    "Empty · no vehicle / no jobs",
                    StatusBarSampleData.input(vehicleCount: 0, jobCount: 0)
                ),
                scenario(
                    "iconOnly",
                    "Icon-only · dense",
                    StatusBarSampleData.input(prefs: StatusBarPrefs(enabled: true, iconOnly: true))
                ),
                disabledScenario
            ]
        }

        @MainActor
        private static func scenario(_ id: String, _ title: String, _ input: StatusBarInput) -> Self {
            StatusBarInspectorScenario(
                id: id,
                title: title,
                view: AnyView(StatusBar(model: StatusBarSampleData.model(input)))
            )
        }

        @MainActor
        private static var disabledScenario: StatusBarInspectorScenario {
            StatusBarInspectorScenario(
                id: "disabled",
                title: "Hidden · disabled (renders nothing)",
                view: AnyView(
                    Text(verbatim: "— bar hidden —")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .frame(maxWidth: .infinity, minHeight: 28)
                )
            )
        }
    }
#endif
