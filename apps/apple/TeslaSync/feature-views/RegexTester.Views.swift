//
//  RegexTester.Views.swift
//  TeslaSync — P4 feature view · 0019 · RegexTester (Apple)
//
//  Presentational subviews for the regex tester — the ToolCard-style header, the
//  pattern field, the flags select, the test-string editor (with an example
//  overlay), the match-count badge, the match rows, and the idle / no-match
//  states. All copy resolves through the P1/S10 facade; all chrome is token-driven
//  (P1/S9); inputs and the badge map to the shared `components/ui` primitives.
//

import SwiftUI

// MARK: - Header (web `ToolCard` icon + title + description)

/// The red ToolCard-style header: a `text.magnifyingglass` glyph (web lucide
/// `Regex`, color "red" → `.danger` tone) over the title + description.
struct RegexToolHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            TSIconBox(systemName: "text.magnifyingglass", tone: .danger)
            VStack(alignment: .leading, spacing: 2) {
                RegexStrings.text("Regex Tester", "Regex Tester")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                RegexStrings.text("Regex Tester Desc", "Test regular expressions against sample text")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Pattern + flags (web `Input` + `Select`)

/// The pattern text field (web `Input` with `label={t('Pattern')}`, example
/// `\d+`) over the shared `TSTextField`.
struct RegexPatternField: View {
    @Binding var pattern: String

    var body: some View {
        TSTextField(
            RegexStrings.key("regex.pattern.example", "\\d+"),
            text: $pattern,
            label: RegexStrings.key("Pattern", "Pattern")
        )
        .accessibilityLabel(RegexStrings.text("Pattern", "Pattern"))
    }
}

/// The flags dropdown (web `Select` over `flagOptions`) backed by the shared
/// `TSSelect`. Each option's title resolves through the facade.
struct RegexFlagsSelect: View {
    @Binding var flags: RegexFlags

    private var options: [TSSelectOption<RegexFlags>] {
        RegexFlags.allCases.map { flag in
            TSSelectOption(flag, RegexStrings.key(flag.labelKey, flag.labelFallback))
        }
    }

    var body: some View {
        TSSelect(selection: $flags, options: options, label: RegexStrings.key("Flags", "Flags"))
            .accessibilityLabel(RegexStrings.text("Flags", "Flags"))
    }
}

// MARK: - Test string (web `Textarea`)

/// The multi-line test-string editor with an example overlay (the native
/// `TextEditor` has no inline prompt) and token chrome, mirroring the web
/// `Textarea`. The example resolves through the facade.
struct RegexTestStringField: View {
    @Binding var text: String

    private var example: String {
        RegexStrings.string("regex.test.example", "The quick brown fox jumps over 13 lazy dogs")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSLabel(RegexStrings.key("Test String", "Test String"))
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(verbatim: example)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 4)
                        .padding(.vertical, TSSpacing.sm + 4)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $text)
                    .font(Font.TS.body)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 76)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, TSSpacing.xs)
            }
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(RegexStrings.text("Test String", "Test String"))
        }
    }
}

// MARK: - Match count badge (web `Badge`)

/// The match-count badge — web `<Badge variant={matches.length > 0 ? 'success'
/// : 'neutral'}>{matches.length} {t('Matches')}</Badge>`.
struct RegexMatchCountBadge: View {
    let outcome: RegexOutcome

    private var label: String {
        RegexProjection.countLabel(count: outcome.count, localize: RegexStrings.string)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSBadge(LocalizedStringKey(label), tone: outcome.matches.isEmpty ? .neutral : .success)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Match list (web `matches.map(...)`)

/// One match row — web `<Badge variant="info">{i + 1}</Badge>` + the monospaced
/// matched text (`text-rose-300` → danger token) + `{t('At Index')} {m.index}`.
struct RegexMatchRow: View {
    let match: RegexMatch

    private var position: String {
        RegexProjection.positionLabel(index: match.index, localize: RegexStrings.string)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            TSBadge(LocalizedStringKey("\(match.ordinal)"), tone: .info)
            Text(verbatim: match.text)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.statusDanger)
                .textSelection(.enabled)
            Spacer(minLength: TSSpacing.sm)
            Text(verbatim: position)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs + 2)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(match.ordinal). \(match.text) \(position)"))
    }
}

/// The list of hits, shown only when there is at least one (web
/// `{matches.length > 0 && …}`).
struct RegexMatchList: View {
    let matches: [RegexMatch]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(matches) { match in
                RegexMatchRow(match: match)
            }
        }
    }
}

// MARK: - Empty states (idle + no-match)

/// The instructional state shown before any pattern/test is entered. The web
/// renders nothing here; the surface contract is "never a blank box".
struct RegexIdleHint: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                RegexStrings.text("regex.idle.title", "Ready to match")
            } icon: {
                Image(systemName: "text.magnifyingglass")
            }
        } description: {
            RegexStrings.text(
                "regex.idle.hint",
                "Enter a pattern and a test string to see matches here."
            )
        }
        .frame(maxWidth: .infinity)
    }
}

/// The state shown when a valid (or invalid) expression yields zero hits.
struct RegexNoMatchHint: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                RegexStrings.text("regex.empty.title", "No matches")
            } icon: {
                Image(systemName: "magnifyingglass")
            }
        } description: {
            RegexStrings.text(
                "regex.empty.hint",
                "This pattern did not match the test string. Check the pattern and flags."
            )
        }
        .frame(maxWidth: .infinity)
    }
}
