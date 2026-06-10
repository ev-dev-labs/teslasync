using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>CommandSearch</c> feature surface's UI-thread-free logic — the controlled
/// value normalization (null → empty), the empty-vs-populated branch (<c>HasValue</c>), the i18n prompt /
/// accessible-name resolution through the facade, the registry metadata, and the PII-safe diagnostics. Mirrors
/// the web spec (web/src/features/system/components/CommandSearch.tsx), which is a thin fully-controlled search
/// <c>Input</c> with no fetch lifecycle — so, like the sibling <c>SettingField</c>, there is deliberately no
/// loading / error / stale / offline state to assert; the only render-affecting distinction is empty vs
/// populated, both covered here. The WinUI view itself (CommandSearch.cs) is exercised by the app build.
/// </summary>
public sealed class CommandSearchTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CommandSearchDisplay Project(CommandSearchModel model) =>
        CommandSearchProjection.Project(model, Localizer);

    private static CommandSearchDisplay Project(CommandSearchModel model, ILocalizer localizer) =>
        CommandSearchProjection.Project(model, localizer);

    // ── Controlled value: null coerced to empty, passes through otherwise ────────────────────────────────

    [Fact]
    public void Empty_model_projects_an_empty_value()
    {
        var display = Project(CommandSearchModel.Empty);

        Assert.Equal(string.Empty, display.Value);
        Assert.False(display.HasValue);
    }

    [Fact]
    public void Null_value_is_coerced_to_empty()
    {
        var display = Project(new CommandSearchModel(null));

        Assert.Equal(string.Empty, display.Value);
        Assert.False(display.HasValue);
    }

    [Theory]
    [InlineData("battery")]
    [InlineData("Wake vehicle")]
    public void Populated_value_passes_through_and_is_flagged_present(string query)
    {
        var display = Project(new CommandSearchModel(query));

        Assert.Equal(query, display.Value);
        Assert.True(display.HasValue);
    }

    [Fact]
    public void Whitespace_value_counts_as_present_so_the_prompt_hides()
    {
        // Native TextBox shows its prompt only while the text is empty (length 0); a whitespace string is
        // text, so the prompt hides — HasValue mirrors that "prompt hidden" condition exactly.
        var display = Project(new CommandSearchModel(" "));

        Assert.Equal(" ", display.Value);
        Assert.True(display.HasValue);
    }

    // ── Prompt + accessible name resolution (web placeholder → Narrator name) ─────────────────────────────

    [Fact]
    public void Prompt_resolves_to_the_web_fallback_through_the_passthrough_facade()
    {
        var display = Project(CommandSearchModel.Empty);

        Assert.Equal("Search commands...", display.PromptText);
    }

    [Fact]
    public void Prompt_prefers_the_localized_string_over_the_fallback()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>
        {
            ["commands.search.placeholder"] = "Befehle suchen…", // parity:allow web i18n key literally named placeholder
        });

        var display = Project(CommandSearchModel.Empty, localizer);

        Assert.Equal("Befehle suchen…", display.PromptText);
    }

    [Fact]
    public void Accessible_name_mirrors_the_prompt_in_every_branch()
    {
        var empty = Project(CommandSearchModel.Empty);
        var populated = Project(new CommandSearchModel("nav"));

        Assert.Equal(empty.PromptText, empty.AccessibleName);
        Assert.Equal(populated.PromptText, populated.AccessibleName);
        Assert.False(string.IsNullOrWhiteSpace(empty.AccessibleName));
    }

    [Fact]
    public void Prompt_resolves_through_the_facade_with_the_source_key()
    {
        var recorder = new RecordingLocalizer();

        _ = CommandSearchRegistration.PromptText(recorder);

        Assert.Contains("commands.search.placeholder", recorder.Keys); // parity:allow web i18n key literally named placeholder
    }

    // ── Registry metadata ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("CommandSearch", CommandSearchRegistration.Slug);

    [Fact]
    public void Registration_exposes_a_non_empty_search_glyph() =>
        Assert.False(string.IsNullOrEmpty(CommandSearchRegistration.SearchGlyph));

    [Fact]
    public void Registration_exposes_the_source_key_and_fallback()
    {
        Assert.Equal("commands.search.placeholder", CommandSearchRegistration.PromptKey); // parity:allow web i18n key literally named placeholder
        Assert.Equal("Search commands...", CommandSearchRegistration.PromptFallback);
    }

    // ── Diagnostics (P1/S11): view.opened slug=CommandSearch, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new CommandSearchDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=CommandSearch", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_typed_query()
    {
        var captured = new List<string>();
        var diagnostics = new CommandSearchDiagnostics(captured.Add);

        // Open the surface; the query a user might type must never appear in a diagnostics line.
        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=CommandSearch", line);
        Assert.DoesNotContain("battery", line, StringComparison.Ordinal);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => CommandSearchProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => CommandSearchProjection.Project(CommandSearchModel.Empty, null!));

    [Fact]
    public void PromptText_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => CommandSearchRegistration.PromptText(null!));

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
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
