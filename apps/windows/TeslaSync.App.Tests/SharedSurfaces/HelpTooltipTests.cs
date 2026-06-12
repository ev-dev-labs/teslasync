using System.Collections.Generic;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.HelpTooltipSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>HelpTooltip</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, the two fixed i18n keys + verbatim English fallbacks, the tooltip role, the Segoe Fluent help /
/// external-link glyphs, the per-tier trigger glyph sizes), the pure <see cref="HelpTooltipProjection"/> across
/// every branch (the i18n-key vs plain-text body resolution and the web key-over-text precedence, the
/// empty-content collapse mirroring the web <c>if (!resolved) return null</c>, the size tiers, the placements, the
/// optional learn-more link with its default / overridden label, and the accessible-name default / override), the
/// learn-more argument guards, the PII-safe diagnostics, and the projection argument guards. Mirrors the web spec
/// one-for-one (<c>web/src/components/ui/HelpTooltip.tsx</c>). The WinUI view itself
/// (shared-surfaces/HelpTooltip.cs) is exercised by the app build.
/// </summary>
public sealed class HelpTooltipTests
{
    private static readonly ILocalizer Passthrough = PassthroughLocalizer.Instance;

    private static HelpTooltipDisplay Project(HelpTooltipModel model, ILocalizer? localizer = null) =>
        HelpTooltipProjection.Project(model, localizer ?? Passthrough);

    /// <summary>A localizer that resolves a fixed catalog and falls back to the English default for misses.</summary>
    private sealed class FakeLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _catalog;

        public FakeLocalizer(Dictionary<string, string> catalog) => _catalog = catalog;

