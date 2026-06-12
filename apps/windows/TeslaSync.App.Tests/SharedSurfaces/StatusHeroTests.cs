using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.StatusHeroSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>StatusHero</c> shared surface's UI-thread-free logic — the per-status default
/// headline resolution and override, the accent-token / icon-glyph / semantic-kind mapping, the subline gate, the
/// live affordance gate (shown only when a subline is present, mirroring the web nesting), the call-to-action
/// projection, the polite-status accessible name, the anchor-id passthrough, the registration metadata and the
/// PII-safe diagnostics. Mirrors the web spec and its test one-for-one
/// (<c>web/src/components/status/StatusHero.tsx</c> and its <c>__tests__/StatusHero.test.tsx</c>). The WinUI view
/// itself (StatusHero.cs) is exercised by the app build.
/// </summary>
public sealed class StatusHeroTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static StatusHeroDisplay Project(StatusHeroModel model) =>
        StatusHeroProjection.Project(model, Localizer);

    // ── registration (diagnostics slug + automation id) ──────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("StatusHero", StatusHeroRegistration.Slug);

    [Fact]
    public void Registration_pins_the_root_automation_id() =>
        Assert.Equal("status-hero", StatusHeroRegistration.RootAutomationId);

    [Fact]
    public void Registration_pins_the_web_tint_and_ring_alphas()
    {
        // web bg-{c}-500/15 and ring-{c}-500/40.
        Assert.Equal(0.15, StatusHeroRegistration.TintAlpha);
        Assert.Equal(0.40, StatusHeroRegistration.RingAlpha);
    }

    // ── default headline per status (web test: renders the default headline for %s) ───────────────────────

    [Theory]
    [InlineData(HeroStatus.Healthy, "All systems operational")]
    [InlineData(HeroStatus.Degraded, "Degraded performance")]
    [InlineData(HeroStatus.Unhealthy, "Service outage")]
    [InlineData(HeroStatus.Unknown, "Status unknown")]
    [InlineData(HeroStatus.Maintenance, "Scheduled maintenance")]
    public void Each_status_resolves_its_default_headline(HeroStatus status, string expected) =>
        Assert.Equal(expected, Project(StatusHeroModel.For(status)).Headline);

    // ── headline override (web test: overrides the default headline when one is supplied) ─────────────────

    [Fact]
    public void Headline_override_replaces_the_default()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy, headline: "Custom headline"));

        Assert.Equal("Custom headline", d.Headline);
        Assert.NotEqual("All systems operational", d.Headline);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_headline_override_falls_back_to_the_default(string? headline) =>
        Assert.Equal("All systems operational", Project(StatusHeroModel.For(HeroStatus.Healthy, headline: headline)).Headline);

    // ── accent token / icon glyph / kind mapping (web STATUS_CONFIG) ──────────────────────────────────────

    [Theory]
    [InlineData(HeroStatus.Healthy, StatusKind.Success, "TsColorSuccessBrush", "\uEC61")]
    [InlineData(HeroStatus.Degraded, StatusKind.Warning, "TsColorWarningBrush", "\uE7BA")]
    [InlineData(HeroStatus.Unhealthy, StatusKind.Danger, "TsColorDangerBrush", "\uEA39")]
    [InlineData(HeroStatus.Unknown, StatusKind.Neutral, "TsColorTextSecondaryBrush", "\uE897")]
    [InlineData(HeroStatus.Maintenance, StatusKind.Info, "TsColorInfoBrush", "\uE90F")]
    public void Status_maps_to_kind_accent_and_glyph(HeroStatus status, StatusKind kind, string brushKey, string glyph)
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(status));

        Assert.Equal(kind, d.Kind);
        Assert.Equal(brushKey, d.AccentBrushKey);
        Assert.Equal(glyph, d.IconGlyph);
    }

    [Fact]
    public void Accent_brush_key_matches_the_core_status_resources_table()
    {
        // The mapping reuses the tested core kind→brush table rather than a private copy.
        foreach (HeroStatus status in Enum.GetValues<HeroStatus>())
        {
            Assert.Equal(
                StatusResources.AccentBrushKey(StatusHeroRegistration.Kind(status)),
                Project(StatusHeroModel.For(status)).AccentBrushKey);
        }
    }

    // ── subline gate (web test: renders the subline when provided) ────────────────────────────────────────

    [Fact]
    public void Subline_renders_when_provided()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy, subline: "Last checked 12s ago"));

        Assert.True(d.HasSubline);
        Assert.Equal("Last checked 12s ago", d.Subline);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Blank_subline_is_absent(string? subline)
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy, subline: subline));

        Assert.False(d.HasSubline);
        Assert.Equal(string.Empty, d.Subline);
    }

    // ── live affordance gate (web: nested inside the {subline && (...)} block) ────────────────────────────

    [Fact]
    public void Live_shows_only_when_a_subline_is_present()
    {
        // web: the live dot is nested inside the subline block, so live without a subline never shows.
        Assert.False(Project(StatusHeroModel.For(HeroStatus.Healthy, live: true)).ShowLive);
        Assert.True(Project(StatusHeroModel.For(HeroStatus.Healthy, subline: "Streaming", live: true)).ShowLive);
    }

    [Fact]
    public void Live_is_off_when_not_requested() =>
        Assert.False(Project(StatusHeroModel.For(HeroStatus.Healthy, subline: "Streaming", live: false)).ShowLive);

    [Fact]
    public void Live_label_resolves_through_i18n()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy, subline: "Streaming", live: true));

        Assert.Equal("Live", d.LiveLabel);
        Assert.Equal("Live", Localizer.GetString(StatusHeroRegistration.LiveKey, StatusHeroRegistration.LiveFallback));
    }

    // ── call-to-action (web test: fires the CTA handler when clicked — label carried, click is a view concern) ─

    [Fact]
    public void Cta_carries_its_label_loading_and_glyph()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(
            HeroStatus.Degraded,
            cta: new StatusHeroCallToAction("Run check", Loading: true)));

        Assert.True(d.HasCta);
        Assert.Equal("Run check", d.CtaLabel);
        Assert.True(d.CtaLoading);
        Assert.Equal("\uE72C", d.CtaGlyph);
    }

    [Fact]
    public void Cta_defaults_to_not_loading()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy, cta: new StatusHeroCallToAction("Run check")));

        Assert.True(d.HasCta);
        Assert.False(d.CtaLoading);
    }

    [Fact]
    public void No_cta_means_no_button()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.For(HeroStatus.Healthy));

        Assert.False(d.HasCta);
        Assert.Equal(string.Empty, d.CtaLabel);
        Assert.False(d.CtaLoading);
    }

    // ── accessibility: polite status region name (web role="status" content) ──────────────────────────────

    [Fact]
    public void Automation_name_is_the_headline_without_a_subline() =>
        Assert.Equal("Service outage", Project(StatusHeroModel.For(HeroStatus.Unhealthy)).AutomationName);

    [Fact]
    public void Automation_name_includes_the_subline_when_present() =>
        Assert.Equal(
            "Degraded performance. Two workers offline",
            Project(StatusHeroModel.For(HeroStatus.Degraded, subline: "Two workers offline")).AutomationName);

    [Fact]
    public void Automation_name_is_non_empty_in_every_status()
    {
        foreach (HeroStatus status in Enum.GetValues<HeroStatus>())
        {
            Assert.False(string.IsNullOrWhiteSpace(Project(StatusHeroModel.For(status)).AutomationName));
        }
    }

    // ── anchor id (web id prop → AutomationProperties.AutomationId) ───────────────────────────────────────

    [Fact]
    public void Anchor_id_is_passed_through_as_the_automation_id() =>
        Assert.Equal("system-hero", Project(StatusHeroModel.For(HeroStatus.Healthy, anchorId: "system-hero")).AutomationId);

    [Fact]
    public void Missing_anchor_id_falls_back_to_the_root_id() =>
        Assert.Equal("status-hero", Project(StatusHeroModel.For(HeroStatus.Healthy)).AutomationId);

    // ── empty / unknown default model ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Unknown_is_the_default_empty_model()
    {
        StatusHeroDisplay d = Project(StatusHeroModel.Unknown);

        Assert.Equal(HeroStatus.Unknown, d.Status);
        Assert.Equal("Status unknown", d.Headline);
        Assert.False(d.HasSubline);
        Assert.False(d.HasCta);
    }

    // ── diagnostics (view.opened, PII-safe — never the status / headline / subline) ───────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new StatusHeroDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=StatusHero", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new StatusHeroDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ──────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => StatusHeroProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => StatusHeroProjection.Project(StatusHeroModel.Unknown, null!));
}
