using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.InlineCalloutSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>InlineCallout</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, the status / button / link roles, the polite live setting, the chevron glyph, the accent /
/// secondary token brush keys), the parity visual constants (icon / body / chevron sizes and the tint / ring
/// alphas), the action-branch discriminator (<see cref="InlineCalloutAction.Create"/> reproducing the web
/// <c>href</c> &gt; <c>onClick</c> &gt; inert precedence), the pure <see cref="InlineCalloutProjection"/> across
/// every variant (the neutral info / success body vs the accent-tinted warning / danger body, the ring alpha bump)
/// and every render branch (status / button / link, interactive vs live region), the icon present / absent path,
/// the composed accessible-name contract (body, then action label), the <c>testId</c> → automation-id passthrough,
/// the PII-safe diagnostics, and the argument guards. Mirrors the web spec one-for-one
/// (<c>web/src/components/feedback/InlineCallout.tsx</c>). The WinUI view itself (shared-surfaces/InlineCallout.cs)
/// is exercised by the app build.
/// </summary>
public sealed class InlineCalloutTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static InlineCalloutDisplay Project(InlineCalloutModel model) =>
        InlineCalloutProjection.Project(model, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("InlineCallout", InlineCalloutRegistration.Slug);

    [Fact]
    public void Registration_roles_match_the_web_branches()
    {
        // web `<div role="status">` / `<button>` / `<a>`.
        Assert.Equal("status", InlineCalloutRegistration.StatusRole);
        Assert.Equal("button", InlineCalloutRegistration.ButtonRole);
        Assert.Equal("link", InlineCalloutRegistration.LinkRole);
    }

    [Fact]
    public void Registration_status_branch_is_a_polite_live_region() =>
        Assert.Equal("polite", InlineCalloutRegistration.LiveSetting);

    [Fact]
    public void Registration_chevron_glyph_is_the_segoe_fluent_chevron_right() =>
        Assert.Equal("\uE76C", InlineCalloutRegistration.ChevronGlyph);

    [Fact]
    public void Registration_secondary_text_brush_key_is_the_token_secondary()
    {
        // web info/success body is `text-[var(--text-secondary)]`.
        Assert.Equal("TsColorTextSecondaryBrush", InlineCalloutRegistration.SecondaryTextBrushKey);
    }

    [Theory]
    [InlineData(CalloutVariant.Info, "TsColorInfoBrush")]
    [InlineData(CalloutVariant.Success, "TsColorSuccessBrush")]
    [InlineData(CalloutVariant.Warning, "TsColorWarningBrush")]
    [InlineData(CalloutVariant.Danger, "TsColorDangerBrush")]
    public void Registration_accent_brush_key_matches_the_shared_callout_accent(CalloutVariant variant, string key)
    {
        Assert.Equal(key, InlineCalloutRegistration.AccentBrushKey(variant));
        Assert.Equal(CalloutVariants.AccentBrushKey(variant), InlineCalloutRegistration.AccentBrushKey(variant));
    }

    [Theory]
    [InlineData(CalloutVariant.Info)]
    [InlineData(CalloutVariant.Success)]
    [InlineData(CalloutVariant.Warning)]
    [InlineData(CalloutVariant.Danger)]
    public void Registration_glyph_matches_the_shared_callout_glyph(CalloutVariant variant) =>
        Assert.Equal(CalloutVariants.Glyph(variant), InlineCalloutRegistration.Glyph(variant));

    // ── parity visual constants ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_visual_constants_match_the_web_tailwind_scale()
    {
        Assert.Equal(16, InlineCalloutProjection.IconSize);          // web h-4 w-4
        Assert.Equal(12, InlineCalloutProjection.BodyFontSize);      // web text-xs
        Assert.Equal(12, InlineCalloutProjection.ChevronSize);       // web h-3 w-3
        Assert.Equal(0.06, InlineCalloutProjection.BackgroundTintOpacity);  // web bg-*/5 (nudged)
        Assert.Equal(0.20, InlineCalloutProjection.RingOpacity);     // web ring-*/20
        Assert.Equal(0.25, InlineCalloutProjection.StrongRingOpacity); // web ring-*/25
    }

    // ── variant colour split (web VARIANT_STYLES) ─────────────────────────────────────────────────────────

    [Theory]
    [InlineData(CalloutVariant.Info)]
    [InlineData(CalloutVariant.Success)]
    public void Quiet_variants_use_a_neutral_body_and_soft_ring(CalloutVariant variant)
    {
        InlineCalloutDisplay d = Project(InlineCalloutModel.Create(variant, "Body"));

        Assert.False(d.BodyUsesAccent);
        Assert.Equal("TsColorTextSecondaryBrush", d.BodyBrushKey);
        Assert.Equal(InlineCalloutRegistration.AccentBrushKey(variant), d.AccentBrushKey);
        Assert.Equal(0.20, d.RingOpacity);
        Assert.Equal(0.06, d.BackgroundTintOpacity);
    }

    [Theory]
    [InlineData(CalloutVariant.Warning)]
    [InlineData(CalloutVariant.Danger)]
    public void Loud_variants_tint_the_body_with_the_accent_and_bump_the_ring(CalloutVariant variant)
    {
        // web warning body `text-amber-200/85`, danger body `text-rose-200/85` — the accent, not the neutral text.
        InlineCalloutDisplay d = Project(InlineCalloutModel.Create(variant, "Body"));

        Assert.True(d.BodyUsesAccent);
        Assert.Equal(InlineCalloutRegistration.AccentBrushKey(variant), d.BodyBrushKey);
        Assert.Equal(0.25, d.RingOpacity);
    }

    // ── icon branch (web `icon && ...`) ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Icon_is_absent_by_default()
    {
        InlineCalloutDisplay d = Project(InlineCalloutModel.Create(CalloutVariant.Info, "Body"));

        Assert.False(d.HasIcon);
        Assert.Null(d.IconGlyph);
    }

    [Fact]
    public void Icon_is_rendered_when_a_glyph_is_supplied()
    {
        string glyph = InlineCalloutRegistration.Glyph(CalloutVariant.Warning);
        InlineCalloutDisplay d = Project(InlineCalloutModel.Create(CalloutVariant.Warning, "Body", iconGlyph: glyph));

        Assert.True(d.HasIcon);
        Assert.Equal(glyph, d.IconGlyph);
    }

    // ── action branch: status (no action) ─────────────────────────────────────────────────────────────────

    [Fact]
    public void No_action_renders_a_non_interactive_status_region()
    {
        InlineCalloutDisplay d = Project(InlineCalloutModel.Create(CalloutVariant.Info, "Body"));

        Assert.False(d.HasAction);
        Assert.Equal(InlineCalloutInteraction.None, d.Interaction);
        Assert.Equal("status", d.Role);
        Assert.True(d.IsStatusRegion);
        Assert.False(d.IsInteractive);
        Assert.Equal(string.Empty, d.ActionLabel);
        Assert.Null(d.Href);
    }

    // ── action branch: navigation link (web `action.href` → `<a>`) ────────────────────────────────────────

    [Fact]
    public void Href_action_renders_a_navigation_link()
    {
        var model = InlineCalloutModel.Create(
            CalloutVariant.Warning,
            "1 anomaly",
            action: InlineCalloutAction.Navigate("View", "/drives/1"));
        InlineCalloutDisplay d = Project(model);

        Assert.True(d.HasAction);
        Assert.Equal(InlineCalloutInteraction.Navigate, d.Interaction);
        Assert.Equal("link", d.Role);
        Assert.True(d.IsInteractive);
        Assert.False(d.IsStatusRegion);
        Assert.Equal("View", d.ActionLabel);
        Assert.Equal("/drives/1", d.Href);
    }

    // ── action branch: in-app button (web `action.onClick` → `<button>`) ──────────────────────────────────

    [Fact]
    public void OnClick_action_renders_an_in_app_button()
    {
        var model = InlineCalloutModel.Create(
            CalloutVariant.Info,
            "Stale data",
            action: InlineCalloutAction.Invoke("Refresh"));
        InlineCalloutDisplay d = Project(model);

        Assert.True(d.HasAction);
        Assert.Equal(InlineCalloutInteraction.Invoke, d.Interaction);
        Assert.Equal("button", d.Role);
        Assert.True(d.IsInteractive);
        Assert.Equal("Refresh", d.ActionLabel);
        Assert.Null(d.Href);
    }

    // ── action branch: inert action (web action with neither href nor onClick) ────────────────────────────

    [Fact]
    public void Inert_action_shows_its_label_but_stays_a_status_region()
    {
        // web: `content` always includes the action label + chevron, but with no href/onClick the wrapper is the
        // `<div role="status">` fall-through — so the label shows yet the surface is not interactive.
        var model = InlineCalloutModel.Create(
            CalloutVariant.Info,
            "Body",
            action: InlineCalloutAction.Inert("Detail"));
        InlineCalloutDisplay d = Project(model);

        Assert.True(d.HasAction);
        Assert.Equal("Detail", d.ActionLabel);
        Assert.Equal(InlineCalloutInteraction.None, d.Interaction);
        Assert.Equal("status", d.Role);
        Assert.False(d.IsInteractive);
        Assert.True(d.IsStatusRegion);
    }

    // ── action precedence (web `action?.href` wins over `action?.onClick`) ────────────────────────────────

    [Fact]
    public void Action_create_prefers_href_when_both_are_supplied()
    {
        var action = InlineCalloutAction.Create("Go", href: "/x", hasOnClick: true);

        Assert.Equal(InlineCalloutInteraction.Navigate, action.Interaction);
        Assert.Equal("/x", action.Href);
    }

    [Fact]
    public void Action_create_falls_back_to_onclick_without_an_href()
    {
        var action = InlineCalloutAction.Create("Go", href: null, hasOnClick: true);

        Assert.Equal(InlineCalloutInteraction.Invoke, action.Interaction);
        Assert.Null(action.Href);
    }

    [Fact]
    public void Action_create_treats_an_empty_href_as_no_href()
    {
        // web: `action?.href` is falsy for "", so an empty href falls through to onClick.
        var action = InlineCalloutAction.Create("Go", href: string.Empty, hasOnClick: true);

        Assert.Equal(InlineCalloutInteraction.Invoke, action.Interaction);
    }

    [Fact]
    public void Action_create_is_inert_without_href_or_onclick()
    {
        var action = InlineCalloutAction.Create("Go");

        Assert.Equal(InlineCalloutInteraction.None, action.Interaction);
        Assert.Null(action.Href);
    }

    // ── accessibility: composed name (body, then action label) ────────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_body_when_there_is_no_action() =>
        Assert.Equal("Body text", Project(InlineCalloutModel.Create(CalloutVariant.Info, "Body text")).AutomationName);

    [Fact]
    public void Accessible_name_appends_the_action_label()
    {
        var model = InlineCalloutModel.Create(
            CalloutVariant.Warning,
            "1 anomaly in this range",
            action: InlineCalloutAction.Navigate("View", "/drives/1"));

        Assert.Equal("1 anomaly in this range, View", Project(model).AutomationName);
    }

    [Fact]
    public void Accessible_name_is_the_action_label_when_the_body_is_empty()
    {
        var model = InlineCalloutModel.Create(
            CalloutVariant.Info,
            string.Empty,
            action: InlineCalloutAction.Invoke("Refresh"));

        Assert.Equal("Refresh", Project(model).AutomationName);
    }

    [Fact]
    public void Accessible_name_is_empty_when_there_is_no_body_or_action() =>
        Assert.Equal(string.Empty, Project(InlineCalloutModel.Create(CalloutVariant.Info, string.Empty)).AutomationName);

    // ── test hook (web testId → AutomationProperties.AutomationId) ────────────────────────────────────────

    [Fact]
    public void Test_id_is_passed_through_as_the_automation_id()
    {
        Assert.Equal(
            "anomaly-callout",
            Project(InlineCalloutModel.Create(CalloutVariant.Info, "Body", testId: "anomaly-callout")).AutomationId);
        Assert.Null(Project(InlineCalloutModel.Create(CalloutVariant.Info, "Body")).AutomationId);
    }

    // ── diagnostics (view.opened, PII-safe — never the body or action label) ──────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new InlineCalloutDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=InlineCallout", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new InlineCalloutDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(
            () => InlineCalloutProjection.Project(InlineCalloutModel.Empty, null!));

    [Fact]
    public void Model_create_rejects_a_null_body() =>
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutModel.Create(CalloutVariant.Info, null!));

    [Fact]
    public void Navigate_action_rejects_a_null_label_and_empty_href()
    {
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutAction.Navigate(null!, "/x"));
        Assert.Throws<System.ArgumentException>(() => InlineCalloutAction.Navigate("Go", string.Empty));
    }

    [Fact]
    public void Action_factories_reject_a_null_label()
    {
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutAction.Invoke(null!));
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutAction.Inert(null!));
        Assert.Throws<System.ArgumentNullException>(() => InlineCalloutAction.Create(null!));
    }
}
