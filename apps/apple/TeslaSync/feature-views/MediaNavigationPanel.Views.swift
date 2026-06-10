//
//  MediaNavigationPanel.Views.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The presentational subviews composed by `MediaNavigationPanel`: the data body (the
//  Now-Playing card with its source chip + status pill, and the Navigation block with
//  its active-destination card + presence chips) and the loading / empty / error
//  chrome. All consume the P1/S10 facade and the shared P1/S9 tokens + shared
//  components (`TSGlassPanel` / `TSSkeleton` / `TSButton` / `TSFadeIn`) — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the header `headphones` →
//  `chartSeriesPower` (the brand purple that equals web `text-purple-300`); the
//  status pill Playing → `statusSuccess` (web green), Paused → `statusWarning` (web
//  amber), else → `textMuted` (web neutral); the presence chips Home → `statusSuccess`
//  (web green-500), Work → `statusInfo` (web blue-500), Favorite → `chartSeriesPower`
//  (web purple-500); the destination pin → `accent` (web `text-neon-cyan`).
//

import SwiftUI

// MARK: - Data body (web non-empty render: Now-Playing + Navigation sections)

/// The resolved panel body — the two stacked sections (Now Playing, Navigation),
/// wrapped in the shared fade-in (web `FadeIn` peer). Each section renders its own
/// content or its web empty copy, so no surface is ever hidden.
struct MediaNavContent: View {
    let projection: MediaNavProjection

    private var accessibilitySummary: String {
        MediaNavAccessibility.summary(
            nowPlaying: MediaNavNowPlayingSection.spokenSummary(projection.nowPlaying),
            navigation: MediaNavNavigationSection.spokenSummary(projection.navigation)
        )
    }

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                MediaNavNowPlayingSection(nowPlaying: projection.nowPlaying)
                MediaNavNavigationSection(navigation: projection.navigation)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Section label (web `text-[10px] uppercase tracking-wider text-muted`)

/// One section's eyebrow label — a muted, upper-cased caption with an optional
/// leading SF Symbol (the web `<Navigation2/>` on the Navigation section).
struct MediaNavSectionLabel: View {
    let titleKey: String
    let fallback: String
    var systemImage: String?

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            Text(verbatim: MediaNavStrings.string(titleKey, fallback))
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityAddTraits(.isHeader)
    }
}

// MARK: - Now Playing section (web "Now Playing")

/// The Now-Playing section — the eyebrow label over either the track card (title /
/// artist / source chip / status pill) or the web "No media data" copy.
struct MediaNavNowPlayingSection: View {
    let nowPlaying: MediaNavNowPlaying?

    /// The displayed (and spoken) track title: the scrubbed value, else the localized
    /// "Nothing playing" fallback (web `cleanNil(title) || t('nothingPlaying')`).
    static func titleText(_ nowPlaying: MediaNavNowPlaying) -> String {
        nowPlaying.title ?? MediaNavStrings.string("telemetry.nothingPlaying", "Nothing playing")
    }

    /// The displayed (and spoken) artist: the scrubbed value, else the localized
    /// "Unknown artist" fallback (web `cleanNil(artist) || t('unknownArtist')`).
    static func artistText(_ nowPlaying: MediaNavNowPlaying) -> String {
        nowPlaying.artist ?? MediaNavStrings.string("telemetry.unknownArtist", "Unknown artist")
    }

    /// The VoiceOver summary for the section: the track + artist, else the empty copy.
    static func spokenSummary(_ nowPlaying: MediaNavNowPlaying?) -> String {
        guard let nowPlaying else {
            return MediaNavStrings.string("telemetry.noMediaData", "No media data")
        }
        return "\(titleText(nowPlaying)), \(artistText(nowPlaying))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            MediaNavSectionLabel(titleKey: "telemetry.nowPlaying", fallback: "Now Playing")
            if let nowPlaying {
                card(nowPlaying)
            } else {
                MediaNavEmptyCopy(key: "telemetry.noMediaData", fallback: "No media data")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func card(_ nowPlaying: MediaNavNowPlaying) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: Self.titleText(nowPlaying))
                .font(Font.TS.bodySm.weight(.bold))
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: Self.artistText(nowPlaying))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
            if nowPlaying.source != nil || nowPlaying.statusLabel != nil {
                HStack(spacing: TSSpacing.sm) {
                    if let source = nowPlaying.source {
                        MediaNavSourceChip(text: source)
                    }
                    if let status = nowPlaying.statusLabel {
                        MediaNavStatusPill(label: status, badge: nowPlaying.statusBadge)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .mediaNavInsetCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: Self.spokenSummary(nowPlaying)))
    }
}

// MARK: - Source chip + status pill (web source span + `Badge`)

/// The playback-source chip — a muted surface capsule showing the raw backend source
/// verbatim (web `<span class="bg-[var(--surface-2)] text-[var(--text-muted)]">`).
struct MediaNavSourceChip: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
            .accessibilityLabel(Text(verbatim: text))
    }
}

