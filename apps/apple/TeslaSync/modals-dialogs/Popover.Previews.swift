//
//  Popover.Previews.swift
//  TeslaSync — P4 modal / dialog · 0015 · Popover (Apple)
//
//  Xcode previews — one per state the positioning primitive produces: the elevated surface chrome
//  (populated + empty, light + dark), the window-level trigger transport (native `.popover`), and a
//  placement gallery driving the inline `PopoverContainer` through bottom / start, the top auto-flip
//  (anchor near the bottom edge), center, and end alignments inside a bounded "viewport" so the
//  flip + clamp math is visible without a device. Preview-only; excluded from release via `#if
//  DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentPopoverTelemetry: PopoverTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative popover body — a titled list with an action, padded like a real consumer.
    private struct PopoverDemoContent: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                Text(verbatim: "Quick actions")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                ForEach(["Refresh now", "Pin to dashboard", "Open settings"], id: \.self) { row in
                    Text(verbatim: row)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
            .padding(TSSpacing.md)
            .frame(width: 200, alignment: .leading)
        }
    }

    @MainActor
    private func presentedModel(side: PopoverSide, align: PopoverAlign) -> PopoverModel {
        let model = PopoverModel(side: side, align: align, telemetry: SilentPopoverTelemetry())
        model.present()
        return model
    }

    /// Hosts the inline container over a bounded viewport with a visible anchor marker.
    private struct PopoverGalleryHost: View {
        let title: String
        let anchor: CGRect
        @State private var model: PopoverModel

        init(title: String, side: PopoverSide, align: PopoverAlign, anchor: CGRect) {
            self.title = title
            self.anchor = anchor
            _model = State(initialValue: presentedModel(side: side, align: align))
        }

        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: title)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                ZStack(alignment: .topLeading) {
                    Color.TS.bg
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .fill(Color.TS.accent.opacity(0.35))
                        .overlay(
                            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                                .strokeBorder(Color.TS.accent, lineWidth: 1)
                        )
                        .frame(width: anchor.width, height: anchor.height)
                        .offset(x: anchor.minX, y: anchor.minY)
                    PopoverContainer(model: model, anchor: anchor) { PopoverDemoContent() }
                }
                .frame(width: 320, height: 260)
                .clipShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            }
            .padding(TSSpacing.md)
        }
    }

    /// Window-level trigger using the native `.popover` transport.
    private struct PopoverTriggerDemo: View {
        @State private var open = false

        var body: some View {
            Button { open.toggle() } label: {
                Text(verbatim: "Open popover")
                    .font(Font.TS.body)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.sm)
            }
            .buttonStyle(.borderedProminent)
            .popoverSurface(
                isPresented: $open,
                side: .bottom,
                align: .start,
                accessibilityLabel: "Quick actions",
                telemetry: SilentPopoverTelemetry()
            ) {
                PopoverDemoContent()
            }
            .padding(TSSpacing.x3xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
        }
    }

    #Preview("Surface · populated") {
        PopoverSurface { PopoverDemoContent() }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Surface · empty") {
        PopoverSurface { PopoverEmptyContent(label: "Nothing to show") }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Surface · empty · dark") {
        PopoverSurface { PopoverEmptyContent(label: "Nothing to show") }
            .padding(TSSpacing.x2xl)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
            .preferredColorScheme(.dark)
    }

    #Preview("Trigger · native popover") {
        PopoverTriggerDemo()
    }

    #Preview("Gallery · bottom / start") {
        PopoverGalleryHost(
            title: "side: bottom · align: start",
            side: .bottom,
            align: .start,
            anchor: CGRect(x: 24, y: 40, width: 96, height: 32)
        )
        .background(Color.TS.bg)
    }

    #Preview("Gallery · flip to top") {
        PopoverGalleryHost(
            title: "side: bottom → flips top",
            side: .bottom,
            align: .start,
            anchor: CGRect(x: 24, y: 196, width: 96, height: 32)
        )
        .background(Color.TS.bg)
    }

    #Preview("Gallery · center") {
        PopoverGalleryHost(
            title: "side: bottom · align: center",
            side: .bottom,
            align: .center,
            anchor: CGRect(x: 112, y: 40, width: 96, height: 32)
        )
        .background(Color.TS.bg)
    }

    #Preview("Gallery · end · dynamic type") {
        PopoverGalleryHost(
            title: "side: bottom · align: end",
            side: .bottom,
            align: .end,
            anchor: CGRect(x: 200, y: 40, width: 96, height: 32)
        )
        .background(Color.TS.bg)
        .environment(\.dynamicTypeSize, .accessibility3)
    }
#endif
