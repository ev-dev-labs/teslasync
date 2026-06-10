using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the PrivacySection's UI-thread-free logic — the require_cookie_consent JSON
/// reader and cache-then-network result mapper (the web <c>useVersionInfo</c> adapter), the copy projections
/// (consent state label, consent body, stored-count), the cookie-consent and confirm-silence client stores,
/// and the state-holder view-model's recent-pages / consent / requirement flows (loading / ready / stale /
/// offline / error), the silence-aware clear confirmation, the i18n key + fallback contract, and the PII-safe
/// diagnostics. Mirrors the web spec (web/src/features/settings/components/PrivacySection.tsx +
/// web/src/lib/recentPages.ts + cookieConsent.ts + confirmSilence.ts). The WinUI view itself
/// (PrivacySection.cs) is exercised by the app build.
/// </summary>
public sealed class PrivacySectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 0, 0, TimeSpan.Zero);

    private const string VersionJsonRequired = """{"chart_version":"v2.5.0","require_cookie_consent":true}""";
    private const string VersionJsonNotRequired = """{"chart_version":"v2.5.0","require_cookie_consent":false}""";
    private const string VersionJsonNoFlag = """{"chart_version":"v2.5.0"}""";

    // ── JSON adapter: require_cookie_consent (web Boolean(versionQuery.data?.require_cookie_consent)) ─────

    [Fact]
    public void ReadRequireConsent_true_for_boolean_true()
    {
        using var doc = JsonDocument.Parse(VersionJsonRequired);
        Assert.True(PrivacySectionJson.ReadRequireConsent(doc.RootElement));
    }

    [Theory]
    [InlineData(VersionJsonNotRequired)]   // explicit false
    [InlineData(VersionJsonNoFlag)]        // absent → Boolean(undefined) === false
    [InlineData("{}")]                     // empty object
    [InlineData("""{"require_cookie_consent":"true"}""")] // a string, not a JSON bool
    [InlineData("""{"require_cookie_consent":1}""")]      // a number, not a JSON bool
    public void ReadRequireConsent_false_for_anything_but_boolean_true(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.False(PrivacySectionJson.ReadRequireConsent(doc.RootElement));
    }

    [Theory]
    [InlineData("5")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    [InlineData("[]")]
    public void ReadRequireConsent_false_for_non_object(string json)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.False(PrivacySectionJson.ReadRequireConsent(doc.RootElement));
    }

    // ── Result mapper: cache-then-network status → require_cookie_consent flag (the adapter) ─────────────

    [Fact]
    public void Map_loading_yields_loading()
    {
        var mapped = ConsentRequirementResultMapper.Map(RepositoryResult<JsonElement>.Loading());
        Assert.Equal(LoadStatus.Loading, mapped.Status);
    }

    [Fact]
    public void Map_cached_projects_the_flag_and_preserves_stale_and_fetched_at()
    {
        using var doc = JsonDocument.Parse(VersionJsonRequired);
        var mapped = ConsentRequirementResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));

        Assert.Equal(LoadStatus.Cached, mapped.Status);
        Assert.True(mapped.Value);
        Assert.True(mapped.IsStale);
        Assert.Equal(Now, mapped.FetchedAt);
    }

    [Fact]
    public void Map_refreshing_projects_the_flag()
    {
        using var doc = JsonDocument.Parse(VersionJsonNotRequired);
        var mapped = ConsentRequirementResultMapper.Map(
            RepositoryResult<JsonElement>.Refreshing(doc.RootElement, Now, stale: false));

        Assert.Equal(LoadStatus.Refreshing, mapped.Status);
        Assert.False(mapped.Value);
    }

    [Fact]
    public void Map_loaded_projects_the_flag()
    {
        using var doc = JsonDocument.Parse(VersionJsonRequired);
        var mapped = ConsentRequirementResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.True(mapped.Value);
        Assert.Equal(Now, mapped.FetchedAt);
    }

    [Fact]
    public void Map_empty_yields_empty()
    {
        var mapped = ConsentRequirementResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Map_offline_projects_the_cached_flag_and_carries_the_error()
    {
        using var doc = JsonDocument.Parse(VersionJsonRequired);
        var error = new RepositoryError(RepositoryErrorKind.Network, "Offline");
        var mapped = ConsentRequirementResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, error));

        Assert.Equal(LoadStatus.Offline, mapped.Status);
        Assert.True(mapped.Value);
        Assert.Equal(error, mapped.Error);
    }

    [Fact]
    public void Map_error_yields_failure_with_the_error()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom", 500);
        var mapped = ConsentRequirementResultMapper.Map(RepositoryResult<JsonElement>.Failure(error));

        Assert.Equal(LoadStatus.Error, mapped.Status);
        Assert.Equal(error, mapped.Error);
    }

    [Fact]
    public void Map_object_without_the_flag_loads_as_false()
    {
        using var doc = JsonDocument.Parse(VersionJsonNoFlag);
        var mapped = ConsentRequirementResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));

        Assert.Equal(LoadStatus.Loaded, mapped.Status);
        Assert.False(mapped.Value);
    }

    // ── Projection: consent label, consent body, stored count (web inline copy) ──────────────────────────

    [Theory]
    [InlineData(PrivacyConsentState.Accepted, "Accepted \u2014 performance & error reporting on")]
    [InlineData(PrivacyConsentState.Declined, "Declined \u2014 only essential storage in use")]
    [InlineData(PrivacyConsentState.Unknown, "Not decided \u2014 banner will appear on next visit")]
    public void ConsentStateLabel_maps_each_decision(PrivacyConsentState state, string expected) =>
        Assert.Equal(expected, PrivacySectionProjection.ConsentStateLabel(state, Localizer));

    [Fact]
    public void ConsentBody_selects_on_or_off_copy()
    {
        Assert.Equal(
            PrivacySectionRegistration.ConsentBodyOn(Localizer),
            PrivacySectionProjection.ConsentBody(true, Localizer));
        Assert.Equal(
            PrivacySectionRegistration.ConsentBodyOff(Localizer),
            PrivacySectionProjection.ConsentBody(false, Localizer));
    }

    [Theory]
    [InlineData(0, "0 entries stored")]
    [InlineData(1, "1 entries stored")]
    [InlineData(12, "12 entries stored")]
    public void RecentCountLabel_formats_the_count(int count, string expected) =>
        Assert.Equal(expected, PrivacySectionProjection.RecentCountLabel(count, Localizer));

    [Fact]
    public void RecentCountLabel_clamps_a_negative_count_to_zero() =>
        Assert.Equal("0 entries stored", PrivacySectionProjection.RecentCountLabel(-4, Localizer));

    // ── Consent store (web cookieConsent.ts) ─────────────────────────────────────────────────────────────

    [Fact]
    public void ConsentSource_defaults_to_unknown()
    {
        var consent = new ConsentSource();
        Assert.Equal(PrivacyConsentState.Unknown, consent.Current);
    }

    [Fact]
    public void ConsentSource_seeds_from_the_persisted_token()
    {
        Assert.Equal(PrivacyConsentState.Accepted, new ConsentSource(() => ConsentSource.AcceptedToken).Current);
        Assert.Equal(PrivacyConsentState.Declined, new ConsentSource(() => ConsentSource.DeclinedToken).Current);
        Assert.Equal(PrivacyConsentState.Unknown, new ConsentSource(() => null).Current);
        Assert.Equal(PrivacyConsentState.Unknown, new ConsentSource(() => "garbage").Current);
    }

    [Fact]
    public void ConsentSource_accept_decline_reset_change_state_persist_and_signal()
    {
        string? persisted = "seed";
        var consent = new ConsentSource(() => null, token => persisted = token);
        int changes = 0;
        consent.Changed += (_, _) => changes++;

        consent.Accept();
        Assert.Equal(PrivacyConsentState.Accepted, consent.Current);
        Assert.Equal(ConsentSource.AcceptedToken, persisted);

        consent.Decline();
        Assert.Equal(PrivacyConsentState.Declined, consent.Current);
        Assert.Equal(ConsentSource.DeclinedToken, persisted);

        consent.Reset();
        Assert.Equal(PrivacyConsentState.Unknown, consent.Current);
        Assert.Null(persisted);

        Assert.Equal(3, changes);
    }

    [Fact]
    public void ConsentSource_setting_the_same_decision_is_a_no_op()
    {
        var consent = new ConsentSource(() => ConsentSource.AcceptedToken);
        int changes = 0;
        consent.Changed += (_, _) => changes++;

        consent.Accept();

        Assert.Equal(0, changes);
    }

    [Theory]
    [InlineData(PrivacyConsentState.Accepted, "accepted")]
    [InlineData(PrivacyConsentState.Declined, "declined")]
    [InlineData(PrivacyConsentState.Unknown, null)]
    public void ConsentSource_token_round_trips(PrivacyConsentState state, string? token)
    {
        Assert.Equal(token, ConsentSource.ToToken(state));
        Assert.Equal(state, ConsentSource.ParseToken(token));
    }

    // ── Confirm-silence store (web confirmSilence.ts) ────────────────────────────────────────────────────

    [Fact]
    public void SilenceStore_starts_empty_and_silences()
    {
        var persisted = new List<string>();
        var store = new ConfirmSilenceStore(persist: keys => persisted = keys.ToList());

        Assert.False(store.IsSilenced("clear-recent-pages"));

        store.Silence("clear-recent-pages");

        Assert.True(store.IsSilenced("clear-recent-pages"));
        Assert.Equal(new[] { "clear-recent-pages" }, persisted);
    }

    [Fact]
    public void SilenceStore_seeds_from_persistence()
    {
        var store = new ConfirmSilenceStore(() => new[] { "clear-recent-pages" });
        Assert.True(store.IsSilenced("clear-recent-pages"));
    }

    [Fact]
    public void SilenceStore_ignores_a_blank_key()
    {
        int writes = 0;
        var store = new ConfirmSilenceStore(persist: _ => writes++);

        store.Silence("");

        Assert.False(store.IsSilenced(""));
        Assert.Equal(0, writes);
    }

    [Fact]
    public void SilenceStore_silencing_twice_persists_once()
    {
        int writes = 0;
        var store = new ConfirmSilenceStore(persist: _ => writes++);

        store.Silence("k");
        store.Silence("k");

        Assert.Equal(1, writes);
    }

    // ── View-model: recent pages count + clear flow ──────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_recent_count_reflects_the_store_and_gates_the_clear_action()
    {
        var recent = NewRecent("/vehicles/1", "/drives/2");
        using var vm = NewViewModel(recentPages: recent);

        Assert.Equal(2, vm.RecentCount);
        Assert.True(vm.CanClearRecentPages);
        Assert.Equal("2 entries stored", vm.RecentCountLabel);
    }

    [Fact]
    public void ViewModel_empty_recent_store_disables_the_clear_action()
    {
        using var vm = NewViewModel(recentPages: NewRecent());

        Assert.Equal(0, vm.RecentCount);
        Assert.False(vm.CanClearRecentPages);
    }

    [Fact]
    public void ViewModel_begin_clear_opens_the_confirmation()
    {
        using var vm = NewViewModel(recentPages: NewRecent("/drives/1"));

        vm.BeginClearRecentPages();

        Assert.True(vm.IsClearConfirmOpen);
        Assert.Equal(1, vm.RecentCount); // not cleared until confirmed
    }

    [Fact]
    public void ViewModel_begin_clear_is_a_no_op_when_empty()
    {
        using var vm = NewViewModel(recentPages: NewRecent());

        vm.BeginClearRecentPages();

        Assert.False(vm.IsClearConfirmOpen);
    }

    [Fact]
    public void ViewModel_confirm_clear_wipes_the_store_announces_and_closes()
    {
        var recent = NewRecent("/drives/1", "/drives/2");
        using var vm = NewViewModel(recentPages: recent);
        vm.BeginClearRecentPages();

        vm.ConfirmClearRecentPages();

        Assert.False(vm.IsClearConfirmOpen);
        Assert.Equal(0, vm.RecentCount);
        Assert.False(vm.CanClearRecentPages);
        Assert.Equal("Recent pages cleared", vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_cancel_clear_closes_without_wiping()
    {
        var recent = NewRecent("/drives/1");
        using var vm = NewViewModel(recentPages: recent);
        vm.BeginClearRecentPages();

        vm.CancelClearRecentPages();

        Assert.False(vm.IsClearConfirmOpen);
        Assert.Equal(1, vm.RecentCount);
    }

    [Fact]
    public void ViewModel_confirm_clear_with_dont_ask_again_persists_silence_and_short_circuits_next_time()
    {
        var silence = new ConfirmSilenceStore();
        var recent = NewRecent("/drives/1", "/drives/2");
        using var vm = NewViewModel(recentPages: recent, silence: silence);

        vm.BeginClearRecentPages();
        vm.ConfirmClearRecentPages(dontAskAgain: true);
        Assert.True(silence.IsSilenced(PrivacySectionRegistration.ClearSilenceKey));

        // A subsequent clear is now short-circuited: no dialog, immediate wipe.
        recent.Record("/drives/3", "Drive 3");
        vm.BeginClearRecentPages();

        Assert.False(vm.IsClearConfirmOpen);
        Assert.Equal(0, vm.RecentCount);
    }

    [Fact]
    public void ViewModel_silenced_action_clears_without_a_dialog()
    {
        var silence = new ConfirmSilenceStore(() => new[] { PrivacySectionRegistration.ClearSilenceKey });
        var recent = NewRecent("/drives/1");
        using var vm = NewViewModel(recentPages: recent, silence: silence);

        vm.BeginClearRecentPages();

        Assert.False(vm.IsClearConfirmOpen);
        Assert.Equal(0, vm.RecentCount);
        Assert.Equal("Recent pages cleared", vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_updates_live_when_a_page_is_recorded_after_construction()
    {
        var recent = NewRecent();
        using var vm = NewViewModel(recentPages: recent);
        Assert.Equal(0, vm.RecentCount);

        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        recent.Record("/drives/9", "Late Drive");

        Assert.Equal(1, vm.RecentCount);
        Assert.True(vm.CanClearRecentPages);
        Assert.Contains(nameof(PrivacySectionViewModel.RecentCount), raised);
    }

    // ── View-model: consent flow ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_consent_starts_from_the_store_and_gates_the_actions()
    {
        var consent = new ConsentSource(() => ConsentSource.AcceptedToken);
        using var vm = NewViewModel(consent: consent);

        Assert.Equal(PrivacyConsentState.Accepted, vm.ConsentState);
        Assert.False(vm.CanAcceptConsent); // web disabled={consent === 'accepted'}
        Assert.True(vm.CanDeclineConsent);
        Assert.True(vm.CanResetConsent);
        Assert.Equal("Accepted \u2014 performance & error reporting on", vm.ConsentStateLabel);
    }

    [Fact]
    public void ViewModel_accept_consent_updates_state_announces_and_records()
    {
        var lines = new List<string>();
        using var vm = NewViewModel(diagnostics: new PrivacySectionDiagnostics(lines.Add));

        vm.AcceptConsent();

        Assert.Equal(PrivacyConsentState.Accepted, vm.ConsentState);
        Assert.False(vm.CanAcceptConsent);
        Assert.Equal("Consent granted", vm.StatusMessage);
        Assert.Contains("privacy.consent.changed slug=PrivacySection", lines);
    }

    [Fact]
    public void ViewModel_decline_consent_updates_state_and_announces()
    {
        using var vm = NewViewModel();

        vm.DeclineConsent();

        Assert.Equal(PrivacyConsentState.Declined, vm.ConsentState);
        Assert.False(vm.CanDeclineConsent);
        Assert.Equal("Consent withdrawn", vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_reset_consent_returns_to_unknown_and_announces()
    {
        var consent = new ConsentSource(() => ConsentSource.AcceptedToken);
        using var vm = NewViewModel(consent: consent);

        vm.ResetConsent();

        Assert.Equal(PrivacyConsentState.Unknown, vm.ConsentState);
        Assert.False(vm.CanResetConsent);
        Assert.Equal("Consent reset \u2014 banner will reappear", vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_consent_action_at_matching_state_is_a_no_op()
    {
        var consent = new ConsentSource(() => ConsentSource.AcceptedToken);
        using var vm = NewViewModel(consent: consent);

        vm.AcceptConsent(); // already accepted

        Assert.Null(vm.StatusMessage);
    }

    [Fact]
    public void ViewModel_updates_live_when_consent_changes_externally()
    {
        var consent = new ConsentSource();
        using var vm = NewViewModel(consent: consent);
        Assert.Equal(PrivacyConsentState.Unknown, vm.ConsentState);

        consent.Accept();

        Assert.Equal(PrivacyConsentState.Accepted, vm.ConsentState);
        Assert.Equal("Accepted \u2014 performance & error reporting on", vm.ConsentStateLabel);
    }

    // ── View-model: requirement read per-state (web useVersionInfo) ──────────────────────────────────────

    [Fact]
    public void ViewModel_starts_in_the_loading_state()
    {
        using var vm = NewViewModel();
        Assert.Equal(PrivacyRequirementState.Loading, vm.RequirementState);
        Assert.False(vm.RequireConsent);
    }

    [Fact]
    public async Task ViewModel_loaded_required_shows_the_on_body()
    {
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.Loading(),
            RepositoryResult<bool>.Loaded(true, Now)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Ready, vm.RequirementState);
        Assert.True(vm.RequireConsent);
        Assert.Equal(PrivacySectionRegistration.ConsentBodyOn(Localizer), vm.ConsentBody);
        Assert.False(vm.IsError);
        Assert.Null(vm.RequirementErrorMessage);
    }

    [Fact]
    public async Task ViewModel_loaded_not_required_shows_the_off_body()
    {
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.Loaded(false, Now)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Ready, vm.RequirementState);
        Assert.False(vm.RequireConsent);
        Assert.Equal(PrivacySectionRegistration.ConsentBodyOff(Localizer), vm.ConsentBody);
    }

    [Fact]
    public async Task ViewModel_cached_stale_is_stale()
    {
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.Cached(true, Now, stale: true)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Stale, vm.RequirementState);
        Assert.True(vm.RequireConsent);
        Assert.True(vm.IsStale);
    }

    [Fact]
    public async Task ViewModel_offline_keeps_the_cached_value_and_flags_error()
    {
        var error = new RepositoryError(RepositoryErrorKind.Network, "Offline");
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.OfflineCached(true, Now, error)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Offline, vm.RequirementState);
        Assert.True(vm.RequireConsent);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_is_ready_with_the_off_body()
    {
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.Empty(Now)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Ready, vm.RequirementState);
        Assert.False(vm.RequireConsent);
        Assert.Equal(PrivacySectionRegistration.ConsentBodyOff(Localizer), vm.ConsentBody);
    }

    [Fact]
    public async Task ViewModel_error_shows_off_body_with_an_inline_retry_message()
    {
        var error = new RepositoryError(RepositoryErrorKind.Server, "boom", 500);
        using var vm = NewViewModel(requirement: new FakeRequirementSource(
            RepositoryResult<bool>.Failure(error)));

        await vm.LoadAsync();

        Assert.Equal(PrivacyRequirementState.Error, vm.RequirementState);
        Assert.False(vm.RequireConsent); // web Boolean(undefined) === false
        Assert.Equal(PrivacySectionRegistration.ConsentBodyOff(Localizer), vm.ConsentBody);
        Assert.False(string.IsNullOrWhiteSpace(vm.RequirementErrorMessage));
    }

    [Fact]
    public async Task ViewModel_retry_recovers_from_error_to_ready()
    {
        var source = new SwitchableRequirementSource(RepositoryResult<bool>.Failure(
            new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = NewViewModel(requirement: source);
        await vm.LoadAsync();
        Assert.Equal(PrivacyRequirementState.Error, vm.RequirementState);

        source.Next = RepositoryResult<bool>.Loaded(true, Now);
        await vm.RetryAsync();

        Assert.Equal(PrivacyRequirementState.Ready, vm.RequirementState);
        Assert.True(vm.RequireConsent);
    }

    // ── View-model: lifecycle ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void ViewModel_dispose_unsubscribes_from_both_stores()
    {
        var recent = NewRecent();
        var consent = new ConsentSource();
        var vm = NewViewModel(recentPages: recent, consent: consent);
        vm.Dispose();

        recent.Record("/drives/1", "Drive 1");
        consent.Accept();

        Assert.Equal(0, vm.RecentCount);
        Assert.Equal(PrivacyConsentState.Unknown, vm.ConsentState);
    }

    // ── i18n: every web key + fallback flows through the facade ──────────────────────────────────────────

    [Fact]
    public void Header_and_action_labels_resolve_through_the_localizer()
    {
        var prefix = new PrefixLocalizer();
        using var vm = NewViewModel(localizer: prefix);

        Assert.Equal("L:privacy.title", vm.Title);
        Assert.Equal("L:privacy.subtitle", vm.Subtitle);
        Assert.Equal("L:recentPages.clearButton", vm.RecentClearButton);
        Assert.Equal("L:consent.action.accept", vm.ConsentAcceptLabel);
        Assert.Equal("L:common.cancel", vm.CancelLabel);
    }

    [Fact]
    public void Every_web_i18n_key_and_fallback_is_requested_from_the_catalog()
    {
        var recording = new RecordingLocalizer();

        // Touch every keyed string the surface composes.
        _ = PrivacySectionRegistration.Title(recording);
        _ = PrivacySectionRegistration.Subtitle(recording);
        _ = PrivacySectionRegistration.RecentClearTitle(recording);
        _ = PrivacySectionRegistration.RecentClearBody(recording);
        _ = PrivacySectionRegistration.RecentStoredCountTemplate(recording);
        _ = PrivacySectionRegistration.RecentClearButton(recording);
        _ = PrivacySectionRegistration.ClearConfirmTitle(recording);
        _ = PrivacySectionRegistration.ClearConfirmBody(recording);
        _ = PrivacySectionRegistration.ClearConfirmCta(recording);
        _ = PrivacySectionRegistration.ClearedToast(recording);
        _ = PrivacySectionRegistration.ConsentSectionTitle(recording);
        _ = PrivacySectionRegistration.ConsentBodyOn(recording);
        _ = PrivacySectionRegistration.ConsentBodyOff(recording);
        _ = PrivacySectionRegistration.ConsentStateAccepted(recording);
        _ = PrivacySectionRegistration.ConsentStateDeclined(recording);
        _ = PrivacySectionRegistration.ConsentStateUnknown(recording);
        _ = PrivacySectionRegistration.ConsentActionAccept(recording);
        _ = PrivacySectionRegistration.ConsentActionDecline(recording);
        _ = PrivacySectionRegistration.ConsentActionReset(recording);
        _ = PrivacySectionRegistration.ConsentAcceptedToast(recording);
        _ = PrivacySectionRegistration.ConsentDeclinedToast(recording);
        _ = PrivacySectionRegistration.ConsentResetToast(recording);
        _ = PrivacySectionRegistration.CancelLabel(recording);
        _ = PrivacySectionRegistration.SilenceCheckbox(recording);

        Assert.Equal("Privacy", recording.Fallback("privacy.title"));
        Assert.Equal(
            "Manage local browsing history surfaces. These settings only affect this browser.",
            recording.Fallback("privacy.subtitle"));
        Assert.Equal("Recently viewed pages", recording.Fallback("recentPages.clearTitle"));
        Assert.Equal("{0} entries stored", recording.Fallback("recentPages.storedCount"));
        Assert.Equal("Clear recent pages", recording.Fallback("recentPages.clearButton"));
        Assert.Equal("Clear recent pages?", recording.Fallback("recentPages.clearConfirmTitle"));
        Assert.Equal("Clear pages", recording.Fallback("recentPages.clearConfirmCta"));
        Assert.Equal("Recent pages cleared", recording.Fallback("recentPages.cleared"));
        Assert.Equal("Cookies & analytics consent", recording.Fallback("consent.section.title"));
        Assert.Equal("Re-grant consent", recording.Fallback("consent.action.accept"));
        Assert.Equal("Withdraw consent", recording.Fallback("consent.action.decline"));
        Assert.Equal("Reset", recording.Fallback("consent.action.reset"));
        Assert.Equal("Consent granted", recording.Fallback("consent.toast.accepted"));
        Assert.Equal("Consent withdrawn", recording.Fallback("consent.toast.declined"));
        Assert.Equal("Consent reset \u2014 banner will reappear", recording.Fallback("consent.toast.reset"));
        Assert.Equal("Cancel", recording.Fallback("common.cancel"));
        Assert.Equal("Don't ask again for this action", recording.Fallback("confirm.silence.checkbox"));
    }

    // ── Accessibility: every interactive label is non-empty ──────────────────────────────────────────────

    [Fact]
    public void Every_interactive_label_has_a_non_empty_accessible_name()
    {
        using var vm = NewViewModel(recentPages: NewRecent("/drives/1"));

        foreach (var label in new[]
        {
            vm.Title, vm.Subtitle, vm.RecentClearTitle, vm.RecentClearBody, vm.RecentClearButton,
            vm.RecentCountLabel, vm.ConsentSectionTitle, vm.ConsentBody, vm.ConsentStateLabel,
            vm.ConsentAcceptLabel, vm.ConsentDeclineLabel, vm.ConsentResetLabel,
            vm.ClearConfirmTitle, vm.ClearConfirmBody, vm.ClearConfirmCta, vm.CancelLabel,
            vm.SilenceCheckboxLabel, vm.RetryLabel,
        })
        {
            Assert.False(string.IsNullOrWhiteSpace(label));
        }
    }

    // ── Diagnostics (view.opened + actions, PII-safe) ────────────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new PrivacySectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=PrivacySection", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_record_cleared_and_consent_changed_without_leaking_user_data()
    {
        var lines = new List<string>();
        var diagnostics = new PrivacySectionDiagnostics(lines.Add);

        diagnostics.RecordRecentPagesCleared();
        diagnostics.RecordConsentChanged();

        Assert.Equal(1, diagnostics.RecentPagesCleared);
        Assert.Equal(1, diagnostics.ConsentChanges);
        Assert.Contains("privacy.recentPages.cleared slug=PrivacySection", lines);
        Assert.Contains("privacy.consent.changed slug=PrivacySection", lines);
        // No path, title or consent value ever appears.
        Assert.DoesNotContain(lines, l => l.Contains("accepted") || l.Contains("declined") || l.Contains('/'));
    }

    [Fact]
    public void Diagnostics_slug_is_the_stable_surface_id() =>
        Assert.Equal("PrivacySection", PrivacySectionRegistration.Slug);

    // ── Helpers / doubles ────────────────────────────────────────────────────────────────────────────────

    private static RecentlyViewedSource NewRecent(params string[] paths)
    {
        var source = new RecentlyViewedSource(new RecentPages(PrivacySectionViewModel.RecentPagesMaxCount));
        foreach (var path in paths)
        {
            source.Record(path, path);
        }

        return source;
    }

    private static PrivacySectionViewModel NewViewModel(
        RecentlyViewedSource? recentPages = null,
        IConsentSource? consent = null,
        IConfirmSilenceStore? silence = null,
        IConsentRequirementSource? requirement = null,
        ILocalizer? localizer = null,
        PrivacySectionDiagnostics? diagnostics = null) =>
        new(
            recentPages ?? NewRecent(),
            consent ?? new ConsentSource(),
            silence ?? new ConfirmSilenceStore(),
            requirement ?? new FakeRequirementSource(),
            localizer ?? Localizer,
            diagnostics);

    private sealed class FakeRequirementSource : IConsentRequirementSource
    {
        private readonly RepositoryResult<bool>[] _emissions;

        public FakeRequirementSource(params RepositoryResult<bool>[] emissions) => _emissions = emissions;

        public async IAsyncEnumerable<RepositoryResult<bool>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class SwitchableRequirementSource : IConsentRequirementSource
    {
        public SwitchableRequirementSource(RepositoryResult<bool> first) => Next = first;

        public RepositoryResult<bool> Next { get; set; }

        public async IAsyncEnumerable<RepositoryResult<bool>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return Next;
            await Task.Yield();
        }
    }

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        private readonly Dictionary<string, string> _calls = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            _calls[key] = fallback;
            return fallback;
        }

        public string Fallback(string key) => _calls.TryGetValue(key, out var f) ? f : null!;
    }
}
