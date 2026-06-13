using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the <c>AlertBanner</c> shared surface's UI-thread-free logic — the registration metadata
/// (slug, the banner / dismiss automation ids, the status / alert roles + polite / assertive live settings, the
/// close glyph, the dismiss i18n key + fallback, the shared accent token keys, and the border / background / body
/// tint alphas reproducing the web <c>border-*/20</c> / <c>bg-*/5</c> / <c>text-*/80</c> scale), the pure
/// <see cref="AlertBannerProjection"/> across every state (collapsed when there is no alert or it was dismissed,
/// visible otherwise; every variant's accent / role / live urgency; the optional title and icon branches; the
/// dismissible flag; the composed accessible name), the <see cref="AlertBannerViewModel"/> state holder (initial
/// projection, reprojection on a source change, the ephemeral dismissal that collapses and raises <c>Closed</c>, the
/// re-arm on fresh content, subscription cleanup), the <see cref="StaticAlertBannerSource"/> seam, and the PII-safe
/// diagnostics. Mirrors the web spec one-for-one (web/src/components/feedback/AlertBanner.tsx). The WinUI view itself
/// (shared-surfaces/AlertBanner.cs) is exercised by the app build.
/// </summary>
public sealed class AlertBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static AlertBannerProjection Project(AlertBannerModel? model, bool dismissed = false) =>
        AlertBannerProjection.Project(model, dismissed, Localizer);

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("AlertBanner", AlertBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_are_stable()
    {
        Assert.Equal("alert-banner", AlertBannerRegistration.BannerAutomationId);
        Assert.Equal("alert-banner-dismiss", AlertBannerRegistration.DismissAutomationId);
    }

    [Fact]
    public void Roles_and_live_settings_describe_a_status_and_an_alert_region()
    {
        Assert.Equal("status", AlertBannerRegistration.StatusRole);
        Assert.Equal("alert", AlertBannerRegistration.AlertRole);
        Assert.Equal("polite", AlertBannerRegistration.PoliteLiveSetting);
        Assert.Equal("assertive", AlertBannerRegistration.AssertiveLiveSetting);
    }

    [Fact]
    public void Dismiss_glyph_is_the_segoe_fluent_chrome_close() =>
        Assert.Equal("\uE711", AlertBannerRegistration.DismissGlyph);

    [Fact]
    public void Dismiss_i18n_key_and_fallback_match_the_facade_contract()
    {
        Assert.Equal("translation.alert.banner.dismiss", AlertBannerRegistration.DismissKey);
        Assert.Equal("Dismiss", AlertBannerRegistration.DismissFallback);
        Assert.Equal("Dismiss", AlertBannerRegistration.ResolveDismissLabel(Localizer));
    }

    [Fact]
    public void Tint_alphas_match_the_web_tailwind_scale()
    {
        Assert.Equal(0.20, AlertBannerRegistration.BorderOpacity);          // web border-*/20
        Assert.Equal(0.06, AlertBannerRegistration.BackgroundOpacity);      // web bg-*/5 (nudged)
        Assert.Equal(0.80, AlertBannerRegistration.BodyForegroundOpacity);  // web text-*/80
    }

    [Theory]
    [InlineData(CalloutVariant.Info, "TsColorInfoBrush")]
    [InlineData(CalloutVariant.Success, "TsColorSuccessBrush")]
    [InlineData(CalloutVariant.Warning, "TsColorWarningBrush")]
    [InlineData(CalloutVariant.Danger, "TsColorDangerBrush")]
    public void Registration_accent_brush_key_matches_the_shared_callout_accent(CalloutVariant variant, string key)
    {
        Assert.Equal(key, AlertBannerRegistration.AccentBrushKey(variant));
        Assert.Equal(CalloutVariants.AccentBrushKey(variant), AlertBannerRegistration.AccentBrushKey(variant));
    }

    [Theory]
    [InlineData(CalloutVariant.Info)]
    [InlineData(CalloutVariant.Success)]
    [InlineData(CalloutVariant.Warning)]
    [InlineData(CalloutVariant.Danger)]
    public void Registration_glyph_matches_the_shared_callout_glyph(CalloutVariant variant) =>
        Assert.Equal(CalloutVariants.Glyph(variant), AlertBannerRegistration.Glyph(variant));

    [Theory]
    [InlineData(CalloutVariant.Info, "status", "polite")]
    [InlineData(CalloutVariant.Success, "status", "polite")]
    [InlineData(CalloutVariant.Warning, "status", "polite")]
    [InlineData(CalloutVariant.Danger, "alert", "assertive")]
    public void Registration_role_and_live_setting_follow_the_variant(CalloutVariant variant, string role, string live)
    {
        Assert.Equal(role, AlertBannerRegistration.RoleFor(variant));
        Assert.Equal(live, AlertBannerRegistration.LiveSettingFor(variant));
    }

    [Fact]
    public void Compose_accessible_name_joins_the_title_and_body()
    {
        Assert.Equal("Heads up. Vehicle is offline", AlertBannerRegistration.ComposeAccessibleName("Heads up", "Vehicle is offline"));
        Assert.Equal("Heads up", AlertBannerRegistration.ComposeAccessibleName("Heads up", string.Empty));
        Assert.Equal("Vehicle is offline", AlertBannerRegistration.ComposeAccessibleName(string.Empty, "Vehicle is offline"));
        Assert.Equal(string.Empty, AlertBannerRegistration.ComposeAccessibleName(string.Empty, string.Empty));
    }

    // ── projection: visibility gating (collapsed = the empty / dismissed state) ───────────────────────────

    [Fact]
    public void Projection_is_collapsed_when_there_is_no_alert()
    {
        AlertBannerProjection p = Project(model: null);

        Assert.False(p.IsVisible);
        Assert.Equal(CalloutVariant.Info, p.Variant);
        Assert.Equal(string.Empty, p.Title);
        Assert.Equal(string.Empty, p.Body);
        // The dismiss label is still resolved so it is ready the instant an alert is shown.
        Assert.Equal("Dismiss", p.DismissLabel);
    }

    [Fact]
    public void Projection_is_shown_when_an_alert_is_present()
    {
        AlertBannerProjection p = Project(AlertBannerModel.Create(CalloutVariant.Info, "Beta feature"));

        Assert.True(p.IsVisible);
        Assert.Equal("Beta feature", p.Body);
    }

    [Fact]
    public void Projection_is_collapsed_when_dismissed_even_with_an_alert()
    {
        AlertBannerProjection p = Project(
            AlertBannerModel.Create(CalloutVariant.Danger, "Tesla connection expired", dismissible: true),
            dismissed: true);

        Assert.False(p.IsVisible);
    }

    // ── projection: per-variant accent / role / live urgency ──────────────────────────────────────────────

    [Theory]
    [InlineData(CalloutVariant.Info, "TsColorInfoBrush", "status", "polite", false)]
    [InlineData(CalloutVariant.Success, "TsColorSuccessBrush", "status", "polite", false)]
    [InlineData(CalloutVariant.Warning, "TsColorWarningBrush", "status", "polite", false)]
    [InlineData(CalloutVariant.Danger, "TsColorDangerBrush", "alert", "assertive", true)]
    public void Projection_maps_each_variant_to_its_accent_and_assistive_tech_contract(
        CalloutVariant variant,
        string accentKey,
        string role,
        string live,
        bool assertive)
    {
        AlertBannerProjection p = Project(AlertBannerModel.Create(variant, "Body"));

        Assert.Equal(variant, p.Variant);
        Assert.Equal(accentKey, p.AccentBrushKey);
        Assert.Equal(role, p.Role);
        Assert.Equal(live, p.LiveSetting);
        Assert.Equal(assertive, p.IsAssertive);
    }

    [Fact]
    public void Projection_carries_the_web_tint_alphas()
    {
        AlertBannerProjection p = Project(AlertBannerModel.Create(CalloutVariant.Warning, "Body"));

        Assert.Equal(0.20, p.BorderOpacity);
        Assert.Equal(0.06, p.BackgroundOpacity);
        Assert.Equal(0.80, p.BodyForegroundOpacity);
    }

    // ── projection: title branch (web `title && ...`) ─────────────────────────────────────────────────────

    [Fact]
    public void Projection_renders_the_title_when_supplied()
    {
        AlertBannerProjection p = Project(AlertBannerModel.Create(CalloutVariant.Info, "Body", title: "Heads up"));

        Assert.True(p.HasTitle);
        Assert.Equal("Heads up", p.Title);
        Assert.Equal("Heads up. Body", p.AccessibleName);
    }

    [Fact]
    public void Projection_omits_the_title_when_absent_or_empty()
    {
        Assert.False(Project(AlertBannerModel.Create(CalloutVariant.Info, "Body")).HasTitle);
        Assert.False(Project(AlertBannerModel.Create(CalloutVariant.Info, "Body", title: string.Empty)).HasTitle);
        Assert.Equal("Body", Project(AlertBannerModel.Create(CalloutVariant.Info, "Body")).AccessibleName);
    }

    // ── projection: icon branch (web `icon && ...`) ───────────────────────────────────────────────────────

    [Fact]
    public void Projection_omits_the_icon_by_default()
    {
        AlertBannerProjection p = Project(AlertBannerModel.Create(CalloutVariant.Info, "Body"));

        Assert.False(p.HasIcon);
        Assert.Null(p.IconGlyph);
    }

    [Fact]
    public void Projection_renders_the_icon_when_a_glyph_is_supplied()
    {
        string glyph = AlertBannerRegistration.Glyph(CalloutVariant.Warning);
        AlertBannerProjection p = Project(AlertBannerModel.Create(CalloutVariant.Warning, "Body", iconGlyph: glyph));

        Assert.True(p.HasIcon);
        Assert.Equal(glyph, p.IconGlyph);
    }

    // ── projection: dismissible branch (web `onClose && ...`) ─────────────────────────────────────────────

    [Fact]
    public void Projection_reflects_the_dismissible_flag()
    {
        Assert.False(Project(AlertBannerModel.Create(CalloutVariant.Info, "Body")).Dismissible);
        Assert.True(Project(AlertBannerModel.Create(CalloutVariant.Info, "Body", dismissible: true)).Dismissible);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void View_model_starts_collapsed_with_an_empty_source()
    {
        var source = new StaticAlertBannerSource();
        using var vm = new AlertBannerViewModel(Localizer, source);

        Assert.False(vm.IsVisible);
        Assert.Null(vm.CurrentModel);
    }

    [Fact]
    public void View_model_starts_visible_when_the_source_is_seeded()
    {
        var source = new StaticAlertBannerSource(AlertBannerModel.Create(CalloutVariant.Success, "Saved"));
        using var vm = new AlertBannerViewModel(Localizer, source);

        Assert.True(vm.IsVisible);
        Assert.Equal("Saved", vm.Body);
    }

    [Fact]
    public void View_model_reprojects_when_the_source_supplies_an_alert()
    {
        var source = new StaticAlertBannerSource();
        using var vm = new AlertBannerViewModel(Localizer, source);
        Assert.False(vm.IsVisible);

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(AlertBannerModel.Create(CalloutVariant.Warning, "Vehicle is offline"));

        Assert.True(vm.IsVisible);
        Assert.Equal("Vehicle is offline", vm.Body);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void View_model_does_not_reproject_for_an_unchanged_alert()
    {
        var model = AlertBannerModel.Create(CalloutVariant.Info, "Beta feature");
        var source = new StaticAlertBannerSource(model);
        using var vm = new AlertBannerViewModel(Localizer, source);

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;

        source.Set(AlertBannerModel.Create(CalloutVariant.Info, "Beta feature"));

        Assert.Equal(0, raised);
    }

    [Fact]
    public void View_model_dismiss_collapses_and_raises_closed()
    {
        var source = new StaticAlertBannerSource(
            AlertBannerModel.Create(CalloutVariant.Danger, "Tesla connection expired", dismissible: true));
        using var vm = new AlertBannerViewModel(Localizer, source);
        Assert.True(vm.IsVisible);

        int closed = 0;
        vm.Closed += (_, _) => closed++;

        vm.Dismiss();

        Assert.False(vm.IsVisible);
        Assert.Equal(1, closed);
    }

    [Fact]
    public void View_model_dismiss_is_a_noop_when_the_alert_is_not_dismissible()
    {
        var source = new StaticAlertBannerSource(AlertBannerModel.Create(CalloutVariant.Info, "Beta feature"));
        using var vm = new AlertBannerViewModel(Localizer, source);

        int closed = 0;
        vm.Closed += (_, _) => closed++;

        vm.Dismiss();

        Assert.True(vm.IsVisible);
        Assert.Equal(0, closed);
    }

    [Fact]
    public void View_model_re_arms_when_fresh_content_arrives_after_a_dismissal()
    {
        var source = new StaticAlertBannerSource(
            AlertBannerModel.Create(CalloutVariant.Warning, "Vehicle is offline", dismissible: true));
        using var vm = new AlertBannerViewModel(Localizer, source);

        vm.Dismiss();
        Assert.False(vm.IsVisible);

        source.Set(AlertBannerModel.Create(CalloutVariant.Warning, "Vehicle is back offline", dismissible: true));

        Assert.True(vm.IsVisible);
        Assert.Equal("Vehicle is back offline", vm.Body);
    }

    [Fact]
    public void View_model_unsubscribes_on_dispose()
    {
        var source = new StaticAlertBannerSource();
        var vm = new AlertBannerViewModel(Localizer, source);
        vm.Dispose();

        int raised = 0;
        vm.PropertyChanged += (_, _) => raised++;
        source.Set(AlertBannerModel.Create(CalloutVariant.Info, "Beta feature"));

        Assert.Equal(0, raised);
    }

    // ── source ────────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_source_set_updates_current_and_raises_changed()
    {
        var source = new StaticAlertBannerSource();
        int raised = 0;
        source.Changed += (_, _) => raised++;

        var model = AlertBannerModel.Create(CalloutVariant.Info, "Beta feature");
        source.Set(model);

        Assert.Same(model, source.Current);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_clear_collapses_and_raises_changed()
    {
        var source = new StaticAlertBannerSource(AlertBannerModel.Create(CalloutVariant.Info, "Beta feature"));
        int raised = 0;
        source.Changed += (_, _) => raised++;

        source.Clear();

        Assert.Null(source.Current);
        Assert.Equal(1, raised);
    }

    // ── diagnostics (view.opened, PII-safe — never the title or body) ─────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new AlertBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AlertBanner", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_counts_repeated_opens()
    {
        var diagnostics = new AlertBannerDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── argument guards ───────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Project_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => AlertBannerProjection.Project(null, dismissed: false, null!));

    [Fact]
    public void Model_create_rejects_a_null_body() =>
        Assert.Throws<System.ArgumentNullException>(() => AlertBannerModel.Create(CalloutVariant.Info, null!));

    [Fact]
    public void Compose_accessible_name_rejects_null_parts()
    {
        Assert.Throws<System.ArgumentNullException>(() => AlertBannerRegistration.ComposeAccessibleName(null!, "Body"));
        Assert.Throws<System.ArgumentNullException>(() => AlertBannerRegistration.ComposeAccessibleName("Title", null!));
    }

    [Fact]
    public void Resolve_dismiss_label_rejects_a_null_localizer() =>
        Assert.Throws<System.ArgumentNullException>(() => AlertBannerRegistration.ResolveDismissLabel(null!));

    [Fact]
    public void View_model_rejects_null_dependencies()
    {
        var source = new StaticAlertBannerSource();
        Assert.Throws<System.ArgumentNullException>(() => new AlertBannerViewModel(null!, source));
        Assert.Throws<System.ArgumentNullException>(() => new AlertBannerViewModel(Localizer, null!));
    }
}
