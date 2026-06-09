using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ResultPanel feature view's UI-thread-free logic — the projection adapter
/// (the cached input → render-ready display, mirroring the web branch precedence and
/// <c>JSON.stringify(data, null, 2)</c> serialization), the per-state output (idle / result / error), the
/// i18n routing, the accessibility names, the semantic tints, the state-holder view-model's transitions, and
/// the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/admin/components/devtools/ResultPanel.tsx). The WinUI view itself is exercised by the
/// app build.
/// </summary>
public sealed class ResultPanelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ResultPanelDisplay Project(ResultPanelInput input, ILocalizer? localizer = null) =>
        ResultPanelProjection.Project(input, localizer ?? Localizer);

    // ---- Projection adapter: idle branch -------------------------------------------

    [Fact]
    public void Project_idle_when_no_data_or_error()
    {
        var display = Project(ResultPanelInput.Idle("Response"));

        Assert.Equal(ResultPanelState.Idle, display.State);
        Assert.Null(display.ErrorMessage);
        Assert.Null(display.SerializedData);
        Assert.False(display.HasCopyAction);
        Assert.Equal("Response", display.Title);
    }

    [Fact]
    public void Project_idle_uses_default_message_from_localizer()
    {
        var display = Project(ResultPanelInput.Idle("Response"));
        Assert.Equal("No result yet", display.IdleMessage);
    }

    [Fact]
    public void Project_idle_respects_caller_override()
    {
        var display = Project(new ResultPanelInput("Response", null, null, "Run a probe to see output"));
        Assert.Equal("Run a probe to see output", display.IdleMessage);
    }

    // ---- Projection adapter: result branch -----------------------------------------

    [Fact]
    public void Project_result_when_data_present()
    {
        var data = new Dictionary<string, object?> { ["status"] = "ok", ["count"] = 3 };
        var display = Project(new ResultPanelInput("Response", data, null, null));

        Assert.Equal(ResultPanelState.Result, display.State);
        Assert.True(display.HasCopyAction);
        Assert.False(string.IsNullOrEmpty(display.SerializedData));
        Assert.Equal(display.SerializedData, display.CopyValue);
        Assert.Null(display.ErrorMessage);
    }

    [Fact]
    public void Project_result_serializes_payload_indented()
    {
        var data = new Dictionary<string, object?> { ["status"] = "ok", ["count"] = 3 };
        var display = Project(new ResultPanelInput("Response", data, null, null));

        Assert.Contains("\n", display.SerializedData);
        Assert.Contains("\"status\": \"ok\"", display.SerializedData);
        Assert.Contains("\"count\": 3", display.SerializedData);
        // Two-space indentation, matching the web JSON.stringify(data, null, 2).
        Assert.Contains("  \"status\"", display.SerializedData);
    }

    [Theory]
    [InlineData(42, "42")]
    [InlineData(true, "true")]
    public void Serialize_renders_primitives(object value, string expected) =>
        Assert.Equal(expected, ResultPanelProjection.Serialize(value));

    [Fact]
    public void Serialize_quotes_strings() =>
        Assert.Equal("\"hello\"", ResultPanelProjection.Serialize("hello"));

    // ---- Projection adapter: error branch + precedence -----------------------------

    [Fact]
    public void Project_error_when_error_present()
    {
        var display = Project(new ResultPanelInput("Response", null, "Request failed: 500", null));

        Assert.Equal(ResultPanelState.Error, display.State);
        Assert.Equal("Request failed: 500", display.ErrorMessage);
        Assert.Null(display.SerializedData);
        Assert.False(display.HasCopyAction);
    }

    [Fact]
    public void Project_error_takes_precedence_over_data_but_keeps_copy()
    {
        // Web header rule: the body shows the error, yet the copy affordance still appears because a payload
        // is present (hasData), and the clipboard value is the serialized payload.
        var data = new Dictionary<string, object?> { ["partial"] = true };
        var display = Project(new ResultPanelInput("Response", data, "Decode warning", null));

        Assert.Equal(ResultPanelState.Error, display.State);
        Assert.Equal("Decode warning", display.ErrorMessage);
        Assert.True(display.HasCopyAction);
        Assert.False(string.IsNullOrEmpty(display.CopyValue));
        Assert.Contains("\"partial\": true", display.CopyValue);
    }

    // ---- Projection adapter: tints (semantic tokens, never neon) --------------------

    [Theory]
    [InlineData(ResultPanelState.Error)]
    [InlineData(ResultPanelState.Result)]
    [InlineData(ResultPanelState.Idle)]
    public void Project_tints_use_semantic_tokens_not_neon(ResultPanelState state)
    {
        var display = Project(InputFor(state));

        Assert.StartsWith("TsColor", display.TintBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", display.TintBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", display.TintBrushKey, StringComparison.OrdinalIgnoreCase);
        Assert.True(display.TintOpacity is > 0 and < 1);
    }

    [Fact]
    public void Project_error_and_result_tints_differ_from_idle()
    {
        var error = Project(InputFor(ResultPanelState.Error));
        var result = Project(InputFor(ResultPanelState.Result));
        var idle = Project(InputFor(ResultPanelState.Idle));

        Assert.Equal(ResultPanelProjection.DangerBrushKey, error.TintBrushKey);
        Assert.Equal(ResultPanelProjection.SuccessBrushKey, result.TintBrushKey);
        Assert.Equal(ResultPanelProjection.NeutralBrushKey, idle.TintBrushKey);
    }

    // ---- Accessibility (region + body Narrator names) ------------------------------

    [Theory]
    [InlineData(ResultPanelState.Error)]
    [InlineData(ResultPanelState.Result)]
    [InlineData(ResultPanelState.Idle)]
    public void Project_region_and_body_names_are_non_empty(ResultPanelState state)
    {
        var display = Project(InputFor(state));

        Assert.False(string.IsNullOrWhiteSpace(display.RegionName));
        Assert.False(string.IsNullOrWhiteSpace(display.BodyName));
    }

    [Fact]
    public void Project_region_name_uses_title_when_present() =>
        Assert.Equal("Response", Project(ResultPanelInput.Idle("Response")).RegionName);

    [Fact]
    public void Project_region_name_falls_back_when_title_blank() =>
        Assert.Equal("Result", Project(ResultPanelInput.Idle(string.Empty)).RegionName);

    [Fact]
    public void Project_error_body_name_is_the_error_text() =>
        Assert.Equal("Boom", Project(new ResultPanelInput("T", null, "Boom", null)).BodyName);

    // ---- i18n routing (every owned string flows through the facade) -----------------

    [Fact]
    public void Project_routes_owned_strings_through_localizer()
    {
        var display = Project(ResultPanelInput.Idle(string.Empty), new PrefixLocalizer());

        Assert.Equal("L:featureView.resultPanel.noResult", display.IdleMessage);
        Assert.Equal("L:featureView.resultPanel.title", display.RegionName);
        Assert.Equal("L:common.copyButton.copy", display.CopyLabel);
        Assert.Equal("L:common.copyButton.copied", display.CopiedLabel);
    }

    [Fact]
    public void Project_result_body_name_routes_through_localizer()
    {
        var data = new Dictionary<string, object?> { ["ok"] = true };
        var display = Project(new ResultPanelInput("T", data, null, null), new PrefixLocalizer());
        Assert.Equal("L:featureView.resultPanel.resultReady", display.BodyName);
    }

    [Fact]
    public void Project_copy_labels_resolved_for_button()
    {
        var data = new Dictionary<string, object?> { ["ok"] = true };
        var display = Project(new ResultPanelInput("T", data, null, null));

        Assert.Equal("Copy", display.CopyLabel);
        Assert.Equal("Copied", display.CopiedLabel);
    }

    // ---- Projection guards ----------------------------------------------------------

    [Fact]
    public void Project_rejects_null_input() =>
        Assert.Throws<ArgumentNullException>(() => ResultPanelProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => ResultPanelProjection.Project(ResultPanelInput.Idle("T"), null!));

    // ---- View-model: seeding + transitions -----------------------------------------

    [Fact]
    public void ViewModel_seeds_from_source()
    {
        var vm = new ResultPanelViewModel(StaticResultPanelSource.Idle("Response"), Localizer);

        Assert.Equal(ResultPanelState.Idle, vm.State);
        Assert.Equal("Response", vm.Title);
        Assert.False(vm.HasCopyAction);
    }

    [Fact]
    public void ViewModel_update_transitions_state_and_raises()
    {
        var vm = new ResultPanelViewModel(StaticResultPanelSource.Idle("Response"), Localizer);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        var data = new Dictionary<string, object?> { ["ok"] = true };
        vm.Update(new ResultPanelInput("Response", data, null, null));

        Assert.Equal(ResultPanelState.Result, vm.State);
        Assert.True(vm.HasCopyAction);
        Assert.Contains(nameof(ResultPanelViewModel.Display), raised);
        Assert.Contains(nameof(ResultPanelViewModel.State), raised);
        Assert.Contains(nameof(ResultPanelViewModel.HasCopyAction), raised);
    }

    [Fact]
    public void ViewModel_update_to_error_state()
    {
        var vm = new ResultPanelViewModel(StaticResultPanelSource.Idle("Response"), Localizer);
        vm.Update(new ResultPanelInput("Response", null, "Failed", null));

        Assert.Equal(ResultPanelState.Error, vm.State);
        Assert.Equal("Failed", vm.Display.ErrorMessage);
    }

    [Fact]
    public void ViewModel_refresh_repulls_the_source()
    {
        var source = new MutableResultPanelSource(ResultPanelInput.Idle("Response"));
        var vm = new ResultPanelViewModel(source, Localizer);
        Assert.Equal(ResultPanelState.Idle, vm.State);

        var data = new Dictionary<string, object?> { ["ok"] = true };
        source.Current = new ResultPanelInput("Response", data, null, null);
        vm.Refresh();

        Assert.Equal(ResultPanelState.Result, vm.State);
    }

    [Fact]
    public void ViewModel_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() => new ResultPanelViewModel(null!, Localizer));
        Assert.Throws<ArgumentNullException>(() => new ResultPanelViewModel(StaticResultPanelSource.Idle("T"), null!));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ResultPanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ResultPanel", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new ResultPanelDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    [Fact]
    public void Registration_slug_matches_diagnostics_event() =>
        Assert.Equal("ResultPanel", ResultPanelRegistration.Slug);

    // ---- Helpers / test doubles ----------------------------------------------------

    private static ResultPanelInput InputFor(ResultPanelState state) => state switch
    {
        ResultPanelState.Error => new ResultPanelInput("Response", null, "Request failed", null),
        ResultPanelState.Result => new ResultPanelInput("Response", new Dictionary<string, object?> { ["ok"] = true }, null, null),
        _ => ResultPanelInput.Idle("Response"),
    };

    private sealed class MutableResultPanelSource(ResultPanelInput initial) : IResultPanelSource
    {
        public ResultPanelInput Current { get; set; } = initial;

        public ResultPanelInput GetInput() => Current;
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