/// The playback-status pill — a capsule chip whose accent follows the web ternary
/// (Playing → green, Paused → amber, else → neutral), showing the raw backend status
/// label verbatim (web `Badge`).
struct MediaNavStatusPill: View {
    let label: String
    let badge: MediaPlaybackBadge

    private var tone: Color {
        switch badge {
        case .playing: Color.TS.statusSuccess
        case .paused: Color.TS.statusWarning
        case .neutral: Color.TS.textMuted
        }
    }

    var body: some View {
        Text(verbatim: label)
            .font(Font.TS.caption.weight(.medium))
            .foregroundStyle(tone)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Navigation section (web "Navigation")

/// The Navigation section — the eyebrow label over either the location block (active
/// destination card or "No active destination" copy, plus presence chips) or the web
/// "No location data" copy.
struct MediaNavNavigationSection: View {
    let navigation: MediaNavNavigation?

    /// The VoiceOver summary for the section: the destination (or "No active
    /// destination"), else the "No location data" empty copy.
    static func spokenSummary(_ navigation: MediaNavNavigation?) -> String {
        guard let navigation else {
            return MediaNavStrings.string("telemetry.noLocationData", "No location data")
        }
        if let destination = navigation.destination {
            return destination.name
        }
        return MediaNavStrings.string("telemetry.noActiveDestination", "No active destination")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            MediaNavSectionLabel(
                titleKey: "telemetry.navigation",
                fallback: "Navigation",
                systemImage: "location.north.line.fill"
            )
            if let navigation {
                if let destination = navigation.destination {
                    MediaNavDestinationCard(destination: destination)
                } else {
                    MediaNavEmptyCopy(key: "telemetry.noActiveDestination", fallback: "No active destination")
                }
                if !navigation.places.isEmpty {
                    placeChips(navigation.places)
                }
            } else {
                MediaNavEmptyCopy(key: "telemetry.noLocationData", fallback: "No location data")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func placeChips(_ places: [MediaNavPlace]) -> some View {
        HStack(spacing: TSSpacing.sm) {
            ForEach(places, id: \.self) { place in
                MediaNavPlaceChip(place: place)
            }
        }
    }
}

// MARK: - Destination card (web destination block)

/// The active-destination card — the pinned destination name over the optional
/// distance + ETA row (web `MapPin` + name, then `{distance} {unit}` and
/// `{minutes} min`).
struct MediaNavDestinationCard: View {
    let destination: MediaNavDestination

    private var accessibilityValue: String {
        var parts: [String] = []
        if let distanceText = destination.distanceText {
            parts.append(distanceText)
        }
        if let etaMinutes = destination.etaMinutes {
            parts.append(etaSpoken(etaMinutes))
        }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "mappin.circle.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.accent)
                    .accessibilityHidden(true)
                Text(verbatim: destination.name)
                    .font(Font.TS.bodySm.weight(.bold))
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
            }
            if destination.distanceText != nil || destination.etaMinutes != nil {
                HStack(spacing: TSSpacing.md) {
                    if let distanceText = destination.distanceText {
                        Text(verbatim: distanceText)
                            .font(Font.TS.caption)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                    if let etaMinutes = destination.etaMinutes {
                        Text(verbatim: etaSpoken(etaMinutes))
                            .font(Font.TS.caption)
                            .monospacedDigit()
                            .foregroundStyle(Color.TS.textSecondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .mediaNavInsetCard()
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: destination.name))
        .accessibilityValue(Text(verbatim: accessibilityValue))
    }

    /// Pairs the integer minutes with the localized "min" (web `{n} {t('minShort')}`).
    private func etaSpoken(_ minutes: String) -> String {
        "\(minutes) \(MediaNavStrings.string("common.minShort", "min"))"
    }
}

// MARK: - Presence chip (web home / work / favorite spans)

/// One presence chip — an SF Symbol + localized label inside a tinted capsule, the
/// native counterpart of the web `located_at_*` emoji chips.
struct MediaNavPlaceChip: View {
    let place: MediaNavPlace

    private var tone: Color {
        switch place {
        case .home: Color.TS.statusSuccess
        case .work: Color.TS.statusInfo
        case .favorite: Color.TS.chartSeriesPower
        }
    }

    private var label: String {
        MediaNavStrings.string(place.labelKey, place.fallback)
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: place.systemImage)
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption.weight(.medium))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.1), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.2), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Empty copy (web `text-xs text-muted` per-section empties)

/// One section's inline empty copy — the native counterpart of the web
/// `<p class="text-muted">{t(...)}</p>` empty lines, so a section without data still
/// renders a friendly line rather than a blank gap.
struct MediaNavEmptyCopy: View {
    let key: String
    let fallback: String

    var body: some View {
        Text(verbatim: MediaNavStrings.string(key, fallback))
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Inset card styling (web `rounded-xl bg-white/[0.02] border p-4`)

private extension View {
    /// Applies the web inset-card treatment: section padding, the subtle glass fill,
    /// and the semantic border stroke clipped to the panel's inner radius.
    func mediaNavInsetCard() -> some View {
        padding(TSSpacing.lg)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}
