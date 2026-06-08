//
//  TOTPEnrollmentSection.Modals.swift
//  TeslaSync — P4 feature view · 0217 · TOTPEnrollmentSection (Apple)
//
//  The three modal contents the surface presents as sheets (web `Modal` /
//  `ConfirmDialog`): the enroll modal (QR + manual secret + six-digit verify),
//  the backup-codes reveal (the copy/download "save these" step), and the typed
//  "DISABLE" confirmation. Plus the shared titled-sheet scaffold, the data-URI QR
//  renderer (web `<img src={qr_data_uri}>`), and the numeric code field. All
//  strings resolve through the P1/S10 facade; styling uses the P1/S9 tokens +
//  shared components.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Titled sheet scaffold (web `Modal` chrome)

/// A titled sheet container: the verbatim title + a close affordance over the
/// scrollable content (web `Modal` header + body). Used by all three modals so
/// they share one HIG-native chrome.
struct TOTPModalScaffold<Content: View>: View {
    let title: String
    let onClose: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: title)
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: TSSpacing.md)
                Button(action: onClose) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 20))
                        .foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(TOTPEnrollmentStrings.text("totp.modal.close", "Close"))
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                content().padding(TSSpacing.lg)
            }
        }
        .frame(minWidth: 320, minHeight: 280)
        .background(Color.TS.bg)
        .totpMediumSheet()
    }
}

// MARK: - Enroll modal (web QR + manual code + six-digit verify)

/// The enrollment modal body: the scan instructions, the QR code, the manual
/// base32 secret with a copy button, the six-digit verify field, the inline
/// verify error, and the Cancel / Verify-and-activate actions.
struct TOTPEnrollModalContent: View {
    @Bindable var model: TOTPEnrollmentModel
    let enrollment: TOTPEnrollmentData

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TOTPEnrollmentStrings.text(
                "totp.modal.scanInstructions",
                "Scan the QR code with your authenticator app, or enter the secret manually."
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .fixedSize(horizontal: false, vertical: true)

            HStack {
                Spacer(minLength: 0)
                TOTPQRCodeView(
                    dataURI: enrollment.qrDataURI,
                    accessibilityLabel: TOTPEnrollmentStrings.string("totp.modal.qrAlt", "TOTP QR code")
                )
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: TOTPEnrollmentStrings.string("totp.modal.manualLabel", "Manual entry secret"))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                HStack(alignment: .top, spacing: TSSpacing.sm) {
                    TSCode(enrollment.secret)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    TSCopyButton(value: enrollment.secret)
                }
            }

            TOTPCodeField(
                label: TOTPEnrollmentStrings.string(
                    "totp.modal.codeLabel", "Enter the 6-digit code from your app"
                ),
                text: model.verifyCodeBinding,
                isDisabled: model.verifyPending
            )

            if let error = model.verifyError {
                Text(verbatim: error)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.statusDanger)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel(Text(verbatim: error))
            }

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(variant: .ghost) { model.closeDialog() } label: {
                    TOTPEnrollmentStrings.text("totp.modal.cancel", "Cancel")
                }
                .disabled(model.verifyPending)
                TSButton(variant: .primary, isLoading: model.verifyPending) { model.verify() } label: {
                    TOTPEnrollmentStrings.text("totp.modal.verify", "Verify and activate")
                }
            }
        }
    }
}

// MARK: - Backup-codes reveal (web "Save your backup codes")

/// The backup-codes modal body: the never-shown-again warning, the codes grid,
/// and the Download / Copy / "I saved them" actions (web `backupCodes` step).
struct TOTPBackupCodesModalContent: View {
    @Bindable var model: TOTPEnrollmentModel
    let codes: [String]

    private let columns = [
        GridItem(.flexible(), alignment: .leading),
        GridItem(.flexible(), alignment: .leading)
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            TOTPEnrollmentStrings.text(
                "totp.backupCodes.warning",
                """
                These codes will not be shown again. Store them in a password manager. Each code \
                can be used once if you lose access to your authenticator app.
                """
            )
            .font(Font.TS.bodySm)
            .foregroundStyle(Color.TS.textPrimary)
            .fixedSize(horizontal: false, vertical: true)

            LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(codes, id: \.self) { code in
                    TSCode(code).frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(TSSpacing.md)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityElement(children: .contain)

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                if let contents = model.backupCodesFileContents() {
                    ShareLink(item: contents, preview: SharePreview(TOTPFormat.backupCodesFilename)) {
                        Label {
                            TOTPEnrollmentStrings.text("totp.backupCodes.download", "Download .txt")
                        } icon: {
                            Image(systemName: "square.and.arrow.down")
                        }
                        .font(Font.TS.body)
                    }
                    .accessibilityLabel(
                        TOTPEnrollmentStrings.text("totp.backupCodes.download", "Download .txt")
                    )
                }
                TSCopyButton(value: codes.joined(separator: "\n"))
                TSButton(variant: .primary) { model.closeDialog() } label: {
                    TOTPEnrollmentStrings.text("totp.backupCodes.done", "I saved them")
                }
            }
        }
    }
}

