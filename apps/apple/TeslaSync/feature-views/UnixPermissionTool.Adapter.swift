//
//  UnixPermissionTool.Adapter.swift
//  TeslaSync — P4 feature view · 0022 · UnixPermissionTool (Apple)
//
//  Pure, SwiftUI-free projection logic — the native parity of the web tool's
//  `useMemo` octal→symbolic computation in
//  features/admin/components/devtools/tools/UnixPermissionTool.tsx.
//
//  Kept Foundation-only so the model + adapter compile and run on a plain host
//  (the SwiftUI chrome layers on top in UnixPermissionTool.swift). There is no
//  network here — this surface is a synchronous client-side tool, mirroring the
//  web source whose only hook is `useTranslation`.
//

import Foundation

// MARK: - Permission table (web `PERMS`)

/// The octal-digit → `rwx` triad map, ported verbatim from the web `PERMS`
/// constant (features/admin/components/devtools/constants.ts).
public enum UnixPermissionPerms {
    /// Maps a single octal digit (`0`…`7`) to its three-character triad.
    public static let triads: [Character: String] = [
        "0": "---",
        "1": "--x",
        "2": "-w-",
        "3": "-wx",
        "4": "r--",
        "5": "r-x",
        "6": "rw-",
        "7": "rwx"
    ]

    /// The triad for an octal digit, falling back to `---` exactly as the web
    /// source does (`PERMS[d] ?? '---'`).
    public static func triad(for digit: Character) -> String {
        triads[digit] ?? "---"
    }
}

// MARK: - Projection

/// The decoded permission set for a valid 3-digit octal value: the full
/// nine-character symbolic string plus its owner / group / other triads.
public struct UnixPermissionProjection: Equatable, Sendable {
    public let octal: String
    public let symbolic: String
    public let owner: String
    public let group: String
    public let other: String

    public init(octal: String, symbolic: String, owner: String, group: String, other: String) {
        self.octal = octal
        self.symbolic = symbolic
        self.owner = owner
        self.group = group
        self.other = other
    }
}

/// Pure projector reproducing the web `symbolic` memo: a three-character
/// `[0-7]{3}` octal maps to the concatenated triads; anything else yields `nil`
/// (the web returns `null`, hiding the breakdown).
public enum UnixPermissionProjector {
    /// `true` when `octal` is exactly three characters, each `0`…`7` — the
    /// native parity of `octal.length === 3 && /^[0-7]{3}$/.test(octal)`.
    public static func isValid(_ octal: String) -> Bool {
        guard octal.count == 3 else { return false }
        return octal.allSatisfy { character in
            ("0" ... "7").contains(character)
        }
    }

    /// Projects an octal string to its permission breakdown, or `nil` when the
    /// input is not a valid three-digit octal value.
    public static func project(octal: String) -> UnixPermissionProjection? {
        guard isValid(octal) else { return nil }
        let triads = octal.map(UnixPermissionPerms.triad(for:))
        return UnixPermissionProjection(
            octal: octal,
            symbolic: triads.joined(),
            owner: triads[0],
            group: triads[1],
            other: triads[2]
        )
    }
}

// MARK: - Presets (web `Select` options)

/// One preset row from the web `Select`: an octal value with its
/// `octal (symbolic)` display label (e.g. `755 (rwxr-xr-x)`), derived from the
/// projector so the label can never drift from the decoding.
public struct UnixPermissionPreset: Equatable, Identifiable, Sendable {
    public let octal: String
    public let label: String

    public var id: String {
        octal
    }

    public init(octal: String) {
        self.octal = octal
        let symbolic = UnixPermissionProjector.project(octal: octal)?.symbolic ?? ""
        label = symbolic.isEmpty ? octal : "\(octal) (\(symbolic))"
    }
}

public extension UnixPermissionPreset {
    /// The preset values shown in the web source, in source order:
    /// 755 / 644 / 700 / 600 / 777 / 444.
    static let all: [UnixPermissionPreset] = [
        UnixPermissionPreset(octal: "755"),
        UnixPermissionPreset(octal: "644"),
        UnixPermissionPreset(octal: "700"),
        UnixPermissionPreset(octal: "600"),
        UnixPermissionPreset(octal: "777"),
        UnixPermissionPreset(octal: "444")
    ]
}

// MARK: - Accessibility

/// Spoken VoiceOver summary for a decoded projection (owner / group / other and
/// the combined symbolic string), assembled through the surface i18n facade so
/// the label localizes with the rest of the surface.
public enum UnixPermissionAccessibility {
    public static func summary(for projection: UnixPermissionProjection) -> String {
        let owner = UnixPermissionToolStrings.string("Owner", "Owner")
        let group = UnixPermissionToolStrings.string("Group", "Group")
        let other = UnixPermissionToolStrings.string("Other", "Other")
        let symbolic = UnixPermissionToolStrings.string("Unix Perm Symbolic A11y", "Symbolic permissions")
        return "\(owner) \(projection.owner), \(group) \(projection.group), "
            + "\(other) \(projection.other). \(symbolic) \(projection.symbolic)"
    }
}
