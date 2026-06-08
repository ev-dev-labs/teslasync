//
//  UnixPermissionTool.Previews.swift
//  TeslaSync — P4 feature view · 0022 · UnixPermissionTool (Apple)
//
//  Xcode previews for each surface branch (valid breakdown / preset / invalid
//  hint). DEBUG-only; skipped by the host compile + format gates.
//

import SwiftUI

#if DEBUG
    #Preview("Valid (755)") {
        UnixPermissionTool(model: UnixPermissionToolModel(octal: "755"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Preset (644)") {
        UnixPermissionTool(model: UnixPermissionToolModel(octal: "644"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Full octal (777)") {
        UnixPermissionTool(model: UnixPermissionToolModel(octal: "777"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }

    #Preview("Empty (invalid)") {
        UnixPermissionTool(model: UnixPermissionToolModel(octal: "75"))
            .padding()
            .frame(maxWidth: 420)
            .background(Color.TS.bg)
    }
#endif
