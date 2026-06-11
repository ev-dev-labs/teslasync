using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the CookieConsentBanner shared surface's UI-thread-free logic — the registration
/// metadata (slug, the dialog/control automation ids, the role + modality contract, the shield glyph, the storage
/// key + persisted tokens, and the i18n keys with their verbatim web fallbacks), the pure consent helpers
/// (<see cref="CookieConsentBannerRegistration.ParseConsent"/>,
/// <see cref="CookieConsentBannerRegistration.ToStorageValue"/>,
/// <see cref="CookieConsentBannerRegistration.IsReportingAllowed"/>), the
/// <see cref="RepositoryCookieConsentRequirementSource.ReadRequireConsent"/> flag reader, the pure
/// <see cref="CookieConsentBannerProjection"/> (the visibility gate, the toggle-label flip, the localized
/// strings, and the accessible name/description contract), the requirement seams
/// (<see cref="StaticCookieConsentRequirementSource"/> / <see cref="RepositoryCookieConsentRequirementSource"/>
/// across the cache-then-network states), the consent stores
/// (<see cref="InMemoryCookieConsentStore"/> / <see cref="DelegatedCookieConsentStore"/>), the
/// <see cref="CookieConsentBannerViewModel"/> state holder (initial projection, reprojection on both sources, the
/// toggle + accept/decline actions, the reporting gate, and subscription cleanup), and the PII-safe diagnostics.
/// Mirrors the web spec (web/src/components/feedback/CookieConsentBanner.tsx + web/src/lib/cookieConsent.ts). The
/// WinUI view itself (shared-surfaces/CookieConsentBanner.cs) is exercised by the app build.
/// </summary>
public sealed class CookieConsentBannerTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static CookieConsentBannerProjection Project(
        bool requireConsent,
        CookieConsentState consent,
        bool showDetails = false,
        ILocalizer? localizer = null) =>
        CookieConsentBannerProjection.Project(requireConsent, consent, showDetails, localizer ?? Localizer);

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    // ── registration ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Registration_slug_matches_the_web_surface() =>
        Assert.Equal("CookieConsentBanner", CookieConsentBannerRegistration.Slug);

    [Fact]
    public void Automation_ids_match_the_web_test_ids()
    {
        Assert.Equal("cookie-consent-banner", CookieConsentBannerRegistration.BannerAutomationId);
        Assert.Equal("cookie-consent-toggle-details", CookieConsentBannerRegistration.ToggleDetailsAutomationId);
        Assert.Equal("cookie-consent-details", CookieConsentBannerRegistration.DetailsAutomationId);
        Assert.Equal("cookie-consent-accept", CookieConsentBannerRegistration.AcceptAutomationId);
        Assert.Equal("cookie-consent-decline", CookieConsentBannerRegistration.DeclineAutomationId);
    }

    [Fact]
    public void Role_is_a_non_modal_dialog()
    {
        Assert.Equal("dialog", CookieConsentBannerRegistration.DialogRole);
        Assert.False(CookieConsentBannerRegistration.IsModal);
    }

    [Fact]
    public void Shield_glyph_matches_the_shared_fluent_stand_in() =>
        Assert.Equal("\uEA18", CookieConsentBannerRegistration.ShieldGlyph);

    [Fact]
    public void Storage_contract_matches_the_web_helper()
    {
        Assert.Equal("teslasync:consent:v1", CookieConsentBannerRegistration.ConsentStorageKey);
        Assert.Equal("accepted", CookieConsentBannerRegistration.AcceptedStorageValue);
        Assert.Equal("declined", CookieConsentBannerRegistration.DeclinedStorageValue);
    }

    [Fact]
    public void I18n_keys_resolve_under_the_shared_consent_namespace()
    {
        string[] keys =
        {
            CookieConsentBannerRegistration.TitleKey,
            CookieConsentBannerRegistration.BodyKey,
            CookieConsentBannerRegistration.HideDetailsKey,
            CookieConsentBannerRegistration.ManageKey,
            CookieConsentBannerRegistration.AcceptKey,
            CookieConsentBannerRegistration.DeclineKey,
            CookieConsentBannerRegistration.EssentialTitleKey,
            CookieConsentBannerRegistration.AlwaysOnKey,
            CookieConsentBannerRegistration.EssentialBodyKey,
            CookieConsentBannerRegistration.AnalyticsTitleKey,
            CookieConsentBannerRegistration.AnalyticsBodyKey,
        };

        Assert.All(keys, key => Assert.StartsWith("translation.consent.", key, StringComparison.Ordinal));
    }

    [Fact]
    public void I18n_fallbacks_match_the_web_literals_verbatim()
    {
        Assert.Equal("Cookies & analytics", CookieConsentBannerRegistration.TitleFallback);
        Assert.Equal("Hide details", CookieConsentBannerRegistration.HideDetailsFallback);
        Assert.Equal("Manage preferences", CookieConsentBannerRegistration.ManageFallback);
        Assert.Equal("Accept all", CookieConsentBannerRegistration.AcceptFallback);
        Assert.Equal("Decline non-essential", CookieConsentBannerRegistration.DeclineFallback);
        Assert.Equal("Strictly necessary", CookieConsentBannerRegistration.EssentialTitleFallback);
        Assert.Equal("Always on", CookieConsentBannerRegistration.AlwaysOnFallback);
        Assert.Equal("Performance & error reporting", CookieConsentBannerRegistration.AnalyticsTitleFallback);
        Assert.StartsWith("TeslaSync uses strictly necessary storage", CookieConsentBannerRegistration.BodyFallback, StringComparison.Ordinal);
        Assert.Contains("Settings → Privacy", CookieConsentBannerRegistration.BodyFallback, StringComparison.Ordinal);
        Assert.StartsWith("Authentication, session, theme", CookieConsentBannerRegistration.EssentialBodyFallback, StringComparison.Ordinal);
        Assert.StartsWith("Anonymous Core Web Vitals", CookieConsentBannerRegistration.AnalyticsBodyFallback, StringComparison.Ordinal);
    }

    // ── consent helpers ───────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("accepted", CookieConsentState.Accepted)]
    [InlineData("declined", CookieConsentState.Declined)]
    [InlineData(null, CookieConsentState.Unknown)]
    [InlineData("", CookieConsentState.Unknown)]
    [InlineData("Accepted", CookieConsentState.Unknown)]
    [InlineData("garbage", CookieConsentState.Unknown)]
    public void ParseConsent_maps_only_the_exact_tokens(string? raw, CookieConsentState expected) =>
        Assert.Equal(expected, CookieConsentBannerRegistration.ParseConsent(raw));

    [Theory]
    [InlineData(CookieConsentState.Accepted, "accepted")]
    [InlineData(CookieConsentState.Declined, "declined")]
    [InlineData(CookieConsentState.Unknown, null)]
    public void ToStorageValue_round_trips_decisions(CookieConsentState state, string? expected) =>
        Assert.Equal(expected, CookieConsentBannerRegistration.ToStorageValue(state));

    [Theory]
    [InlineData(false, CookieConsentState.Unknown, true)]
    [InlineData(false, CookieConsentState.Declined, true)]
    [InlineData(false, CookieConsentState.Accepted, true)]
    [InlineData(true, CookieConsentState.Accepted, true)]
    [InlineData(true, CookieConsentState.Unknown, false)]
    [InlineData(true, CookieConsentState.Declined, false)]
    public void IsReportingAllowed_gates_on_consent(bool requireConsent, CookieConsentState consent, bool expected) =>
        Assert.Equal(expected, CookieConsentBannerRegistration.IsReportingAllowed(requireConsent, consent));

    // ── require_cookie_consent reader ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void ReadRequireConsent_reads_the_snake_case_flag() =>
        Assert.True(RepositoryCookieConsentRequirementSource.ReadRequireConsent(Json("{\"require_cookie_consent\":true}")));

    [Fact]
    public void ReadRequireConsent_reads_the_camel_case_flag() =>
        Assert.True(RepositoryCookieConsentRequirementSource.ReadRequireConsent(Json("{\"requireCookieConsent\":true}")));

    [Fact]
    public void ReadRequireConsent_accepts_a_stringified_boolean() =>
        Assert.True(RepositoryCookieConsentRequirementSource.ReadRequireConsent(Json("{\"require_cookie_consent\":\"true\"}")));

    [Theory]
    [InlineData("{\"require_cookie_consent\":false}")]
    [InlineData("{\"other\":true}")]
    [InlineData("{}")]
    [InlineData("\"not-an-object\"")]
    [InlineData("123")]
    public void ReadRequireConsent_defaults_to_false(string raw) =>
        Assert.False(RepositoryCookieConsentRequirementSource.ReadRequireConsent(Json(raw)));

    // ── projection ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Projection_is_hidden_when_consent_is_not_required() =>
        Assert.False(Project(requireConsent: false, CookieConsentState.Unknown).IsVisible);

    [Fact]
    public void Projection_is_visible_only_when_required_and_undecided()
    {
        Assert.True(Project(requireConsent: true, CookieConsentState.Unknown).IsVisible);
        Assert.False(Project(requireConsent: true, CookieConsentState.Accepted).IsVisible);
        Assert.False(Project(requireConsent: true, CookieConsentState.Declined).IsVisible);
    }

    [Fact]
    public void Projection_exposes_the_localized_prompt_and_categories()
    {
        var projection = Project(requireConsent: true, CookieConsentState.Unknown);

        Assert.Equal("Cookies & analytics", projection.Title);
        Assert.StartsWith("TeslaSync uses strictly necessary storage", projection.Body, StringComparison.Ordinal);
        Assert.Equal("Strictly necessary", projection.EssentialTitle);
        Assert.Equal("Always on", projection.EssentialAlwaysOnLabel);
        Assert.StartsWith("Authentication, session, theme", projection.EssentialBody, StringComparison.Ordinal);
        Assert.Equal("Performance & error reporting", projection.AnalyticsTitle);
        Assert.StartsWith("Anonymous Core Web Vitals", projection.AnalyticsBody, StringComparison.Ordinal);
        Assert.Equal("Accept all", projection.AcceptLabel);
        Assert.Equal("Decline non-essential", projection.DeclineLabel);
    }

    [Fact]
    public void Projection_toggle_label_flips_with_show_details()
    {
        Assert.Equal("Manage preferences", Project(true, CookieConsentState.Unknown, showDetails: false).ToggleLabel);
        Assert.Equal("Hide details", Project(true, CookieConsentState.Unknown, showDetails: true).ToggleLabel);
    }

    [Fact]
    public void Projection_carries_the_show_details_state()
    {
        Assert.False(Project(true, CookieConsentState.Unknown, showDetails: false).ShowDetails);
        Assert.True(Project(true, CookieConsentState.Unknown, showDetails: true).ShowDetails);
    }

    [Fact]
    public void Projection_accessible_name_and_description_are_the_title_and_body()
    {
        var projection = Project(requireConsent: true, CookieConsentState.Unknown);

        Assert.Equal(projection.Title, projection.AccessibleName);
        Assert.Equal(projection.Body, projection.Description);
        Assert.False(string.IsNullOrWhiteSpace(projection.AccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(projection.Description));
    }

    [Fact]
    public void Projection_interactive_labels_are_non_empty_for_narrator()
    {
        var projection = Project(requireConsent: true, CookieConsentState.Unknown);

        Assert.False(string.IsNullOrWhiteSpace(projection.ToggleLabel));
        Assert.False(string.IsNullOrWhiteSpace(projection.AcceptLabel));
        Assert.False(string.IsNullOrWhiteSpace(projection.DeclineLabel));
        Assert.False(string.IsNullOrWhiteSpace(projection.EssentialAlwaysOnLabel));
    }

    // ── requirement seams ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Static_requirement_source_raises_changed_only_on_a_real_move()
    {
        var source = new StaticCookieConsentRequirementSource(requireConsent: false);
        var changes = 0;
        source.Changed += (_, _) => changes++;

        source.Set(false);
        Assert.Equal(0, changes);

        source.Set(true);
        Assert.True(source.RequireConsent);
        Assert.Equal(1, changes);
    }

    [Fact]
    public async Task Repository_requirement_source_reads_the_flag_from_the_version_stream()
    {
        var source = new RepositoryCookieConsentRequirementSource(Stream, autoStart: false);
        var settled = new TaskCompletionSource();
        source.Changed += (_, _) =>
        {
            if (source.RequireConsent)
            {
                settled.TrySetResult();
            }
        };

        source.Refresh();
        await settled.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(source.RequireConsent);
        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            yield return RepositoryResult<JsonElement>.Loading();
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<JsonElement>.Loaded(Json("{\"require_cookie_consent\":true}"), DateTimeOffset.UnixEpoch);
        }
    }

    [Fact]
    public async Task Repository_requirement_source_keeps_hidden_for_value_less_states()
    {
        var source = new RepositoryCookieConsentRequirementSource(Stream, autoStart: false);
        source.Refresh();

        // Drain the stream: loading/empty/error all carry no value -> require stays false (banner hidden).
        await Task.Delay(50);

        Assert.False(source.RequireConsent);
        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            yield return RepositoryResult<JsonElement>.Loading();
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<JsonElement>.Empty();
            yield return RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Unknown, "boom"));
        }
    }

    [Fact]
    public async Task Repository_requirement_source_honours_an_offline_cached_flag()
    {
        var source = new RepositoryCookieConsentRequirementSource(Stream, autoStart: false);
        var settled = new TaskCompletionSource();
        source.Changed += (_, _) =>
        {
            if (source.RequireConsent)
            {
                settled.TrySetResult();
            }
        };

        source.Refresh();
        await settled.Task.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(source.RequireConsent);
        source.Dispose();

        static async IAsyncEnumerable<RepositoryResult<JsonElement>> Stream(
            [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            await Task.Yield();
            cancellationToken.ThrowIfCancellationRequested();
            yield return RepositoryResult<JsonElement>.OfflineCached(
                Json("{\"require_cookie_consent\":true}"),
                DateTimeOffset.UnixEpoch,
                new RepositoryError(RepositoryErrorKind.Network, "offline"));
        }
    }

    // ── consent stores ────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void In_memory_store_reports_and_commits_decisions()
    {
        var store = new InMemoryCookieConsentStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;

        Assert.Equal(CookieConsentState.Unknown, store.GetConsent());

        store.SetConsent(CookieConsentState.Accepted);
        Assert.Equal(CookieConsentState.Accepted, store.GetConsent());
        Assert.Equal(1, store.WriteCount);
        Assert.Equal(1, changes);

        // A no-op set neither writes nor notifies.
        store.SetConsent(CookieConsentState.Accepted);
        Assert.Equal(1, store.WriteCount);
        Assert.Equal(1, changes);
    }

    [Fact]
    public void Delegated_store_reads_and_writes_the_raw_token()
    {
        string? cell = null;
        var store = new DelegatedCookieConsentStore(() => cell, value => cell = value);
        var changes = 0;
        store.Changed += (_, _) => changes++;

        Assert.Equal(CookieConsentState.Unknown, store.GetConsent());

        store.SetConsent(CookieConsentState.Declined);
        Assert.Equal("declined", cell);
        Assert.Equal(CookieConsentState.Declined, store.GetConsent());
        Assert.Equal(1, changes);

        store.SetConsent(CookieConsentState.Unknown);
        Assert.Null(cell);
    }

    [Fact]
    public void Delegated_store_swallows_storage_failures()
    {
        var store = new DelegatedCookieConsentStore(
            () => throw new InvalidOperationException("read blocked"),
            _ => throw new InvalidOperationException("write blocked"));
        var changes = 0;
        store.Changed += (_, _) => changes++;

        // A throwing read collapses to unknown; a throwing write is swallowed but still notifies subscribers.
        Assert.Equal(CookieConsentState.Unknown, store.GetConsent());
        store.SetConsent(CookieConsentState.Accepted);
        Assert.Equal(1, changes);
    }

    // ── view-model ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_initial_projection_reflects_the_seams()
    {
        using var vm = new CookieConsentBannerViewModel(
            Localizer,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            new InMemoryCookieConsentStore());

        Assert.True(vm.IsVisible);
        Assert.True(vm.RequireConsent);
        Assert.Equal(CookieConsentState.Unknown, vm.Consent);
        Assert.False(vm.ShowDetails);
        Assert.False(vm.IsReportingAllowed);
    }

    [Fact]
    public void ViewModel_toggles_details_and_notifies()
    {
        using var vm = new CookieConsentBannerViewModel(
            Localizer,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            new InMemoryCookieConsentStore());
        var notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.ToggleDetails();

        Assert.True(vm.ShowDetails);
        Assert.True(vm.Projection.ShowDetails);
        Assert.Equal("Hide details", vm.Projection.ToggleLabel);
        Assert.Equal(1, notifications);
    }

    [Fact]
    public void ViewModel_accept_persists_and_hides_the_banner()
    {
        var store = new InMemoryCookieConsentStore();
        using var vm = new CookieConsentBannerViewModel(
            Localizer,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            store);
        var notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.Accept();

        Assert.Equal(CookieConsentState.Accepted, store.GetConsent());
        Assert.Equal(CookieConsentState.Accepted, vm.Consent);
        Assert.False(vm.IsVisible);
        Assert.True(vm.IsReportingAllowed);
        Assert.Equal(1, notifications);
    }

    [Fact]
    public void ViewModel_decline_persists_and_hides_the_banner()
    {
        var store = new InMemoryCookieConsentStore();
        using var vm = new CookieConsentBannerViewModel(
            Localizer,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            store);

        vm.Decline();

        Assert.Equal(CookieConsentState.Declined, store.GetConsent());
        Assert.False(vm.IsVisible);
        Assert.False(vm.IsReportingAllowed);
    }

    [Fact]
    public void ViewModel_reprojects_when_the_requirement_resolves()
    {
        var requirement = new StaticCookieConsentRequirementSource(requireConsent: false);
        using var vm = new CookieConsentBannerViewModel(Localizer, requirement, new InMemoryCookieConsentStore());
        Assert.False(vm.IsVisible);

        requirement.Set(true);

        Assert.True(vm.IsVisible);
    }

    [Fact]
    public void ViewModel_reprojects_when_an_external_decision_is_stored()
    {
        var store = new InMemoryCookieConsentStore();
        using var vm = new CookieConsentBannerViewModel(
            Localizer,
            new StaticCookieConsentRequirementSource(requireConsent: true),
            store);
        Assert.True(vm.IsVisible);

        // A decision recorded elsewhere (e.g. another window / the privacy panel) re-renders the banner away.
        store.SetConsent(CookieConsentState.Accepted);

        Assert.Equal(CookieConsentState.Accepted, vm.Consent);
        Assert.False(vm.IsVisible);
    }

    [Fact]
    public void ViewModel_stops_reprojecting_after_dispose()
    {
        var requirement = new StaticCookieConsentRequirementSource(requireConsent: false);
        var store = new InMemoryCookieConsentStore();
        var vm = new CookieConsentBannerViewModel(Localizer, requirement, store);
        var notifications = 0;
        vm.PropertyChanged += (_, _) => notifications++;

        vm.Dispose();
        requirement.Set(true);
        store.SetConsent(CookieConsentState.Declined);

        Assert.Equal(0, notifications);
    }

    // ── diagnostics ───────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_records_only_the_view_opened_event_with_the_surface_slug()
    {
        var lines = new List<string>();
        var diagnostics = new CookieConsentBannerDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(new[] { "view.opened slug=CookieConsentBanner", "view.opened slug=CookieConsentBanner" }, lines);
    }
}
