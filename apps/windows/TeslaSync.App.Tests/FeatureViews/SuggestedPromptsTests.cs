using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SuggestedPrompts surface's UI-thread-free logic — the static catalog parity,
/// the localized projection (prompt resolution, Sparkles glyph, Narrator-name composition), the state-holder
/// view-model's Ready/Empty branches and language re-projection, the registration metadata, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/system/components/chatbot/SuggestedPrompts.tsx). The
/// WinUI view itself is exercised by the app build.
/// </summary>
public sealed class SuggestedPromptsTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    // ---- Catalog parity ------------------------------------------------------------

    [Fact]
    public void Catalog_default_reproduces_the_four_web_suggestions_in_order()
    {
        var catalog = ChatSuggestionCatalog.Default;

        Assert.Collection(
            catalog,
            s => AssertSuggestion(s, "chatbot.suggestion.fleetYesterday", "What did my fleet do yesterday?"),
            s => AssertSuggestion(s, "chatbot.suggestion.chargingCost30d", "Charging cost last 30 days"),
            s => AssertSuggestion(s, "chatbot.suggestion.socDropping", "Why is my SoC dropping faster this week?"),
            s => AssertSuggestion(s, "chatbot.suggestion.efficientDrive", "Show me the most efficient drive this month"));
    }

    private static void AssertSuggestion(ChatSuggestion suggestion, string key, string value)
    {
        Assert.Equal(key, suggestion.I18nKey);
        Assert.Equal(value, suggestion.DefaultValue);
    }

    // ---- Projection adapter --------------------------------------------------------

    [Fact]
    public void Project_resolves_prompts_and_attaches_the_sparkle_glyph()
    {
        var items = SuggestedPromptsProjection.Project(ChatSuggestionCatalog.Default, Passthrough);

        Assert.Collection(
            items,
            i => AssertItem(i, "What did my fleet do yesterday?"),
            i => AssertItem(i, "Charging cost last 30 days"),
            i => AssertItem(i, "Why is my SoC dropping faster this week?"),
            i => AssertItem(i, "Show me the most efficient drive this month"));
    }

    private static void AssertItem(SuggestedPromptItem item, string text)
    {
        Assert.Equal(text, item.Text);
        Assert.Equal(SuggestedPromptsRegistration.SparkleGlyph, item.Glyph);
        Assert.Equal(text, item.AutomationName);
    }

    [Fact]
    public void Project_requests_exactly_the_web_i18n_keys_in_order()
    {
        var recorder = new RecordingLocalizer();

        SuggestedPromptsProjection.Project(ChatSuggestionCatalog.Default, recorder);

        Assert.Equal(
            new[]
            {
                "chatbot.suggestion.fleetYesterday",
                "chatbot.suggestion.chargingCost30d",
                "chatbot.suggestion.socDropping",
                "chatbot.suggestion.efficientDrive",
            },
            recorder.Keys);
    }

    [Fact]
    public void Glyph_is_the_registered_sparkle_glyph()
    {
        Assert.Equal(SuggestedPromptsRegistration.SparkleGlyph, SuggestedPromptsProjection.Glyph());
        Assert.False(string.IsNullOrEmpty(SuggestedPromptsProjection.Glyph()));
    }

    [Fact]
    public void Project_null_or_empty_catalog_yields_no_items()
    {
        Assert.Empty(SuggestedPromptsProjection.Project(null, Passthrough));
        Assert.Empty(SuggestedPromptsProjection.Project(Array.Empty<ChatSuggestion>(), Passthrough));
    }

    [Fact]
    public void AutomationName_is_the_prompt_text()
    {
        var item = Assert.Single(
            SuggestedPromptsProjection.Project(
                new[] { new ChatSuggestion("k", "Charging cost last 30 days") },
                Passthrough));

        Assert.Equal("Charging cost last 30 days", item.AutomationName);
        Assert.False(string.IsNullOrWhiteSpace(item.AutomationName));
    }

    // ---- View-model state branches -------------------------------------------------

    [Fact]
    public void ViewModel_default_catalog_is_ready_with_four_suggestions()
    {
        var vm = new SuggestedPromptsViewModel(Passthrough);

        Assert.Equal(SuggestedPromptState.Ready, vm.State);
        Assert.True(vm.HasSuggestions);
        Assert.Equal(4, vm.Items.Count);
    }

    [Fact]
    public void ViewModel_empty_catalog_renders_the_empty_state()
    {
        var vm = new SuggestedPromptsViewModel(Passthrough, Array.Empty<ChatSuggestion>());

        Assert.Equal(SuggestedPromptState.Empty, vm.State);
        Assert.False(vm.HasSuggestions);
        Assert.Empty(vm.Items);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_region_and_empty_copy_resolve_through_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new SuggestedPromptsViewModel(recorder, Array.Empty<ChatSuggestion>());

        Assert.Equal("Suggested prompts", vm.RegionName);
        Assert.Equal("No data available", vm.EmptyMessage);
        Assert.Contains("chatbot.aria.suggestions", recorder.Keys);
        Assert.Contains("common.noData", recorder.Keys);
    }

    [Fact]
    public void ViewModel_reload_reprojects_prompts_and_notifies()
    {
        var localizer = new SuffixLocalizer();
        var vm = new SuggestedPromptsViewModel(localizer);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        Assert.Equal("What did my fleet do yesterday?", vm.Items[0].Text);

        localizer.Suffix = " \u2605";
        vm.Reload();

        Assert.Equal("What did my fleet do yesterday? \u2605", vm.Items[0].Text);
        Assert.Contains(nameof(SuggestedPromptsViewModel.Items), changed);
        Assert.Equal(SuggestedPromptState.Ready, vm.State);
    }

    // ---- Registration + diagnostics ------------------------------------------------

    [Fact]
    public void Registration_slug_is_stable()
    {
        Assert.Equal("SuggestedPrompts", SuggestedPromptsRegistration.Slug);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new SuggestedPromptsDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=SuggestedPrompts", "view.opened slug=SuggestedPrompts" }, emitted);
    }

    // ---- Test localizers -----------------------------------------------------------

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = new();

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class SuffixLocalizer : ILocalizer
    {
        public string Suffix { get; set; } = string.Empty;

        public string GetString(string key, string fallback) => fallback + Suffix;
    }
}
