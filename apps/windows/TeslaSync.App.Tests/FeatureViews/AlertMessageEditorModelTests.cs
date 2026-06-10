using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the AlertMessageEditor's UI-thread-free model logic — the JSON parse
/// adapters, the template key/scan/insert helpers, the token-catalog and preset-gallery projections, the
/// cache-then-network result mappers, the preview request builder, the registration metadata, the
/// diagnostics and the i18n facade. Mirrors the web spec
/// (web/src/features/notifications/components/AlertMessageEditor.tsx).
/// </summary>
public sealed class AlertMessageEditorModelTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 6, 12, 0, 0, TimeSpan.Zero);

    // ---- Template key extraction (port of extractTemplateKeys) ----------------------

    [Fact]
    public void ExtractKeys_reads_double_brace_tokens_in_order()
    {
        var keys = TemplateLogic.ExtractKeys("Battery {{BatteryLevel}} and {{ Speed }} at {{Odometer_1}}");

        Assert.Equal(new[] { "BatteryLevel", "Speed", "Odometer_1" }, keys);
    }

    [Theory]
    [InlineData("")]
    [InlineData("no tokens here")]
    [InlineData("{{1bad}} {{-bad}}")]
    public void ExtractKeys_ignores_text_without_valid_tokens(string template) =>
        Assert.Empty(TemplateLogic.ExtractKeys(template));

    // ---- Autocomplete trigger scan (port of handleTextareaChange) -------------------

    [Fact]
    public void Scan_opens_inside_unclosed_brace_expression()
    {
        const string text = "Battery {{Bat";
        var hit = TemplateLogic.Scan(text, text.Length);

        Assert.True(hit.Open);
        Assert.Equal(8, hit.TriggerIndex);
        Assert.Equal("Bat", hit.Filter);
    }

    [Fact]
    public void Scan_closes_after_braces_are_closed()
    {
        const string text = "Battery {{BatteryLevel}} ";
        Assert.False(TemplateLogic.Scan(text, text.Length).Open);
    }

    [Fact]
    public void Scan_closes_when_partial_contains_whitespace()
    {
        const string text = "Battery {{Bat ";
        Assert.False(TemplateLogic.Scan(text, text.Length).Open);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void Scan_closed_at_or_before_start(int caret) =>
        Assert.False(TemplateLogic.Scan("text", caret).Open);

    // ---- Token insertion (port of insertPlaceholder) --------------------------------

    [Fact]
    public void InsertToken_splices_canonical_form_and_reports_caret()
    {
        const string template = "Hi {{Bat";
        var result = TemplateLogic.InsertToken(template, 3, template.Length, "BatteryLevel");

        Assert.Equal("Hi {{BatteryLevel}}", result.Text);
        Assert.Equal(result.Text.Length, result.Caret);
    }

    [Fact]
    public void InsertToken_preserves_trailing_text_after_caret()
    {
        const string template = "{{Ba more";
        var result = TemplateLogic.InsertToken(template, 0, 4, "Battery");

        Assert.Equal("{{Battery}} more", result.Text);
        Assert.Equal("{{Battery}}".Length, result.Caret);
    }

    // ---- Token catalog filter + group (port of filteredPlaceholders + grouped) -------

    [Fact]
    public void Filter_matches_key_or_label_case_insensitively()
    {
        var tokens = new[]
        {
            Token("BatteryLevel", "Battery level", "Battery"),
            Token("Speed", "Vehicle speed", "Driving"),
        };

        Assert.Single(TokenCatalog.Filter(tokens, "batt"));
        Assert.Single(TokenCatalog.Filter(tokens, "vehicle"));
        Assert.Equal(2, TokenCatalog.Filter(tokens, "").Count);
    }

    [Fact]
    public void Group_preserves_first_seen_group_order()
    {
        var tokens = new[]
        {
            Token("BatteryLevel", "Battery level", "Battery"),
            Token("Speed", "Vehicle speed", "Driving"),
            Token("RatedRange", "Rated range", "Battery"),
        };

        var groups = TokenCatalog.Group(tokens);

        Assert.Equal(2, groups.Count);
        Assert.Equal("Battery", groups[0].Group);
        Assert.Equal(2, groups[0].Tokens.Count);
        Assert.Equal("Driving", groups[1].Group);
    }

    // ---- Preset gallery (port of opValidPresets / presetTags / filteredPresets) ------

    [Fact]
    public void OpValid_hides_presets_referencing_unavailable_tokens_when_op_known()
    {
        var presets = new[]
        {
            Preset("a", "Battery", "Low: {{BatteryLevel}}"),
            Preset("b", "Range", "Range: {{Min}}-{{Max}}"),
        };
        IReadOnlySet<string> keys = new HashSet<string>(StringComparer.Ordinal) { "BatteryLevel" };

        var valid = PresetGallery.OpValid(presets, keys, op: "<", tokensLoading: false);

        Assert.Single(valid);
        Assert.Equal("a", valid[0].Id);
    }

    [Fact]
    public void OpValid_degrades_to_all_when_op_missing_or_loading_or_no_keys()
    {
        var presets = new[] { Preset("a", "A", "{{X}}"), Preset("b", "B", "{{Y}}") };
        IReadOnlySet<string> empty = new HashSet<string>(StringComparer.Ordinal);
        IReadOnlySet<string> keys = new HashSet<string>(StringComparer.Ordinal) { "X" };

        Assert.Equal(2, PresetGallery.OpValid(presets, keys, op: null, tokensLoading: false).Count);
        Assert.Equal(2, PresetGallery.OpValid(presets, keys, op: "<", tokensLoading: true).Count);
        Assert.Equal(2, PresetGallery.OpValid(presets, empty, op: "<", tokensLoading: false).Count);
    }

    [Fact]
    public void Tags_are_sorted_and_deduplicated()
    {
        var presets = new[]
        {
            Preset("a", "A", "{{X}}", "battery", "charging"),
            Preset("b", "B", "{{Y}}", "charging"),
        };

        Assert.Equal(new[] { "battery", "charging" }, PresetGallery.Tags(presets));
    }

    [Fact]
    public void FilterByTag_filters_or_passes_through_for_null()
    {
        var presets = new[]
        {
            Preset("a", "A", "{{X}}", "battery"),
            Preset("b", "B", "{{Y}}", "charging"),
        };

        Assert.Equal(2, PresetGallery.FilterByTag(presets, null).Count);
        Assert.Single(PresetGallery.FilterByTag(presets, "battery"));
    }

    // ---- JSON parse adapters (snake_case, null-tolerant) ----------------------------

    [Fact]
    public void Token_parse_reads_snake_case_and_tolerates_missing_fields()
    {
        const string json = """
        [{"key":"BatteryLevel","label":"Battery level","description":"State of charge","group":"Battery","example":"82"},
         {"key":"Speed"}]
        """;
        using var doc = JsonDocument.Parse(json);

        var tokens = MessageToken.ParseList(doc.RootElement);

        Assert.Equal(2, tokens.Count);
        Assert.Equal("BatteryLevel", tokens[0].Key);
        Assert.Equal("Battery level", tokens[0].Label);
        Assert.Equal("Battery", tokens[0].Group);
        Assert.Equal("Speed", tokens[1].Label); // falls back to key when label absent
        Assert.Equal("{{BatteryLevel}}", tokens[0].InsertText);
    }

    [Fact]
    public void Preset_parse_reads_tags_array()
    {
        const string json = """
        [{"id":"low-batt","name":"Low battery","description":"warn","template":"{{BatteryLevel}}","kind":"signal","tags":["battery","charging"]}]
        """;
        using var doc = JsonDocument.Parse(json);

        var preset = Assert.Single(MessagePreset.ParseList(doc.RootElement));

        Assert.Equal("low-batt", preset.Id);
        Assert.Equal("Low battery", preset.Name);
        Assert.Equal(new[] { "battery", "charging" }, preset.Tags);
    }

    [Fact]
    public void Preview_result_parse_reads_title_and_body()
    {
        using var doc = JsonDocument.Parse("""{"title":"Battery low","body":"Battery at 10%"}""");

        var preview = MessagePreviewResult.FromJson(doc.RootElement);

        Assert.Equal("Battery low", preview.Title);
        Assert.Equal("Battery at 10%", preview.Body);
    }

    [Fact]
    public void Parse_returns_empty_for_non_array()
    {
        using var doc = JsonDocument.Parse("{}");
        Assert.Empty(MessageToken.ParseList(doc.RootElement));
        Assert.Empty(MessagePreset.ParseList(doc.RootElement));
    }

    // ---- Preview request builder (port of the preview body) -------------------------

    [Fact]
    public void Preview_request_maps_draft_and_nulls_blank_template()
    {
        var draft = new AlertRuleDraft { Kind = "signal", SignalName = "BatteryLevel", Op = "<", Severity = "warn", ValueNum = 20 };

        var blank = MessagePreviewRequest.From(draft, "   ", includeTitle: true);
        var filled = MessagePreviewRequest.From(draft, "Battery {{BatteryLevel}}", includeTitle: false);

        Assert.Null(blank.MsgTemplate);
        Assert.True(blank.IncludeTitle);
        Assert.Equal("BatteryLevel", blank.SignalName);
        Assert.Equal(20, blank.ValueNum);
        Assert.Equal("Battery {{BatteryLevel}}", filled.MsgTemplate);
        Assert.False(filled.IncludeTitle);
    }

    [Fact]
    public void Preview_request_serializes_snake_case()
    {
        var request = MessagePreviewRequest.From(
            new AlertRuleDraft { SignalName = "BatteryLevel", ValueNum = 20 },
            "Body",
            includeTitle: true);

        string json = JsonSerializer.Serialize(request, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Contains("\"signal_name\":\"BatteryLevel\"", json, StringComparison.Ordinal);
        Assert.Contains("\"value_num\":20", json, StringComparison.Ordinal);
        Assert.Contains("\"msg_template\":\"Body\"", json, StringComparison.Ordinal);
        Assert.Contains("\"include_title\":true", json, StringComparison.Ordinal);
    }

    [Fact]
    public void Preview_request_debounce_key_changes_with_inputs()
    {
        var draft = new AlertRuleDraft { Op = "<" };
        string a = MessagePreviewRequest.From(draft, "X", true).DebounceKey();
        string b = MessagePreviewRequest.From(draft, "X", false).DebounceKey();
        string c = MessagePreviewRequest.From(draft, "Y", true).DebounceKey();

        Assert.NotEqual(a, b);
        Assert.NotEqual(a, c);
        Assert.Equal(a, MessagePreviewRequest.From(draft, "X", true).DebounceKey());
    }

    // ---- Result mappers (cache-then-network preservation) ---------------------------

    [Fact]
    public void Token_mapper_preserves_status_and_parses_payload()
    {
        using var doc = JsonDocument.Parse("""[{"key":"BatteryLevel","group":"Battery"}]""");

        var cached = MessageTokenResultMapper.Map(RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        var offline = MessageTokenResultMapper.Map(RepositoryResult<JsonElement>.OfflineCached(
            doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
    }

    [Fact]
    public void Mappers_collapse_loaded_empty_array_to_empty()
    {
        using var doc = JsonDocument.Parse("[]");
        Assert.Equal(LoadStatus.Empty, MessageTokenResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
        Assert.Equal(LoadStatus.Empty, MessagePresetResultMapper.Map(RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now)).Status);
    }

    [Fact]
    public void Mappers_map_failure()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom");
        Assert.Equal(LoadStatus.Error, MessageTokenResultMapper.Map(RepositoryResult<JsonElement>.Failure(error)).Status);
        Assert.Equal(LoadStatus.Error, MessagePresetResultMapper.Map(RepositoryResult<JsonElement>.Failure(error)).Status);
    }

    // ---- Accessibility names --------------------------------------------------------

    [Fact]
    public void Token_automation_name_combines_insertion_and_label()
    {
        var name = Token("BatteryLevel", "Battery level", "Battery").AutomationName;

        Assert.Contains("{{BatteryLevel}}", name, StringComparison.Ordinal);
        Assert.Contains("Battery level", name, StringComparison.Ordinal);
    }

    [Fact]
    public void Preset_automation_name_combines_name_and_description()
    {
        var name = Preset("a", "Low battery", "{{X}}").AutomationName;
        Assert.Contains("Low battery", name, StringComparison.Ordinal);
    }

    // ---- Registration + diagnostics -------------------------------------------------

    [Fact]
    public void Registration_carries_canonical_slug()
    {
        Assert.Equal("AlertMessageEditor", AlertMessageEditorRegistration.Slug);
        Assert.Equal("alert-message-editor", AlertMessageEditorRegistration.Id);
        Assert.Equal("notifications", AlertMessageEditorRegistration.Category);
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AlertMessageEditorDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AlertMessageEditor", Assert.Single(lines));
    }

    // ---- i18n facade ----------------------------------------------------------------

    [Fact]
    public void Text_resolves_every_surface_string_through_the_localizer()
    {
        Assert.Equal("Include title in notifications", AlertMessageEditorText.IncludeTitleLabel(Localizer));
        Assert.Equal("Message Template", AlertMessageEditorText.MessageTemplateLabel(Localizer));
        Assert.Equal("Pick a preset", AlertMessageEditorText.PresetButton(Localizer));
        Assert.Equal("Preview", AlertMessageEditorText.PreviewLabel(Localizer));
        Assert.Equal("Start typing to see a preview", AlertMessageEditorText.PreviewEmpty(Localizer));
        Assert.Equal("Message Presets", AlertMessageEditorText.PresetModalTitle(Localizer));
        Assert.Equal("All", AlertMessageEditorText.PresetAllTag(Localizer));
        Assert.Equal("No presets match this filter", AlertMessageEditorText.PresetEmpty(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(AlertMessageEditorText.AutocompleteEmpty(Localizer)));
        Assert.False(string.IsNullOrWhiteSpace(AlertMessageEditorText.MessageTemplateHint(Localizer)));
    }

    // ---- Helpers --------------------------------------------------------------------

    private static MessageToken Token(string key, string label, string group) =>
        new(key, label, Description: null, group, Example: null);

    private static MessagePreset Preset(string id, string name, string template, params string[] tags) =>
        new(id, name, Description: "desc", template, Kind: "signal", tags);
}
