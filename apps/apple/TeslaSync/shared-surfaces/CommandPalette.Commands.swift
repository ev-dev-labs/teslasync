//
//  CommandPalette.Commands.swift
//  TeslaSync — P4 shared surface · 0205 · CommandPalette (Apple)
//
//  The static vehicle-command catalog — the verbatim port of the web `PALETTE_COMMAND_CONFIGS` constant in
//  `components/ui/CommandPalette.tsx`. Each entry is one palette-eligible Tesla command (security, climate,
//  charging, doors, windows, alerts, media) with its i18n label key + English fallback, fuzzy-match keywords,
//  and the resolved SF Symbol glyph. Kept in its own file (Foundation only) so the Adapter stays within the
//  SwiftLint file-length budget; the ``CommandPaletteItems`` builder reads this catalog to render the
//  "Vehicle Commands" section.
//

import Foundation

/// One palette-eligible vehicle command — the native peer of the web `PaletteCommandConfig`. The web stores a
/// `defId` + `useOffIcon` to look the glyph up in `COMMANDS`; the native port resolves the SF Symbol up front
/// so the catalog is self-contained.
public struct PaletteCommandConfig: Sendable, Equatable {
    public let command: String
    public let labelKey: String
    public let labelFallback: String
    public let keywords: [String]
    public let iconName: String

    public init(command: String, labelKey: String, labelFallback: String, keywords: [String], iconName: String) {
        self.command = command
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.keywords = keywords
        self.iconName = iconName
    }

    /// The verbatim port of the web `PALETTE_COMMAND_CONFIGS` — security, climate, charging, doors, windows,
    /// alerts, and media commands, in the same order the web renders them.
    public static let all: [PaletteCommandConfig] = [
        // Security
        .init(
            command: "wake_up",
            labelKey: "palette.cmd.wakeUp",
            labelFallback: "Wake Up Vehicle",
            keywords: ["wake", "power", "start", "online"],
            iconName: "power"
        ),
        .init(
            command: "lock",
            labelKey: "palette.cmd.lock",
            labelFallback: "Lock Vehicle",
            keywords: ["lock", "security", "doors", "secure"],
            iconName: "lock.fill"
        ),
        .init(
            command: "unlock",
            labelKey: "palette.cmd.unlock",
            labelFallback: "Unlock Vehicle",
            keywords: ["unlock", "open", "doors"],
            iconName: "lock.open.fill"
        ),
        .init(
            command: "sentry_on",
            labelKey: "palette.cmd.sentryOn",
            labelFallback: "Sentry Mode On",
            keywords: ["sentry", "guard", "security", "surveillance"],
            iconName: "shield.lefthalf.filled"
        ),
        .init(
            command: "sentry_off",
            labelKey: "palette.cmd.sentryOff",
            labelFallback: "Sentry Mode Off",
            keywords: ["sentry", "off", "security"],
            iconName: "shield.slash"
        ),
        // Climate
        .init(
            command: "climate_on",
            labelKey: "palette.cmd.climateOn",
            labelFallback: "Climate On",
            keywords: ["climate", "ac", "heat", "cool", "hvac", "temperature"],
            iconName: "thermometer.sun.fill"
        ),
        .init(
            command: "climate_off",
            labelKey: "palette.cmd.climateOff",
            labelFallback: "Climate Off",
            keywords: ["climate", "off", "ac", "stop"],
            iconName: "thermometer.snowflake"
        ),
        .init(
            command: "dog_mode",
            labelKey: "palette.cmd.dogMode",
            labelFallback: "Dog Mode",
            keywords: ["dog", "pet", "mode", "keep"],
            iconName: "pawprint.fill"
        ),
        .init(
            command: "camp_mode",
            labelKey: "palette.cmd.campMode",
            labelFallback: "Camp Mode",
            keywords: ["camp", "camping", "mode", "keep"],
            iconName: "tent.fill"
        ),
        // Charging
        .init(
            command: "charge_port_open",
            labelKey: "palette.cmd.chargePortOpen",
            labelFallback: "Open Charge Port",
            keywords: ["charge", "port", "open", "plug"],
            iconName: "ev.charger"
        ),
        .init(
            command: "close_charge_port",
            labelKey: "palette.cmd.chargePortClose",
            labelFallback: "Close Charge Port",
            keywords: ["charge", "port", "close"],
            iconName: "ev.charger.fill"
        ),
        .init(
            command: "charge_start",
            labelKey: "palette.cmd.chargeStart",
            labelFallback: "Start Charging",
            keywords: ["charge", "start", "begin", "plug"],
            iconName: "bolt.fill"
        ),
        .init(
            command: "charge_stop",
            labelKey: "palette.cmd.chargeStop",
            labelFallback: "Stop Charging",
            keywords: ["charge", "stop", "end"],
            iconName: "bolt.slash.fill"
        ),
        .init(
            command: "charge_max_range",
            labelKey: "palette.cmd.chargeMax",
            labelFallback: "Charge to Max Range",
            keywords: ["charge", "max", "range", "trip"],
            iconName: "battery.100.bolt"
        ),
        .init(
            command: "charge_standard",
            labelKey: "palette.cmd.chargeStandard",
            labelFallback: "Charge to Standard",
            keywords: ["charge", "standard", "daily"],
            iconName: "battery.75percent"
        ),
        // Doors & Trunk
        .init(
            command: "frunk_open",
            labelKey: "palette.cmd.frunk",
            labelFallback: "Open Frunk",
            keywords: ["frunk", "front", "trunk", "hood"],
            iconName: "car.fill"
        ),
        .init(
            command: "trunk_open",
            labelKey: "palette.cmd.trunk",
            labelFallback: "Open Trunk",
            keywords: ["trunk", "rear", "boot"],
            iconName: "car.rear.fill"
        ),
        // Windows
        .init(
            command: "vent_windows",
            labelKey: "palette.cmd.ventWindows",
            labelFallback: "Vent Windows",
            keywords: ["vent", "windows", "open", "air"],
            iconName: "wind"
        ),
        .init(
            command: "close_windows",
            labelKey: "palette.cmd.closeWindows",
            labelFallback: "Close Windows",
            keywords: ["close", "windows", "shut"],
            iconName: "rectangle.compress.vertical"
        ),
        // Alerts
        .init(
            command: "honk_horn",
            labelKey: "palette.cmd.horn",
            labelFallback: "Honk Horn",
            keywords: ["horn", "honk", "beep", "sound"],
            iconName: "speaker.wave.2.fill"
        ),
        .init(
            command: "flash_lights",
            labelKey: "palette.cmd.flash",
            labelFallback: "Flash Lights",
            keywords: ["flash", "lights", "blink", "find"],
            iconName: "lightbulb.fill"
        ),
        // Media
        .init(
            command: "media_toggle_playback",
            labelKey: "palette.cmd.playPause",
            labelFallback: "Play / Pause",
            keywords: ["play", "pause", "music", "media"],
            iconName: "playpause.fill"
        ),
        .init(
            command: "media_next_track",
            labelKey: "palette.cmd.nextTrack",
            labelFallback: "Next Track",
            keywords: ["next", "track", "skip", "music"],
            iconName: "forward.fill"
        ),
        .init(
            command: "media_prev_track",
            labelKey: "palette.cmd.prevTrack",
            labelFallback: "Previous Track",
            keywords: ["previous", "track", "back", "music"],
            iconName: "backward.fill"
        )
    ]
}
