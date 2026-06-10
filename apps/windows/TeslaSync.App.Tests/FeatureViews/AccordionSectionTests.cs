using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AccordionSection</c> feature surface's UI-thread-free logic — the verbatim
/// title / description passthrough, the icon-glyph resolution, the presence flags that collapse a blank header
/// line, the default-open passthrough, the localized empty-body caption (resolved through the i18n facade), the
/// composed disclosure Narrator name, the stable registration slug and the PII-safe diagnostics. Mirrors the web
/// spec (web/src/features/system/components/status/AccordionSection.tsx). The component is purely presentational
/// (no fetch lifecycle), so the only states are collapsed and expanded plus an empty-body caption; the WinUI view
/// itself — the GlassPanel + flattened Expander disclosure that renders those states — is exercised by the app
/// build.
/// </summary>
public sealed class AccordionSectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AccordionSectionModel Model(
        string title = "Battery Health",
        string description = "Cell balance and degradation",
        string? icon = "\uE945",
        bool defaultOpen = false) =>
        new(title, description, icon, defaultOpen);

    private static AccordionSectionDisplay Project(AccordionSectionModel model) =>
        AccordionSectionProjection.Project(model, Localizer);

    // ── Title / description: rendered verbatim (the web interpolates the resolved props unchanged) ─────────

    [Fact]
    public void Title_is_passed_through_verbatim() =>
        Assert.Equal("Tire Pressure", Project(Model(title: "Tire Pressure")).Title);

    [Fact]
    public void Description_is_passed_through_verbatim() =>
        Assert.Equal("Front and rear axle PSI", Project(Model(description: "Front and rear axle PSI")).Description);

    [Theory]
    [InlineData("Battery Health", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void HasTitle_reflects_a_non_blank_title(string title, bool expected) =>
        Assert.Equal(expected, Project(Model(title: title)).HasTitle);

    [Theory]
    [InlineData("Cell balance", true)]
    [InlineData("", false)]
    [InlineData("   ", false)]
    public void HasDescription_reflects_a_non_blank_description(string description, bool expected) =>
        Assert.Equal(expected, Project(Model(description: description)).HasDescription);

    // ── Icon glyph (the web `icon` ReactNode mapped to an optional Segoe Fluent glyph) ─────────────────────

    [Fact]
    public void Icon_glyph_is_passed_through()
    {
        AccordionSectionDisplay display = Project(Model(icon: "\uE945"));

        Assert.True(display.HasIcon);
        Assert.Equal("\uE945", display.IconGlyph);
    }

    [Fact]
    public void Icon_glyph_is_null_when_absent()
    {
        Assert.Null(Project(Model(icon: null)).IconGlyph);
        Assert.Null(Project(Model(icon: string.Empty)).IconGlyph);
        Assert.False(Project(Model(icon: null)).HasIcon);
    }

    // ── Default-open passthrough (web `defaultOpen`) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void Default_open_is_passed_through(bool defaultOpen) =>
        Assert.Equal(defaultOpen, Project(Model(defaultOpen: defaultOpen)).DefaultOpen);

    [Fact]
    public void Default_open_defaults_to_false_on_the_model() =>
        Assert.False(new AccordionSectionModel("T", "D").DefaultOpen);

    // ── Empty-body caption: resolved through the i18n facade, never a hardcoded literal ────────────────────

    [Fact]
    public void Empty_message_uses_the_english_fallback_through_the_passthrough_localizer() =>
        Assert.Equal("No content", Project(Model()).EmptyMessage);

    [Fact]
    public void Empty_message_resolves_through_the_i18n_facade_key()
    {
        // A key-echoing localizer proves the projection asks the facade for the canonical key rather than
        // embedding an English literal.
        AccordionSectionDisplay display = AccordionSectionProjection.Project(Model(), new KeyEchoLocalizer());

        Assert.Equal("accordion.empty", display.EmptyMessage);
    }

    [Fact]
    public void Empty_message_key_is_stable() =>
        Assert.Equal("accordion.empty", AccordionSectionProjection.EmptyMessageKey);

    // ── Accessibility: the disclosure header exposes a meaningful, composed Narrator name ──────────────────

    [Fact]
    public void Automation_name_carries_title_then_description()
    {
        AccordionSectionDisplay display = Project(Model(title: "Battery Health", description: "Cell balance"));

        Assert.Equal("Battery Health. Cell balance", display.AutomationName);
    }

    [Fact]
    public void Automation_name_is_just_the_title_without_a_description() =>
        Assert.Equal("Battery Health", Project(Model(title: "Battery Health", description: "  ")).AutomationName);

    [Fact]
    public void Automation_name_is_just_the_description_without_a_title() =>
        Assert.Equal("Cell balance", Project(Model(title: string.Empty, description: "Cell balance")).AutomationName);

    [Fact]
    public void Automation_name_falls_back_to_the_empty_caption_when_the_header_is_blank() =>
        Assert.Equal("No content", Project(Model(title: " ", description: string.Empty)).AutomationName);

    [Fact]
    public void Every_projection_exposes_a_non_empty_automation_name()
    {
        Assert.All(
            new[]
            {
                Project(Model()),
                Project(Model(title: string.Empty, description: string.Empty)),
                Project(Model(icon: null, description: string.Empty)),
            },
            display => Assert.False(string.IsNullOrWhiteSpace(display.AutomationName)));
    }

    // ── Diagnostics (P1/S11): view.opened slug=AccordionSection, PII-safe ──────────────────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new AccordionSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AccordionSection", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_never_leaks_the_section_content()
    {
        var captured = new List<string>();
        var diagnostics = new AccordionSectionDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        string line = Assert.Single(captured);
        Assert.Equal("view.opened slug=AccordionSection", line);
        Assert.DoesNotContain("Battery", line, StringComparison.Ordinal);
        Assert.DoesNotContain("balance", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Registration_slug_is_stable() =>
        Assert.Equal("AccordionSection", AccordionSectionRegistration.Slug);

    // ── Argument validation ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<ArgumentNullException>(() => AccordionSectionProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(() => AccordionSectionProjection.Project(Model(), null!));

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => key;
    }
}
