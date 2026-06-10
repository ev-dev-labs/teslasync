//
//  TOUSettingsModal.Presets.swift
//  TeslaSync — P4 modal / dialog · 0021 · TOUSettingsModal (Apple)
//
//  The three preset rate plans, ported verbatim from the web source's `PRESETS` array
//  (features/battery/components/TOUSettingsModal.tsx): PG&E EV2-A, SCE TOU-D, and SDG&E TOU-DR1. Each is
//  authored as an *ordered* `TOUJSON` envelope so the Preset-tab preview pretty-prints byte-for-byte
//  with the web `JSON.stringify(settings, null, 2)`. The `optionLabel` mirrors the web `presetOptions`
//  map (`{ value: id, label: "name — utility" }`). Foundation-only — no view or store dependency.
//

import Foundation

// MARK: - Preset descriptor (web `TOUPreset`)

/// One preset rate plan — the native parity of the web `TOUPreset` (`id` / `name` / `utility` /
/// `settings`). `optionLabel` is the web `presetOptions` label (`"name — utility"`).
public struct TOUSettingsPreset: Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let utility: String
    public let settings: TOUSettingsPayload

    public init(id: String, name: String, utility: String, settings: TOUSettingsPayload) {
        self.id = id
        self.name = name
        self.utility = utility
        self.settings = settings
    }

    /// The dropdown label (web ``${p.name} — ${p.utility}``).
    public var optionLabel: String {
        "\(name) — \(utility)"
    }
}

/// One option in the preset `Select` (web `presetOptions` entry: `value` + `label`).
public struct TOUSettingsPresetOption: Sendable, Equatable, Identifiable {
    public let id: String
    public let label: String

    public init(id: String, label: String) {
        self.id = id
        self.label = label
    }
}

// MARK: - Catalog (web `PRESETS`)

/// The preset catalog + the lookups the model drives (web `PRESETS` / `PRESETS.find` / `presetOptions`).
public enum TOUSettingsCatalog {
    /// The three presets in web `PRESETS` order.
    public static let presets: [TOUSettingsPreset] = [pgeEV2A, sceTOUD, sdgeTOUDR1]

    /// The `Select` options (web `presetOptions`).
    public static var options: [TOUSettingsPresetOption] {
        presets.map { TOUSettingsPresetOption(id: $0.id, label: $0.optionLabel) }
    }

    /// The preset for an id, or `nil` (web `PRESETS.find((p) => p.id === selectedPreset)`).
    public static func preset(id: String) -> TOUSettingsPreset? {
        presets.first { $0.id == id }
    }

    /// The selected preset's settings for `getPayload`, or `nil` when none is chosen / found.
    public static func settings(id: String) -> TOUSettingsPayload? {
        preset(id: id)?.settings
    }
}

// MARK: - Authoring helpers (data builders — keep the ported tariffs readable)

private func envelope(_ tariff: TOUJSON) -> TOUSettingsPayload {
    TOUSettingsPayload(
        root: .obj([
            ("tou_settings", .obj([
                ("optimization_strategy", "economics"),
                ("tariff_content_v2", tariff)
            ]))
        ])
    )
}

private func dailyCharge(_ amount: TOUJSON) -> TOUJSON {
    .array([.obj([("amount", amount), ("name", "Charge")])])
}

private let demandChargesAllZero: TOUJSON = .obj([("ALL", .obj([("ALL", 0)]))])

private func window(_ rate: TOUJSON, _ start: Int, _ end: Int) -> TOUJSON {
    .obj([("rate", rate), ("start", .int(start)), ("end", .int(end))])
}

private func season(fromMonth: Int, fromDay: Int, toMonth: Int, toDay: Int) -> TOUJSON {
    .obj([
        ("fromMonth", .int(fromMonth)),
        ("fromDay", .int(fromDay)),
        ("toMonth", .int(toMonth)),
        ("toDay", .int(toDay))
    ])
}

private let standardSeasons: TOUJSON = .obj([
    ("Summer", season(fromMonth: 6, fromDay: 1, toMonth: 9, toDay: 30)),
    ("Winter", season(fromMonth: 10, fromDay: 1, toMonth: 5, toDay: 31))
])

// MARK: - PG&E EV2-A

private extension TOUSettingsCatalog {
    static let pgeEV2A = TOUSettingsPreset(
        id: "pge-ev2a",
        name: "PG&E EV2-A",
        utility: "Pacific Gas & Electric",
        settings: envelope(.obj([
            ("name", "PG&E EV2-A"),
            ("utility", "Pacific Gas & Electric"),
            ("daily_charges", dailyCharge(0.32854)),
            ("demand_charges", demandChargesAllZero),
            ("energy_charges", .obj([
                ("Summer", .obj([
                    ("ON_PEAK", .array([window(0.49, 16, 21)])),
                    ("OFF_PEAK", .array([window(0.35, 0, 16), window(0.35, 21, 24)]))
                ])),
                ("Winter", .obj([
                    ("ON_PEAK", .array([window(0.42, 16, 21)])),
                    ("OFF_PEAK", .array([window(0.36, 0, 16), window(0.36, 21, 24)]))
                ]))
            ])),
            ("seasons", standardSeasons)
        ]))
    )
}

// MARK: - SCE TOU-D

private extension TOUSettingsCatalog {
    static let sceTOUD = TOUSettingsPreset(
        id: "sce-tou-d",
        name: "SCE TOU-D",
        utility: "Southern California Edison",
        settings: envelope(.obj([
            ("name", "SCE TOU-D"),
            ("utility", "Southern California Edison"),
            ("daily_charges", dailyCharge(0.031)),
            ("demand_charges", demandChargesAllZero),
            ("energy_charges", .obj([
                ("Summer", .obj([
                    ("ON_PEAK", .array([window(0.54, 16, 21)])),
                    ("MID_PEAK", .array([window(0.41, 8, 16), window(0.41, 21, 23)])),
                    ("OFF_PEAK", .array([window(0.28, 0, 8), window(0.28, 23, 24)]))
                ])),
                ("Winter", .obj([
                    ("MID_PEAK", .array([window(0.43, 8, 21)])),
                    ("SUPER_OFF_PEAK", .array([window(0.28, 0, 8), window(0.28, 21, 24)]))
                ]))
            ])),
            ("seasons", standardSeasons)
        ]))
    )
}

// MARK: - SDG&E TOU-DR1

private extension TOUSettingsCatalog {
    static let sdgeTOUDR1 = TOUSettingsPreset(
        id: "sdge-tou-dr1",
        name: "SDG&E TOU-DR1",
        utility: "San Diego Gas & Electric",
        settings: envelope(.obj([
            ("name", "SDG&E TOU-DR1"),
            ("utility", "San Diego Gas & Electric"),
            ("daily_charges", dailyCharge(0.546)),
            ("demand_charges", demandChargesAllZero),
            ("energy_charges", .obj([
                ("Summer", .obj([
                    ("ON_PEAK", .array([window(0.71, 16, 21)])),
                    ("OFF_PEAK", .array([window(0.45, 0, 16), window(0.45, 21, 24)]))
                ])),
                ("Winter", .obj([
                    ("ON_PEAK", .array([window(0.57, 16, 21)])),
                    ("OFF_PEAK", .array([window(0.45, 0, 16), window(0.45, 21, 24)]))
                ]))
            ])),
            ("seasons", standardSeasons)
        ]))
    )
}
