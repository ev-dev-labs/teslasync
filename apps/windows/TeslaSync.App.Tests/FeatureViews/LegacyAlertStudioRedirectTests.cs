using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LegacyAlertStudioRedirect</c> feature surface's UI-thread-free logic — the
/// query-preserving redirect projection (the web <c>`/notifications/studio${search}`</c> + <c>replace</c>), the
/// render-ready display copy, the bound current-location state holder, the one-shot navigation dispatch and the
/// PII-safe diagnostics. Mirrors the web spec
/// (web/src/features/notifications/components/LegacyAlertStudioRedirect.tsx). The WinUI view itself is exercised by
/// the app build.
/// </summary>
public sealed class LegacyAlertStudioRedirectTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // ── NormalizeSearch: the web search (already "?…" or empty) plus hardening for bare / lone-"?" inputs ──

    [Theory]
    [InlineData(null, "")]
    [InlineData("", "")]
    [InlineData("   ", "")]
    [InlineData("?", "")]
    [InlineData("?signals=a,b", "?signals=a,b")]
    [InlineData("?id=42&from=signal-diff", "?id=42&from=signal-diff")]
    [InlineData("id=42", "?id=42")]
    [InlineData("  ?id=42  ", "?id=42")]
    public void NormalizeSearch_yields_single_leading_question_mark_or_empty(string? input, string expected) =>
        Assert.Equal(expected, LegacyAlertStudioRedirectProjection.NormalizeSearch(input));

    // ── Resolve: the redirect intent (RoutePath / Search / Href / Replace) ───────────────────────────────

    [Fact]
    public void Resolve_targets_the_notifications_studio_route_with_replace()
    {
        var target = LegacyAlertStudioRedirectProjection.Resolve(null);

        Assert.Equal("notifications/studio", target.RoutePath);
        Assert.True(target.Replace);
        Assert.Equal(string.Empty, target.Search);
        Assert.False(target.HasSearch);
    }

    [Fact]
    public void Resolve_preserves_the_query_string()
    {
        var target = LegacyAlertStudioRedirectProjection.Resolve("?rule=7&from=signal-diff");

        Assert.Equal("notifications/studio", target.RoutePath);
        Assert.Equal("?rule=7&from=signal-diff", target.Search);
        Assert.True(target.HasSearch);
    }

    [Theory]
    [InlineData("", "/notifications/studio")]
    [InlineData("?id=42", "/notifications/studio?id=42")]
    public void Resolve_href_matches_the_web_navigate_target(string search, string expectedHref)
    {
        // Web parity: `/notifications/studio${search}` for canonical react-router search values.
        var target = LegacyAlertStudioRedirectProjection.Resolve(search);

        Assert.Equal(expectedHref, target.Href);
        Assert.Equal(LegacyAlertStudioRedirectRegistration.TargetHrefPrefix + target.Search, target.Href);
    }

    // ── ProjectDisplay: localized copy + accessible name (the single state renders a non-blank surface) ──

    [Fact]
    public void Display_resolves_the_localized_title_and_message()
    {
        var display = LegacyAlertStudioRedirectProjection.ProjectDisplay("?a=b", Localizer);

        Assert.Equal("Redirecting\u2026", display.Title);
        Assert.Equal("Taking you to Alert Studio", display.Message);
        Assert.Equal("?a=b", display.Target.Search);
    }

    [Fact]
    public void Display_renders_a_non_blank_surface_in_the_single_redirecting_state()
    {
        // The web source has exactly one deterministic state; the native surface must still draw something.
        var display = LegacyAlertStudioRedirectProjection.ProjectDisplay(null, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.Title));
        Assert.False(string.IsNullOrWhiteSpace(display.Message));
        Assert.Equal("notifications/studio", display.Target.RoutePath);
    }

    [Fact]
    public void Display_composes_a_non_empty_automation_name_from_title_and_message()
    {
        var display = LegacyAlertStudioRedirectProjection.ProjectDisplay(null, Localizer);

        Assert.False(string.IsNullOrWhiteSpace(display.AutomationName));
        Assert.Equal("Redirecting\u2026. Taking you to Alert Studio", display.AutomationName);
    }

    [Fact]
    public void Display_copy_flows_through_the_registration_i18n_keys()
    {
        var localizer = new KeyCapturingLocalizer();

        LegacyAlertStudioRedirectProjection.ProjectDisplay(null, localizer);

        Assert.Contains(LegacyAlertStudioRedirectRegistration.TitleKey, localizer.RequestedKeys);
        Assert.Contains(LegacyAlertStudioRedirectRegistration.MessageKey, localizer.RequestedKeys);
    }

    // ── ViewModel: binds the location state holder, dispatches the redirect once ──────────────────────────

    [Fact]
    public void ViewModel_reads_the_query_from_the_bound_location_state_holder()
    {
        var vm = new LegacyAlertStudioRedirectViewModel(
            new FakeLocation("?id=42"), new RecordingNavigator(), Localizer);

        Assert.Equal("?id=42", vm.Target.Search);
        Assert.Equal("/notifications/studio?id=42", vm.Display.Target.Href);
    }

    [Fact]
    public void Run_dispatches_the_resolved_target_to_the_navigator()
    {
        var navigator = new RecordingNavigator();
        var vm = new LegacyAlertStudioRedirectViewModel(new FakeLocation("?from=signal-diff"), navigator, Localizer);

        vm.Run();

        var target = Assert.Single(navigator.Requests);
        Assert.Equal("notifications/studio", target.RoutePath);
        Assert.Equal("?from=signal-diff", target.Search);
        Assert.True(target.Replace);
        Assert.True(vm.HasRedirected);
    }

    [Fact]
    public void Run_is_idempotent_and_navigates_exactly_once()
    {
        var navigator = new RecordingNavigator();
        var captured = new List<string>();
        var vm = new LegacyAlertStudioRedirectViewModel(
            new FakeLocation(string.Empty),
            navigator,
            Localizer,
            new LegacyAlertStudioRedirectDiagnostics(captured.Add));

        vm.Run();
        vm.Run();
        vm.Run();

        Assert.Single(navigator.Requests);
        Assert.Single(captured);
    }

    // ── Diagnostics (P1/S11): view.opened slug=LegacyAlertStudioRedirect, never the query ────────────────

    [Fact]
    public void Diagnostics_records_view_opened_with_surface_slug()
    {
        var captured = new List<string>();
        var diagnostics = new LegacyAlertStudioRedirectDiagnostics(captured.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=LegacyAlertStudioRedirect", Assert.Single(captured));
    }

    [Fact]
    public void Run_never_leaks_the_query_string_to_diagnostics()
    {
        var captured = new List<string>();
        var vm = new LegacyAlertStudioRedirectViewModel(
            new FakeLocation("?vehicle_id=7&token=secret"),
            new RecordingNavigator(),
            Localizer,
            new LegacyAlertStudioRedirectDiagnostics(captured.Add));

        vm.Run();

        var line = Assert.Single(captured);
        Assert.Equal("view.opened slug=LegacyAlertStudioRedirect", line);
        Assert.DoesNotContain("vehicle_id", line, StringComparison.Ordinal);
        Assert.DoesNotContain("token", line, StringComparison.Ordinal);
        Assert.DoesNotContain("secret", line, StringComparison.Ordinal);
    }

    // ── Registration metadata is stable ──────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_constants_are_stable()
    {
        Assert.Equal("LegacyAlertStudioRedirect", LegacyAlertStudioRedirectRegistration.Slug);
        Assert.Equal("alert-studio", LegacyAlertStudioRedirectRegistration.SourcePath);
        Assert.Equal("notifications/studio", LegacyAlertStudioRedirectRegistration.TargetRoutePath);
        Assert.Equal("/notifications/studio", LegacyAlertStudioRedirectRegistration.TargetHrefPrefix);
    }

    // ── Argument validation ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ProjectDisplay_rejects_a_null_localizer() =>
        Assert.Throws<ArgumentNullException>(
            () => LegacyAlertStudioRedirectProjection.ProjectDisplay(null, null!));

    [Fact]
    public void ViewModel_rejects_null_dependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertStudioRedirectViewModel(null!, new RecordingNavigator(), Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertStudioRedirectViewModel(new FakeLocation(string.Empty), null!, Localizer));
        Assert.Throws<ArgumentNullException>(() =>
            new LegacyAlertStudioRedirectViewModel(new FakeLocation(string.Empty), new RecordingNavigator(), null!));
    }

    // ── Test doubles ─────────────────────────────────────────────────────────────────────────────────────

    private sealed class FakeLocation(string search) : ILegacyAlertStudioRedirectLocation
    {
        public string Search { get; } = search;
    }

    private sealed class RecordingNavigator : ILegacyAlertStudioRedirectNavigator
    {
        public List<LegacyAlertStudioRedirectTarget> Requests { get; } = [];

        public void Redirect(LegacyAlertStudioRedirectTarget target) => Requests.Add(target);
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
