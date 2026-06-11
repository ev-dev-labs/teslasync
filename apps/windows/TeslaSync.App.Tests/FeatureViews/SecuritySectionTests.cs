using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SecuritySection's UI-thread-free logic — the <c>/security/latest</c> parse
/// adapter (the door-state label coercion and the open-window count ported from the web), the merged-snapshot
/// HasData gate, the four-card projection (labels, values, tones, glyphs, the i18n keys and the accessibility
/// names), the cache-then-network result mapper (folding the lock / sentry flags from the vehicle state), the
/// registration metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/vehicles/components/vehicle-detail/SecuritySection.tsx).
/// </summary>
public sealed class SecuritySectionTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 10, 12, 5, 0, TimeSpan.Zero);

    // ---- Security parse adapter (FromResponse) -------------------------------------

    [Fact]
    public void FromResponse_returns_null_for_non_object()
    {
        Assert.Null(SecuritySectionReading.FromResponse(Json("null")));
        Assert.Null(SecuritySectionReading.FromResponse(Json("[]")));
        Assert.Null(SecuritySectionReading.FromResponse(Json("\"oops\"")));
        Assert.Null(SecuritySectionReading.FromResponse(Json("42")));
    }

    [Fact]
    public void FromResponse_empty_object_has_no_door_and_no_open_windows()
    {
        var reading = SecuritySectionReading.FromResponse(Json("{}"));

        Assert.NotNull(reading);
        Assert.Null(reading!.DoorLabel);
        Assert.False(reading.HasDoorReading);
        Assert.Equal(0, reading.WindowsOpen);
    }

    [Theory]
    [InlineData("\"DriverFrontOpen\"", "DriverFrontOpen")]
    [InlineData("\"FrontLeft\"", "FrontLeft")]
    [InlineData("true", "true")]
    [InlineData("false", "false")] // web String(false) — present and !== '' so the label is shown verbatim.
    public void FromResponse_reads_door_label_verbatim(string doorJson, string expected)
    {
        var reading = SecuritySectionReading.FromResponse(Json($"{{ \"door_state\": {doorJson} }}"));

        Assert.NotNull(reading);
        Assert.Equal(expected, reading!.DoorLabel);
        Assert.True(reading.HasDoorReading);
    }

    [Theory]
    [InlineData("\"\"")] // empty string -> no label (web !== '' gate)
    [InlineData("null")]
    public void FromResponse_drops_empty_or_null_door_label(string doorJson)
    {
        var reading = SecuritySectionReading.FromResponse(Json($"{{ \"door_state\": {doorJson} }}"));

        Assert.NotNull(reading);
        Assert.Null(reading!.DoorLabel);
        Assert.False(reading.HasDoorReading);
    }

    [Fact]
    public void FromResponse_counts_only_windows_coercing_to_a_positive_number()
    {
        // web windowOpenCount: 5 > 0 (open); 0 not open; "0" -> 0 not open; "Closed" -> NaN not open.
        var reading = SecuritySectionReading.FromResponse(Json("""
            { "fd_window": 5, "fp_window": 0, "rd_window": "0", "rp_window": "Closed" }
            """));

        Assert.NotNull(reading);
        Assert.Equal(1, reading!.WindowsOpen);
    }

    [Fact]
    public void FromResponse_window_count_handles_bool_and_numeric_string_encodings()
    {
        // web Number(): true -> 1 (open); false -> 0 (not open); "2" -> 2 (open); "Open" -> NaN (not open).
        var reading = SecuritySectionReading.FromResponse(Json("""
            { "fd_window": true, "fp_window": false, "rd_window": "2", "rp_window": "Open" }
            """));

        Assert.NotNull(reading);
        Assert.Equal(2, reading!.WindowsOpen);
    }

    [Fact]
    public void FromResponse_window_count_is_four_when_all_open()
    {
        var reading = SecuritySectionReading.FromResponse(Json("""
            { "fd_window": 1, "fp_window": 2.5, "rd_window": "3", "rp_window": true }
            """));

        Assert.NotNull(reading);
        Assert.Equal(4, reading!.WindowsOpen);
    }

    // ---- Snapshot gate -------------------------------------------------------------

    [Fact]
    public void Snapshot_has_data_only_when_a_security_event_is_present()
    {
        Assert.True(new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), false, false).HasData);
        Assert.False(new SecuritySectionSnapshot(null, true, true).HasData);
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_secured_snapshot_renders_four_green_cards()
    {
        var view = Project(new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), Locked: true, SentryActive: true));

        Assert.True(view.HasData);
        Assert.Equal("Security", view.Title);
        Assert.Equal(4, view.Cards.Count);

        var lockCard = CardByKey(view, "lock");
        Assert.Equal("Locked", lockCard.Label);
        Assert.Equal("Yes", lockCard.Value);
        Assert.Equal(SecuritySectionRegistration.LockGlyph, lockCard.Glyph);
        Assert.Equal(SecurityCardTone.Secured, lockCard.Tone);

        var sentryCard = CardByKey(view, "sentry");
        Assert.Equal("Sentry", sentryCard.Label);
        Assert.Equal("Active", sentryCard.Value);
        Assert.Equal(SecuritySectionRegistration.SentryGlyph, sentryCard.Glyph);
        Assert.Equal(SecurityCardTone.Secured, sentryCard.Tone);

        var doorsCard = CardByKey(view, "doors");
        Assert.Equal("Doors", doorsCard.Label);
        Assert.Equal("Closed", doorsCard.Value);
        Assert.Equal(SecuritySectionRegistration.DoorGlyph, doorsCard.Glyph);
        Assert.Equal(SecurityCardTone.Secured, doorsCard.Tone);

        var windowsCard = CardByKey(view, "windows");
        Assert.Equal("Windows", windowsCard.Label);
        Assert.Equal("Closed", windowsCard.Value);
        Assert.Equal(SecuritySectionRegistration.WindowGlyph, windowsCard.Glyph);
        Assert.Equal(SecurityCardTone.Secured, windowsCard.Tone);
    }

    [Fact]
    public void Project_unsecured_snapshot_renders_neutral_cards_with_open_values()
    {
        var view = Project(new SecuritySectionSnapshot(
            new SecuritySectionReading("DriverFrontOpen", 2), Locked: false, SentryActive: false));

        var lockCard = CardByKey(view, "lock");
        Assert.Equal("No", lockCard.Value);
        Assert.Equal(SecuritySectionRegistration.UnlockGlyph, lockCard.Glyph);
        Assert.Equal(SecurityCardTone.Neutral, lockCard.Tone);

        var sentryCard = CardByKey(view, "sentry");
        Assert.Equal("Off", sentryCard.Value);
        Assert.Equal(SecurityCardTone.Neutral, sentryCard.Tone);

        var doorsCard = CardByKey(view, "doors");
        Assert.Equal("DriverFrontOpen", doorsCard.Value);
        Assert.Equal(SecurityCardTone.Neutral, doorsCard.Tone);

        var windowsCard = CardByKey(view, "windows");
        Assert.Equal("2 open", windowsCard.Value); // web t('windowsOpen', '{{count}} open') -> catalog "{0} open".
        Assert.Equal(SecurityCardTone.Neutral, windowsCard.Tone);
    }

    [Fact]
    public void Project_no_security_event_renders_empty_state()
    {
        var view = Project(new SecuritySectionSnapshot(null, true, true));

        Assert.False(view.HasData);
        Assert.Empty(view.Cards);
        Assert.Equal("Security", view.Title);
        Assert.Equal("No security data available", view.EmptyMessage);
    }

    [Fact]
    public void Project_brush_keys_map_green_and_cyan_tones()
    {
        Assert.Equal("TsColorSuccessBrush", SecurityCardToneResources.BrushKey(SecurityCardTone.Secured));
        Assert.Equal("TsColorAccentBrush", SecurityCardToneResources.BrushKey(SecurityCardTone.Neutral));
    }

    // ---- Accessibility (label presence) --------------------------------------------

    [Fact]
    public void Every_card_carries_a_non_empty_automation_name_with_label_and_value()
    {
        var view = Project(new SecuritySectionSnapshot(new SecuritySectionReading("DriverFrontOpen", 1), true, true));

        Assert.NotEmpty(view.AutomationName);
        foreach (var card in view.Cards)
        {
            Assert.False(string.IsNullOrWhiteSpace(card.AutomationName));
            Assert.Contains(card.Label, card.AutomationName, StringComparison.Ordinal);
            Assert.Contains(card.Value, card.AutomationName, StringComparison.Ordinal);
        }
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Mapper_folds_lock_and_sentry_into_a_loaded_snapshot()
    {
        var loaded = SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(Json("""{ "door_state": "Open" }"""), Now),
            locked: true,
            sentryActive: true);

        Assert.Equal(LoadStatus.Loaded, loaded.Status);
        Assert.NotNull(loaded.Value!.Security);
        Assert.Equal("Open", loaded.Value.Security!.DoorLabel);
        Assert.True(loaded.Value.Locked);
        Assert.True(loaded.Value.SentryActive);
        Assert.True(loaded.Value.HasData);
    }

    [Fact]
    public void Mapper_preserves_cached_stale_and_offline_status()
    {
        var cached = SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(Json("{}"), Now, stale: true), locked: false, sentryActive: false);
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);

        var offline = SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(Json("{}"), Now, new RepositoryError(RepositoryErrorKind.Network, "down")),
            locked: false,
            sentryActive: false);
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.NotNull(offline.Value!.Security);
    }

    [Fact]
    public void Mapper_maps_empty_loading_and_failure()
    {
        Assert.Equal(LoadStatus.Empty, SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.Empty(Now), false, false).Status);

        Assert.Equal(LoadStatus.Loading, SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.Loading(), false, false).Status);

        Assert.Equal(LoadStatus.Error, SecuritySectionResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")), false, false).Status);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SecuritySectionSnapshot>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_four_cards()
    {
        using var vm = NewViewModel(Loaded(new SecuritySectionSnapshot(
            new SecuritySectionReading("Open", 1), Locked: true, SentryActive: true)));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Cards.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_loaded_without_security_event_renders_empty()
    {
        using var vm = NewViewModel(Loaded(new SecuritySectionSnapshot(null, Locked: true, SentryActive: true)));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal("No security data available", vm.Display.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SecuritySectionSnapshot>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.False(string.IsNullOrWhiteSpace(vm.Display.EmptyMessage));
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecuritySectionSnapshot>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SecuritySectionSnapshot>.Cached(
            new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), true, true), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SecuritySectionSnapshot>.OfflineCached(
            new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), true, true),
            Now,
            new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecuritySectionSnapshot>.Loading(),
            RepositoryResult<SecuritySectionSnapshot>.Cached(
                new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), false, false), Now, stale: false),
            RepositoryResult<SecuritySectionSnapshot>.Loaded(
                new SecuritySectionSnapshot(new SecuritySectionReading("Open", 1), true, true), Now));
        await vm.LoadAsync();

        Assert.Equal(SecuritySectionState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.Equal(4, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SecuritySectionSnapshot>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Security", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(new SecuritySectionSnapshot(new SecuritySectionReading(null, 0), true, true)));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SecuritySectionViewModel.State), changed);
        Assert.Contains(nameof(SecuritySectionViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("security-section", SecuritySectionRegistration.Id);
        Assert.Equal("vehicles", SecuritySectionRegistration.Category);
        Assert.Equal("SecuritySection", SecuritySectionRegistration.Slug);
        Assert.Equal("Security", SecuritySectionRegistration.Name(Localizer));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SecuritySectionDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecuritySection", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static SecurityMetricCard CardByKey(SecuritySectionDisplay view, string key) =>
        view.Cards.Single(c => string.Equals(c.Key, key, StringComparison.Ordinal));

    private static SecuritySectionDisplay Project(SecuritySectionSnapshot snapshot) =>
        SecuritySectionProjection.Project(snapshot, Localizer);

    private static RepositoryResult<SecuritySectionSnapshot> Loaded(SecuritySectionSnapshot snapshot) =>
        RepositoryResult<SecuritySectionSnapshot>.Loaded(snapshot, Now);

    private static SecuritySectionViewModel NewViewModel(params RepositoryResult<SecuritySectionSnapshot>[] emissions) =>
        new(new FakeSecuritySectionSource(emissions), Localizer);

    private sealed class FakeSecuritySectionSource(params RepositoryResult<SecuritySectionSnapshot>[] emissions)
        : ISecuritySectionSource
    {
        public async IAsyncEnumerable<RepositoryResult<SecuritySectionSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                await Task.Yield();
                yield return emission;
            }
        }
    }
}
