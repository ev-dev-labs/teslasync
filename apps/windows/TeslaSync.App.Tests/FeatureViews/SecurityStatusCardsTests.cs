using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the SecurityStatusCards' UI-thread-free logic — the <c>/security/latest</c> parse
/// adapter (the lock / sentry / door / window / homelink / guest helpers ported from the web), the six-card
/// projection (titles, values, descriptions, tones, glyphs, the i18n keys and the accessibility labels), the
/// registration metadata, the diagnostics, and the state-holder view-model's per-state transitions (loading /
/// loaded / empty / error / stale / offline). Mirrors the web spec
/// (web/src/features/admin/components/security-access/SecurityStatusCards.tsx).
/// </summary>
public sealed class SecurityStatusCardsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (FromJson) --------------------------------------------------

    [Fact]
    public void FromJson_reads_every_active_signal()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""
            {
              "locked": true,
              "sentry_mode": "Armed",
              "door_state": "DriverFrontOpen",
              "fd_window": "Open",
              "fp_window": "Closed",
              "rd_window": "Closed",
              "rp_window": "Closed",
              "homelink_nearby": true,
              "guest_mode": true
            }
            """));

        Assert.True(data.Locked);
        Assert.True(data.SentryActive);
        Assert.False(data.DoorsClosed);
        Assert.Equal("DriverFrontOpen", data.DoorOpenLabel);
        Assert.False(data.WindowsAllClosed);
        Assert.True(data.HomelinkNearby);
        Assert.True(data.GuestMode);
        Assert.True(data.HasData);
    }

    [Fact]
    public void FromJson_reads_secured_defaults_from_explicit_values()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""
            {
              "locked": false,
              "sentry_mode": "Off",
              "door_state": "Closed",
              "fd_window": "Closed",
              "fp_window": "Closed",
              "rd_window": "Closed",
              "rp_window": "Closed",
              "homelink_nearby": false,
              "guest_mode": false
            }
            """));

        Assert.False(data.Locked);
        Assert.False(data.SentryActive);
        Assert.True(data.DoorsClosed);
        Assert.Null(data.DoorOpenLabel);
        Assert.True(data.WindowsAllClosed);
        Assert.False(data.HomelinkNearby);
        Assert.False(data.GuestMode);
        Assert.True(data.HasData); // explicit values are real data even when all "secured"
    }

    [Fact]
    public void FromJson_accepts_camelCase_aliases()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""{ "sentryMode": "Armed", "homelinkNearby": true, "guestMode": true }"""));

        Assert.True(data.SentryActive);
        Assert.True(data.HomelinkNearby);
        Assert.True(data.GuestMode);
        Assert.True(data.HasData);
    }

    [Fact]
    public void FromJson_empty_object_is_no_data_defaults()
    {
        var data = SecurityStatusCardsData.FromJson(Json("{}"));

        Assert.False(data.HasData);
        Assert.Same(SecurityStatusCardsData.Empty, data);
    }

    [Fact]
    public void FromJson_object_without_card_signals_is_no_data()
    {
        // homelink_device_count is not one of the six cards' signals -> the snapshot carries no card data.
        var data = SecurityStatusCardsData.FromJson(Json("""{ "homelink_device_count": 3 }"""));

        Assert.False(data.HasData);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("\"oops\"")]
    public void FromJson_non_object_bodies_fall_back_to_empty(string json)
    {
        var data = SecurityStatusCardsData.FromJson(Json(json));

        Assert.False(data.HasData);
        Assert.Same(SecurityStatusCardsData.Empty, data);
    }

    [Fact]
    public void FromJson_door_open_label_is_dropped_when_doors_are_closed()
    {
        // A "Closed" string parses as closed; the open-label is only surfaced when a door is actually open.
        var data = SecurityStatusCardsData.FromJson(Json("""{ "door_state": "Closed" }"""));

        Assert.True(data.DoorsClosed);
        Assert.Null(data.DoorOpenLabel);
    }

    [Fact]
    public void FromJson_object_door_state_with_all_false_is_closed()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""{ "door_state": { "df": false, "pf": false, "rd": false, "rp": false } }"""));

        Assert.True(data.DoorsClosed);
        Assert.Null(data.DoorOpenLabel); // an object door state has no display string
    }

    [Fact]
    public void FromJson_object_door_state_with_an_open_door_is_open()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""{ "door_state": { "df": true, "pf": false } }"""));

        Assert.False(data.DoorsClosed);
    }

    // ---- Ported helpers ------------------------------------------------------------

    [Theory]
    [InlineData("true", false)]   // boolean true door -> open
    [InlineData("false", true)]   // boolean false door -> closed
    [InlineData("0", true)]       // numeric zero -> closed
    [InlineData("1", false)]      // numeric non-zero -> open
    [InlineData("\"\"", true)]    // empty string -> closed
    [InlineData("\"Closed\"", true)]
    [InlineData("\"ClosedAll\"", true)]
    [InlineData("\"DriverOpen\"", false)]
    public void DoorClosed_matches_web_semantics(string json, bool expectedClosed)
    {
        Assert.Equal(expectedClosed, SecurityStatusCardsData.DoorClosed(Json(json)));
    }

    [Theory]
    [InlineData("\"Closed\"", SecurityWindowState.Closed)]
    [InlineData("\"0\"", SecurityWindowState.Closed)]
    [InlineData("\"Venting\"", SecurityWindowState.Venting)]
    [InlineData("\"Open\"", SecurityWindowState.Open)]
    [InlineData("\"PartiallyOpen\"", SecurityWindowState.Open)]
    [InlineData("\"\"", SecurityWindowState.Unknown)]
    [InlineData("true", SecurityWindowState.Unknown)]
    public void ParseWindowState_matches_web_semantics(string json, SecurityWindowState expected)
    {
        Assert.Equal(expected, SecurityStatusCardsData.ParseWindowState(Json(json)));
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    [InlineData("\"Armed\"", true)]
    [InlineData("\"Aware\"", true)]
    [InlineData("\"Off\"", false)]
    [InlineData("\"\"", false)]
    [InlineData("5", false)]
    public void IsSentryActive_matches_web_semantics(string json, bool expectedActive)
    {
        Assert.Equal(expectedActive, SecurityStatusCardsData.IsSentryActive(Json(json)));
    }

    [Fact]
    public void Windows_all_closed_only_when_every_window_is_closed()
    {
        var allClosed = SecurityStatusCardsData.FromJson(Json("""{ "fd_window": "Closed", "fp_window": "Closed", "rd_window": "Closed", "rp_window": "Closed" }"""));
        Assert.True(allClosed.WindowsAllClosed);

        var oneVenting = SecurityStatusCardsData.FromJson(Json("""{ "fd_window": "Closed", "fp_window": "Venting", "rd_window": "Closed", "rp_window": "Closed" }"""));
        Assert.False(oneVenting.WindowsAllClosed);
    }

    // ---- Projection: the six cards in web order ------------------------------------

    [Fact]
    public void Project_builds_six_cards_in_web_order()
    {
        var view = Project(Active());

        Assert.Equal(6, view.Cards.Count);
        Assert.Equal(
            new[] { "lock", "sentry", "doors", "windows", "homelink", "guest" },
            view.Cards.Select(c => c.Key));
        Assert.True(view.HasData);
    }

    [Fact]
    public void Project_active_state_uses_armed_values_glyphs_and_tones()
    {
        var cards = Project(Active()).Cards;

        AssertCard(cards[0], SecurityStatusCardsRegistration.LockGlyph, "Lock Status", "Locked", "Vehicle lock state", SecurityTone.Positive);
        AssertCard(cards[1], SecurityStatusCardsRegistration.SentryGlyph, "Sentry Mode", "Active", "Camera surveillance system", SecurityTone.Watch);
        AssertCard(cards[2], SecurityStatusCardsRegistration.DoorGlyph, "Doors", "DriverFront", "All vehicle doors", SecurityTone.Caution);
        AssertCard(cards[3], SecurityStatusCardsRegistration.WindowGlyph, "Windows", "Open", "Window positions", SecurityTone.Caution);
        AssertCard(cards[4], SecurityStatusCardsRegistration.HomeLinkGlyph, "HomeLink", "Nearby", "Garage door opener", SecurityTone.Linked);
        AssertCard(cards[5], SecurityStatusCardsRegistration.GuestGlyph, "Guest Mode", "Enabled", "Temporary access mode", SecurityTone.Caution);
    }

    [Fact]
    public void Project_default_state_uses_safe_defaults_glyphs_and_tones()
    {
        var cards = Project(SecurityStatusCardsData.Empty).Cards;

        AssertCard(cards[0], SecurityStatusCardsRegistration.UnlockGlyph, "Lock Status", "Unlocked", "Vehicle lock state", SecurityTone.Negative);
        AssertCard(cards[1], SecurityStatusCardsRegistration.SentryGlyph, "Sentry Mode", "Inactive", "Camera surveillance system", SecurityTone.Idle);
        AssertCard(cards[2], SecurityStatusCardsRegistration.DoorGlyph, "Doors", "Closed", "All vehicle doors", SecurityTone.Positive);
        AssertCard(cards[3], SecurityStatusCardsRegistration.WindowGlyph, "Windows", "Closed", "Window positions", SecurityTone.Positive);
        AssertCard(cards[4], SecurityStatusCardsRegistration.HomeLinkGlyph, "HomeLink", "Away", "Garage door opener", SecurityTone.Idle);
        AssertCard(cards[5], SecurityStatusCardsRegistration.GuestGlyph, "Guest Mode", "Disabled", "Temporary access mode", SecurityTone.Idle);
    }

    [Fact]
    public void Project_open_door_without_a_label_falls_back_to_localized_open()
    {
        var data = SecurityStatusCardsData.FromJson(Json("""{ "door_state": { "df": true } }"""));

        var doors = Project(data).Cards[2];

        Assert.Equal("Open", doors.Value);
        Assert.Equal(SecurityTone.Caution, doors.Tone);
    }

    // ---- i18n: every label resolves through its catalog key ------------------------

    [Fact]
    public void Labels_resolve_through_the_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var cards = SecurityStatusCardsProjection.Project(SecurityStatusCardsData.Empty, echo).Cards;

        Assert.Equal("L:translation.admin.security.card.lockStatus", cards[0].Title);
        Assert.Equal("L:translation.admin.security.unlocked", cards[0].Value);
        Assert.Equal("L:translation.admin.security.card.lockDesc", cards[0].Description);
        Assert.Equal("L:translation.admin.security.card.sentryMode", cards[1].Title);
        Assert.Equal("L:translation.admin.security.inactive", cards[1].Value);
        Assert.Equal("L:translation.admin.security.card.sentryDesc", cards[1].Description);
        Assert.Equal("L:translation.admin.security.card.doors", cards[2].Title);
        Assert.Equal("L:translation.admin.security.closed", cards[2].Value);
        Assert.Equal("L:translation.admin.security.card.windows", cards[3].Title);
        Assert.Equal("L:translation.admin.security.card.homelink", cards[4].Title);
        Assert.Equal("L:translation.admin.security.away", cards[4].Value);
        Assert.Equal("L:translation.admin.security.card.guestMode", cards[5].Title);
        Assert.Equal("L:translation.admin.security.disabled", cards[5].Value);
    }

    [Fact]
    public void Active_values_resolve_through_their_catalog_keys()
    {
        var echo = new KeyEchoLocalizer();
        var cards = SecurityStatusCardsProjection.Project(Active(), echo).Cards;

        Assert.Equal("L:translation.admin.security.locked", cards[0].Value);
        Assert.Equal("L:translation.admin.security.active", cards[1].Value);
        Assert.Equal("L:translation.admin.security.open", cards[3].Value);
        Assert.Equal("L:translation.admin.security.nearby", cards[4].Value);
        Assert.Equal("L:translation.admin.security.enabled", cards[5].Value);
    }

    [Fact]
    public void Surface_automation_name_resolves_through_the_title_key()
    {
        Assert.Equal("L:translation.admin.security.title", SecurityStatusCardsProjection.Project(Active(), new KeyEchoLocalizer()).AutomationName);
        Assert.Equal("Security & Access", Project(Active()).AutomationName);
    }

    // ---- a11y: every card + the surface carry a spoken name ------------------------

    [Fact]
    public void Every_card_carries_a_composed_automation_name()
    {
        var view = Project(Active());

        Assert.All(view.Cards, c => Assert.False(string.IsNullOrWhiteSpace(c.AutomationName)));
        Assert.False(string.IsNullOrWhiteSpace(view.AutomationName));

        // The composed name folds the title, value and description together for the screen reader.
        Assert.Equal("Lock Status: Locked. Vehicle lock state", view.Cards[0].AutomationName);
        Assert.Equal("Sentry Mode: Active. Camera surveillance system", view.Cards[1].AutomationName);
        Assert.Equal("Guest Mode: Enabled. Temporary access mode", view.Cards[5].AutomationName);
    }

    // ---- Tone -> brush token mapping -----------------------------------------------

    [Theory]
    [InlineData(SecurityTone.Positive, "TsColorSuccessBrush")]
    [InlineData(SecurityTone.Negative, "TsColorDangerBrush")]
    [InlineData(SecurityTone.Caution, "TsColorWarningBrush")]
    [InlineData(SecurityTone.Watch, "TsColorInfoBrush")]
    [InlineData(SecurityTone.Linked, "TsColorAccentBrush")]
    [InlineData(SecurityTone.Idle, "TsColorTextMutedBrush")]
    public void ToneResources_map_to_design_token_brush_keys(SecurityTone tone, string expectedKey)
    {
        Assert.Equal(expectedKey, SecurityToneResources.BrushKey(tone));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusCardsData>.Loading());
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Loading, vm.State);
        Assert.False(vm.HasData);
        Assert.True(vm.Attempts >= 1);
        // Even before any data the six cards exist (defaults) so the grid is never blank.
        Assert.Equal(6, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_populated_cards()
    {
        using var vm = NewViewModel(Loaded(Active()));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Loaded, vm.State);
        Assert.True(vm.HasData);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
        Assert.Equal("Locked", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_loaded_no_signals_renders_empty_with_cards()
    {
        using var vm = NewViewModel(Loaded(SecurityStatusCardsData.Empty));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
        Assert.Equal("Unlocked", vm.Display.Cards[0].Value);
    }

    [Fact]
    public async Task ViewModel_empty_status_renders_empty()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusCardsData>.Empty(Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Empty, vm.State);
        Assert.False(vm.HasData);
        Assert.Equal(6, vm.Display.Cards.Count);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error_with_retry_context()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityStatusCardsData>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_data()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusCardsData>.Cached(Active(), Now, stale: true));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasData);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_data_and_message()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusCardsData>.OfflineCached(
            Active(), Now, new RepositoryError(RepositoryErrorKind.Network, "offline")));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Offline, vm.State);
        Assert.True(vm.HasData);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using var vm = NewViewModel(
            RepositoryResult<SecurityStatusCardsData>.Loading(),
            RepositoryResult<SecurityStatusCardsData>.Cached(SecurityStatusCardsData.Empty, Now, stale: false),
            RepositoryResult<SecurityStatusCardsData>.Loaded(Active(), Now));
        await vm.LoadAsync();

        Assert.Equal(SecurityStatusCardsState.Loaded, vm.State);
        Assert.Equal("Locked", vm.Display.Cards[0].Value); // the freshest snapshot wins
    }

    [Fact]
    public async Task ViewModel_title_resolves_through_i18n()
    {
        using var vm = NewViewModel(RepositoryResult<SecurityStatusCardsData>.Empty(Now));
        await vm.LoadAsync();
        Assert.Equal("Security & Access", vm.Title);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using var vm = NewViewModel(Loaded(Active()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(SecurityStatusCardsViewModel.State), changed);
        Assert.Contains(nameof(SecurityStatusCardsViewModel.Display), changed);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("security-status-cards", SecurityStatusCardsRegistration.Id);
        Assert.Equal("admin", SecurityStatusCardsRegistration.Category);
        Assert.Equal("SecurityStatusCards", SecurityStatusCardsRegistration.Slug);
        Assert.Equal("Security & Access", SecurityStatusCardsRegistration.Name(Localizer));
    }

    [Fact]
    public void Registration_glyphs_are_the_verified_segoe_fluent_codepoints()
    {
        Assert.Equal("\uE72E", SecurityStatusCardsRegistration.LockGlyph);
        Assert.Equal("\uE785", SecurityStatusCardsRegistration.UnlockGlyph);
        Assert.Equal("\uEA18", SecurityStatusCardsRegistration.SentryGlyph);
        Assert.Equal("\uE8D7", SecurityStatusCardsRegistration.DoorGlyph);
        Assert.Equal("\uE8A7", SecurityStatusCardsRegistration.WindowGlyph);
        Assert.Equal("\uE80F", SecurityStatusCardsRegistration.HomeLinkGlyph);
        Assert.Equal("\uE192", SecurityStatusCardsRegistration.GuestGlyph);
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SecurityStatusCardsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SecurityStatusCards", Assert.Single(lines));
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    // Every card in its "armed / active / open" branch — exercises all six glyphs + accent tones.
    private static SecurityStatusCardsData Active() => new(
        Locked: true,
        SentryActive: true,
        DoorsClosed: false,
        DoorOpenLabel: "DriverFront",
        WindowsAllClosed: false,
        HomelinkNearby: true,
        GuestMode: true,
        HasData: true);

    private static SecurityStatusCardsDisplay Project(SecurityStatusCardsData data) =>
        SecurityStatusCardsProjection.Project(data, Localizer);

    private static void AssertCard(
        SecurityStatusCard card,
        string glyph,
        string title,
        string value,
        string description,
        SecurityTone tone)
    {
        Assert.Equal(glyph, card.Glyph);
        Assert.Equal(title, card.Title);
        Assert.Equal(value, card.Value);
        Assert.Equal(description, card.Description);
        Assert.Equal(tone, card.Tone);
    }

    private static RepositoryResult<SecurityStatusCardsData> Loaded(SecurityStatusCardsData data) =>
        RepositoryResult<SecurityStatusCardsData>.Loaded(data, Now);

    private static SecurityStatusCardsViewModel NewViewModel(params RepositoryResult<SecurityStatusCardsData>[] emissions) =>
        new(new FakeSecurityStatusCardsSource(emissions), Localizer);

    private sealed class FakeSecurityStatusCardsSource(params RepositoryResult<SecurityStatusCardsData>[] emissions)
        : ISecurityStatusCardsSource
    {
        public async IAsyncEnumerable<RepositoryResult<SecurityStatusCardsData>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class KeyEchoLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
