import SwiftUI

// MARK: - Regex tester (web `RegexTesterTool`)

struct DevToolsRegexTool: View {
    @State private var pattern = ""
    @State private var flags = "g"
    @State private var testString = ""

    private var flagOptions: [TSSelectOption<String>] {
        [
            TSSelectOption("g", "g"),
            TSSelectOption("gi", "gi"),
            TSSelectOption("gm", "gm"),
            TSSelectOption("gim", "gim"),
            TSSelectOption("", "devtools.field.noFlags")
        ]
    }

    private var matches: [DevToolsUtilities.RegexMatch]? {
        DevToolsUtilities.regexMatches(pattern: pattern, flags: flags, in: testString)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(alignment: .bottom, spacing: TSSpacing.md) {
                TSTextField("devtools.field.patternHint", text: $pattern, label: "devtools.field.pattern")
                TSSelect(selection: $flags, options: flagOptions, label: "devtools.field.flags")
                    .frame(maxWidth: 140)
            }
            TSTextArea(text: $testString, label: "devtools.field.testString", minHeight: 72)
            resultView
        }
    }

    @ViewBuilder
    private var resultView: some View {
        if matches == nil {
            TSErrorText("devtools.error.invalidPattern")
        } else if let matches {
            TSBadge("devtools.regex.matchCount \(matches.count)", tone: matches.isEmpty ? .neutral : .success)
            ForEach(Array(matches.enumerated()), id: \.offset) { index, match in
                HStack(spacing: TSSpacing.sm) {
                    Text(verbatim: "\(index + 1)")
                        .font(Font.TS.label)
                        .foregroundStyle(Color.TS.statusInfo)
                        .frame(width: 22)
                    Text(verbatim: match.text)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.TS.statusDanger)
                    Text("devtools.regex.atIndex \(match.index)")
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, TSSpacing.md)
                .padding(.vertical, TSSpacing.xs)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
            }
        }
    }
}

// MARK: - Cron parser (web `CronParserTool`)

struct DevToolsCronTool: View {
    @State private var expression = ""

    private let presets: [(title: LocalizedStringKey, value: String)] = [
        ("devtools.cron.everyMinute", "* * * * *"),
        ("devtools.cron.everyHour", "0 * * * *"),
        ("devtools.cron.everyDay", "0 0 * * *"),
        ("devtools.cron.everyWeek", "0 0 * * 0"),
        ("devtools.cron.everyMonth", "0 0 1 * *")
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSTextField(
                "devtools.field.cronHint",
                text: $expression,
                label: "devtools.field.cronExpression"
            )
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: TSSpacing.xs) {
                    ForEach(presets, id: \.value) { preset in
                        TSButton(preset.title, variant: .ghost, size: .small) {
                            expression = preset.value
                        }
                    }
                }
            }
            if let description = DevToolsUtilities.describeCron(expression) {
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    TSLabel("devtools.field.description")
                    Text(verbatim: description)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.statusSuccess)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.md)
                .background(
                    Color.TS.surface,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
            }
            nextRuns
        }
    }

    @ViewBuilder
    private var nextRuns: some View {
        let runs = DevToolsUtilities.nextCronRuns(expression, count: 5, from: Date())
        if !runs.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                TSLabel("devtools.cron.nextRuns")
                ForEach(Array(runs.enumerated()), id: \.offset) { index, run in
                    HStack(spacing: TSSpacing.sm) {
                        Text(verbatim: "\(index + 1)")
                            .font(Font.TS.label)
                            .foregroundStyle(Color.TS.statusInfo)
                            .frame(width: 22)
                        Text(verbatim: run.formatted(date: .abbreviated, time: .shortened))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }
}
