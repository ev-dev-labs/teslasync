//
//  FleetApiSection.Tools.swift
//  TeslaSync — P4 feature view · 0004 · FleetApiSection (Apple)
//
//  The first five Fleet API tool cards (ports of the web tool functions):
//  FleetApiConfigTool, PartnerRegistrationTool, PartnerPublicKeyTool,
//  PublicKeySetupTool, and VehicleKeyPairingTool. Each binds through the shared
//  model (no networking in the view) and renders every state of its data: query
//  loading / error / loaded, and the per-action idle / loading / success / failure
//  result panels.
//

import SwiftUI

// MARK: - Config tool (port of `FleetApiConfigTool`)

struct FleetConfigTool: View {
    let model: FleetApiSectionModel

    var body: some View {
        FleetToolCard(
            icon: "gearshape.fill", tone: .cyan,
            titleKey: "Config", titleFallback: "Config",
            descKey: "Config Desc", descFallback: "Fleet API configuration"
        ) {
            switch model.fleetInfo {
            case .loading:
                VStack(spacing: TSSpacing.sm) { TSSkeleton(height: 14); TSSkeleton(height: 14) }
            case let .failed(message):
                loadFailed(message)
            case let .loaded(value):
                grid(FleetApiBuilder.configInfo(from: value))
            }
        }
    }

    private func grid(_ info: FleetApiConfigInfo) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: TSSpacing.sm) {
            FleetInfoTile(labelKey: "Base Url", labelFallback: "Base URL") {
                FleetMonoValue(value: info.baseURL)
            }
            FleetInfoTile(labelKey: "Client Id", labelFallback: "Client ID") {
                FleetMonoValue(value: info.clientID)
            }
            FleetInfoTile(labelKey: "Auth Status", labelFallback: "Auth Status") {
                if info.authenticated {
                    FleetBadge(text: FleetApiStrings.text("Authenticated", "Authenticated"), tone: .green, dot: true)
                } else {
                    FleetBadge(
                        text: FleetApiStrings.text("Not Authenticated", "Not Authenticated"),
                        tone: .red,
                        dot: true
                    )
                }
            }
            FleetInfoTile(labelKey: "Regions", labelFallback: "Regions") {
                regionBadges(info.regions)
            }
        }
    }

    @ViewBuilder
    private func regionBadges(_ regions: [String]) -> some View {
        if regions.isEmpty {
            Text(verbatim: "—").font(Font.TS.body).foregroundStyle(Color.TS.textMuted)
        } else {
            HStack(spacing: TSSpacing.xs) {
                ForEach(regions, id: \.self) { region in
                    FleetBadge(text: Text(verbatim: region), tone: .cyan)
                }
            }
        }
    }

    private func loadFailed(_ message: String) -> some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Color.TS.statusDanger)
            FleetApiStrings.text("error.loadFailed", "Failed to load data")
                .font(Font.TS.body).foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: message).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
        }
    }
}

// MARK: - Partner registration tool (port of `PartnerRegistrationTool`)

struct PartnerRegistrationTool: View {
    let model: FleetApiSectionModel
    @State private var domain = ""

    private let opensslGen = "openssl ecparam -name prime256v1 -genkey -noout -out private.pem"
    private let opensslPub = "openssl ec -in private.pem -pubout -out public.pem"

    var body: some View {
        FleetToolCard(
            icon: "globe", tone: .green,
            titleKey: "Partner Reg", titleFallback: "Partner Reg",
            descKey: "Partner Reg Desc", descFallback: "Register as a Fleet API partner"
        ) {
            FleetWarningCallout(
                titleKey: "Prerequisites", titleFallback: "Prerequisites",
                bodyKey: "Prerequisites Desc",
                bodyFallback: "Generate an EC key pair before registering."
            )
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                FleetApiStrings.text("Openssl Commands", "OpenSSL Commands")
                    .font(Font.TS.label).foregroundStyle(Color.TS.textSecondary)
                FleetCodeRow(value: opensslGen)
                FleetCodeRow(value: opensslPub)
            }
            FleetField(
                labelKey: "Domain", labelFallback: "Domain",
                promptKey: "devtools.fleet.domainPrompt", promptFallback: "yourapp.example.com",
                systemImage: "globe", text: $domain
            )
            FleetButton(
                titleKey: "Register", fallback: "Register", variant: .primary, systemImage: "play.fill",
                loading: model.result(for: "register-partner").isLoading
            ) {
                model.run(FleetRequest(
                    id: "register-partner", endpoint: "register-partner", method: .post,
                    body: ["domain": .string(domain)]
                ))
            }
            if model.result(for: "register-partner").isPresented {
                FleetResultPanel(
                    titleKey: "Partner Reg", titleFallback: "Partner Reg",
                    result: model.result(for: "register-partner")
                )
            }
        }
    }
}

