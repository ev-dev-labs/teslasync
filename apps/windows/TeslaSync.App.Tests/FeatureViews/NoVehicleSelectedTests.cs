using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>NoVehicleSelected</c> feature surface's UI-thread-free logic — the
/// copy-projection adapter (the web <c>title ?? t(…)</c> / <c>description ?? t(…)</c> fallbacks and the
/// always-localized call-to-action), the render-ready display + accessible name, the one-shot
/// <c>view.opened</c> diagnostic, the call-to-action navigation dispatch, and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/features/onboarding/components/NoVehicleSelected.tsx). The WinUI view itself
/// is exercised by the app build.
/// </summary>
public sealed class NoVehicleSelectedTests
{
    private const string PageTitle = "Battery Health";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_constants_are_stable()
    {
        Assert.Equal("NoVehicleSelected", NoVehicleSelectedRegistration.Slug);
        Assert.Equal("translation.common.noVehicleSelected.title", NoVehicleSelectedRegistration.TitleKey);
        Assert.Equal("translation.common.noVehicleSelected.desc", NoVehicleSelectedRegistration.MessageKey);
        Assert.Equal("translation.common.noVehicleSelected.action", NoVehicleSelectedRegistration.ActionKey);
        Assert.Equal("No vehicle selected", NoVehicleSelectedRegistration.TitleFallback);
        Assert.Equal("Add a vehicle to your fleet to see data on this page.", NoVehicleSelectedRegistration.MessageFallback);
        Assert.Equal("Set up TeslaSync", NoVehicleSelectedRegistration.ActionFallback);
        Assert.Equal("Onboarding", NoVehicleSelectedRegistration.OnboardingRouteName);
        Assert.Equal("/onboarding", NoVehicleSelectedRegistration.OnboardingHref);
        Assert.Equal("\uE804", NoVehicleSelectedRegistration.CarGlyph);
    }

    // ── ProjectDisplay (the copy adapter): default i18n copy, prop overrides, always-localized action ─────

    [Fact]
    public void Display_resolves_the_default_localized_copy_when_no_overrides()
    {
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, null, Localizer);

