using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Settings;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AIRestorePanel</c> feature surface's UI-thread-free logic — the preview-label
/// adapter (the web <c>previewLabels</c> helper: enabled-only filtering, registry-name fallback for known
/// features, raw id for unknown ones, order preservation), the i18n key resolution (passthrough fallback to the
/// web default literals, and the <c>translation.*</c> catalog form), the per-state projection snapshot, the
/// composed alert-region Narrator name, and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/AIRestorePanel.tsx). AIRestorePanel is a controlled, presentational
/// surface: the web source has no data source and no loading / error / stale / offline branches, so the
/// reproduced content states are populated (with the archived preview list) and empty (no list) — both keep the
/// prompt title, description and affordances rendered (never a blank box). The WinUI view itself
/// (AIRestorePanel.cs) is exercised by the app build.
/// </summary>
public sealed class AIRestorePanelTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    private static AIRestorePanelDisplay Project(AIRestorePanelModel model, ILocalizer? localizer = null) =>
        AIRestorePanelProjection.Project(model, localizer ?? Passthrough);

    private static AIRestorePanelModel ModelOf(params (string Id, bool Enabled)[] entries)
    {
        var map = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var (id, enabled) in entries)
        {
            map[id] = enabled;
        }

        return new AIRestorePanelModel(map);
    }

    // ── Preview-label adapter: the web previewLabels(archived, translate) helper ──────────────────────────

    [Fact]
    public void PreviewLabels_skips_disabled_entries_and_preserves_order()
    {
        var labels = AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool>(StringComparer.Ordinal)
            {
                ["chatbot-llm"] = true,
                ["voice-mode"] = false, // disabled -> skipped (web `if (!value) continue`)
                ["rag-help"] = true,
            },
            Passthrough);

        // Registry-name fallback (PassthroughLocalizer), enabled-only, in insertion order.
        Assert.Equal(new[] { "LLM Chatbot", "RAG-backed app help" }, labels);
    }

    [Fact]
    public void PreviewLabels_known_feature_falls_back_to_registry_name_when_untranslated()
    {
        var labels = AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool> { ["ai-provider-health"] = true }, Passthrough);

        Assert.Equal("AI Provider Health (ops)", Assert.Single(labels));
    }

    [Fact]
    public void PreviewLabels_unknown_id_renders_raw_so_the_listing_is_never_blank()
    {
        var labels = AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool> { ["not-a-feature"] = true }, Passthrough);

        Assert.Equal("not-a-feature", Assert.Single(labels));
    }

    [Fact]
    public void PreviewLabels_empty_or_all_disabled_yields_no_labels()
    {
        Assert.Empty(AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool>(), Passthrough));
        Assert.Empty(AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool> { ["chatbot-llm"] = false, ["rag-help"] = false }, Passthrough));
    }

    [Fact]
    public void PreviewLabels_feeds_the_exact_catalog_key_and_prefers_its_value()
    {
        // Production resolves the catalog's translation.* key; the adapter must feed that exact key, so the
        // catalog copy wins over the registry name fallback.
        var labels = AIRestorePanelProjection.PreviewLabels(
            new Dictionary<string, bool> { ["chatbot-llm"] = true }, new CatalogLocalizer());

        var label = Assert.Single(labels);
        Assert.Equal("Helix Chatbot", label);
        Assert.NotEqual("LLM Chatbot", label); // proves the catalog key was fed, not the registry fallback
    }

    [Fact]
    public void PreviewLabels_rejects_null_arguments()
    {
        Assert.Throws<ArgumentNullException>(() =>
            AIRestorePanelProjection.PreviewLabels(null!, Passthrough));
        Assert.Throws<ArgumentNullException>(() =>
            AIRestorePanelProjection.PreviewLabels(new Dictionary<string, bool>(), null!));
    }

    // ── Model factory ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Model_For_collapses_null_and_empty_to_the_shared_empty_model()
    {
        Assert.Same(AIRestorePanelModel.Empty, AIRestorePanelModel.For(null));
        Assert.Same(AIRestorePanelModel.Empty, AIRestorePanelModel.For(new Dictionary<string, bool>()));
    }

    [Fact]
    public void Model_For_wraps_a_populated_snapshot()
    {
        var archived = new Dictionary<string, bool> { ["chatbot-llm"] = true };

        Assert.Same(archived, AIRestorePanelModel.For(archived).Archived);
    }

    // ── Per-state projection snapshot (web has no data states; these are the real branches) ───────────────

    [Fact]
    public void Populated_state_renders_prompt_and_preview_list()
    {
        var display = Project(ModelOf(("chatbot-llm", true), ("rag-help", true)));

        Assert.Equal(AIRestorePanelState.Populated, display.State);
        Assert.True(display.HasLabels);
        Assert.Equal(new[] { "LLM Chatbot", "RAG-backed app help" }, display.Labels);

        // The prompt + affordances always render — the web default literals via PassthroughLocalizer.
        Assert.Equal("Restore previous Helix selection?", display.Title);
        Assert.Equal("You previously had these features enabled. Re-enable them now?", display.Description);
        Assert.Equal("No thanks", display.DeclineLabel);
        Assert.Equal("Restore selection", display.RestoreLabel);
    }

    [Fact]
    public void Empty_state_keeps_the_prompt_but_drops_the_preview_list()
    {
        var display = Project(AIRestorePanelModel.Empty);

        Assert.Equal(AIRestorePanelState.Empty, display.State);
        Assert.False(display.HasLabels);
        Assert.Empty(display.Labels);

        // Never a blank box: title, description and both affordances still render.
        Assert.Equal("Restore previous Helix selection?", display.Title);
        Assert.Equal("You previously had these features enabled. Re-enable them now?", display.Description);
        Assert.Equal("No thanks", display.DeclineLabel);
        Assert.Equal("Restore selection", display.RestoreLabel);
    }

    [Fact]
    public void All_disabled_snapshot_is_the_empty_state()
    {
        var display = Project(ModelOf(("chatbot-llm", false), ("rag-help", false)));

        Assert.Equal(AIRestorePanelState.Empty, display.State);
        Assert.False(display.HasLabels);
    }

    [Fact]
    public void Projection_feeds_the_exact_prompt_catalog_keys_and_prefers_their_values()
    {
        var display = Project(ModelOf(("chatbot-llm", true)), new CatalogLocalizer());

        Assert.Equal("Catalog archive title", display.Title);
        Assert.Equal("Catalog archive description", display.Description);
        Assert.Equal("Catalog decline", display.DeclineLabel);
        Assert.Equal("Catalog restore", display.RestoreLabel);
        Assert.Equal("Helix Chatbot", Assert.Single(display.Labels));
    }

    // ── Accessibility: the alert region exposes the whole prompt as its Narrator name ─────────────────────

    [Fact]
    public void Every_state_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(AIRestorePanelModel.Empty),
                Project(ModelOf(("chatbot-llm", true), ("rag-help", true))),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    [Fact]
    public void Populated_automation_name_carries_title_description_and_joined_labels()
    {
        var display = Project(ModelOf(("chatbot-llm", true), ("rag-help", true)));

        Assert.Equal(
            "Restore previous Helix selection?. You previously had these features enabled. Re-enable them now?. LLM Chatbot, RAG-backed app help",
            display.AutomationName);
    }

    [Fact]
    public void Empty_automation_name_carries_only_title_and_description()
    {
        var display = Project(AIRestorePanelModel.Empty);

        Assert.Equal(
            "Restore previous Helix selection?. You previously had these features enabled. Re-enable them now?",
            display.AutomationName);
    }

    // ── i18n key format (must match the resw catalog names + the sibling surface) ─────────────────────────

    [Fact]
    public void I18n_keys_match_the_catalog_translation_names()
    {
        Assert.Equal("translation.ai.settings.archive.title", AIRestorePanelRegistration.TitleKey);
        Assert.Equal("translation.ai.settings.archive.description", AIRestorePanelRegistration.DescriptionKey);
        Assert.Equal("translation.ai.settings.archive.restore", AIRestorePanelRegistration.RestoreKey);
        Assert.Equal("translation.ai.settings.archive.decline", AIRestorePanelRegistration.DeclineKey);
        Assert.Equal(
            "translation.ai.settings.feature.chatbot-llm.label",
            AIRestorePanelRegistration.LabelKey("chatbot-llm"));
    }

    [Fact]
    public void Per_feature_label_key_matches_the_sibling_AIFeatureToggleList_surface()
    {
        // Both AI-settings surfaces share the same catalog key, so a single entry serves both — assert non-drift.
        foreach (var id in new[] { "chatbot-llm", "voice-mode", "ai-provider-health" })
        {
            Assert.Equal(
                AIFeatureToggleListRegistration.LabelKey(id),
                AIRestorePanelRegistration.LabelKey(id));
        }
    }

    [Fact]
    public void Default_fallbacks_match_the_web_literals()
    {
        Assert.Equal("Restore previous Helix selection?", AIRestorePanelRegistration.TitleFallback);
        Assert.Equal(
            "You previously had these features enabled. Re-enable them now?",
            AIRestorePanelRegistration.DescriptionFallback);
        Assert.Equal("Restore selection", AIRestorePanelRegistration.RestoreFallback);
        Assert.Equal("No thanks", AIRestorePanelRegistration.DeclineFallback);
    }

    // ── Diagnostics (P1/S11): view.opened slug=AIRestorePanel, PII-safe ───────────────────────────────────

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AIRestorePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AIRestorePanel", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_archived_feature_ids()
    {
        var lines = new List<string>();
        var diagnostics = new AIRestorePanelDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(lines);
        Assert.Equal("view.opened slug=AIRestorePanel", line);
        Assert.DoesNotContain("chatbot-llm", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Helix", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_counts_each_open_and_tolerates_a_null_sink()
    {
        var diagnostics = new AIRestorePanelDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal("AIRestorePanel", AIRestorePanelRegistration.Slug);
    }

    [Fact]
    public void Registration_exposes_a_sparkle_glyph() =>
        Assert.False(string.IsNullOrEmpty(AIRestorePanelRegistration.SparkleGlyph));

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => AIRestorePanelProjection.Project(null!, Passthrough));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => AIRestorePanelProjection.Project(AIRestorePanelModel.Empty, null!));

    /// <summary>
    /// An <see cref="ILocalizer"/> that resolves this surface's <c>translation.*</c> keys to distinct catalog
    /// values (proving the projection feeds the exact keys rather than the English fallback) and the fallback for
    /// every other key.
    /// </summary>
    private sealed class CatalogLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key switch
        {
            AIRestorePanelRegistration.TitleKey => "Catalog archive title",
            AIRestorePanelRegistration.DescriptionKey => "Catalog archive description",
            AIRestorePanelRegistration.RestoreKey => "Catalog restore",
            AIRestorePanelRegistration.DeclineKey => "Catalog decline",
            "translation.ai.settings.feature.chatbot-llm.label" => "Helix Chatbot",
            _ => fallback,
        };
    }
}
