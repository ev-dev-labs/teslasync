import SwiftUI

/// One keyboard shortcut entry.
public struct TSShortcut: Identifiable {
    public let id: String
    public let keys: String
    public let detail: LocalizedStringKey

    public init(id: String, keys: String, detail: LocalizedStringKey) {
        self.id = id
        self.keys = keys
        self.detail = detail
    }
}

/// Keyboard shortcuts reference (web `KeyboardShortcutsModal`). Present in a sheet.
public struct TSKeyboardShortcutsModal: View {
    @Binding private var isPresented: Bool
    private let shortcuts: [TSShortcut]

    public init(isPresented: Binding<Bool>, shortcuts: [TSShortcut]) {
        _isPresented = isPresented
        self.shortcuts = shortcuts
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                TSPanelTitle("shortcuts.title")
                Spacer()
                Button { isPresented = false } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("action.close"))
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                VStack(spacing: TSSpacing.sm) {
                    ForEach(shortcuts) { shortcut in
                        HStack {
                            Text(shortcut.detail).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                            Spacer()
                            TSCode(shortcut.keys)
                        }
                    }
                }
                .padding(TSSpacing.lg)
            }
        }
        .frame(minWidth: 320, minHeight: 280)
    }
}

/// One guided-tour step.
public struct TSTourStep: Identifiable {
    public let id: String
    public let title: LocalizedStringKey
    public let detail: LocalizedStringKey

    public init(id: String, title: LocalizedStringKey, detail: LocalizedStringKey) {
        self.id = id
        self.title = title
        self.detail = detail
    }
}

/// Guided onboarding tour overlay (web `TourOverlay`).
public struct TSTourOverlay: View {
    @Binding private var isPresented: Bool
    private let steps: [TSTourStep]
    @State private var index = 0

    public init(isPresented: Binding<Bool>, steps: [TSTourStep]) {
        _isPresented = isPresented
        self.steps = steps
    }

    private var current: TSTourStep? {
        steps.indices.contains(index) ? steps[index] : nil
    }

    public var body: some View {
        if isPresented, let current {
            ZStack {
                Color.black.opacity(0.5).ignoresSafeArea()
                TSCard {
                    VStack(alignment: .leading, spacing: TSSpacing.md) {
                        TSPanelTitle(current.title)
                        TSText(current.detail)
                        HStack {
                            TSCaption("tour.step \(index + 1) \(steps.count)")
                            Spacer()
                            TSButton("tour.skip", variant: .ghost, size: .small) { isPresented = false }
                            TSButton(index == steps.count - 1 ? "tour.done" : "tour.next", size: .small) {
                                if index == steps.count - 1 { isPresented = false } else { index += 1 }
                            }
                        }
                    }
                }
                .frame(maxWidth: 360)
                .padding()
            }
        }
    }
}

/// One background job's progress.
public struct TSJobProgress: Identifiable {
    public let id: String
    public let name: LocalizedStringKey
    public let fraction: Double

    public init(id: String, name: LocalizedStringKey, fraction: Double) {
        self.id = id
        self.name = name
        self.fraction = fraction
    }
}

/// Background-job progress list (web `JobProgressDrawer`).
public struct TSJobProgressDrawer: View {
    private let jobs: [TSJobProgress]

    public init(jobs: [TSJobProgress]) {
        self.jobs = jobs
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSPanelTitle("jobs.title")
            ForEach(jobs) { job in
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    HStack {
                        Text(job.name).font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                        Spacer()
                        TSCode("\(Int((job.fraction * 100).rounded()))%")
                    }
                    TSMetricBar(fraction: job.fraction)
                }
            }
        }
        .padding(TSSpacing.lg)
    }
}

/// Achievement-unlocked toast that auto-dismisses (web `AchievementUnlockedToast`).
public struct TSAchievementUnlockedToast: View {
    @Binding private var isPresented: Bool
    private let title: LocalizedStringKey

    public init(isPresented: Binding<Bool>, title: LocalizedStringKey) {
        _isPresented = isPresented
        self.title = title
    }

    public var body: some View {
        if isPresented {
            HStack(spacing: TSSpacing.md) {
                Image(systemName: "trophy.fill").foregroundStyle(Color.TS.statusWarning)
                VStack(alignment: .leading, spacing: 2) {
                    TSCaption("achievement.unlocked")
                    Text(title).font(Font.TS.bodySm).fontWeight(.semibold).foregroundStyle(Color.TS.textPrimary)
                }
            }
            .padding(TSSpacing.md)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1)
            )
            .transition(.move(edge: .top).combined(with: .opacity))
            .task {
                try? await Task.sleep(for: .seconds(3))
                isPresented = false
            }
        }
    }
}

/// One changelog release.
public struct TSChangelogEntry: Identifiable {
    public let id: String
    public let version: String
    public let notes: LocalizedStringKey

    public init(id: String, version: String, notes: LocalizedStringKey) {
        self.id = id
        self.version = version
        self.notes = notes
    }
}

/// Release-notes modal (web `ChangelogModal`). Present in a sheet.
public struct TSChangelogModal: View {
    @Binding private var isPresented: Bool
    private let entries: [TSChangelogEntry]

    public init(isPresented: Binding<Bool>, entries: [TSChangelogEntry]) {
        _isPresented = isPresented
        self.entries = entries
    }

    public var body: some View {
        VStack(spacing: 0) {
            HStack {
                TSPanelTitle("changelog.title")
                Spacer()
                Button { isPresented = false } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Color.TS.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("action.close"))
            }
            .padding(TSSpacing.lg)
            Divider().overlay(Color.TS.border)
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: TSSpacing.xs) {
                            TSBadge(LocalizedStringKey(entry.version), tone: .accent)
                            TSText(entry.notes)
                        }
                    }
                }
                .padding(TSSpacing.lg)
            }
        }
        .frame(minWidth: 340, minHeight: 320)
    }
}
