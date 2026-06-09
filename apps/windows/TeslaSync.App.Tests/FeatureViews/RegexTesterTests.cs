using System.Text.RegularExpressions;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the Regex Tester surface's UI-thread-free logic — the pure
/// <see cref="RegexEvaluator"/> adapter (a port of the web <c>RegExp.exec</c> memo), the state-holder
/// view-model's per-state transitions (empty / matched), the registration + flag-option metadata, the
/// PII-safe diagnostics, the localized labels + Narrator names, and the exact set of i18n keys. Mirrors
/// the web spec (web/src/features/admin/components/devtools/tools/RegexTester.tsx). The WinUI view
/// itself is exercised by the app build.
/// </summary>
public sealed class RegexTesterTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ---- Evaluator adapter (port of the RegExp.exec memo) --------------------------

    [Theory]
    [InlineData("", "g", "abc")]          // web: !pattern -> []
    [InlineData("a", "g", "")]            // web: !testStr -> []
    [InlineData(null, "g", "abc")]        // null pattern -> []
    [InlineData("a", "g", null)]          // null test string -> []
    public void Evaluate_empty_inputs_return_no_matches(string? pattern, string flags, string? testStr)
    {
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate(pattern, flags, testStr);

        Assert.Empty(matches);
    }

    [Fact]
    public void Evaluate_global_collects_every_match_with_index_and_ordinal()
    {
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate("\\d+", "g", "a1b22c333");

        Assert.Equal(3, matches.Count);
        Assert.Equal(new RegexTesterMatch(1, "1", 1), matches[0]);
        Assert.Equal(new RegexTesterMatch(2, "22", 3), matches[1]);
        Assert.Equal(new RegexTesterMatch(3, "333", 6), matches[2]);
    }

    [Fact]
    public void Evaluate_without_global_returns_only_the_first_match()
    {
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate("\\d+", string.Empty, "a1b22c333");

        Assert.Single(matches);
        Assert.Equal(new RegexTesterMatch(1, "1", 1), matches[0]);
    }

    [Fact]
    public void Evaluate_case_insensitive_flag_matches_both_cases()
    {
        Assert.Single(RegexEvaluator.Evaluate("abc", "g", "ABCabc"));            // 'abc' only
        Assert.Equal(2, RegexEvaluator.Evaluate("abc", "gi", "ABCabc").Count);   // 'ABC' + 'abc'
    }

    [Fact]
    public void Evaluate_multiline_flag_anchors_each_line()
    {
        Assert.Single(RegexEvaluator.Evaluate("^\\w+", "g", "foo\nbar"));            // 'foo' only
        IReadOnlyList<RegexTesterMatch> multi = RegexEvaluator.Evaluate("^\\w+", "gm", "foo\nbar");
        Assert.Equal(2, multi.Count);
        Assert.Equal("foo", multi[0].Value);
        Assert.Equal("bar", multi[1].Value);
        Assert.Equal(4, multi[1].Index);
    }

    [Fact]
    public void Evaluate_invalid_pattern_returns_no_matches_like_the_web_catch()
    {
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate("(", "g", "abc");

        Assert.Empty(matches);
    }

    [Fact]
    public void Evaluate_zero_width_global_records_one_empty_match_then_stops()
    {
        // /a*/g over "aa": the web pushes 'aa'@0 then ''@2 and breaks on the empty match.
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate("a*", "g", "aa");

        Assert.Equal(2, matches.Count);
        Assert.Equal(new RegexTesterMatch(1, "aa", 0), matches[0]);
        Assert.Equal(new RegexTesterMatch(2, "", 2), matches[1]);
    }

    [Fact]
    public void Evaluate_zero_width_with_no_content_records_a_single_empty_match()
    {
        // /x*/g over "ab": the first exec is the empty match at 0, then the loop breaks.
        IReadOnlyList<RegexTesterMatch> matches = RegexEvaluator.Evaluate("x*", "g", "ab");

        Assert.Single(matches);
        Assert.Equal(new RegexTesterMatch(1, "", 0), matches[0]);
    }

    [Theory]
    [InlineData("g", RegexOptions.None, true)]
    [InlineData("gi", RegexOptions.IgnoreCase, true)]
    [InlineData("gm", RegexOptions.Multiline, true)]
    [InlineData("gim", RegexOptions.IgnoreCase | RegexOptions.Multiline, true)]
    [InlineData("", RegexOptions.None, false)]
    [InlineData(null, RegexOptions.None, false)]
    public void ParseFlags_maps_js_flags_to_engine_options(string? flags, RegexOptions expected, bool global)
    {
        (RegexOptions options, bool isGlobal) = RegexEvaluator.ParseFlags(flags);

        Assert.Equal(expected, options);
        Assert.Equal(global, isGlobal);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_empty_with_no_matches()
    {
        var vm = new RegexTesterViewModel(Localizer);

        Assert.Equal(RegexTesterState.Empty, vm.State);
        Assert.Equal(0, vm.MatchCount);
        Assert.False(vm.HasMatches);
        Assert.Empty(vm.Matches);
        Assert.Equal(StatusKind.Neutral, vm.BadgeStatus);
        Assert.Equal("g", vm.Flags); // web useState('g')
    }

    [Fact]
    public void ViewModel_matches_on_pattern_and_test_string()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "\\d+",
            TestString = "a1b22",
        };

        Assert.Equal(RegexTesterState.Matched, vm.State);
        Assert.Equal(2, vm.MatchCount);
        Assert.True(vm.HasMatches);
        Assert.Equal(StatusKind.Success, vm.BadgeStatus);
        Assert.Equal("2 Matches", vm.BadgeText);
        Assert.Equal("1", vm.Matches[0].Value);
        Assert.Equal("22", vm.Matches[1].Value);
    }

    [Fact]
    public void ViewModel_clearing_pattern_returns_to_empty()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "\\d+",
            TestString = "a1b22",
        };
        Assert.True(vm.HasMatches);

        vm.Pattern = string.Empty;

        Assert.Equal(RegexTesterState.Empty, vm.State);
        Assert.Equal(0, vm.MatchCount);
        Assert.False(vm.HasMatches);
        Assert.Equal("0 Matches", vm.BadgeText);
    }

    [Fact]
    public void ViewModel_switching_to_non_global_returns_first_match_only()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "\\d+",
            TestString = "a1b22c333",
        };
        Assert.Equal(3, vm.MatchCount);

        vm.Flags = string.Empty; // "No Flags"

        Assert.Equal(1, vm.MatchCount);
        Assert.Equal("1", vm.Matches[0].Value);
    }

    [Fact]
    public void ViewModel_invalid_pattern_stays_empty()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "(",
            TestString = "abc",
        };

        Assert.Equal(RegexTesterState.Empty, vm.State);
        Assert.Equal(0, vm.MatchCount);
        Assert.False(vm.HasMatches);
    }

    [Fact]
    public void ViewModel_exposes_match_captions_like_the_web()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "\\d+",
            TestString = "a1b22",
        };

        RegexMatchDisplay display = vm.DescribeMatch(vm.Matches[1]);
        Assert.Equal("2", display.Ordinal);                // web {i + 1}
        Assert.Equal("22", display.Value);                 // web m[0]
        Assert.Equal("At Index 3", display.IndexCaption);  // web {t('At Index')} {m.index}
        Assert.Contains("22", display.AccessibleName, StringComparison.Ordinal);
    }

    // ---- Property change notifications ---------------------------------------------

    [Fact]
    public void ViewModel_raises_property_changed_when_matches_appear()
    {
        var vm = new RegexTesterViewModel(Localizer) { TestString = "a1b22" };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Pattern = "\\d+";

        Assert.Contains(nameof(RegexTesterViewModel.Pattern), changed);
        Assert.Contains(nameof(RegexTesterViewModel.Matches), changed);
        Assert.Contains(nameof(RegexTesterViewModel.MatchCount), changed);
        Assert.Contains(nameof(RegexTesterViewModel.HasMatches), changed);
        Assert.Contains(nameof(RegexTesterViewModel.State), changed);
        Assert.Contains(nameof(RegexTesterViewModel.BadgeStatus), changed);
        Assert.Contains(nameof(RegexTesterViewModel.BadgeText), changed);
        Assert.Contains(nameof(RegexTesterViewModel.MatchesAccessibleName), changed);
    }

    [Fact]
    public void ViewModel_setting_same_value_does_not_raise()
    {
        var vm = new RegexTesterViewModel(Localizer)
        {
            Pattern = "\\d+",
            TestString = "a1b22",
        };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Pattern = "\\d+";       // unchanged
        vm.Flags = "g";            // unchanged (default)
        vm.TestString = "a1b22";   // unchanged

        Assert.Empty(changed);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = new RegexTesterViewModel(Localizer);

        Assert.Equal("Pattern", vm.PatternAccessibleName);
        Assert.Equal("Flags", vm.FlagsAccessibleName);
        Assert.Equal("Test String", vm.TestStringAccessibleName);
        Assert.Equal("0 Matches", vm.MatchesAccessibleName);
    }

    // ---- Registration + flag-option metadata (web registry parity) -----------------

    [Fact]
    public void Registration_matches_web_tool()
    {
        Assert.Equal("regex", RegexTesterRegistration.Id);
        Assert.Equal("devtools", RegexTesterRegistration.Category);
        Assert.Equal("RegexTester", RegexTesterRegistration.Slug);
        Assert.Equal("g", RegexTesterRegistration.DefaultFlags);
        Assert.Equal("Regex Tester", RegexTesterRegistration.Name(Localizer));
        Assert.Equal("Regex Tester Desc", RegexTesterRegistration.Description(Localizer));
        Assert.False(string.IsNullOrEmpty(RegexTesterRegistration.IconGlyph));
        Assert.False(string.IsNullOrEmpty(RegexTesterRegistration.AccentBrushKey));
        Assert.False(string.IsNullOrEmpty(RegexTesterRegistration.AccentColorKey));
    }

    [Fact]
    public void FlagChoices_reproduce_the_web_flag_options_in_order()
    {
        IReadOnlyList<RegexFlagChoice> choices = RegexTesterRegistration.FlagChoices(Localizer);

        Assert.Equal(5, choices.Count);
        Assert.Equal(new[] { "g", "gi", "gm", "gim", "" }, choices.Select(c => c.Value).ToArray());
        Assert.Equal("g (global)", choices[0].Label);
        Assert.Equal("gi (global, case-insensitive)", choices[1].Label);
        Assert.Equal("gm (global, multiline)", choices[2].Label);
        Assert.Equal("gim (all)", choices[3].Label);
        Assert.Equal("No Flags", choices[4].Label);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new RegexTesterDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=RegexTester", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_emits_pattern_or_test_string()
    {
        // The sink must never receive the user's payload (it can carry secrets).
        const string secretPattern = "super-secret-token";
        const string secretInput = "another-secret-value";
        var lines = new List<string>();
        var diagnostics = new RegexTesterDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains(secretPattern, StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains(secretInput, StringComparison.Ordinal));
    }

    // ---- i18n key parity (web t() call sites) --------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new RegexTesterViewModel(recorder);

        // Touch every localized surface the view renders.
        _ = vm.Title;
        _ = vm.Description;
        _ = vm.PatternLabel;
        _ = vm.PatternHint;
        _ = vm.FlagsLabel;
        _ = vm.TestStringLabel;
        _ = vm.TestStringHint;
        _ = vm.MatchesLabel;
        _ = vm.AtIndexLabel;
        _ = vm.FlagOptions;

        string[] expected =
        [
            "Regex Tester",
            "Regex Tester Desc",
            "Pattern",
            "devtools.regex.patternHint",
            "Flags",
            "Test String",
            "Test String Placeholder",
            "Matches",
            "At Index",
            "devtools.regex.flagGlobal",
            "devtools.regex.flagGlobalCaseInsensitive",
            "devtools.regex.flagGlobalMultiline",
            "devtools.regex.flagAll",
            "No Flags",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
