//
//  XRayControls.Views.swift
//  TeslaSync — P4 feature view · 0033 · XRayControls (Apple)
//
//  The presentational subviews composed by `XRayControls`: the responsive
//  controls layout (web `flex flex-wrap items-center gap-4` → `ViewThatFits`
//  row / column), the labeled menu-select (web `Select` → a native `Menu` with a
//  bordered field trigger and per-item disable for the `tooBig` buckets), the
//  vehicle-slot states (skeleton / empty hint / inline `QueryError`), and the
//  stale/offline freshness banner. All consume pre-localized strings from the
//  P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind ports.
//

import SwiftUI

// MARK: - i18n facade Text helper

extension XRayControlsStrings {
    /// Resolves a key to a verbatim `Text` (the facade owns the lookup; the view
    /// never embeds a literal).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Responsive layout (web controls `flex flex-wrap`)

/// Arranges the three selectors the native port of the web
/// `flex flex-wrap items-center gap-4`: `ViewThatFits` lays them in a single row
/// when the container is wide enough and falls back to a stacked column on
/// compact widths, reproducing the web wrap behavior. The vehicle slot keeps a
/// wider minimum (web `w-64`) than the window/bucket selectors (web `w-40`).
struct XRayControlsLayout<VehicleSlot: View, WindowSlot: View, BucketSlot: View>: View {
    private let vehicle: VehicleSlot
    private let window: WindowSlot
    private let bucket: BucketSlot

    init(
        @ViewBuilder vehicle: () -> VehicleSlot,
        @ViewBuilder window: () -> WindowSlot,
        @ViewBuilder bucket: () -> BucketSlot
    ) {
        self.vehicle = vehicle()
        self.window = window()
        self.bucket = bucket()
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            horizontal
            vertical
        }
    }

    private var horizontal: some View {
        HStack(alignment: .top, spacing: TSSpacing.lg) {
            vehicle.frame(minWidth: 220, maxWidth: .infinity, alignment: .leading)
            window.frame(minWidth: 132, maxWidth: 180, alignment: .leading)
            bucket.frame(minWidth: 132, maxWidth: 180, alignment: .leading)
        }
    }

    private var vertical: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            vehicle.frame(maxWidth: .infinity, alignment: .leading)
            window.frame(maxWidth: .infinity, alignment: .leading)
            bucket.frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Field chrome (web `Select` bordered box)

/// The bordered field surface shared by the menu-select trigger and the loading
/// skeleton, so both read as the same control shape (web `Select` chrome). A
/// trailing chevron signals the pop-up affordance.
struct XRayControlFieldChrome<Content: View>: View {
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            content
            Spacer(minLength: TSSpacing.xs)
            Image(systemName: "chevron.up.chevron.down")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
    }
}

// MARK: - Menu select (web `Select`)

/// A dropdown selector — the native port of the web `Select`. A `Menu` whose
/// trigger is the bordered field showing the current selection and whose content
/// is one `Button` per option, a checkmark on the selected one and `.disabled`
/// on any option the projection flagged (web disabled `tooBig` buckets). The
/// control carries the web `aria-label` as its VoiceOver label and announces the
/// selected option as its value.
struct XRayControlSelect<Value: Hashable & Sendable>: View {
    let options: [XRayControlOption<Value>]
    let selection: Value
    let accessibilityLabel: String
    let onSelect: (Value) -> Void

    /// The title of the currently-selected option, falling back to the first
    /// option (the empty "Select vehicle…" sentinel) when nothing matches so the
    /// trigger never renders blank.
    private var selectedTitle: String {
        options.first { $0.value == selection }?.title ?? options.first?.title ?? ""
    }

    var body: some View {
        Menu {
            ForEach(options) { option in
                Button {
                    onSelect(option.value)
                } label: {
                    if option.value == selection {
                        Label {
                            Text(verbatim: option.title)
                        } icon: {
                            Image(systemName: "checkmark")
                        }
                    } else {
                        Text(verbatim: option.title)
                    }
                }
                .disabled(option.isDisabled)
            }
        } label: {
            XRayControlFieldChrome {
                Text(verbatim: selectedTitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
        }
        .tint(Color.TS.accent)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
        .accessibilityValue(Text(verbatim: selectedTitle))
    }
}

// MARK: - Vehicle slot: loading skeleton

/// The vehicle picker's initial-load skeleton: the field chrome with a shimmer
/// block where the selection would be, so the bar keeps its shape while the
/// vehicle list loads (web skeleton intent). Announced as "loading" to
/// VoiceOver.
struct XRayControlsSkeletonField: View {
    var body: some View {
        XRayControlFieldChrome {
            TSSkeleton(height: 18, cornerRadius: TSRadius.sm)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(XRayControlsStrings.text("admin.xray.controls.loadingVehicles", "Loading vehicles"))
    }
}

// MARK: - Vehicle slot: empty hint

/// The friendly note shown beneath a disabled vehicle picker when the vehicle
/// list resolved with no vehicles — so the slot reads as "nothing to pick yet",
/// never a blank box.
struct XRayControlsEmptyHint: View {
    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.2")
                .font(.system(size: 11, weight: .semibold))
            XRayControlsStrings
                .text("admin.xray.controls.emptyHint", "No vehicles available yet")
                .font(Font.TS.caption)
        }
        .foregroundStyle(Color.TS.textMuted)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            Color.TS.textMuted.opacity(0.1),
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Vehicle slot: inline error (web `QueryError`)

/// The `QueryError`-equivalent shown in the vehicle slot when the vehicle list
/// fails to load, with a retry affordance. Compact so it sits inline in the bar
/// without displacing the window/bucket selectors.
struct XRayControlsErrorSlot: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                XRayControlsStrings
                    .text("admin.xray.controls.errorTitle", "Couldn't load vehicles")
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: TSSpacing.xs)
            Button(action: onRetry) {
                XRayControlsStrings.text("admin.xray.controls.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(XRayControlsStrings.text("admin.xray.controls.retry", "Retry"))
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.4), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness banner (stale / offline)

/// The stale/offline banner shown above the bar when the bound source is not
/// live, so the cached vehicle list is clearly labeled (web freshness-indicator
/// intent).
struct XRayControlsConnectivityBanner: View {
    let connection: XRayControlsConnection

    var body: some View {
        let isOffline = connection == .offline
        let key = isOffline ? "admin.xray.controls.offlineBanner" : "admin.xray.controls.staleBanner"
        let fallback = isOffline
            ? "Offline — showing the last loaded vehicles"
            : "Refreshing — the vehicle list may be stale"
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            XRayControlsStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}
