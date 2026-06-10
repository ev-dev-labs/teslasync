using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AIFeatureToggleList</c> feature surface's UI-thread-free logic — the
/// generated AI feature registry (count / order / uniqueness vs the web <c>AI_FEATURE_IDS</c>), the projection
/// adapter (registry + controlled values + i18n facade → render rows), the i18n key resolution (passthrough
/// fallback to the registry name/description, and the resw <c>translation.*</c> catalog form including the
/// "Helix" rebrand), the controlled <c>Boolean(values[id])</c> state mapping, the composed Narrator name, the
/// populated and empty content states, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/AIFeatureToggleList.tsx). AIFeatureToggleList is a controlled,
/// presentational surface: the web source has no data source and no loading / error / stale / offline branches,
/// so the reproduced content states are populated-content and empty-content — both keep the legend rendered
/// (never a blank box). The WinUI view itself (AIFeatureToggleList.cs) is exercised by the app build.
/// </summary>
public sealed class AIFeatureToggleListTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    // ── Registry: the native mirror of the web AI_FEATURES / AI_FEATURE_IDS registry ────────────────────

    [Fact]
    public void Registry_has_every_web_feature_in_order()
    {
        Assert.Equal(57, AiFeatureRegistry.Features.Count);
        Assert.Equal(57, AiFeatureRegistry.FeatureIds.Count);
        Assert.Equal("__redaction_bypass__", AiFeatureRegistry.Features[0].Id);
        Assert.Equal("yir-narration", AiFeatureRegistry.Features[^1].Id);

        // FeatureIds is the projection of Features.Id, in declaration order.
        Assert.Equal(AiFeatureRegistry.Features.Select(f => f.Id), AiFeatureRegistry.FeatureIds);
    }

    [Fact]
    public void Registry_ids_are_unique_and_non_empty()
    {
        Assert.Equal(AiFeatureRegistry.FeatureIds.Count, AiFeatureRegistry.FeatureIds.Distinct().Count());
        Assert.All(AiFeatureRegistry.Features, f =>
        {
            Assert.False(string.IsNullOrWhiteSpace(f.Id));
            Assert.False(string.IsNullOrWhiteSpace(f.Name));
            Assert.False(string.IsNullOrWhiteSpace(f.Description));
        });
    }

    [Fact]
    public void Registry_find_and_isKnown_resolve_real_features_only()
    {
        var meta = AiFeatureRegistry.Find("ai-provider-health");
        Assert.NotNull(meta);
        Assert.Equal("AI Provider Health (ops)", meta!.Name);
        Assert.StartsWith("Diagnostic endpoint that reports the active AI provider", meta.Description);

        Assert.True(AiFeatureRegistry.IsKnown("chatbot-llm"));
        Assert.False(AiFeatureRegistry.IsKnown("not-a-feature"));
        Assert.Null(AiFeatureRegistry.Find("not-a-feature"));
    }

    // ── Projection adapter: registry + values + i18n → render rows ───────────────────────────────────────

    [Fact]
    public void Project_renders_one_row_per_feature_in_registry_order()
    {
        var display = AIFeatureToggleListProjection.Project(Passthrough, values: null);

        Assert.True(display.HasRows);
        Assert.Equal(AiFeatureRegistry.FeatureIds, display.Rows.Select(r => r.Id));
    }

    [Fact]
    public void Project_falls_back_to_registry_name_and_description_when_untranslated()
    {
        // PassthroughLocalizer returns the English fallback — the web `t(key, meta.name|meta.description)`
        // contract, so every row is self-describing even before a translation lands.
        var display = AIFeatureToggleListProjection.Project(Passthrough, values: null);

        Assert.All(display.Rows, row =>
        {
            var meta = AiFeatureRegistry.Find(row.Id)!;
            Assert.Equal(meta.Name, row.Label);
            Assert.Equal(meta.Description, row.Description);
        });
    }

    [Fact]
    public void Project_reads_controlled_values_per_feature()
    {
        var values = new Dictionary<string, bool>
        {
            ["chatbot-llm"] = true,
            ["voice-mode"] = false,
        };

        var display = AIFeatureToggleListProjection.Project(Passthrough, values);

        Assert.True(Row(display, "chatbot-llm").IsOn);     // explicit true
        Assert.False(Row(display, "voice-mode").IsOn);     // explicit false
        Assert.False(Row(display, "rag-help").IsOn);       // absent -> Boolean(undefined) === false
    }

    [Fact]
    public void Project_null_values_default_every_toggle_off()
    {
        var display = AIFeatureToggleListProjection.Project(Passthrough, values: null);

        Assert.All(display.Rows, row => Assert.False(row.IsOn));
    }

    [Fact]
    public void Project_feeds_the_exact_catalog_keys_and_prefers_their_values()
    {
        // Production resolves the catalog's translation.* keys; the projection must feed those exact keys, so
        // the rebranded catalog copy ("Helix ...") wins over the registry fallback ("AI ...").
        var health = AiFeatureRegistry.Find("ai-provider-health")!;
        var display = AIFeatureToggleListProjection.Project(new[] { health }, new ReswLocalizer(), values: null);

        var row = Assert.Single(display.Rows);
        Assert.Equal("Helix provider health (ops)", row.Label);
        Assert.Equal(
            "Diagnostic endpoint that reports the active Helix provider and its capabilities. Off by default; enable only for ops debugging.",
            row.Description);
        Assert.NotEqual(health.Name, row.Label); // proves the catalog key was fed, not the fallback
    }

    [Fact]
    public void Project_legend_resolves_through_key_then_fallback()
    {
        Assert.Equal(
            "Per-feature opt-in (all default off)",
            AIFeatureToggleListProjection.Project(Passthrough, values: null).Legend);

        Assert.Equal(
            "Per-feature opt-in (all default off)",
            AIFeatureToggleListProjection.Project(new ReswLocalizer(), values: null).Legend);
    }

    // ── Content states (web has no data states; these are the real branches) ─────────────────────────────

    [Fact]
    public void Project_populated_state_keeps_legend_and_rows()
    {
        var display = AIFeatureToggleListProjection.Project(Passthrough, values: null);

        Assert.True(display.HasRows);
        Assert.Equal(57, display.Rows.Count);
        Assert.Equal("Per-feature opt-in (all default off)", display.Legend);
    }

    [Fact]
    public void Project_empty_feature_set_yields_empty_branch_with_legend_intact()
    {
        // Defensive "never a blank box" branch: an empty feature set still resolves the legend; the view
        // renders the friendly empty surface instead of a collapsed region.
        var display = AIFeatureToggleListProjection.Project(Array.Empty<AiFeatureMeta>(), Passthrough, values: null);

        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
        Assert.Equal("Per-feature opt-in (all default off)", display.Legend);
        Assert.Equal("No AI features are available.", AIFeatureToggleListRegistration.EmptyMessage(Passthrough));
    }

    // ── Accessibility: every toggle carries the feature label as its Narrator name (web aria-label) ───────

    [Fact]
    public void Row_automation_name_equals_label()
    {
        var display = AIFeatureToggleListProjection.Project(Passthrough, values: null);

        Assert.All(display.Rows, row => Assert.Equal(row.Label, row.AutomationName));
    }

    [Fact]
    public void Row_with_empty_description_collapses_but_label_still_renders()
    {
        var features = new[] { new AiFeatureMeta("synthetic", "Synthetic label", string.Empty) };

        var row = Assert.Single(AIFeatureToggleListProjection.Project(features, Passthrough, values: null).Rows);

        Assert.Equal("Synthetic label", row.Label);
        Assert.False(row.HasDescription);
        Assert.Equal(string.Empty, row.Description);
    }

    // ── i18n key format (must match the resw catalog names) ──────────────────────────────────────────────

    [Fact]
    public void I18n_keys_match_the_catalog_translation_names()
    {
        Assert.Equal("translation.ai.settings.feature.legend", AIFeatureToggleListRegistration.LegendKey);
        Assert.Equal(
            "translation.ai.settings.feature.ai-provider-health.label",
            AIFeatureToggleListRegistration.LabelKey("ai-provider-health"));
        Assert.Equal(
            "translation.ai.settings.feature.ai-provider-health.description",
            AIFeatureToggleListRegistration.DescriptionKey("ai-provider-health"));
    }

    // ── Diagnostics (view.opened, PII-safe) ──────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIFeatureToggleListDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIFeatureToggleList", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_each_open_and_tolerates_a_null_sink()
    {
        var diagnostics = new AIFeatureToggleListDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("AIFeatureToggleList", AIFeatureToggleListRegistration.Slug);
    }

    private static AiFeatureToggleRow Row(AIFeatureTogglePanelDisplay display, string id) =>
        display.Rows.Single(r => r.Id == id);

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves this surface's <c>translation.*</c> keys to the
    /// <c>Strings/{lang}/Resources.resw</c> English catalog values (as production does — including the
    /// "Helix" rebrand of the AI feature copy), and the English fallback for every other key. Proves the
    /// projection feeds the exact catalog keys.
    /// </summary>
    private sealed class ReswLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            AIFeatureToggleListRegistration.LegendKey => "Per-feature opt-in (all default off)",
            "translation.ai.settings.feature.ai-provider-health.label" => "Helix provider health (ops)",
            "translation.ai.settings.feature.ai-provider-health.description" =>
                "Diagnostic endpoint that reports the active Helix provider and its capabilities. Off by default; enable only for ops debugging.",
            _ => fallback,
        };
    }
}
