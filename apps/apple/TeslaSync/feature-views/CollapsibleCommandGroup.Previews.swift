//
//  CollapsibleCommandGroup.Previews.swift
//  TeslaSync — P4 feature view · 0224 · CollapsibleCommandGroup (Apple)
//
//  Xcode previews exercising every branch of the surface: collapsed, expanded
//  with a grid of command tiles, and expanded-but-empty (the friendly empty
//  state). The embedded tiles are example content standing in for the caller's
//  real command tiles (web `children`); each preview uses a distinct vehicle id
//  so its scene-storage open flag does not bleed into the others.
//

#if DEBUG
    import SwiftUI

    /// Example command tile used only by previews to represent caller content.
    private struct ExampleCommandTile: View {
        let title: String
        let systemImage: String

        var body: some View {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 76)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
    }

    private struct ExampleSecurityTiles: View {
        var body: some View {
            Group {
                ExampleCommandTile(title: "Wake Up", systemImage: "power")
                ExampleCommandTile(title: "Lock", systemImage: "lock.fill")
                ExampleCommandTile(title: "Sentry", systemImage: "shield.lefthalf.filled")
                ExampleCommandTile(title: "Flash", systemImage: "headlight.high.beam.fill")
                ExampleCommandTile(title: "Honk", systemImage: "speaker.wave.2.fill")
            }
        }
    }

    #Preview("Expanded · security") {
        ScrollView {
            CollapsibleCommandGroup(
                category: .security,
                vehicleID: 1,
                commandCount: 5,
                defaultOpen: true
            ) {
                ExampleSecurityTiles()
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Collapsed · charging") {
        ScrollView {
            CollapsibleCommandGroup(
                category: .charging,
                vehicleID: 2,
                commandCount: 8,
                defaultOpen: false
            ) {
                ExampleCommandTile(title: "Start", systemImage: "bolt.fill")
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("Empty · expanded") {
        ScrollView {
            CollapsibleCommandGroup(
                category: .media,
                vehicleID: 3,
                commandCount: 0,
                defaultOpen: true
            ) {
                EmptyView()
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }

    #Preview("All categories · collapsed") {
        ScrollView {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                ForEach(CollapsibleCommandCategory.allCases, id: \.rawValue) { category in
                    CollapsibleCommandGroup(
                        category: category,
                        vehicleID: 99,
                        commandCount: category.webOrder + 1
                    ) {
                        ExampleCommandTile(title: category.labelFallback, systemImage: category.systemImage)
                    }
                }
            }
            .padding(TSSpacing.lg)
        }
        .background(Color.TS.bg)
    }
#endif
