//
//  TimeMachineBanner.Views.swift
//  TeslaSync — P4 shared surface · 0143 · TimeMachineBanner (Apple)
//
//  The presentational subviews composed by `TimeMachineBanner`: the active banner card (the native
//  parity of the web `<AlertBanner variant="info">` — the info-tinted chrome with the "Viewing data as
//  of …" title and the read-only note, plus the "Pick a date" toggle, "Return to live", and the inline
//  date-time picker) and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and
//  the shared P1/S9 tokens / components (`TSAlertBanner` ← web `AlertBanner`, `TSButton` ← web `Button`,
//  `DatePicker` ← web `<input type="datetime-local">`) — no persistence, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Active banner (web `<AlertBanner variant="info">` + picker)

/// The active banner — the data render of the surface. Reproduces the web banner: the info-tinted
/// `TSAlertBanner` chrome (clock icon + the "Viewing data as of {when}" title + the read-only / pick
/// note), the "Pick a date" toggle and the "Return to live" affordance (shown only when historical,
/// web `effective != null`), and the inline date-time picker (web `<input type="datetime-local">` +
/// "View as of date" + "Cancel") revealed when `pickerOpen`.
struct TimeMachineBannerCard: View {
    let data: TimeMachineData
    let pickerOpen: Bool
    let onTogglePicker: () -> Void
    let onReturnToLive: () -> Void
    let onSubmit: (Date) -> Void
    let onCancelPicker: () -> Void

    @Environment(\.locale) private var locale
    @State private var draft = TimeMachineSeed.defaultAnchor()

    private var whenText: String {
        guard let asOf = data.asOf else { return "" }
        return TimeMachineFormat.dateTime(asOf, locale: locale)
    }

    private var titleText: String {
        TimeMachineTitle.text(
            when: whenText,
            template: TimeMachineBannerStrings.string(TimeMachineCopy.titleKey, TimeMachineCopy.titleFallback)
        )
    }

    private var bodyText: String {
        data.isHistorical
            ? TimeMachineBannerStrings.string(TimeMachineCopy.bodyKey, TimeMachineCopy.bodyFallback)
            : TimeMachineBannerStrings.string(TimeMachineCopy.pickPromptKey, TimeMachineCopy.pickPromptFallback)
    }

    private var pickLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.pickKey, TimeMachineCopy.pickFallback)
    }

    private var returnLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.returnToLiveKey, TimeMachineCopy.returnToLiveFallback)
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSAlertBanner(
                    tone: .info,
                    systemImage: "clock.arrow.circlepath",
                    title: LocalizedStringKey(titleText),
                    message: LocalizedStringKey(bodyText)
                )
                .accessibilityLabel(Text(verbatim: TimeMachineAccessibility.bannerLabel(
                    title: titleText,
                    body: bodyText
                )))

                actionRow
                if pickerOpen {
                    TimeMachinePickerRow(
                        draft: $draft,
                        onSubmit: { onSubmit(draft) },
                        onCancel: onCancelPicker
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear(perform: seedDraft)
        .onChange(of: pickerOpen) { _, isOpen in
            if isOpen { seedDraft() }
        }
    }

    private var actionRow: some View {
        HStack(spacing: TSSpacing.sm) {
            TSButton(variant: .secondary, size: .small, action: onTogglePicker) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "clock").font(.system(size: 11, weight: .semibold))
                    Text(verbatim: pickLabel)
                }
            }
            .accessibilityLabel(Text(verbatim: pickLabel))

            if data.isHistorical {
                TSButton(variant: .ghost, size: .small, action: onReturnToLive) {
                    Text(verbatim: returnLabel)
                }
                .accessibilityLabel(Text(verbatim: returnLabel))
            }
        }
    }

    private func seedDraft() {
        // Web `onOpen` seed: the current anchor if any, else yesterday at noon.
        draft = data.asOf ?? TimeMachineSeed.defaultAnchor()
    }
}

// MARK: - Inline picker (web `<input type="datetime-local">` + submit / cancel)

/// The inline date-time picker — the native parity of the web `datetime-local` input row. A labelled
/// `DatePicker` (date + time, HIG-idiomatic) plus the "View as of date" submit and "Cancel" controls.
struct TimeMachinePickerRow: View {
    @Binding var draft: Date
    let onSubmit: () -> Void
    let onCancel: () -> Void

    private var inputLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.inputLabelKey, TimeMachineCopy.inputLabelFallback)
    }

    private var submitLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.submitKey, TimeMachineCopy.submitFallback)
    }

    private var cancelLabel: String {
        TimeMachineBannerStrings.string(TimeMachineCopy.cancelKey, TimeMachineCopy.cancelFallback)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: inputLabel)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                DatePicker("", selection: $draft, displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                    .tint(Color.TS.accent)
                    .accessibilityLabel(Text(verbatim: inputLabel))
            }
            HStack(spacing: TSSpacing.sm) {
                TSButton(variant: .primary, size: .small, action: onSubmit) {
                    Text(verbatim: submitLabel)
                }
                .accessibilityLabel(Text(verbatim: submitLabel))
                TSButton(variant: .ghost, size: .small, action: onCancel) {
                    Text(verbatim: cancelLabel)
                }
                .accessibilityLabel(Text(verbatim: cancelLabel))
            }
        }
        .padding(.top, TSSpacing.xs)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the surface when the historical snapshot is not live — a coloured
/// dot + a label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the
/// read, with an explicit label. Hidden while live.
struct TimeMachineFreshnessChip: View {
    let connection: TimeMachineConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: TimeMachineBannerStrings.string("timeMachine.live", "Live")
        case .stale: TimeMachineBannerStrings.string("timeMachine.stale", "Stale")
        case .offline: TimeMachineBannerStrings.string("timeMachine.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            TimeMachineBannerStrings.string("timeMachine.staleA11y", "Stale — tap to re-read the snapshot")
        case .offline:
            TimeMachineBannerStrings.string("timeMachine.offlineA11y", "Offline — showing the last snapshot")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