// MARK: - Partner public-key tool (port of `PartnerPublicKeyTool`)

struct PartnerPublicKeyTool: View {
    let model: FleetApiSectionModel
    @State private var domain = ""

    private var result: ToolResult {
        model.result(for: "partner-public-key")
    }

    var body: some View {
        FleetToolCard(
            icon: "checkmark.shield.fill", tone: .cyan,
            titleKey: "devtools.partnerKey.title", titleFallback: "Public Key Verification",
            descKey: "devtools.partnerKey.desc", descFallback: "Verify your registered public key with Tesla"
        ) {
            FleetField(
                labelKey: "Domain", labelFallback: "Domain",
                promptKey: "devtools.fleet.domainPrompt", promptFallback: "yourapp.example.com",
                systemImage: "globe", text: $domain
            )
            FleetButton(
                titleKey: "devtools.partnerKey.verify", fallback: "Verify",
                variant: .primary, systemImage: "play.fill",
                loading: result.isLoading,
                disabled: domain.trimmingCharacters(in: .whitespaces).isEmpty
            ) {
                let encoded = domain.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? domain
                model.run(FleetRequest(id: "partner-public-key", endpoint: "partner-public-key?domain=\(encoded)"))
            }
            if case let .success(value) = result {
                verificationView(FleetApiBuilder.partnerKeyVerification(from: value))
            }
            if result.isPresented {
                FleetResultPanel(
                    titleKey: "devtools.partnerKey.rawResponse", titleFallback: "Raw Response",
                    result: result
                )
            }
        }
    }

    @ViewBuilder
    private func verificationView(_ verification: PartnerKeyVerification) -> some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(FleetApiBuilder.partnerKeyBadges(verification)) { badge in
                FleetBadge(text: FleetApiStrings.text(badge.titleKey, badge.fallback), tone: badge.tone, dot: true)
            }
        }
        if let pem = verification.publicKeyPEM {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                FleetApiStrings.text("devtools.partnerKey.pemLabel", "Registered PEM")
                    .font(Font.TS.label).foregroundStyle(Color.TS.textSecondary)
                VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                    ScrollView(.vertical) {
                        Text(verbatim: pem)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Color.TS.textPrimary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 160)
                    FleetCopyButton(value: pem)
                }
                .padding(TSSpacing.sm)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            }
        }
    }
}

// MARK: - Public-key setup tool (port of `PublicKeySetupTool`)

struct PublicKeySetupTool: View {
    let model: FleetApiSectionModel
    @State private var pemInput = ""

    var body: some View {
        FleetToolCard(
            icon: "key.fill", tone: .purple,
            titleKey: "Public Key", titleFallback: "Public Key",
            descKey: "Public Key Desc", descFallback: "Manage your local public key"
        ) {
            switch model.publicKeyStatus {
            case .loading:
                VStack(spacing: TSSpacing.sm) { TSSkeleton(height: 14); TSSkeleton(width: 160, height: 14) }
            case let .failed(message):
                Text(verbatim: message).font(Font.TS.body).foregroundStyle(Color.TS.statusDanger)
            case let .loaded(value):
                loadedBody(FleetApiBuilder.publicKeyStatus(from: value))
            }
        }
    }

    @ViewBuilder
    private func loadedBody(_ status: PublicKeyStatus) -> some View {
        HStack(spacing: TSSpacing.sm) {
            FleetApiStrings.text("Status", "Status").font(Font.TS.label).foregroundStyle(Color.TS.textSecondary)
            if status.configured {
                FleetBadge(text: FleetApiStrings.text("Configured", "Configured"), tone: .green, dot: true)
            } else {
                FleetBadge(text: FleetApiStrings.text("Not Configured", "Not Configured"), tone: .amber, dot: true)
            }
        }
        if let fingerprint = status.fingerprint, !fingerprint.isEmpty {
            FleetCodeRow(value: fingerprint, tone: .purple, systemImage: "touchid")
        }
        if let url = status.wellKnownURL, !url.isEmpty {
            FleetCodeRow(value: url, tone: .cyan, systemImage: "link")
        }
        FleetWarningCallout(
            titleKey: nil, titleFallback: nil,
            bodyKey: "Private Key Warning",
            bodyFallback: "Never share your private key. Keep it secret and secure."
        )
        keypairButtons
        FleetResultPanel(
            titleKey: "Generate Keypair", titleFallback: "Generate Keypair",
            result: model.result(
                for: "generate-keypair",
                idleKey: "devtools.keypairIdle", idleFallback: "Generate or delete a keypair to see results"
            )
        )
        FleetResultPanel(
            titleKey: "Delete Keypair", titleFallback: "Delete Keypair",
            result: model.result(for: "delete-keypair")
        )
        uploadSection
    }

