using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.ClientUtilities;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the ClientUtilitiesSection's UI-thread-free logic — the canonical fifteen-tool
/// catalog (web <c>useToolList</c>), the search projection (cards, i18n labels, case-insensitive name /
/// description filtering, a11y names), the registry + diagnostics metadata, and the state-holder
/// view-model's per-state transitions (ready / empty), single-open disclosure semantics and re-filtering.
/// Mirrors the web spec (web/src/features/admin/components/devtools/ClientUtilitiesSection.tsx).
/// </summary>
public sealed class ClientUtilitiesSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static readonly string[] WebOrderIds =
    {
        "vin", "jwt", "timestamp", "base64", "url", "json", "uuid", "hash",
        "bytes", "color", "cron", "http", "tesla-api", "regex", "unix-perm",
    };

    private static ClientUtilitiesViewModel NewViewModel(IClientUtilityToolSource? source = null) =>
        new(source ?? new ClientUtilityToolSource(), Localizer);

    // ---- Canonical catalog (web useToolList parity) --------------------------------

    [Fact]
    public void Catalog_has_fifteen_entries_in_web_order()
    {
        var ids = ClientUtilityToolSource.Canonical.Select(t => t.Id).ToArray();
        Assert.Equal(WebOrderIds, ids);
    }

    [Fact]
    public void Catalog_base64_uses_web_keyed_translation()
    {
        var base64 = ClientUtilityToolSource.Canonical.Single(t => t.Id == "base64");

        Assert.Equal("devtools.utils.base64", base64.NameKey);
        Assert.Equal("Base64", base64.NameFallback);
        Assert.Equal("devtools.utils.base64Desc", base64.DescriptionKey);
        Assert.Equal("Base64Desc", base64.DescriptionFallback);
    }

    [Theory]
    [InlineData("vin", "Vin Decoder", "Vin Decoder Desc")]
    [InlineData("jwt", "Jwt Decoder", "Jwt Decoder Desc")]
    [InlineData("timestamp", "Timestamp", "Timestamp Desc")]
    [InlineData("url", "Url Encoder", "Url Encoder Desc")]
    [InlineData("json", "Json Formatter", "Json Formatter Desc")]
    [InlineData("uuid", "Uuid Generator", "Uuid Generator Desc")]
    [InlineData("hash", "Hash Calculator", "Hash Calculator Desc")]
    [InlineData("bytes", "Byte Size", "Byte Size Desc")]
    [InlineData("color", "Color Converter", "Color Converter Desc")]
    [InlineData("cron", "Cron Parser", "Cron Parser Desc")]
    [InlineData("http", "Http Status", "Http Status Desc")]
    [InlineData("tesla-api", "Tesla Api Ref", "Tesla Api Ref Desc")]
    [InlineData("regex", "Regex Tester", "Regex Tester Desc")]
    [InlineData("unix-perm", "Unix Perm", "Unix Perm Desc")]
    public void Catalog_keyless_tools_use_label_as_key(string id, string nameKey, string descKey)
    {
        var tool = ClientUtilityToolSource.Canonical.Single(t => t.Id == id);

        Assert.Equal(nameKey, tool.NameKey);
        Assert.Equal(nameKey, tool.NameFallback);
        Assert.Equal(descKey, tool.DescriptionKey);
        Assert.Equal(descKey, tool.DescriptionFallback);
    }

    [Theory]
    [InlineData("vin", "TsColorInfoBrush")]
    [InlineData("jwt", "TsColorAccentBrush")]
    [InlineData("timestamp", "TsColorSuccessBrush")]
    [InlineData("base64", "TsColorWarningBrush")]
    [InlineData("hash", "TsColorDangerBrush")]
    [InlineData("regex", "TsColorDangerBrush")]
    public void Catalog_accent_tokens_map_web_colors(string id, string token) =>
        Assert.Equal(token, ClientUtilityToolSource.Canonical.Single(t => t.Id == id).AccentBrushKey);

    [Fact]
    public void Catalog_accents_use_semantic_tokens_not_neon()
    {
        foreach (var tool in ClientUtilityToolSource.Canonical)
        {
            Assert.StartsWith("TsColor", tool.AccentBrushKey, StringComparison.Ordinal);
            Assert.EndsWith("Brush", tool.AccentBrushKey, StringComparison.Ordinal);
            Assert.DoesNotContain("neon", tool.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void Catalog_glyphs_are_non_empty()
    {
        foreach (var tool in ClientUtilityToolSource.Canonical)
        {
            Assert.False(string.IsNullOrEmpty(tool.Glyph));
        }
    }

    [Fact]
    public void Catalog_ids_are_unique()
    {
        var ids = ClientUtilityToolSource.Canonical.Select(t => t.Id).ToArray();
        Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());
    }

    // ---- Projection adapter (search + i18n) ----------------------------------------

    [Fact]
    public void Project_unfiltered_yields_a_card_per_tool_in_order()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, null, Localizer);

        Assert.Equal(15, display.Cards.Count);
        Assert.Equal(15, display.TotalCount);
        Assert.Equal(WebOrderIds, display.Cards.Select(c => c.Id).ToArray());
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Project_blank_query_returns_every_tool(string query)
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, query, Localizer);
        Assert.Equal(15, display.Cards.Count);
    }

    [Fact]
    public void Project_resolves_labels_through_localizer()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, null, Localizer);
        var vin = display.Cards[0];

        Assert.Equal("Vin Decoder", vin.Name);
        Assert.Equal("Vin Decoder Desc", vin.Description);
    }

    [Fact]
    public void Project_uses_keys_when_localizer_translates()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, null, new PrefixLocalizer());

        // Every label came through the i18n facade (prefixed), not a hard-coded literal.
        Assert.Equal("L:Vin Decoder", display.Cards[0].Name);
        Assert.Equal("L:devtools.utils.base64", display.Cards.Single(c => c.Id == "base64").Name);
    }

    [Fact]
    public void Project_filters_by_name_case_insensitively()
    {
        var lower = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, "vin", Localizer);
        var upper = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, "VIN", Localizer);

        Assert.Equal("vin", Assert.Single(lower.Cards).Id);
        Assert.Equal("vin", Assert.Single(upper.Cards).Id);
    }

    [Fact]
    public void Project_filters_match_multiple_tools_by_shared_name_token()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, "decoder", Localizer);

        Assert.Equal(new[] { "vin", "jwt" }, display.Cards.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Project_filters_by_description_only()
    {
        // "Decoder Desc" appears in the vin/jwt descriptions but in no tool name.
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, "Decoder Desc", Localizer);

        Assert.Equal(new[] { "vin", "jwt" }, display.Cards.Select(c => c.Id).ToArray());
    }

    [Fact]
    public void Project_non_matching_query_yields_no_cards_but_keeps_total()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, "no-such-tool-xyz", Localizer);

        Assert.Empty(display.Cards);
        Assert.Equal(15, display.TotalCount);
    }

    [Fact]
    public void Project_with_empty_source_yields_no_cards()
    {
        var display = ClientUtilitiesProjection.Project(Array.Empty<ClientUtilityTool>(), null, Localizer);

        Assert.Empty(display.Cards);
        Assert.Equal(0, display.TotalCount);
    }

    // ---- Accessibility (Narrator names on every card) ------------------------------

    [Fact]
    public void Project_every_card_has_a_non_empty_automation_name()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, null, Localizer);

        Assert.All(display.Cards, card => Assert.False(string.IsNullOrWhiteSpace(card.AutomationName)));
    }

    [Fact]
    public void Project_automation_name_joins_name_and_description()
    {
        var display = ClientUtilitiesProjection.Project(ClientUtilityToolSource.Canonical, null, Localizer);

        Assert.Equal("Vin Decoder, Vin Decoder Desc", display.Cards[0].AutomationName);
        Assert.Equal("Base64, Base64Desc", display.Cards.Single(c => c.Id == "base64").AutomationName);
    }

    // ---- Registry + i18n metadata --------------------------------------------------

    [Fact]
    public void Registration_metadata_is_stable()
    {
        Assert.Equal("client-utilities", ClientUtilitiesRegistration.Id);
        Assert.Equal("admin", ClientUtilitiesRegistration.Category);
        Assert.Equal("ClientUtilitiesSection", ClientUtilitiesRegistration.Slug);
        Assert.Equal("Client Utilities", ClientUtilitiesRegistration.Name(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(ClientUtilitiesRegistration.Description(Localizer)));
    }

    [Fact]
    public void Registration_labels_flow_through_localizer()
    {
        var prefix = new PrefixLocalizer();

        Assert.Equal("L:devtools.clientUtilities.title", ClientUtilitiesRegistration.Name(prefix));
        Assert.Equal("L:devtools.clientUtilities.description", ClientUtilitiesRegistration.Description(prefix));
    }

    // ---- View-model: ready / empty states ------------------------------------------

    [Fact]
    public void ViewModel_starts_ready_with_full_catalog()
    {
        var vm = NewViewModel();

        Assert.Equal(ClientUtilityToolState.Ready, vm.State);
        Assert.True(vm.HasResults);
        Assert.Equal(15, vm.Display.Cards.Count);
        Assert.Equal(15, vm.ToolCount);
        Assert.Null(vm.ExpandedId);
    }

    [Fact]
    public void ViewModel_search_filters_results()
    {
        var vm = NewViewModel();
        vm.SearchText = "color";

        Assert.Equal(ClientUtilityToolState.Ready, vm.State);
        Assert.Equal("color", Assert.Single(vm.Display.Cards).Id);
    }

    [Fact]
    public void ViewModel_search_with_no_match_is_empty()
    {
        var vm = NewViewModel();
        vm.SearchText = "no-such-tool-xyz";

        Assert.Equal(ClientUtilityToolState.Empty, vm.State);
        Assert.False(vm.HasResults);
        Assert.Empty(vm.Display.Cards);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    [Fact]
    public void ViewModel_search_raises_display_and_state()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SearchText = "no-such-tool-xyz";

        Assert.Contains(nameof(ClientUtilitiesViewModel.SearchText), raised);
        Assert.Contains(nameof(ClientUtilitiesViewModel.Display), raised);
        Assert.Contains(nameof(ClientUtilitiesViewModel.State), raised);
    }

    [Fact]
    public void ViewModel_search_to_same_value_is_a_noop()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.SearchText = string.Empty;

        Assert.Empty(raised);
    }

    [Fact]
    public void ViewModel_empty_source_is_empty_without_search()
    {
        var vm = NewViewModel(new EmptyToolSource());

        Assert.Equal(ClientUtilityToolState.Empty, vm.State);
        Assert.False(vm.HasResults);
    }

    [Fact]
    public void ViewModel_search_hint_and_title_are_localized()
    {
        var vm = NewViewModel();

        Assert.Equal("Search tools...", vm.SearchHint);
        Assert.Equal("No tools match your search", vm.EmptyMessage);
        Assert.Equal("Client Utilities", vm.Title);
    }

    // ---- View-model: single-open disclosure (web expandedId) -----------------------

    [Fact]
    public void ViewModel_toggle_expands_then_collapses()
    {
        var vm = NewViewModel();

        vm.ToggleExpand("vin");
        Assert.Equal("vin", vm.ExpandedId);
        Assert.True(vm.IsExpanded("vin"));

        vm.ToggleExpand("vin");
        Assert.Null(vm.ExpandedId);
        Assert.False(vm.IsExpanded("vin"));
    }

    [Fact]
    public void ViewModel_toggle_is_single_open()
    {
        var vm = NewViewModel();

        vm.ToggleExpand("vin");
        vm.ToggleExpand("jwt");

        Assert.Equal("jwt", vm.ExpandedId);
        Assert.False(vm.IsExpanded("vin"));
        Assert.True(vm.IsExpanded("jwt"));
    }

    [Fact]
    public void ViewModel_set_expanded_tracks_disclosure_events()
    {
        var vm = NewViewModel();

        vm.SetExpanded("vin", true);
        Assert.Equal("vin", vm.ExpandedId);

        vm.SetExpanded("jwt", true);
        Assert.Equal("jwt", vm.ExpandedId);

        // Collapsing a card that is not the open one is a no-op.
        vm.SetExpanded("vin", false);
        Assert.Equal("jwt", vm.ExpandedId);

        vm.SetExpanded("jwt", false);
        Assert.Null(vm.ExpandedId);
    }

    [Fact]
    public void ViewModel_expand_raises_expanded_id()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.ToggleExpand("vin");

        Assert.Contains(nameof(ClientUtilitiesViewModel.ExpandedId), raised);
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void ViewModel_toggle_rejects_empty_id(string? id)
    {
        var vm = NewViewModel();
        Assert.ThrowsAny<ArgumentException>(() => vm.ToggleExpand(id!));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ClientUtilitiesDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ClientUtilitiesSection", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new ClientUtilitiesDiagnostics();
        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();
        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Test doubles --------------------------------------------------------------

    private sealed class EmptyToolSource : IClientUtilityToolSource
    {
        public IReadOnlyList<ClientUtilityTool> GetTools() => Array.Empty<ClientUtilityTool>();
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
