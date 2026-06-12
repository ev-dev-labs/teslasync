//
//  StatusBar.Popovers.swift
//  TeslaSync — P4 shared surface · 0182 · StatusBar (Apple)
//
//  The two segments that open a popover — the native parity of the web `ActiveVehicleSegment` (the vehicle
//  switcher) and `BackgroundWorkSegment` (the running-jobs popover). The static-vs-switcher vehicle branch
//  and the hidden-when-idle background branch are decided in the projection; these views render the resolved
//  view models. Copy is pre-localized (P1/S10); chrome is token-driven (P1/S9).
//

import SwiftUI

// MARK: - Active vehicle (web ActiveVehicleSegment)

/// The active-vehicle segment — a static chip for a single-vehicle account, or a popover switcher for 2+
/// vehicles. The metrics chip shows `{battery}% · {range} {unit}` when vehicle state is available.
public struct StatusBarVehicleView: View {
    private let vm: StatusBarVehicleVM
    private let iconOnly: Bool
    @Binding private var isPresented: Bool
    private let onSelect: (Int) -> Void

    public init(
        vm: StatusBarVehicleVM,
        iconOnly: Bool,
        isPresented: Binding<Bool>,
        onSelect: @escaping (Int) -> Void
    ) {
        self.vm = vm
        self.iconOnly = iconOnly
        _isPresented = isPresented
        self.onSelect = onSelect
    }

    public var body: some View {
        if vm.mode == .switcher {
            switcher
        } else {
            chip(interactive: false)
                .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
        }
    }

    private var switcher: some View {
        Button { isPresented.toggle() } label: {
            chip(interactive: true)
        }
        .buttonStyle(.plain)
        .help(vm.tooltip)
        .accessibilityLabel(Text(verbatim: vm.switchAccessibilityLabel))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isPresented) {
            StatusBarVehicleList(vm: vm, onSelect: { id in
                onSelect(id)
                isPresented = false
            })
        }
    }

    private func chip(interactive: Bool) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "car.fill")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            if !iconOnly {
                Text(verbatim: vm.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                if let metrics = vm.metricsText {
                    StatusBarMutedSuffix(text: metrics)
                }
                if interactive {
                    Image(systemName: "chevron.up")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

/// The vehicle switcher popover list — web `role="listbox"` with one `role="option"` per vehicle.
public struct StatusBarVehicleList: View {
    let vm: StatusBarVehicleVM
    let onSelect: (Int) -> Void

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 1) {
                ForEach(vm.options) { option in
                    Button { onSelect(option.id) } label: {
                        HStack(spacing: TSSpacing.sm) {
                            Image(systemName: "car.fill")
                                .font(Font.TS.caption)
                                .foregroundStyle(Color.TS.textMuted)
                                .accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 0) {
                                Text(verbatim: option.name)
                                    .font(Font.TS.body)
                                    .foregroundStyle(Color.TS.textPrimary)
                                if let model = option.model, !model.isEmpty {
                                    Text(verbatim: model)
                                        .font(Font.TS.caption)
                                        .foregroundStyle(Color.TS.textMuted)
                                }
                            }
                            Spacer(minLength: TSSpacing.sm)
                            if option.isSelected {
                                Image(systemName: "checkmark")
                                    .font(Font.TS.caption)
                                    .foregroundStyle(Color.TS.statusSuccess)
                                    .accessibilityHidden(true)
                            }
                        }
                        .padding(.horizontal, TSSpacing.sm)
                        .padding(.vertical, TSSpacing.xs)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: option.name))
                    .accessibilityAddTraits(option.isSelected ? [.isButton, .isSelected] : .isButton)
                }
            }
            .padding(TSSpacing.xs)
        }
        .frame(minWidth: 220, maxHeight: 280)
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: vm.listAccessibilityLabel))
    }
}

// MARK: - Background work (web BackgroundWorkSegment)

/// The background-work segment — a spinner + the "{count} task(s)" summary, opening a popover that lists the
/// running jobs. Hidden entirely while idle (decided in the projection — this view is only mounted when
/// `isVisible`).
public struct StatusBarBackgroundView: View {
    private let vm: StatusBarBackgroundVM
    private let iconOnly: Bool
    @Binding private var isPresented: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(vm: StatusBarBackgroundVM, iconOnly: Bool, isPresented: Binding<Bool>) {
        self.vm = vm
        self.iconOnly = iconOnly
        _isPresented = isPresented
    }

    public var body: some View {
        Button { isPresented.toggle() } label: {
            HStack(spacing: TSSpacing.xs) {
                StatusBarSpinningSymbol(
                    systemName: "arrow.triangle.2.circlepath",
                    spinning: true,
                    reduceMotion: reduceMotion
                )
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.statusWarning)
                if !iconOnly {
                    Text(verbatim: vm.summary)
                        .font(Font.TS.caption)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.statusWarning)
                }
            }
            .padding(.horizontal, TSSpacing.xs)
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(vm.tooltip)
        .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
        .accessibilityAddTraits(.isButton)
        .popover(isPresented: $isPresented) {
            StatusBarJobsList(vm: vm)
        }
    }
}

/// The running-jobs popover — a "Running" heading + one row per job (kind glyph, label, detail, spinner).
public struct StatusBarJobsList: View {
    let vm: StatusBarBackgroundVM
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: vm.heading)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textMuted)
                ForEach(vm.jobs) { job in
                    HStack(alignment: .top, spacing: TSSpacing.sm) {
                        Image(systemName: jobSymbol(job.kind))
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textMuted)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(verbatim: job.label)
                                .font(Font.TS.body)
                                .foregroundStyle(Color.TS.textPrimary)
                            if let detail = job.detail, !detail.isEmpty {
                                Text(verbatim: detail)
                                    .font(Font.TS.caption)
                                    .foregroundStyle(Color.TS.textMuted)
                            }
                        }
                        Spacer(minLength: TSSpacing.sm)
                        StatusBarSpinningSymbol(
                            systemName: "arrow.triangle.2.circlepath",
                            spinning: true,
                            reduceMotion: reduceMotion
                        )
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.statusWarning)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel(Text(verbatim: job.label))
                }
            }
            .padding(TSSpacing.sm)
        }
        .frame(minWidth: 260, maxHeight: 280)
        .background(Color.TS.surface)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: vm.accessibilityLabel))
    }

    private func jobSymbol(_ kind: StatusBarJobKind) -> String {
        switch kind {
        case .export: "arrow.down.doc.fill"
        case .mutation: "square.and.arrow.down.fill"
        case .custom: "sparkles"
        }
    }
}
