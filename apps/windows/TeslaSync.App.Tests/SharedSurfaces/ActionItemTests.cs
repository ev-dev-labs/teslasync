using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces.ActionItemSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>ActionItem</c> shared surface's UI-thread-free logic — the registration
/// metadata (slug, the link / button CTA roles, the chevron glyph, the primary / secondary text brush keys, and
/// the severity → shared <see cref="CalloutVariant"/> accent / glyph mapping), the parity visual constants (icon
/// / title / description / CTA / chevron sizes, the tint / ring alphas and the CTA min-height), the pure
/// <see cref="ActionItemProjection"/> across every severity (the accent + glyph, the always-primary title and
/// always-secondary description), the optional-description branch, every CTA render branch (no CTA / inert CTA /
/// internal link / external link / button, with the web <c>to</c> &gt; <c>onClick</c> precedence and the
/// <c>external</c> flag), the composed accessible-name contract (title, then description) plus the separate CTA
/// accessible name, the PII-safe diagnostics, and the argument guards. Mirrors the web spec one-for-one
/// (<c>web/src/components/status/ActionItem.tsx</c>). The WinUI view itself (shared-surfaces/ActionItem.cs) is
/// exercised by the app build.
/// </summary>
public sealed class ActionItemTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static ActionItemDisplay Project(ActionItemModel model) =>
        ActionItemProjection.Project(model, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("ActionItem", ActionItemRegistration.Slug);

    [Fact]
    public void Registration_roles_match_the_web_cta_branches()
    {
        // web `cta.to` → `<a>`/`<Link>` (link); `cta.onClick` → `<button>` (button).
        Assert.Equal("button", ActionItemRegistration.ButtonRole);
        Assert.Equal("link", ActionItemRegistration.LinkRole);
    }

    [Fact]
    public void Registration_chevron_glyph_is_the_segoe_fluent_chevron_right() =>
        Assert.Equal("\uE76C", ActionItemRegistration.ChevronGlyph);

    [Fact]
    public void Registration_text_brush_keys_are_the_token_primary_and_secondary()
    {
        // web title `text-[var(--text-primary)]`, description `text-[var(--text-secondary)]`.
        Assert.Equal("TsColorTextPrimaryBrush", ActionItemRegistration.PrimaryTextBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", ActionItemRegistration.SecondaryTextBrushKey);
    }

    [Theory]
    [InlineData(ActionSeverity.Info, CalloutVariant.Info)]
    [InlineData(ActionSeverity.Warn, CalloutVariant.Warning)]
    [InlineData(ActionSeverity.Error, CalloutVariant.Danger)]
    public void Registration_maps_severity_to_the_shared_callout_variant(ActionSeverity severity, CalloutVariant variant) =>
        Assert.Equal(variant, ActionItemRegistration.Variant(severity));

    [Theory]
    [InlineData(ActionSeverity.Info, "TsColorInfoBrush")]
    [InlineData(ActionSeverity.Warn, "TsColorWarningBrush")]
    [InlineData(ActionSeverity.Error, "TsColorDangerBrush")]
    public void Registration_accent_brush_key_matches_the_shared_callout_accent(ActionSeverity severity, string key)
    {
        Assert.Equal(key, ActionItemRegistration.AccentBrushKey(severity));
        Assert.Equal(
            CalloutVariants.AccentBrushKey(ActionItemRegistration.Variant(severity)),
            ActionItemRegistration.AccentBrushKey(severity));
    }

    [Theory]
    [InlineData(ActionSeverity.Info)]
    [InlineData(ActionSeverity.Warn)]
    [InlineData(ActionSeverity.Error)]
    public void Registration_glyph_matches_the_shared_callout_glyph(ActionSeverity severity) =>
        Assert.Equal(
            CalloutVariants.Glyph(ActionItemRegistration.Variant(severity)),
            ActionItemRegistration.Glyph(severity));

    // ── parity visual constants ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_visual_constants_match_the_web_tailwind_scale()
    {
        Assert.Equal(20, ActionItemProjection.IconSize);          // web h-5 w-5
        Assert.Equal(14, ActionItemProjection.TitleFontSize);     // web text-sm
        Assert.Equal(12, ActionItemProjection.DescriptionFontSize); // web text-xs
        Assert.Equal(12, ActionItemProjection.CtaFontSize);       // web text-xs
        Assert.Equal(14, ActionItemProjection.ChevronSize);       // web h-3.5 w-3.5
        Assert.Equal(0.10, ActionItemProjection.BackgroundTintOpacity); // web bg-*-500/10
        Assert.Equal(0.20, ActionItemProjection.RingOpacity);     // web ring-*-400/20
        Assert.Equal(36, ActionItemProjection.CtaMinHeight);      // web min-h-[36px]
    }

    // ── severity colour / glyph (web SEVERITY_CFG) ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(ActionSeverity.Info)]
    [InlineData(ActionSeverity.Warn)]
    [InlineData(ActionSeverity.Error)]
    public void Severity_drives_the_accent_and_glyph_with_neutral_title_and_description(ActionSeverity severity)
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(severity, "Run backup", "Last run 8 days ago"));

        Assert.Equal(ActionItemRegistration.Variant(severity), d.Variant);
        Assert.Equal(ActionItemRegistration.AccentBrushKey(severity), d.AccentBrushKey);
        Assert.Equal(ActionItemRegistration.Glyph(severity), d.IconGlyph);

        // The title is always primary text and the description always secondary, regardless of severity.
        Assert.Equal("TsColorTextPrimaryBrush", d.TitleBrushKey);
        Assert.Equal("TsColorTextSecondaryBrush", d.DescriptionBrushKey);

        Assert.Equal(0.10, d.BackgroundTintOpacity);
        Assert.Equal(0.20, d.RingOpacity);
    }

    // ── description branch (web `description && ...`) ─────────────────────────────────────────────────────

    [Fact]
    public void Description_is_absent_by_default()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(ActionSeverity.Info, "Re-authorize Tesla"));

        Assert.False(d.HasDescription);
        Assert.Equal(string.Empty, d.Description);
    }

    [Fact]
    public void Empty_description_renders_no_sub_line()
    {
        // web: `{description && (...)}` is falsy for "", so an empty description renders nothing.
        ActionItemDisplay d = Project(ActionItemModel.Create(ActionSeverity.Info, "Title", string.Empty));

        Assert.False(d.HasDescription);
        Assert.Equal(string.Empty, d.Description);
    }

    [Fact]
    public void Description_is_rendered_when_supplied()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(ActionSeverity.Warn, "Update available", "v1.2.0 \u2192 v1.3.0"));

        Assert.True(d.HasDescription);
        Assert.Equal("v1.2.0 \u2192 v1.3.0", d.Description);
    }

    // ── CTA branch: none (web `cta` undefined → `ActionCTA` not rendered) ─────────────────────────────────

    [Fact]
    public void No_cta_renders_nothing_interactive()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(ActionSeverity.Info, "Title"));

        Assert.False(d.HasCta);
        Assert.Equal(ActionItemInteraction.None, d.Interaction);
        Assert.Equal(string.Empty, d.CtaLabel);
        Assert.Equal(string.Empty, d.CtaRole);
        Assert.Null(d.CtaHref);
        Assert.False(d.CtaIsExternal);
        Assert.Equal(string.Empty, d.CtaAccessibleName);
    }

    [Fact]
    public void Inert_cta_without_to_or_onclick_renders_no_cta()
    {
        // web `ActionCTA` returns null when the cta has neither `to` nor `onClick`.
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Info,
            "Title",
            cta: ActionItemCta.Create("Go")));

        Assert.False(d.HasCta);
        Assert.Equal(ActionItemInteraction.None, d.Interaction);
        Assert.Equal(string.Empty, d.CtaRole);
    }

    // ── CTA branch: internal navigation link (web `cta.to` → `<Link>`) ────────────────────────────────────

    [Fact]
    public void Internal_to_renders_a_routing_link()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Warn,
            "Review anomalies",
            cta: ActionItemCta.NavigateInternal("View drives", "/drives")));

        Assert.True(d.HasCta);
        Assert.Equal(ActionItemInteraction.Navigate, d.Interaction);
        Assert.Equal("link", d.CtaRole);
        Assert.Equal("View drives", d.CtaLabel);
        Assert.Equal("/drives", d.CtaHref);
        Assert.False(d.CtaIsExternal);
        Assert.Equal("View drives", d.CtaAccessibleName);
    }

    // ── CTA branch: external navigation link (web `cta.to` + `external` → `<a target=_blank>`) ────────────

    [Fact]
    public void External_to_renders_a_new_tab_link()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Error,
            "Install update",
            cta: ActionItemCta.NavigateExternal("Release notes", "https://example.com/notes")));

        Assert.True(d.HasCta);
        Assert.Equal(ActionItemInteraction.Navigate, d.Interaction);
        Assert.Equal("link", d.CtaRole);
        Assert.Equal("https://example.com/notes", d.CtaHref);
        Assert.True(d.CtaIsExternal);
    }

    // ── CTA branch: in-app button (web `cta.onClick` → `<button>`) ────────────────────────────────────────

    [Fact]
    public void OnClick_renders_an_in_app_button()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Info,
            "Dismiss alert",
            cta: ActionItemCta.Invoke("Dismiss")));

        Assert.True(d.HasCta);
        Assert.Equal(ActionItemInteraction.Invoke, d.Interaction);
        Assert.Equal("button", d.CtaRole);
        Assert.Equal("Dismiss", d.CtaLabel);
        Assert.Null(d.CtaHref);
        Assert.False(d.CtaIsExternal);
    }

    // ── CTA precedence (web `cta.to` wins over `cta.onClick`) ─────────────────────────────────────────────

    [Fact]
    public void Cta_create_prefers_to_over_onclick()
    {
        var cta = ActionItemCta.Create("Go", to: "/x", hasOnClick: true);

        Assert.Equal(ActionItemInteraction.Navigate, cta.Interaction);
        Assert.Equal("/x", cta.Href);
    }

    [Fact]
    public void Cta_create_carries_the_external_flag_on_the_navigation_branch()
    {
        var cta = ActionItemCta.Create("Go", to: "https://x", external: true);

        Assert.Equal(ActionItemInteraction.Navigate, cta.Interaction);
        Assert.True(cta.IsExternal);
    }

    [Fact]
    public void Cta_create_falls_back_to_onclick_without_a_to()
    {
        var cta = ActionItemCta.Create("Go", to: null, hasOnClick: true);

        Assert.Equal(ActionItemInteraction.Invoke, cta.Interaction);
        Assert.Null(cta.Href);
    }

    [Fact]
    public void Cta_create_treats_an_empty_to_as_no_to()
    {
        // web: `cta.to` is falsy for "", so an empty `to` falls through to `onClick`.
        var cta = ActionItemCta.Create("Go", to: string.Empty, hasOnClick: true);

        Assert.Equal(ActionItemInteraction.Invoke, cta.Interaction);
    }

    [Fact]
    public void Cta_create_is_inert_without_to_or_onclick()
    {
        var cta = ActionItemCta.Create("Go");

        Assert.Equal(ActionItemInteraction.None, cta.Interaction);
        Assert.Null(cta.Href);
        Assert.False(cta.IsExternal);
    }

    [Fact]
    public void Internal_navigation_ignores_any_external_intent_on_a_relative_route()
    {
        var cta = ActionItemCta.NavigateInternal("View", "/drives");

        Assert.False(cta.IsExternal);
    }

    // ── accessibility: composed row name (title, then description) ────────────────────────────────────────

    [Fact]
    public void Accessible_name_is_the_title_when_there_is_no_description() =>
        Assert.Equal("Run backup", Project(ActionItemModel.Create(ActionSeverity.Info, "Run backup")).AutomationName);

    [Fact]
    public void Accessible_name_appends_the_description()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Warn,
            "Update available",
            "v1.2.0 to v1.3.0"));

        Assert.Equal("Update available, v1.2.0 to v1.3.0", d.AutomationName);
    }

    [Fact]
    public void Accessible_name_is_the_description_when_the_title_is_empty()
    {
        ActionItemDisplay d = Project(ActionItemModel.Create(ActionSeverity.Info, string.Empty, "Only a description"));

        Assert.Equal("Only a description", d.AutomationName);
    }

    [Fact]
    public void Accessible_name_is_empty_when_there_is_no_title_or_description() =>
        Assert.Equal(string.Empty, Project(ActionItemModel.Create(ActionSeverity.Info, string.Empty)).AutomationName);

    [Fact]
    public void Cta_carries_its_own_accessible_name_separate_from_the_row()
    {
        // The row name is the title/description; the focusable CTA is named by its label (not folded into the row).
        ActionItemDisplay d = Project(ActionItemModel.Create(
            ActionSeverity.Warn,
            "Review anomalies",
            "3 found",
            ActionItemCta.NavigateInternal("View", "/drives")));

        Assert.Equal("Review anomalies, 3 found", d.AutomationName);
        Assert.Equal("View", d.CtaAccessibleName);
    }

    // ── diagnostics (view.opened, PII-safe — never the title, description or CTA label) ───────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ActionItemDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ActionItem", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new ActionItemDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_model() =>
        Assert.Throws<System.ArgumentNullException>(() => ActionItemProjection.Project(null!, Localizer));

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => ActionItemProjection.Project(ActionItemModel.Empty, null!));

    [Fact]
    public void Model_create_rejects_a_null_title() =>
        Assert.Throws<System.ArgumentNullException>(() => ActionItemModel.Create(ActionSeverity.Info, null!));

    [Fact]
    public void Navigate_factories_reject_a_null_label_and_empty_target()
    {
        Assert.Throws<System.ArgumentNullException>(() => ActionItemCta.NavigateInternal(null!, "/x"));
        Assert.Throws<System.ArgumentException>(() => ActionItemCta.NavigateInternal("Go", string.Empty));
        Assert.Throws<System.ArgumentNullException>(() => ActionItemCta.NavigateExternal(null!, "https://x"));
        Assert.Throws<System.ArgumentException>(() => ActionItemCta.NavigateExternal("Go", string.Empty));
    }

    [Fact]
    public void Cta_factories_reject_a_null_label()
    {
        Assert.Throws<System.ArgumentNullException>(() => ActionItemCta.Invoke(null!));
        Assert.Throws<System.ArgumentNullException>(() => ActionItemCta.Create(null!));
    }
}