// MARK: - Disable confirmation (web ConfirmDialog + typed "DISABLE")

/// The disable confirmation body: the warning, the typed-confirmation field that
/// must read "DISABLE", and the Cancel / Disable actions (web `ConfirmDialog`
/// with `requireTypedConfirmation`).
struct TOTPDisableConfirmContent: View {
    @Bindable var model: TOTPEnrollmentModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                TSIconBox(systemName: "exclamationmark.triangle.fill", tone: .danger)
                TOTPEnrollmentStrings.text(
                    "totp.disable.message",
                    """
                    You will no longer be prompted for a TOTP code on the sudo step-up. Your \
                    backup codes will be invalidated.
                    """
                )
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: TOTPEnrollmentStrings.string("totp.disable.typedLabel", "Type DISABLE to confirm"))
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                TextField("", text: $model.disableConfirmInput)
                    .textFieldStyle(.plain)
                    .font(.system(.body, design: .monospaced))
                    .autocorrectionDisabled()
                    .totpDisableConfirmField()
                    .padding(.horizontal, TSSpacing.sm)
                    .padding(.vertical, TSSpacing.sm)
                    .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                            .strokeBorder(Color.TS.border, lineWidth: 1)
                    )
                    .accessibilityLabel(
                        TOTPEnrollmentStrings.text("totp.disable.typedLabel", "Type DISABLE to confirm")
                    )
            }

            HStack(spacing: TSSpacing.sm) {
                Spacer(minLength: 0)
                TSButton(variant: .ghost) { model.cancelDisableConfirm() } label: {
                    TOTPEnrollmentStrings.text("totp.disable.cancel", "Keep TOTP enabled")
                }
                .disabled(model.revokePending)
                TSButton(variant: .destructive, isLoading: model.revokePending) {
                    model.confirmDisable()
                } label: {
                    TOTPEnrollmentStrings.text("totp.disable.confirm", "Disable")
                }
                .disabled(!model.canConfirmDisable)
            }
        }
    }
}

// MARK: - QR code (web `<img src={qr_data_uri}>`)

/// Renders the enrollment QR from its `data:` URI (web `<img>`), with a graceful
/// glyph fallback when the payload cannot be decoded so the modal never shows a
/// broken image. White-backed + bordered to stay scannable in dark mode.
struct TOTPQRCodeView: View {
    let dataURI: String
    let accessibilityLabel: String

    var body: some View {
        Group {
            if let image = Self.image(from: dataURI) {
                image.resizable().interpolation(.none).scaledToFit().padding(TSSpacing.sm)
            } else {
                Image(systemName: "qrcode")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Color.black.opacity(0.5))
                    .padding(TSSpacing.lg)
            }
        }
        .frame(width: 224, height: 224)
        .background(Color.white, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// Decodes a `data:[mime];base64,<payload>` URI into a platform `Image`.
    static func image(from dataURI: String) -> Image? {
        guard let comma = dataURI.firstIndex(of: ",") else { return nil }
        let payload = String(dataURI[dataURI.index(after: comma)...])
        guard let data = Data(base64Encoded: payload, options: .ignoreUnknownCharacters) else {
            return nil
        }
        #if canImport(UIKit)
            return UIImage(data: data).map(Image.init(uiImage:))
        #elseif canImport(AppKit)
            return NSImage(data: data).map(Image.init(nsImage:))
        #else
            return nil
        #endif
    }
}

// MARK: - Numeric code field (web `Input inputMode="numeric"`)

/// The six-digit verify field (web numeric `Input`): a monospaced numeric field
/// that auto-focuses and routes every keystroke through the model's sanitiser.
struct TOTPCodeField: View {
    let label: String
    @Binding var text: String
    let isDisabled: Bool
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            TextField("", text: $text)
                .textFieldStyle(.plain)
                .font(.system(.body, design: .monospaced))
                .focused($focused)
                .disabled(isDisabled)
                .totpNumericKeyboard()
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .onAppear { focused = true }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Platform modifiers

private extension View {
    /// iOS numeric keyboard + one-time-code autofill; a no-op on macOS.
    func totpNumericKeyboard() -> some View {
        #if os(iOS)
            return keyboardType(.numberPad).textContentType(.oneTimeCode)
        #else
            return self
        #endif
    }

    /// iOS character-capitalization for the typed "DISABLE" token; no-op on macOS.
    func totpDisableConfirmField() -> some View {
        #if os(iOS)
            return textInputAutocapitalization(.characters)
        #else
            return self
        #endif
    }

    /// A medium/large detented sheet on iOS; the natural sheet sizing on macOS.
    func totpMediumSheet() -> some View {
        #if os(iOS)
            return presentationDetents([.medium, .large])
        #else
            return self
        #endif
    }
}