        public string GetString(string key, string fallback) =>
            _catalog.TryGetValue(key, out string? value) ? value : fallback;
    }

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("HelpTooltip", HelpTooltipRegistration.Slug);

    [Fact]
    public void Registration_icon_label_key_and_fallback_match_the_web_translation_call()
    {
        // web L70: t('help.tooltip.iconLabel', { defaultValue: 'More info' }).
        Assert.Equal("translation.help.tooltip.iconLabel", HelpTooltipRegistration.IconLabelKey);
        Assert.Equal("More info", HelpTooltipRegistration.IconLabelFallback);
    }

    [Fact]
    public void Registration_learn_more_key_and_fallback_match_the_web_translation_call()
    {
        // web L87: t('common.learnMore', { defaultValue: 'Learn more' }).
        Assert.Equal("translation.common.learnMore", HelpTooltipRegistration.LearnMoreKey);
        Assert.Equal("Learn more", HelpTooltipRegistration.LearnMoreFallback);
    }

    [Fact]
    public void Registration_tooltip_role_matches_the_shared_tooltip() =>
        Assert.Equal("tooltip", HelpTooltipRegistration.TooltipRole);

    [Fact]
    public void Registration_glyphs_are_the_segoe_fluent_stand_ins()
    {
        Assert.Equal("\uE897", HelpTooltipRegistration.HelpGlyph);          // web Lucide HelpCircle
        Assert.Equal("\uE8A7", HelpTooltipRegistration.ExternalLinkGlyph);  // web Lucide ExternalLink
    }

    [Theory]
    [InlineData(HelpTooltipSize.ExtraSmall, 12)]  // web h-3 w-3
    [InlineData(HelpTooltipSize.Small, 14)]       // web h-3.5 w-3.5 (default)
    [InlineData(HelpTooltipSize.Medium, 16)]      // web h-4 w-4
    public void Registration_icon_size_matches_the_web_size_class(HelpTooltipSize size, double expected) =>
        Assert.Equal(expected, HelpTooltipRegistration.IconSize(size));

    // ── content resolution (web L61-63) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Plain_text_is_used_as_the_body()
    {
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromText("Vampire drain is parasitic battery loss while parked."));

        Assert.Equal("Vampire drain is parasitic battery loss while parked.", d.ResolvedText);
        Assert.True(d.HasContent);
        Assert.False(d.RendersNothing);
        Assert.Equal("\uE897", d.Glyph);
        Assert.Equal("tooltip", d.TooltipRole);
    }

    [Fact]
    public void I18n_key_resolves_through_the_localizer()
    {
        var localizer = new FakeLocalizer(new Dictionary<string, string>
        {
            ["translation.battery.vampireDrainHelp"] = "Parasitischer Batterieverlust im Parkmodus.",
        });

        HelpTooltipDisplay d = Project(
            HelpTooltipModel.FromKey("translation.battery.vampireDrainHelp", "Parasitic loss while parked."),
            localizer);

        Assert.Equal("Parasitischer Batterieverlust im Parkmodus.", d.ResolvedText);
        Assert.True(d.HasContent);
    }

    [Fact]
    public void I18n_key_falls_back_to_the_default_value_when_missing()
    {
        // PassthroughLocalizer returns the fallback — the web `t(key, { defaultValue })` missing-key behaviour.
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromKey("translation.missing.key", "Parasitic loss while parked."));

        Assert.Equal("Parasitic loss while parked.", d.ResolvedText);
        Assert.True(d.HasContent);
    }

    [Fact]
    public void I18n_key_takes_precedence_over_plain_text()
    {
        // web L61: `i18nKey ? t(i18nKey, ...) : (text ?? '')` — the key wins when both are supplied.
        HelpTooltipDisplay d = Project(
            HelpTooltipModel.Create(text: "plain text", i18nKey: "translation.some.key", defaultValue: "resolved default"));

        Assert.Equal("resolved default", d.ResolvedText);
    }

    // ── empty state (web L67: if (!resolved) return null) ─────────────────────────────────────────────────

    [Fact]
    public void Empty_model_renders_nothing()
    {
        HelpTooltipDisplay d = Project(HelpTooltipModel.Empty);

        Assert.Equal(string.Empty, d.ResolvedText);
        Assert.False(d.HasContent);
        Assert.True(d.RendersNothing);
    }

    [Fact]
    public void No_text_or_key_renders_nothing() =>
        Assert.True(Project(HelpTooltipModel.Create()).RendersNothing);

    [Fact]
    public void Empty_text_renders_nothing()
    {
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromText(string.Empty));

        Assert.False(d.HasContent);
        Assert.True(d.RendersNothing);
    }

    [Fact]
    public void Missing_key_with_empty_default_renders_nothing()
    {
        // web: an absent translation with an empty defaultValue resolves to '' → the component returns null.
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromKey("translation.missing.key", string.Empty));

        Assert.False(d.HasContent);
        Assert.True(d.RendersNothing);
    }

    // ── accessible name (web L70) ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Accessible_label_defaults_to_the_localized_more_info() =>
        Assert.Equal("More info", Project(HelpTooltipModel.FromText("Body")).AccessibleLabel);

    [Fact]
    public void Accessible_label_uses_the_localized_translation_when_present()
    {
        var localizer = new FakeLocalizer(new Dictionary<string, string>
        {
            ["translation.help.tooltip.iconLabel"] = "Weitere Informationen",
        });

        Assert.Equal("Weitere Informationen", Project(HelpTooltipModel.FromText("Body"), localizer).AccessibleLabel);
    }

    [Fact]
    public void Accessible_label_override_wins_over_the_default()
    {
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromText("Body", ariaLabel: "More info about vampire drain"));

        Assert.Equal("More info about vampire drain", d.AccessibleLabel);
    }

    // ── learn-more link (web L75-90) ──────────────────────────────────────────────────────────────────────

    [Fact]
    public void No_learn_more_link_by_default()
    {
        HelpTooltipDisplay d = Project(HelpTooltipModel.FromText("Body"));

        Assert.False(d.HasLearnMore);
        Assert.Null(d.LearnMoreUrl);
        Assert.Equal(string.Empty, d.LearnMoreLabel);
    }

    [Fact]
    public void Learn_more_link_uses_the_localized_default_label()
    {
        HelpTooltipDisplay d = Project(
            HelpTooltipModel.FromText("Body", learnMore: HelpTooltipLearnMore.Create("https://docs.example.com/vampire-drain")));

        Assert.True(d.HasLearnMore);
        Assert.Equal("https://docs.example.com/vampire-drain", d.LearnMoreUrl);
        Assert.Equal("Learn more", d.LearnMoreLabel);
        Assert.Equal("\uE8A7", d.ExternalLinkGlyph);
    }

    [Fact]
    public void Learn_more_link_uses_an_overridden_label()
    {
        HelpTooltipDisplay d = Project(
            HelpTooltipModel.FromText(
                "Body",
                learnMore: HelpTooltipLearnMore.Create("https://docs.example.com/x", "Read the docs")));

        Assert.True(d.HasLearnMore);
        Assert.Equal("Read the docs", d.LearnMoreLabel);
    }

    [Fact]
    public void Learn_more_label_resolves_the_localized_translation_when_present()
    {
        var localizer = new FakeLocalizer(new Dictionary<string, string>
        {
            ["translation.common.learnMore"] = "Mehr erfahren",
        });

        HelpTooltipDisplay d = Project(
            HelpTooltipModel.FromText("Body", learnMore: HelpTooltipLearnMore.Create("https://docs.example.com/x")),
            localizer);

        Assert.Equal("Mehr erfahren", d.LearnMoreLabel);
    }

    // ── size + placement passthrough ──────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(HelpTooltipSize.ExtraSmall, 12)]
    [InlineData(HelpTooltipSize.Small, 14)]
    [InlineData(HelpTooltipSize.Medium, 16)]
    public void Projection_sizes_the_trigger_glyph_by_tier(HelpTooltipSize size, double expected) =>
        Assert.Equal(expected, Project(HelpTooltipModel.FromText("Body", size: size)).IconSize);

    [Fact]
    public void Default_size_is_small() =>
        Assert.Equal(14, Project(HelpTooltipModel.FromText("Body")).IconSize);

    [Theory]
    [InlineData(HelpTooltipPlacement.Top)]
    [InlineData(HelpTooltipPlacement.Bottom)]
    [InlineData(HelpTooltipPlacement.Left)]
    [InlineData(HelpTooltipPlacement.Right)]
    public void Projection_passes_the_placement_through(HelpTooltipPlacement placement) =>
        Assert.Equal(placement, Project(HelpTooltipModel.FromText("Body", placement: placement)).Placement);

    [Fact]
    public void Default_placement_is_top() =>
        Assert.Equal(HelpTooltipPlacement.Top, Project(HelpTooltipModel.FromText("Body")).Placement);

    // ── diagnostics (view.opened, PII-safe — never the resolved text or URL) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new HelpTooltipDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=HelpTooltip", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new HelpTooltipDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipProjection.Project(null!, Passthrough));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipProjection.Project(HelpTooltipModel.Empty, null!));

    [Fact]
    public void From_text_rejects_a_null_text() =>
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipModel.FromText(null!));

    [Fact]
    public void From_key_rejects_a_null_or_empty_key()
    {
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipModel.FromKey(null!, "Default"));
        Assert.Throws<System.ArgumentException>(() => HelpTooltipModel.FromKey(string.Empty, "Default"));
    }

    [Fact]
    public void From_key_rejects_a_null_default_value() =>
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipModel.FromKey("translation.x", null!));

    [Fact]
    public void Learn_more_create_rejects_a_null_or_empty_url()
    {
        Assert.Throws<System.ArgumentNullException>(() => HelpTooltipLearnMore.Create(null!));
        Assert.Throws<System.ArgumentException>(() => HelpTooltipLearnMore.Create(string.Empty));
    }
}
