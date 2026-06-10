using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SettingField</c> feature surface's UI-thread-free logic — the label
/// upper-casing and natural-cased accessible name, the help-text resolution (i18n key with content fallback,
/// or plain content), the empty-text suppression of the inline help affordance, the affordance's accessible
/// name ("Help for {id}" / "More info"), and the PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/settings/components/SettingField.tsx and its composed
/// web/src/components/ui/HelpIcon.tsx). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class SettingFieldTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static SettingFieldDisplay Project(SettingFieldModel model) =>
        SettingFieldProjection.Project(model, Localizer);

    private static SettingFieldDisplay Project(SettingFieldModel model, ILocalizer localizer) =>
        SettingFieldProjection.Project(model, localizer);

    // ── Label: shown upper-cased, spoken in natural casing ───────────────────────────────────────────────

    [Fact]
    public void Label_is_passed_through_verbatim_for_the_accessible_name() =>
        Assert.Equal("My Time Zone Override", Project(new SettingFieldModel("My Time Zone Override")).Label);

    [Fact]
    public void Display_label_is_upper_cased_like_the_web_uppercase_class() =>
        Assert.Equal("MY TIME ZONE OVERRIDE", Project(new SettingFieldModel("My Time Zone Override")).DisplayLabel);

    [Fact]
    public void Empty_label_projects_to_empty_strings()
    {
        var display = Project(SettingFieldModel.Unlabeled);

        Assert.Equal(string.Empty, display.Label);
        Assert.Equal(string.Empty, display.DisplayLabel);
    }

    // ── Help absent ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void No_help_descriptor_suppresses_the_affordance()
    {
        var display = Project(new SettingFieldModel("Gas Price"));

        Assert.False(display.HasHelp);
        Assert.Equal(string.Empty, display.HelpText);
        Assert.Equal(string.Empty, display.HelpAccessibleName);
    }

    // ── Help text resolution (web: i18nKey ? t(i18nKey, {defaultValue: content}) : content) ───────────────

    [Fact]
    public void Help_with_plain_content_resolves_that_content()
    {
        var display = Project(new SettingFieldModel(
            "Electricity Cost",
            new SettingFieldHelp(Content: "Cost per kWh used to compute charging spend.")));

        Assert.True(display.HasHelp);
        Assert.Equal("Cost per kWh used to compute charging spend.", display.HelpText);
    }

    [Fact]
    public void Help_with_i18n_key_resolves_the_translation_over_the_content_fallback()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>
        {
            ["help.fields.settings.electricityCost"] = "Translated electricity-cost help.",
        });

        var display = Project(
            new SettingFieldModel(
                "Electricity Cost",
                new SettingFieldHelp(
                    I18nKey: "help.fields.settings.electricityCost",
                    Content: "English fallback help.")),
            localizer);

        Assert.True(display.HasHelp);
        Assert.Equal("Translated electricity-cost help.", display.HelpText);
    }

    [Fact]
    public void Help_with_i18n_key_falls_back_to_content_when_the_key_is_missing()
    {
        // PassthroughLocalizer always returns the supplied fallback, standing in for an unresolved key.
        var display = Project(new SettingFieldModel(
            "Electricity Cost",
            new SettingFieldHelp(I18nKey: "missing.key", Content: "English fallback help.")));

        Assert.True(display.HasHelp);
        Assert.Equal("English fallback help.", display.HelpText);
    }

    [Fact]
    public void Help_with_an_empty_resolved_text_suppresses_the_affordance()
    {
        // A descriptor whose key resolves to empty and which carries no content has nothing to show — the web
        // icon returns null in that case.
        var display = Project(new SettingFieldModel(
            "Electricity Cost",
            new SettingFieldHelp(I18nKey: "missing.key")));

        Assert.False(display.HasHelp);
        Assert.Equal(string.Empty, display.HelpText);
        Assert.Equal(string.Empty, display.HelpAccessibleName);
    }

    [Fact]
    public void Whitespace_help_text_still_renders_the_affordance()
    {
        // The web gate is `if (!text) return null` — a whitespace string is truthy, so the icon renders.
        var display = Project(new SettingFieldModel("Field", new SettingFieldHelp(Content: " ")));

        Assert.True(display.HasHelp);
        Assert.Equal(" ", display.HelpText);
    }

    // ── Affordance accessible name (web aria-label) ──────────────────────────────────────────────────────

    [Fact]
    public void Help_for_a_field_id_names_the_affordance_help_for_that_id()
    {
        var display = Project(new SettingFieldModel(
            "Electricity Cost",
            new SettingFieldHelp(Content: "x", For: "electricity-cost")));

        Assert.Equal("Help for electricity-cost", display.HelpAccessibleName);
    }

    [Fact]
    public void Help_without_a_field_id_uses_the_generic_more_info_name()
    {
        var display = Project(new SettingFieldModel("Field", new SettingFieldHelp(Content: "x")));

        Assert.Equal("More info", display.HelpAccessibleName);
    }

    [Fact]
    public void Help_with_an_empty_field_id_uses_the_generic_more_info_name()
    {
        var display = Project(new SettingFieldModel("Field", new SettingFieldHelp(Content: "x", For: "")));

        Assert.Equal("More info", display.HelpAccessibleName);
    }

    [Fact]
    public void Help_for_id_honors_a_localized_template()
    {
        var localizer = new MapLocalizer(new Dictionary<string, string>
        {
            [SettingFieldProjection.HelpForKey] = "Aide pour {0}",
        });

        var display = Project(
            new SettingFieldModel("Field", new SettingFieldHelp(Content: "x", For: "cooldown")),
            localizer);

        Assert.Equal("Aide pour cooldown", display.HelpAccessibleName);
    }

    [Fact]
    public void Help_for_id_falls_back_to_the_english_template()
    {
        Assert.Equal("Help for {0}", SettingFieldProjection.HelpForFallback);
        Assert.Equal("a11y.helpFor", SettingFieldProjection.HelpForKey);
        Assert.Equal("More info", SettingFieldProjection.IconLabelFallback);
        Assert.Equal("help.tooltip.iconLabel", SettingFieldProjection.IconLabelKey);
    }

    // ── Diagnostics (P1/S11): view.opened slug=SettingField, PII-safe ────────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new SettingFieldDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SettingField", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_field_label_or_help_text()
    {
        var captured = new List<string>();
        var diagnostics = new SettingFieldDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=SettingField", line);
        Assert.DoesNotContain("kWh", line, StringComparison.Ordinal);
        Assert.DoesNotContain("Help for", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("SettingField", SettingFieldRegistration.Slug);

    [Fact]
    public void Registration_exposes_a_non_empty_help_glyph() =>
        Assert.False(string.IsNullOrEmpty(SettingFieldRegistration.HelpGlyph));

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => SettingFieldProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => SettingFieldProjection.Project(SettingFieldModel.Unlabeled, null!));

    private sealed class MapLocalizer : ILocalizer
    {
        private readonly IReadOnlyDictionary<string, string> _map;

        public MapLocalizer(IReadOnlyDictionary<string, string> map) => _map = map;

        public string GetString(string key, string fallback) =>
            _map.TryGetValue(key, out var value) ? value : fallback;
    }
}
