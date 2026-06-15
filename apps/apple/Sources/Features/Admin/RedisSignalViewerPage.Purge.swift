import SwiftUI

// MARK: - Purge confirmation sheet (web `ConfirmDialog`)

/// The destructive purge confirmation (web `ConfirmDialog`), serving both paths: the per-vehicle
/// purge (standard danger confirm) and the cluster-wide purge (which additionally requires the
/// operator to type `PURGE ALL`, web `requireTypedConfirmation`). Presented as an HIG-native
/// sheet that cannot be dismissed while the DELETE is in flight; all copy resolves from
/// `Localizable.xcstrings` with the web key names and the per-vehicle title interpolates the
/// pinned target label at the display boundary.
struct RedisPurgeConfirmSheet: View {
    @Bindable var model: RedisSignalViewerPageModel

    private var isAll: Bool {
        model.purgeMode == .all
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Color.TS.border)
            ScrollView {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    Text(isAll ? "redis.purgeAllMessage" : "redis.purgeMessage")
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if isAll {
                        TSTextField(
                            "redis.purgeAllTypedLabel",
                            text: $model.purgeAllConfirmation,
                            label: "redis.purgeAllTypedLabel"
                        )
                        .accessibilityLabel(Text("redis.purgeAllTypedLabel"))
                    }
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Divider().overlay(Color.TS.border)
            footer
        }
        .background(Color.TS.surface)
        #if os(macOS)
            .frame(minWidth: 520, minHeight: 360)
        #endif
            .interactiveDismissDisabled(model.isPurging)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "trash")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            title
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.md)
        }
        .padding(TSSpacing.lg)
    }

    @ViewBuilder
    private var title: some View {
        if isAll {
            Text("redis.purgeAllTitle")
        } else {
            // Web `t('redis.purgeTitle', 'Purge Redis (L2) cache for {{vehicle}}?', { vehicle })`.
            Text(verbatim: String(format: String(localized: "redis.purgeTitle"), model.purgeTargetLabel))
        }
    }

    private var footer: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TSButton("common.cancel", variant: .secondary) {
                model.cancelPurge()
            }
            .disabled(model.isPurging)
            TSButton(
                isAll ? "redis.purgeAllConfirm" : "redis.purgeConfirm",
                variant: .destructive,
                isLoading: model.isPurging
            ) {
                Task { await model.confirmPurge() }
            }
            .disabled(!model.canConfirmPurge)
        }
        .padding(TSSpacing.lg)
    }
}

// MARK: - Outcome banner (web `toast.*`)

/// The dismissible result banner shown after a purge command — the HIG-native peer of the web
/// `toast.success / info / warning / error`. Maps a `RedisPurgeOutcome` to a tinted banner whose
/// title resolves from `Localizable.xcstrings` (web key names) and whose detail interpolates the
/// command result (vehicle label / purged count / limit) at the display boundary.
struct RedisPurgeOutcomeBanner: View {
    let outcome: RedisPurgeOutcome
    let onDismiss: () -> Void

    private var tone: TSTone {
        outcome.tone.tsTone
    }

    private var symbol: String {
        switch outcome.tone {
        case .danger: "exclamationmark.triangle.fill"
        case .warning: "exclamationmark.circle.fill"
        case .info: "info.circle.fill"
        default: "checkmark.circle.fill"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: symbol)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(titleKey)
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                if let detail {
                    Text(verbatim: detail)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: TSSpacing.sm)
            Button(action: onDismiss) {
                Image(systemName: "xmark").font(.caption2)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text("redis.outcomeDismiss"))
        }
        .padding(TSSpacing.md)
        .background(tone.color.opacity(0.1), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(tone.color.opacity(0.3), lineWidth: 1)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    /// Web toast title key per outcome (verbatim key names from `RedisSignalViewerPage.tsx`).
    private var titleKey: LocalizedStringKey {
        switch outcome {
        case .purgeSucceeded: "redis.purgeSuccess"
        case .purgeNoOp: "redis.purgeNoOpTitle"
        case .purgeAllSucceeded: "redis.purgeAllSuccess"
        case .purgeAllPartial: "redis.purgeAllPartial"
        case .failed: "redis.purgeError"
        }
    }

    /// Web toast detail per outcome, interpolated at the boundary.
    private var detail: String? {
        switch outcome {
        case let .purgeSucceeded(vehicle):
            String(format: String(localized: "redis.purgeSuccessDetail"), vehicle)
        case let .purgeNoOp(vehicle):
            String(format: String(localized: "redis.purgeNoOpDetail"), vehicle)
        case let .purgeAllSucceeded(count):
            String(format: String(localized: "redis.purgeAllSuccessDetail"), String(count))
        case let .purgeAllPartial(count, limit):
            String(format: String(localized: "redis.purgeAllPartialDetail"), String(count), String(limit))
        case let .failed(message):
            message
        }
    }
}
