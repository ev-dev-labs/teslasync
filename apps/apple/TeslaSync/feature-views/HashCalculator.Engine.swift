//
//  HashCalculator.Engine.swift
//  TeslaSync — P4 feature view · 0015 · HashCalculator (Apple)
//
//  The pure, SwiftUI-free SHA-256 → lowercase-hex adapter — the native mirror of the
//  web source's compute block in
//  features/admin/components/devtools/tools/HashCalculator.tsx:
//
//      const data = encoder.encode(inputVal)               // UTF-8 bytes
//      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
//      hex = Array.from(new Uint8Array(hashBuffer))
//        .map((b) => b.toString(16).padStart(2, '0')).join('')
//
//  Foundation + CryptoKit only, so it is unit-tested AND executed in the host
//  validation harness (a real "input → digest" run, not just a typecheck).
//

import CryptoKit
import Foundation

// MARK: - SHA-256 hex engine

/// Pure SHA-256 helpers for the HashCalculator surface. Deterministic and
/// dependency-light: UTF-8 encode → SHA-256 → lowercase hex, byte-for-byte
/// identical to the web `crypto.subtle.digest('SHA-256', …)` + `toString(16)` output.
public enum HashCalculatorEngine {
    /// The 64-character lowercase hex SHA-256 digest of `input` (UTF-8 encoded).
    public static func sha256Hex(_ input: String) -> String {
        sha256Hex(Data(input.utf8))
    }

    /// The lowercase hex SHA-256 digest of raw `data`.
    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { byte in String(format: "%02x", byte) }.joined()
    }
}
