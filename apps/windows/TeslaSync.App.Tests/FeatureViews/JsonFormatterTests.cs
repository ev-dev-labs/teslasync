using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the JsonFormatter feature-view's UI-thread-free logic — the transform adapter
/// (the editor value → render-ready display, mirroring the web <c>useMemo</c> precedence and
/// <c>JSON.stringify(JSON.parse(inputVal), null, 2)</c> serialization), the per-state output (empty / formatted
/// / error), the i18n routing, the accessibility output names, the state-holder view-model's transitions, and
/// the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/tools/JsonFormatter.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class JsonFormatterTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private const string Fallback = "Invalid Json";

    private static JsonFormatterDisplay Project(string? text, ILocalizer? localizer = null) =>
        JsonFormatterProjection.Project(JsonFormatterInput.From(text), localizer ?? Localizer);

    // ---- Transform adapter: empty branch (web !inputVal.trim()) ---------------------

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n ")]
    [InlineData(null)]
    public void Compute_blank_or_whitespace_is_empty(string? text)
    {
        var result = JsonFormatterProjection.Compute(text, Fallback);

        Assert.Equal(JsonFormatterState.Empty, result.State);
        Assert.Equal(string.Empty, result.Formatted);
        Assert.Equal(string.Empty, result.Error);
    }

    [Fact]
    public void Project_empty_sets_empty_display_flags()
    {
        var display = Project("");

        Assert.Equal(JsonFormatterState.Empty, display.State);
        Assert.True(display.IsEmpty);
        Assert.False(display.HasFormatted);
        Assert.False(display.HasError);
        Assert.Equal(string.Empty, display.FormattedText);
        Assert.Equal(string.Empty, display.ErrorMessage);
    }

    // ---- Transform adapter: formatted branch ---------------------------------------

    [Fact]
    public void Compute_valid_object_is_formatted_with_two_space_indent()
    {
        var result = JsonFormatterProjection.Compute("{\"b\":2,\"a\":1}", Fallback);

        Assert.Equal(JsonFormatterState.Formatted, result.State);
        Assert.Equal(string.Empty, result.Error);
        Assert.Contains("\n", result.Formatted, StringComparison.Ordinal);
        // Two-space indentation, matching the web JSON.stringify(parsed, null, 2).
        Assert.Contains("  \"b\": 2", result.Formatted, StringComparison.Ordinal);
        Assert.Contains("  \"a\": 1", result.Formatted, StringComparison.Ordinal);
    }

    [Fact]
    public void Compute_preserves_member_order()
    {
        var result = JsonFormatterProjection.Compute("{\"b\":2,\"a\":1}", Fallback);

        int b = result.Formatted.IndexOf("\"b\"", StringComparison.Ordinal);
        int a = result.Formatted.IndexOf("\"a\"", StringComparison.Ordinal);
        Assert.True(b >= 0 && a > b, "members should serialize in source order (b before a)");
    }

    [Fact]
    public void Compute_indents_nested_arrays()
    {
        var result = JsonFormatterProjection.Compute("[1,2,3]", Fallback);

        Assert.Equal(JsonFormatterState.Formatted, result.State);
        Assert.Contains("[\n", result.Formatted, StringComparison.Ordinal);
        Assert.Contains("  1", result.Formatted, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("123", "123")]
    [InlineData("true", "true")]
    [InlineData("null", "null")]
    [InlineData("\"hi\"", "\"hi\"")]
    public void Compute_formats_top_level_scalars(string input, string expected)
    {
        var result = JsonFormatterProjection.Compute(input, Fallback);

        Assert.Equal(JsonFormatterState.Formatted, result.State);
        Assert.Equal(expected, result.Formatted);
    }

    [Fact]
    public void Compute_does_not_html_escape_string_values()
    {
        // The web JSON.stringify leaves '<', '>' and '&' verbatim; the .NET default encoder would emit
        // \u003C etc., so the projection uses the relaxed JavaScript encoder to keep parity.
        var result = JsonFormatterProjection.Compute("{\"html\":\"<a>&'\"}", Fallback);

        Assert.Equal(JsonFormatterState.Formatted, result.State);
        Assert.Contains("<a>&'", result.Formatted, StringComparison.Ordinal);
        Assert.DoesNotContain("\\u003C", result.Formatted, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Project_formatted_sets_display_and_copy_payload()
    {
        var display = Project("{\"ok\":true}");

        Assert.Equal(JsonFormatterState.Formatted, display.State);
        Assert.True(display.HasFormatted);
        Assert.False(display.HasError);
        Assert.False(string.IsNullOrEmpty(display.FormattedText));
        Assert.Equal(string.Empty, display.ErrorMessage);
        Assert.Contains("\"ok\": true", display.FormattedText, StringComparison.Ordinal);
    }

    // ---- Transform adapter: error branch -------------------------------------------

    [Theory]
    [InlineData("{bad}")]
    [InlineData("{")]
    [InlineData("[1,2,")]
    [InlineData("not json")]
    [InlineData("{\"a\":}")]
    public void Compute_invalid_json_is_error_with_message(string input)
    {
        var result = JsonFormatterProjection.Compute(input, Fallback);

        Assert.Equal(JsonFormatterState.Error, result.State);
        Assert.Equal(string.Empty, result.Formatted);
        Assert.False(string.IsNullOrWhiteSpace(result.Error));
    }

    [Fact]
    public void Compute_uses_fallback_only_when_parser_has_no_message()
    {
        // System.Text.Json always supplies a message, so a real parse error surfaces the parser text rather
        // than the fallback; this pins that the fallback is the substitute, not the default.
        var result = JsonFormatterProjection.Compute("{bad}", "FALLBACK");

        Assert.Equal(JsonFormatterState.Error, result.State);
        Assert.NotEqual("FALLBACK", result.Error);
    }

    [Fact]
    public void Project_error_sets_display_flags()
    {
        var display = Project("{bad}");

        Assert.Equal(JsonFormatterState.Error, display.State);
        Assert.True(display.HasError);
        Assert.False(display.HasFormatted);
        Assert.Equal(string.Empty, display.FormattedText);
        Assert.False(string.IsNullOrWhiteSpace(display.ErrorMessage));
    }

    // ---- Accessibility (output Narrator name per state) ----------------------------

    [Theory]
    [InlineData("")]
    [InlineData("{\"ok\":true}")]
    [InlineData("{bad}")]
    public void Project_output_name_is_non_empty(string input) =>
        Assert.False(string.IsNullOrWhiteSpace(Project(input).OutputName));

    [Fact]
    public void Project_error_output_name_is_the_parser_message()
    {
        var display = Project("{bad}");
        Assert.Equal(display.ErrorMessage, display.OutputName);
    }

    // ---- i18n routing (every owned string flows through the facade) -----------------

    [Fact]
    public void Project_routes_output_names_through_localizer()
    {
        Assert.Equal("L:featureView.jsonFormatter.idle", Project("", new PrefixLocalizer()).OutputName);
        Assert.Equal(
            "L:featureView.jsonFormatter.formattedReady",
            Project("{\"ok\":true}", new PrefixLocalizer()).OutputName);
    }

    [Fact]
    public void Project_always_resolves_the_invalid_json_fallback_key()
    {
        // The web component always evaluates t('Invalid Json'); the projection mirrors that by resolving the
        // fallback on every render, even for a valid payload.
        var recording = new RecordingLocalizer();
        _ = Project("{\"ok\":true}", recording);

        Assert.Contains(JsonFormatterProjection.InvalidJsonKey, recording.Keys);
    }

    [Fact]
    public void Project_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => JsonFormatterProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => JsonFormatterProjection.Project(JsonFormatterInput.Blank, null!));

    // ---- View-model: labels route through the facade --------------------------------

    [Fact]
    public void ViewModel_labels_route_through_localizer()
    {
        var vm = new JsonFormatterViewModel(StaticJsonFormatterSource.Blank(), new PrefixLocalizer());

        Assert.Equal("L:Json Formatter", vm.Title);
        Assert.Equal("L:Json Formatter Desc", vm.Description);
        Assert.Equal("L:Json Input", vm.InputLabel);
        Assert.Equal("L:Formatted", vm.FormattedLabel);
        Assert.Equal("L:common.copyButton.copy", vm.CopyLabel);
        Assert.Equal("L:common.copyButton.copied", vm.CopiedLabel);
    }

    [Fact]
    public void Projection_exposes_the_untranslated_editor_example() =>
        Assert.Equal("{\"key\":\"value\"}", JsonFormatterProjection.InputExample);

    // ---- View-model: seeding + transitions -----------------------------------------

    [Fact]
    public void ViewModel_seeds_from_source()
    {
        var vm = new JsonFormatterViewModel(StaticJsonFormatterSource.Of("{\"ok\":true}"), Localizer);

        Assert.Equal(JsonFormatterState.Formatted, vm.State);
        Assert.Equal("{\"ok\":true}", vm.Text);
    }

    [Fact]
    public void ViewModel_set_text_transitions_state_and_raises()
    {
        var vm = new JsonFormatterViewModel(StaticJsonFormatterSource.Blank(), Localizer);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SetText("{\"ok\":true}");

        Assert.Equal(JsonFormatterState.Formatted, vm.State);
        Assert.Contains(nameof(JsonFormatterViewModel.Display), raised);
        Assert.Contains(nameof(JsonFormatterViewModel.State), raised);
    }

    [Fact]
    public void ViewModel_set_text_walks_every_branch()
    {
        var vm = new JsonFormatterViewModel(StaticJsonFormatterSource.Blank(), Localizer);
        Assert.Equal(JsonFormatterState.Empty, vm.State);

        vm.SetText("{\"ok\":true}");
        Assert.Equal(JsonFormatterState.Formatted, vm.State);

        vm.SetText("{bad}");
        Assert.Equal(JsonFormatterState.Error, vm.State);

        vm.SetText("   ");
        Assert.Equal(JsonFormatterState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_set_text_null_is_empty()
    {
        var vm = new JsonFormatterViewModel(StaticJsonFormatterSource.Of("{\"ok\":true}"), Localizer);
        vm.SetText(null);

        Assert.Equal(JsonFormatterState.Empty, vm.State);
        Assert.Equal(string.Empty, vm.Text);
    }

    [Fact]
    public void ViewModel_refresh_repulls_the_source()
    {
        var source = new MutableJsonFormatterSource(JsonFormatterInput.Blank);
        var vm = new JsonFormatterViewModel(source, Localizer);
        Assert.Equal(JsonFormatterState.Empty, vm.State);

        source.Current = JsonFormatterInput.From("{\"ok\":true}");
        vm.Refresh();

        Assert.Equal(JsonFormatterState.Formatted, vm.State);
    }

    [Fact]
    public void ViewModel_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new JsonFormatterViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => new JsonFormatterViewModel(StaticJsonFormatterSource.Blank(), null!));
    }

    // ---- Source seam ----------------------------------------------------------------

    [Fact]
    public void Source_blank_seeds_empty_editor() =>
        Assert.Equal(string.Empty, StaticJsonFormatterSource.Blank().GetInput().Text);

    [Fact]
    public void Source_of_coalesces_null_to_empty() =>
        Assert.Equal(string.Empty, StaticJsonFormatterSource.Of(null).GetInput().Text);

    [Fact]
    public void Source_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => new StaticJsonFormatterSource(null!));

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new JsonFormatterDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=JsonFormatter", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new JsonFormatterDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_matches_diagnostics_event() =>
        Assert.Equal("JsonFormatter", JsonFormatterRegistration.Slug);

    // ---- Helpers / test doubles ----------------------------------------------------

    private sealed class MutableJsonFormatterSource(JsonFormatterInput initial) : IJsonFormatterSource
    {
        public JsonFormatterInput Current { get; set; } = initial;

        public JsonFormatterInput GetInput() => Current;
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