    private var keypairButtons: some View {
        HStack(spacing: TSSpacing.sm) {
            FleetButton(
                titleKey: "Generate Keypair", fallback: "Generate Keypair",
                variant: .primary, systemImage: "key.fill",
                loading: model.result(for: "generate-keypair").isLoading
            ) {
                model.run(FleetRequest(id: "generate-keypair", endpoint: "generate-keypair", method: .post))
                model.refresh()
            }
            FleetButton(
                titleKey: "Delete Keypair", fallback: "Delete Keypair",
                variant: .destructive, systemImage: "trash",
                loading: model.result(for: "delete-keypair").isLoading
            ) {
                model.run(FleetRequest(id: "delete-keypair", endpoint: "public-key", method: .delete))
                model.refresh()
            }
        }
    }

    private var uploadSection: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            FleetTextArea(
                labelKey: "Upload Pem", labelFallback: "Upload PEM",
                promptKey: "devtools.fleet.pemPrompt", promptFallback: "-----BEGIN PUBLIC KEY-----",
                text: $pemInput
            )
            FleetButton(
                titleKey: "Upload Key", fallback: "Upload Key",
                variant: .secondary, systemImage: "arrow.up.doc",
                loading: model.result(for: "upload-public-key").isLoading
            ) {
                model.run(FleetRequest(
                    id: "upload-public-key", endpoint: "upload-public-key", method: .post,
                    body: ["pem": .string(pemInput)]
                ))
                model.refresh()
            }
            FleetResultPanel(
                titleKey: "Upload Key", titleFallback: "Upload Key",
                result: model.result(
                    for: "upload-public-key",
                    idleKey: "devtools.uploadIdle", idleFallback: "Upload a public key to see results"
                )
            )
        }
    }
}

// MARK: - Vehicle key-pairing tool (port of `VehicleKeyPairingTool`)

struct VehicleKeyPairingTool: View {
    let model: FleetApiSectionModel

    var body: some View {
        FleetToolCard(
            icon: "car.fill", tone: .green,
            titleKey: "Key Pairing", titleFallback: "Key Pairing",
            descKey: "Key Pairing Desc", descFallback: "Pair your key with each vehicle"
        ) {
            FleetCodeRow(value: FleetApiBuilder.pairingURL(hostname: model.hostname), tone: .green, systemImage: "link")
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                FleetApiStrings.text("Pairing Instructions", "Pairing Instructions")
                    .font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                pairingStep("devtools.fleet.pairingStep1", "Pairing Step1")
                pairingStep("devtools.fleet.pairingStep2", "Pairing Step2")
                pairingStep("devtools.fleet.pairingStep3", "Pairing Step3")
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.accent.opacity(0.06),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
        }
    }

    private func pairingStep(_ key: String, _ fallback: String) -> some View {
        HStack(alignment: .top, spacing: TSSpacing.xs) {
            Image(systemName: "chevron.right")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            FleetApiStrings.text(key, fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Small info tile + mono value (config card cells)

/// A labeled info tile used in the config card grid.
struct FleetInfoTile<Content: View>: View {
    let labelKey: String
    let labelFallback: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            FleetApiStrings.text(labelKey, labelFallback)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            content()
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .topLeading)
        .padding(TSSpacing.sm)
        .background(
            Color.TS.surfaceGlass.opacity(0.6),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
    }
}

/// A truncating monospaced value with a trailing copy button (config cells).
struct FleetMonoValue: View {
    let value: String

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: value.isEmpty ? "—" : value)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(maxWidth: .infinity, alignment: .leading)
            if !value.isEmpty { FleetCopyButton(value: value) }
        }
    }
}
