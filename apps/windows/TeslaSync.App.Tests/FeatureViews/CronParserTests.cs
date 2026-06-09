using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.CronParser;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the CronParser surface's UI-thread-free logic — the canonical preset catalog (web
/// <c>presets</c>), the pure cron engine (the <c>describeCron</c> description composer and the
/// <c>getNextCronRuns</c> minute scan with its field-match grammar), the projection (state, i18n description,
/// formatted runs, a11y names), the registry + diagnostics metadata, and the state-holder view-model's
/// per-state transitions (parsed / empty), preset application and re-parsing. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/CronParser.tsx +
/// web/src/features/admin/components/devtools/helpers.ts).
/// </summary>
public sealed class CronParserTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // 2026-01-01 00:00:00Z is a Thursday (DayOfWeek == 4); the minute scan starts at 00:01.
    private static readonly DateTimeOffset FixedNow = new(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

    private static readonly string[] WebPresetOrder =
    {
        "* * * * *", "0 * * * *", "0 0 * * *", "0 0 * * 0", "0 0 1 * *",
    };

    private static string FixedFormat(DateTimeOffset time) =>
        time.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

    private static CronParserViewModel NewViewModel(ICronPresetSource? source = null) =>
        new(source ?? new CronPresetSource(), Localizer, new FixedTimeProvider(FixedNow), FixedFormat);

    // ---- Canonical preset catalog (web presets parity) -----------------------------

    [Fact]
    public void Catalog_has_five_presets_in_web_order()
    {
        var values = CronPresetSource.Canonical.Select(p => p.Value).ToArray();
        Assert.Equal(WebPresetOrder, values);
    }

    [Theory]
    [InlineData("Every Minute", "* * * * *")]
    [InlineData("Every Hour", "0 * * * *")]
    [InlineData("Every Day", "0 0 * * *")]
    [InlineData("Every Week", "0 0 * * 0")]
    [InlineData("Every Month", "0 0 1 * *")]
    public void Catalog_presets_use_label_as_key(string label, string value)
    {
        var preset = CronPresetSource.Canonical.Single(p => p.Value == value);

        Assert.Equal(label, preset.LabelKey);
        Assert.Equal(label, preset.LabelFallback);
    }

    [Fact]
    public void Catalog_preset_values_are_unique()
    {
        var values = CronPresetSource.Canonical.Select(p => p.Value).ToArray();
        Assert.Equal(values.Length, values.Distinct(StringComparer.Ordinal).Count());
    }

    // ---- SplitFields (web expr.trim().split(/\s+/)) --------------------------------

    [Theory]
    [InlineData("*/5 * * * *", 5)]
    [InlineData("0   0 * * *", 5)]
    [InlineData("  0 0 1 * *  ", 5)]
    [InlineData("* * *", 3)]
    [InlineData("", 0)]
    [InlineData("   ", 0)]
    public void SplitFields_counts_match_web(string expression, int expected) =>
        Assert.Equal(expected, CronExpression.SplitFields(expression).Count);

    [Fact]
    public void SplitFields_null_is_empty() =>
        Assert.Empty(CronExpression.SplitFields(null));

    // ---- Describe (web describeCron) -----------------------------------------------

    [Theory]
    [InlineData("* * * * *", "Every minute")]
    [InlineData("30 * * * *", "At minute 30 of every hour")]
    [InlineData("30 2 * * *", "At 02:30")]
    [InlineData("0 0 * * *", "At 00:00")]
    [InlineData("0 0 1 * *", "At 00:00 on day 1")]
    [InlineData("0 0 * * 0", "At 00:00 on Sun")]
    [InlineData("0 0 1 6 5", "At 00:00 on day 1 in month 6 on Fri")]
    [InlineData("* 5 * * *", "Every minute of hour 5")]
    public void Describe_matches_web(string expression, string expected)
    {
        var parts = CronExpression.SplitFields(expression);
        var labels = CronDescribeLabels.FromLocalizer(Localizer);

        Assert.Equal(expected, CronExpression.Describe(parts, labels));
    }

    [Fact]
    public void Describe_pads_single_digit_hour_and_minute()
    {
        var parts = CronExpression.SplitFields("5 9 * * *");
        var labels = CronDescribeLabels.FromLocalizer(Localizer);

        Assert.Equal("At 09:05", CronExpression.Describe(parts, labels));
    }

    [Fact]
    public void Describe_unknown_weekday_falls_back_to_raw_token()
    {
        // parseInt('7') === 7 -> out of [0,6] -> web uses the raw dow token.
        var parts = CronExpression.SplitFields("0 0 * * 7");
        var labels = CronDescribeLabels.FromLocalizer(Localizer);

        Assert.Equal("At 00:00 on 7", CronExpression.Describe(parts, labels));
    }

    [Fact]
    public void Describe_routes_phrases_through_localizer()
    {
        var parts = CronExpression.SplitFields("30 2 * * *");
        var labels = CronDescribeLabels.FromLocalizer(new PrefixLocalizer());

        // Every phrase came through the i18n facade (prefixed), not a hard-coded literal.
        Assert.Contains("L:devtools.cron.atTime", CronExpression.Describe(parts, labels), StringComparison.Ordinal);
    }

    [Fact]
    public void Describe_non_five_field_is_empty()
    {
        var parts = CronExpression.SplitFields("* * *");
        var labels = CronDescribeLabels.FromLocalizer(Localizer);

        Assert.Equal(string.Empty, CronExpression.Describe(parts, labels));
    }

    // ---- MatchField (web matchField precedence) ------------------------------------

    [Theory]
    [InlineData("*", 0, true)]
    [InlineData("*", 59, true)]
    [InlineData("5", 5, true)]
    [InlineData("5", 6, false)]
    [InlineData("*/15", 0, true)]
    [InlineData("*/15", 30, true)]
    [InlineData("*/15", 7, false)]
    [InlineData("9-17", 9, true)]
    [InlineData("9-17", 17, true)]
    [InlineData("9-17", 8, false)]
    [InlineData("9-17", 18, false)]
    [InlineData("1,3,5", 3, true)]
    [InlineData("1,3,5", 2, false)]
    public void MatchField_matches_web(string field, int value, bool expected) =>
        Assert.Equal(expected, CronExpression.MatchField(field, value));

    [Theory]
    [InlineData("*/0")]
    [InlineData("abc")]
    [InlineData("*/")]
    public void MatchField_malformed_never_matches_and_never_throws(string field)
    {
        // Web NaN comparisons resolve to false; the native port must not divide by zero or throw.
        Assert.False(CronExpression.MatchField(field, 0));
        Assert.False(CronExpression.MatchField(field, 5));
    }

    // ---- NextRuns (web getNextCronRuns) --------------------------------------------

    [Fact]
    public void NextRuns_every_minute_starts_one_minute_ahead()
    {
        var parts = CronExpression.SplitFields("* * * * *");
        var runs = CronExpression.NextRuns(parts, 5, FixedNow);

        Assert.Equal(5, runs.Count);
        Assert.Equal(new DateTimeOffset(2026, 1, 1, 0, 1, 0, TimeSpan.Zero), runs[0]);
        for (int i = 1; i < runs.Count; i++)
        {
            Assert.Equal(runs[i - 1].AddMinutes(1), runs[i]);
        }
    }

    [Fact]
    public void NextRuns_every_hour_lands_on_top_of_hour()
    {
        var parts = CronExpression.SplitFields("0 * * * *");
        var runs = CronExpression.NextRuns(parts, 5, FixedNow);

        Assert.Equal(5, runs.Count);
        Assert.All(runs, r => Assert.Equal(0, r.Minute));
        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, runs.Select(r => r.Hour).ToArray());
    }

    [Fact]
    public void NextRuns_step_lands_on_multiples()
    {
        var parts = CronExpression.SplitFields("*/15 * * * *");
        var runs = CronExpression.NextRuns(parts, 3, FixedNow);

        Assert.Equal(new[] { 15, 30, 45 }, runs.Select(r => r.Minute).ToArray());
    }

    [Fact]
    public void NextRuns_respects_count()
    {
        var parts = CronExpression.SplitFields("* * * * *");
        Assert.Equal(3, CronExpression.NextRuns(parts, 3, FixedNow).Count);
    }

    [Theory]
    [InlineData("* * *")]
    [InlineData("")]
    public void NextRuns_invalid_expression_is_empty(string expression)
    {
        var parts = CronExpression.SplitFields(expression);
        Assert.Empty(CronExpression.NextRuns(parts, 5, FixedNow));
    }

    [Fact]
    public void NextRuns_impossible_schedule_is_empty()
    {
        // Feb 30 never occurs; the web scan exhausts its one-year safety bound and returns [].
        var parts = CronExpression.SplitFields("0 0 30 2 *");
        Assert.Empty(CronExpression.NextRuns(parts, 5, FixedNow));
    }

    [Fact]
    public void NextRuns_preserves_offset_of_now()
    {
        var now = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.FromHours(5));
        var parts = CronExpression.SplitFields("* * * * *");
        var runs = CronExpression.NextRuns(parts, 1, now);

        Assert.Equal(TimeSpan.FromHours(5), Assert.Single(runs).Offset);
    }

    // ---- Projection (web useMemo pipeline) -----------------------------------------

    [Fact]
    public void Project_blank_expression_is_empty_state()
    {
        var display = CronProjection.Project("", Localizer, FixedNow, 5, FixedFormat);

        Assert.Equal(CronParserState.Empty, display.State);
        Assert.Equal(string.Empty, display.Description);
        Assert.Empty(display.NextRuns);
        Assert.False(display.HasDescription);
        Assert.False(display.HasRuns);
    }

    [Fact]
    public void Project_valid_expression_is_parsed_state()
    {
        var display = CronProjection.Project("* * * * *", Localizer, FixedNow, 5, FixedFormat);

        Assert.Equal(CronParserState.Parsed, display.State);
        Assert.Equal("Every minute", display.Description);
        Assert.True(display.HasDescription);
        Assert.True(display.HasRuns);
        Assert.Equal(5, display.NextRuns.Count);
    }

    [Fact]
    public void Project_numbers_and_formats_each_run()
    {
        var display = CronProjection.Project("* * * * *", Localizer, FixedNow, 3, FixedFormat);

        Assert.Equal(new[] { 1, 2, 3 }, display.NextRuns.Select(r => r.Index).ToArray());
        Assert.Equal("2026-01-01 00:01", display.NextRuns[0].Formatted);
        Assert.Equal("2026-01-01 00:02", display.NextRuns[1].Formatted);
    }

    [Fact]
    public void Project_valid_but_impossible_schedule_parses_with_no_runs()
    {
        var display = CronProjection.Project("0 0 30 2 *", Localizer, FixedNow, 5, FixedFormat);

        Assert.Equal(CronParserState.Parsed, display.State);
        Assert.True(display.HasDescription);
        Assert.False(display.HasRuns);
        Assert.Empty(display.NextRuns);
    }

    [Fact]
    public void Project_routes_labels_through_localizer()
    {
        var display = CronProjection.Project("30 2 * * *", new PrefixLocalizer(), FixedNow, 1, FixedFormat);

        Assert.Contains("L:devtools.cron.atTime", display.Description, StringComparison.Ordinal);
        Assert.StartsWith("L:devtools.cron.runLabel", display.NextRuns[0].AutomationName, StringComparison.Ordinal);
    }

    // ---- Accessibility (Narrator names) --------------------------------------------

    [Fact]
    public void Project_every_run_has_a_non_empty_automation_name()
    {
        var display = CronProjection.Project("* * * * *", Localizer, FixedNow, 5, FixedFormat);

        Assert.All(display.NextRuns, run => Assert.False(string.IsNullOrWhiteSpace(run.AutomationName)));
    }

    [Fact]
    public void Project_run_automation_name_joins_index_and_time()
    {
        var display = CronProjection.Project("* * * * *", Localizer, FixedNow, 1, FixedFormat);

        Assert.Equal("Run 1: 2026-01-01 00:01", display.NextRuns[0].AutomationName);
    }

    [Fact]
    public void ViewModel_every_preset_has_a_non_empty_automation_name()
    {
        var vm = NewViewModel();
        Assert.All(vm.Presets, preset => Assert.False(string.IsNullOrWhiteSpace(preset.AutomationName)));
    }

    // ---- Registry + i18n metadata --------------------------------------------------

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("cron-parser", CronParserRegistration.Id);
        Assert.Equal("admin", CronParserRegistration.Category);
        Assert.Equal("CronParser", CronParserRegistration.Slug);
        Assert.Equal("cron", CronParserRegistration.ToolId);
        Assert.Equal("Cron Parser", CronParserRegistration.Name(Localizer));
        Assert.Equal("Cron Parser Desc", CronParserRegistration.Description(Localizer));
    }

    [Fact]
    public void Registration_labels_flow_through_localizer()
    {
        var prefix = new PrefixLocalizer();

        Assert.Equal("L:Cron Parser", CronParserRegistration.Name(prefix));
        Assert.Equal("L:Cron Parser Desc", CronParserRegistration.Description(prefix));
    }

    // ---- View-model: parsed / empty states -----------------------------------------

    [Fact]
    public void ViewModel_starts_empty()
    {
        var vm = NewViewModel();

        Assert.Equal(CronParserState.Empty, vm.State);
        Assert.Equal(string.Empty, vm.Expression);
        Assert.False(vm.HasDescription);
        Assert.False(vm.HasRuns);
        Assert.Equal(5, vm.Presets.Count);
    }

    [Fact]
    public void ViewModel_expression_parses_and_previews()
    {
        var vm = NewViewModel();
        vm.Expression = "* * * * *";

        Assert.Equal(CronParserState.Parsed, vm.State);
        Assert.True(vm.HasDescription);
        Assert.Equal("Every minute", vm.Description);
        Assert.True(vm.HasRuns);
        Assert.Equal(5, vm.NextRuns.Count);
    }

    [Fact]
    public void ViewModel_apply_preset_sets_expression()
    {
        var vm = NewViewModel();
        vm.ApplyPreset("0 0 * * *");

        Assert.Equal("0 0 * * *", vm.Expression);
        Assert.Equal("At 00:00", vm.Description);
    }

    [Fact]
    public void ViewModel_expression_change_raises_state()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Expression = "* * * * *";

        Assert.Contains(nameof(CronParserViewModel.Expression), raised);
        Assert.Contains(nameof(CronParserViewModel.Display), raised);
        Assert.Contains(nameof(CronParserViewModel.State), raised);
    }

    [Fact]
    public void ViewModel_same_expression_is_a_noop()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Expression = string.Empty;

        Assert.Empty(raised);
    }

    [Fact]
    public void ViewModel_invalid_expression_is_empty_state()
    {
        var vm = NewViewModel();
        vm.Expression = "* * *";

        Assert.Equal(CronParserState.Empty, vm.State);
        Assert.False(vm.HasDescription);
    }

    [Fact]
    public void ViewModel_uses_injected_clock_for_runs()
    {
        var vm = NewViewModel();
        vm.Expression = "* * * * *";

        Assert.Equal(new DateTimeOffset(2026, 1, 1, 0, 1, 0, TimeSpan.Zero), vm.NextRuns[0].Time);
    }

    [Fact]
    public void ViewModel_labels_are_localized()
    {
        var vm = NewViewModel();

        Assert.Equal("Cron Parser", vm.Title);
        Assert.Equal("Cron Parser Desc", vm.ToolDescription);
        Assert.Equal("Cron Expression", vm.InputLabel);
        Assert.Equal("Description", vm.DescriptionLabel);
        Assert.Equal("Next Runs", vm.NextRunsLabel);
        Assert.Equal("*/5 * * * *", vm.InputHint);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
        Assert.False(string.IsNullOrWhiteSpace(vm.NoRunsMessage));
        Assert.Equal(5, CronProjection.DefaultRunCount);
    }

    [Fact]
    public void ViewModel_presets_resolve_through_localizer()
    {
        var vm = new CronParserViewModel(new CronPresetSource(), new PrefixLocalizer(), new FixedTimeProvider(FixedNow), FixedFormat);

        Assert.Equal("L:Every Minute", vm.Presets[0].Label);
        Assert.Equal("* * * * *", vm.Presets[0].Value);
    }

    [Fact]
    public void ViewModel_empty_preset_source_yields_no_presets()
    {
        var vm = NewViewModel(new EmptyPresetSource());
        Assert.Empty(vm.Presets);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CronParserDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CronParser", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new CronParserDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class EmptyPresetSource : ICronPresetSource
    {
        public IReadOnlyList<CronPreset> GetPresets() => Array.Empty<CronPreset>();
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class FixedTimeProvider : TimeProvider
    {
        private readonly DateTimeOffset _now;

        public FixedTimeProvider(DateTimeOffset now) => _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public override TimeZoneInfo LocalTimeZone => TimeZoneInfo.Utc;
    }
}