        Assert.Equal(PageTitle, display.PageTitle);
        Assert.Equal("No vehicle selected", display.Title);
        Assert.Equal("Add a vehicle to your fleet to see data on this page.", display.Message);
        Assert.Equal("Set up TeslaSync", display.ActionText);
    }

    [Fact]
    public void Display_prefers_the_title_override_over_the_i18n_copy()
    {
        // Web parity: title ?? t('common.noVehicleSelected.title', …) — an explicit prop wins.
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, "Pick a vehicle", null, Localizer);

        Assert.Equal("Pick a vehicle", display.Title);
        Assert.Equal("Add a vehicle to your fleet to see data on this page.", display.Message);
    }

    [Fact]
    public void Display_prefers_the_description_override_over_the_i18n_copy()
    {
        // Web parity: description ?? t('common.noVehicleSelected.desc', …) — an explicit prop wins.
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, "Connect a car first", Localizer);

        Assert.Equal("No vehicle selected", display.Title);
        Assert.Equal("Connect a car first", display.Message);
    }

    [Fact]
    public void Display_honours_both_overrides_while_the_action_stays_localized()
    {
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, "Custom title", "Custom message", Localizer);

        Assert.Equal("Custom title", display.Title);
        Assert.Equal("Custom message", display.Message);
        Assert.Equal("Set up TeslaSync", display.ActionText);
    }

    [Fact]
    public void Display_composes_a_non_empty_automation_name_from_title_and_message()
    {
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, null, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Equal("No vehicle selected. Add a vehicle to your fleet to see data on this page.", display.AutomationName);
    }

    [Fact]
    public void Display_copy_flows_through_the_registration_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, null, localizer);

        Assert.Contains(NoVehicleSelectedRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(NoVehicleSelectedRegistration.MessageKey, localizer.RequestedKeys);
        Assert.Contains(NoVehicleSelectedRegistration.ActionKey, localizer.RequestedKeys);
    }

    [Fact]
    public void Display_override_short_circuits_the_overridden_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        NoVehicleSelectedProjection.ProjectDisplay(PageTitle, "t", "d", localizer);

        // Overrides win, so only the action key is resolved through the facade (web title/description props).
        Assert.DoesNotContain(NoVehicleSelectedRegistration.TitleKey, localizer.RequestedKeys);
        Assert.DoesNotContain(NoVehicleSelectedRegistration.MessageKey, localizer.RequestedKeys);
        Assert.Contains(NoVehicleSelectedRegistration.ActionKey, localizer.RequestedKeys);
    }

    // ── Accessibility: a Narrator name on the surface and a label on the interactive call-to-action ───────

    [Fact]
    public void Display_provides_an_accessible_name_and_an_action_label()
    {
        var display = NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, null, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.False(string.IsNullOrWhiteSpace(display.ActionText));
    }

    // ── ViewModel: projects the display, marks opened once, dispatches the call-to-action ────────────────

    [Fact]
    public void ViewModel_projects_the_page_title_and_localized_copy()
    {
        var vm = new NoVehicleSelectedViewModel(new RecordingNavigator(), Localizer, PageTitle);

        Assert.Equal(PageTitle, vm.Display.PageTitle);
        Assert.Equal("No vehicle selected", vm.Display.Title);
        Assert.False(vm.HasOpened);
    }

    [Fact]
    public void MarkOpened_emits_view_opened_once_and_is_idempotent()
    {
        var captured = new List<string>();
        var vm = new NoVehicleSelectedViewModel(
            new RecordingNavigator(),
            Localizer,
            PageTitle,
            diagnostics: new NoVehicleSelectedDiagnostics(captured.Add));

        vm.MarkOpened();
        vm.MarkOpened();
        vm.MarkOpened();

        Assert.True(vm.HasOpened);
        Assert.Equal("view.opened slug=NoVehicleSelected", Assert.Single(captured));
    }

    [Fact]
    public void RequestSetup_navigates_to_onboarding_and_records_the_activation()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new NoVehicleSelectedViewModel(
            navigator,
            Localizer,
            PageTitle,
            diagnostics: new NoVehicleSelectedDiagnostics(captured.Add));

        vm.RequestSetup();

        Assert.Equal(1, navigator.OnboardingNavigations);
        Assert.Equal("no-vehicle.setup-requested slug=NoVehicleSelected", Assert.Single(captured));
    }

    [Fact]
    public void RequestSetup_can_be_invoked_for_each_activation()
    {
        var navigator = new RecordingNavigator();
        var vm = new NoVehicleSelectedViewModel(navigator, Localizer, PageTitle);

        vm.RequestSetup();
        vm.RequestSetup();

        Assert.Equal(2, navigator.OnboardingNavigations);
    }

    // ── Diagnostics (P1/S11): view.opened / setup-requested slug, counts, no payload ─────────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new NoVehicleSelectedDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=NoVehicleSelected", Assert.Single(captured));
    }

    [Fact]
    public void Diagnostics_records_setup_requested_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new NoVehicleSelectedDiagnostics(captured.Add);

        diagnostics.RecordSetupRequested();

        Assert.Equal(1, diagnostics.SetupRequests);
        var line = Assert.Single(captured);
        Assert.Equal("no-vehicle.setup-requested slug=NoVehicleSelected", line);
        Assert.EndsWith("slug=NoVehicleSelected", line, StringComparison.Ordinal);
    }

    [Fact]
    public void Diagnostics_are_inert_without_a_sink()
    {
        var diagnostics = new NoVehicleSelectedDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordSetupRequested();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal(1, diagnostics.SetupRequests);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProjectDisplay_rejects_null_required_arguments()
    {
        Assert.Throws<ArgumentNullException>(
            () => NoVehicleSelectedProjection.ProjectDisplay(null!, null, null, Localizer));
        Assert.Throws<ArgumentNullException>(
            () => NoVehicleSelectedProjection.ProjectDisplay(PageTitle, null, null, null!));
    }

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new NoVehicleSelectedViewModel(null!, Localizer, PageTitle));
        Assert.Throws<ArgumentNullException>(() =>
            new NoVehicleSelectedViewModel(new RecordingNavigator(), null!, PageTitle));
        Assert.Throws<ArgumentNullException>(() =>
            new NoVehicleSelectedViewModel(new RecordingNavigator(), Localizer, null!));
    }

    // ── Test doubles ─────────────────────────────────────────────────────────────────────────────────────

    private sealed class RecordingNavigator : INoVehicleSelectedNavigator
    {
        public int OnboardingNavigations { get; private set; }

        public void NavigateToOnboarding() => OnboardingNavigations++;
    }

    private sealed class KeyCapturingLocalizer : ILocalizer
    {
        public List<string> RequestedKeys { get; } = [];

        public string GetString(string key, string fallback)
        {
            RequestedKeys.Add(key);
            return fallback;
        }
    }
}
