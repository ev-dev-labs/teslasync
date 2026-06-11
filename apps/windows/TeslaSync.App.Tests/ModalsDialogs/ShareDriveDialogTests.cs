using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.ModalsDialogs;
using Xunit;

namespace TeslaSync.App.Tests.ModalsDialogs;

/// <summary>
/// Headless verification of the ShareDriveDialog modal's UI-thread-free logic — the share-link parse adapter, the
/// display projection (title fallback / views label / expiry label / public-URL build), the cache-then-network
/// result mapper, the registry metadata + create-body mapping, the diagnostics, and the state-holder view-model's
/// per-state transitions (loading / loaded / empty / error / stale / offline) plus the create + revoke mutations.
/// Mirrors the web spec (web/src/features/driving/components/ShareDriveDialog.tsx + api/hooks/useSharing.ts).
/// </summary>
public sealed class ShareDriveDialogTests
{
    private const long DriveId = 42;
    private const string Origin = "https://teslasync.example";
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 11, 12, 0, 0, TimeSpan.Zero);

    private static ShareLink Link(
        string token = "tok-1",
        string? title = "Road Trip",
        long views = 12,
        bool includeSpeed = true,
        bool includeTelemetry = false,
        DateTimeOffset? expiresAt = null,
        long id = 1) =>
        new(id, token, title, views, includeSpeed, includeTelemetry, expiresAt, Now.AddDays(-1));

    // ---- Parse adapter -------------------------------------------------------------

    [Fact]
    public void ParseList_reads_snake_case_fields()
    {
        const string json = """
        [{"id":7,"token":"abc","title":"SF to LA","views":5,"include_speed":true,
          "include_telemetry":false,"expires_at":"2026-07-01T00:00:00Z","created_at":"2026-06-01T00:00:00Z"}]
        """;
        using JsonDocument doc = JsonDocument.Parse(json);

        ShareLink link = Assert.Single(ShareDriveDialogParser.ParseList(doc.RootElement));

        Assert.Equal(7, link.Id);
        Assert.Equal("abc", link.Token);
        Assert.Equal("SF to LA", link.Title);
        Assert.Equal(5, link.Views);
        Assert.True(link.IncludeSpeed);
        Assert.False(link.IncludeTelemetry);
        Assert.Equal(new DateTimeOffset(2026, 7, 1, 0, 0, 0, TimeSpan.Zero), link.ExpiresAt);
        Assert.Equal(new DateTimeOffset(2026, 6, 1, 0, 0, 0, TimeSpan.Zero), link.CreatedAt);
    }

    [Fact]
    public void ParseList_treats_null_title_and_missing_expiry_as_null()
    {
        using JsonDocument doc = JsonDocument.Parse("""[{"token":"t","title":null,"views":0}]""");

        ShareLink link = Assert.Single(ShareDriveDialogParser.ParseList(doc.RootElement));

        Assert.Null(link.Title);
        Assert.Null(link.ExpiresAt);
        Assert.Equal(0, link.Views);
    }

    [Fact]
    public void ParseList_skips_rows_without_a_token()
    {
        // A row with no token is not renderable (copy / revoke both key off the token).
        using JsonDocument doc = JsonDocument.Parse("""[{"id":1,"title":"No token"},{"token":"keep"}]""");

        ShareLink link = Assert.Single(ShareDriveDialogParser.ParseList(doc.RootElement));
        Assert.Equal("keep", link.Token);
    }

    [Fact]
    public void ParseList_returns_empty_for_non_array()
    {
        using JsonDocument doc = JsonDocument.Parse("{}");
        Assert.Empty(ShareDriveDialogParser.ParseList(doc.RootElement));
    }

    // ---- Projection ----------------------------------------------------------------

    [Fact]
    public void Project_uses_untitled_fallback_and_views_label()
    {
        ShareLinksDisplay display = ShareDriveDialogProjection.Project(
            new[] { Link(title: null, views: 3) }, Origin, Now, Localizer);

        ShareLinkRow row = Assert.Single(display.Rows);
        Assert.Equal("Untitled share", row.TitleDisplay);
        Assert.Equal("3 views", row.ViewsLabel);
        Assert.Contains("Untitled share", row.AutomationName, StringComparison.Ordinal);
    }

    [Fact]
    public void Project_builds_public_share_url_from_origin_and_token()
    {
        ShareLinksDisplay display = ShareDriveDialogProjection.Project(
            new[] { Link(token: "xyz") }, "https://host.example/", Now, Localizer);

        // Trailing slash on the origin is trimmed before the /s/{token} suffix.
        Assert.Equal("https://host.example/s/xyz", Assert.Single(display.Rows).ShareUrl);
    }

    [Fact]
    public void ExpiryLabel_reports_expired_when_in_the_past()
    {
        ShareLink link = Link(expiresAt: Now.AddDays(-2));
        Assert.True(ShareDriveDialogProjection.IsExpired(link, Now));
        Assert.Equal("Expired", ShareDriveDialogProjection.ExpiryLabel(link, Now, Localizer));
    }

    [Fact]
    public void ExpiryLabel_formats_future_expiry()
    {
        DateTimeOffset future = Now.AddDays(30);
        ShareLink link = Link(expiresAt: future);

        string expected = "Expires " + ShareDriveDialogProjection.FormatDate(future);
        Assert.Equal(expected, ShareDriveDialogProjection.ExpiryLabel(link, Now, Localizer));
        Assert.False(ShareDriveDialogProjection.IsExpired(link, Now));
    }

    [Fact]
    public void ExpiryLabel_reports_no_expiry_when_unset()
    {
        Assert.Equal("No expiry", ShareDriveDialogProjection.ExpiryLabel(Link(expiresAt: null), Now, Localizer));
    }

    [Fact]
    public void Project_empty_links_yields_empty_display()
    {
        ShareLinksDisplay display = ShareDriveDialogProjection.Project(
            Array.Empty<ShareLink>(), Origin, Now, Localizer);
        Assert.False(display.HasRows);
        Assert.Empty(display.Rows);
    }

    // ---- Result mapper (cache-then-network preservation) ----------------------------

    [Fact]
    public void Mapper_preserves_status_and_parses_payload()
    {
        using JsonDocument doc = JsonDocument.Parse("""[{"token":"a","title":"One","views":1}]""");

        RepositoryResult<IReadOnlyList<ShareLink>> cached = ShareDriveDialogResultMapper.Map(
            RepositoryResult<JsonElement>.Cached(doc.RootElement, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Single(cached.Value!);

        RepositoryResult<IReadOnlyList<ShareLink>> offline = ShareDriveDialogResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(doc.RootElement, Now, new RepositoryError(RepositoryErrorKind.Network, "down")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.Single(offline.Value!);
    }

    [Fact]
    public void Mapper_collapses_loaded_empty_array_to_empty()
    {
        using JsonDocument doc = JsonDocument.Parse("[]");
        RepositoryResult<IReadOnlyList<ShareLink>> mapped = ShareDriveDialogResultMapper.Map(
            RepositoryResult<JsonElement>.Loaded(doc.RootElement, Now));
        Assert.Equal(LoadStatus.Empty, mapped.Status);
    }

    [Fact]
    public void Mapper_maps_failure()
    {
        RepositoryResult<IReadOnlyList<ShareLink>> mapped = ShareDriveDialogResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, mapped.Status);
    }

    // ---- View-model defaults -------------------------------------------------------

    [Fact]
    public void ViewModel_defaults_match_web_initial_state()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(new FakeShareLinksSource());

        Assert.True(vm.IncludeSpeed);
        Assert.False(vm.IncludeTelemetry);
        Assert.Equal("30", vm.ExpiryDays);
        Assert.True(vm.IsCreateMode);
        Assert.False(vm.HasShareUrl);
        Assert.Equal("Share Drive", vm.ModalTitle);
        Assert.Equal(4, vm.ExpiryOptions.Count);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loading_only_stays_loading()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Loading()));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Loading, vm.State);
        Assert.False(vm.HasLinks);
        Assert.True(vm.Attempts >= 1);
    }

    [Fact]
    public async Task ViewModel_loaded_exposes_rows()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(Loaded(Link("a", "One"), Link("b", "Two")));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Loaded, vm.State);
        Assert.True(vm.HasLinks);
        Assert.Equal(2, vm.Display.Rows.Count);
        Assert.NotNull(vm.UpdatedAt);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_empty_renders_empty()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Empty, vm.State);
        Assert.False(vm.HasLinks);
        Assert.Equal("No active share links yet.", vm.EmptyMessage);
    }

    [Fact]
    public async Task ViewModel_failure_renders_error()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(new FakeShareLinksSource(
            RepositoryResult<IReadOnlyList<ShareLink>>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom"))));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_cache_renders_stale_with_rows()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(new FakeShareLinksSource(
            RepositoryResult<IReadOnlyList<ShareLink>>.Cached(new[] { Link() }, Now, stale: true)));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Stale, vm.State);
        Assert.True(vm.IsStale);
        Assert.True(vm.HasLinks);
    }

    [Fact]
    public async Task ViewModel_offline_renders_offline_with_rows()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(new FakeShareLinksSource(
            RepositoryResult<IReadOnlyList<ShareLink>>.OfflineCached(
                new[] { Link() }, Now, new RepositoryError(RepositoryErrorKind.Network, "offline"))));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Offline, vm.State);
        Assert.True(vm.HasLinks);
        Assert.True(vm.IsStale);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_folds_loading_cached_loaded_to_loaded()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(new FakeShareLinksSource(
            RepositoryResult<IReadOnlyList<ShareLink>>.Loading(),
            RepositoryResult<IReadOnlyList<ShareLink>>.Cached(new[] { Link("a", "One") }, Now, stale: false),
            RepositoryResult<IReadOnlyList<ShareLink>>.Loaded(new[] { Link("a", "One"), Link("b", "Two") }, Now)));
        await vm.LoadAsync();

        Assert.Equal(ShareDriveState.Loaded, vm.State);
        Assert.Equal(2, vm.Display.Rows.Count);
    }

    [Fact]
    public async Task ViewModel_raises_property_changed_for_state_and_display()
    {
        using ShareDriveDialogViewModel vm = NewViewModel(Loaded(Link()));
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        await vm.LoadAsync();

        Assert.Contains(nameof(ShareDriveDialogViewModel.State), changed);
        Assert.Contains(nameof(ShareDriveDialogViewModel.Display), changed);
    }

    [Fact]
    public async Task ViewModel_passes_drive_id_to_source()
    {
        var source = new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now));
        using ShareDriveDialogViewModel vm = NewViewModel(source);
        await vm.LoadAsync();
        Assert.Equal(DriveId, source.LastDriveId);
    }

    // ---- Create flow ---------------------------------------------------------------

    [Fact]
    public async Task GenerateAsync_success_sets_share_url_toast_and_reloads()
    {
        var source = new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now));
        var commands = new FakeShareLinksCommands(ShareCreateOutcome.Ok(new ShareCreateResult("new-token", null, 9)));
        var lines = new List<string>();
        using ShareDriveDialogViewModel vm = NewViewModel(source, commands, diagnostics: new ShareDriveDialogDiagnostics(lines.Add));
        var toasts = new List<ShareDriveToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync(); // initial load (source call #1)
        bool created = await vm.GenerateAsync();

        Assert.True(created);
        Assert.True(vm.HasShareUrl);
        Assert.Equal("https://teslasync.example/s/new-token", vm.ShareUrl);
        Assert.Equal(DriveId, commands.LastCreateDriveId);
        Assert.Equal(1, commands.CreateCalls);
        Assert.True(source.Calls >= 2, "create should reload the active-links list");
        Assert.Contains(toasts, t => !t.IsError && t.Message == "Share link created");
        Assert.Contains("share.link.created slug=ShareDriveDialog", lines);
    }

    [Fact]
    public async Task GenerateAsync_maps_form_fields_to_request_body()
    {
        var commands = new FakeShareLinksCommands();
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)), commands);

        vm.Title = "My Trip";
        vm.IncludeSpeed = false;
        vm.IncludeTelemetry = true;
        vm.ExpiryDays = "7";
        await vm.GenerateAsync();

        Assert.NotNull(commands.LastCreateBody);
        Assert.Equal("My Trip", commands.LastCreateBody!.Title);
        Assert.False(commands.LastCreateBody.IncludeSpeed);
        Assert.True(commands.LastCreateBody.IncludeTelemetry);
        Assert.Equal(7, commands.LastCreateBody.ExpiresInDays);
    }

    [Fact]
    public async Task GenerateAsync_failure_raises_error_toast_and_keeps_form()
    {
        var commands = new FakeShareLinksCommands(
            ShareCreateOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        var lines = new List<string>();
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)),
            commands,
            diagnostics: new ShareDriveDialogDiagnostics(lines.Add));
        var toasts = new List<ShareDriveToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        bool created = await vm.GenerateAsync();

        Assert.False(created);
        Assert.False(vm.HasShareUrl);
        Assert.True(vm.IsCreateMode);
        Assert.Contains(toasts, t => t.IsError);
        Assert.DoesNotContain("share.link.created slug=ShareDriveDialog", lines);
    }

    [Fact]
    public async Task CreateAnother_returns_to_create_form()
    {
        var commands = new FakeShareLinksCommands(ShareCreateOutcome.Ok(new ShareCreateResult("t", null, 1)));
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)), commands);

        await vm.GenerateAsync();
        Assert.True(vm.HasShareUrl);

        vm.CreateAnother();
        Assert.False(vm.HasShareUrl);
        Assert.True(vm.IsCreateMode);
    }

    [Fact]
    public async Task Reset_clears_url_and_title()
    {
        var commands = new FakeShareLinksCommands(ShareCreateOutcome.Ok(new ShareCreateResult("t", null, 1)));
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)), commands);
        vm.Title = "Keep?";
        await vm.GenerateAsync();

        vm.Reset();

        Assert.False(vm.HasShareUrl);
        Assert.Equal(string.Empty, vm.Title);
    }

    // ---- Revoke flow ---------------------------------------------------------------

    [Fact]
    public async Task RevokeAsync_success_calls_command_toast_and_reloads()
    {
        var source = new FakeShareLinksSource(Loaded(Link("tok-x")).First());
        var commands = new FakeShareLinksCommands();
        var lines = new List<string>();
        using ShareDriveDialogViewModel vm = NewViewModel(source, commands, diagnostics: new ShareDriveDialogDiagnostics(lines.Add));
        var toasts = new List<ShareDriveToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        await vm.RevokeAsync("tok-x");

        Assert.Equal("tok-x", commands.LastRevokeToken);
        Assert.Equal(1, commands.RevokeCalls);
        Assert.True(source.Calls >= 2, "revoke should reload the active-links list");
        Assert.Contains(toasts, t => !t.IsError && t.Message == "Share link revoked");
        Assert.Contains("share.link.revoked slug=ShareDriveDialog", lines);
        Assert.False(vm.RevokePending);
    }

    [Fact]
    public async Task RevokeAsync_failure_raises_error_toast()
    {
        var commands = new FakeShareLinksCommands(
            revoke: ShareRevokeOutcome.Fail(new RepositoryError(RepositoryErrorKind.Server, "nope")));
        using ShareDriveDialogViewModel vm = NewViewModel(Loaded(Link("tok-y")), commands);
        var toasts = new List<ShareDriveToast>();
        vm.ToastRequested += (_, t) => toasts.Add(t);

        await vm.LoadAsync();
        await vm.RevokeAsync("tok-y");

        Assert.Contains(toasts, t => t.IsError);
        Assert.False(vm.RevokePending);
    }

    [Fact]
    public async Task RevokeAsync_ignores_blank_token()
    {
        var commands = new FakeShareLinksCommands();
        using ShareDriveDialogViewModel vm = NewViewModel(
            new FakeShareLinksSource(RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now)), commands);

        await vm.RevokeAsync(string.Empty);

        Assert.Equal(0, commands.RevokeCalls);
    }

    // ---- Create-body mapping (web handleCreate parity) -----------------------------

    [Theory]
    [InlineData("", null)]
    [InlineData("Trip", "Trip")]
    public void BuildCreateBody_drops_empty_title(string title, string? expected)
    {
        CreateShareBody body = ShareDriveDialogRegistration.BuildCreateBody(title, true, false, "30");
        Assert.Equal(expected, body.Title);
    }

    [Theory]
    [InlineData("7", 7)]
    [InlineData("30", 30)]
    [InlineData("90", 90)]
    [InlineData("0", null)]
    [InlineData("", null)]
    public void BuildCreateBody_maps_expiry_with_never_dropped(string expiry, int? expected)
    {
        CreateShareBody body = ShareDriveDialogRegistration.BuildCreateBody("t", true, true, expiry);
        Assert.Equal(expected, body.ExpiresInDays);
    }

    // ---- Registration metadata -----------------------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("share-drive-dialog", ShareDriveDialogRegistration.Id);
        Assert.Equal("ShareDriveDialog", ShareDriveDialogRegistration.Slug);
        Assert.Equal("get_api_v1_drives_driveID_shares", ShareDriveDialogRegistration.ListOperation);
        Assert.Equal("post_api_v1_drives_driveID_share", ShareDriveDialogRegistration.CreateOperation);
        Assert.Equal("delete_api_v1_shares_token", ShareDriveDialogRegistration.RevokeOperation);
        Assert.Equal("Share Drive", ShareDriveDialogRegistration.Title(Localizer));
        Assert.False(string.IsNullOrWhiteSpace(ShareDriveDialogRegistration.Description(Localizer)));
        Assert.Equal("Active Share Links", ShareDriveDialogRegistration.Existing(Localizer));
    }

    [Fact]
    public void Registration_expiry_options_in_web_order()
    {
        IReadOnlyList<ShareExpiryOption> options = ShareDriveDialogRegistration.ExpiryOptions(Localizer);

        Assert.Equal(new[] { "7", "30", "90", "0" }, options.Select(o => o.Value).ToArray());
        Assert.Equal(new[] { "7 days", "30 days", "90 days", "Never" }, options.Select(o => o.Label).ToArray());
        Assert.Equal("30", ShareDriveDialogRegistration.DefaultExpiryDays);
    }

    // ---- Diagnostics (PII-safe, view.opened) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new ShareDriveDialogDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=ShareDriveDialog", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_emits_created_and_revoked_without_token()
    {
        var lines = new List<string>();
        var diagnostics = new ShareDriveDialogDiagnostics(lines.Add);

        diagnostics.RecordLinkCreated();
        diagnostics.RecordLinkRevoked();

        Assert.Equal(1, diagnostics.LinksCreated);
        Assert.Equal(1, diagnostics.LinksRevoked);
        Assert.Contains("share.link.created slug=ShareDriveDialog", lines);
        Assert.Contains("share.link.revoked slug=ShareDriveDialog", lines);
    }

    // ---- Fakes / helpers -----------------------------------------------------------

    private static ShareDriveDialogViewModel NewViewModel(
        IShareLinksSource source,
        IShareLinksCommands? commands = null,
        ShareDriveDialogDiagnostics? diagnostics = null,
        string origin = Origin) =>
        new(source, commands ?? new FakeShareLinksCommands(), DriveId, origin, Localizer, diagnostics, () => Now);

    private static FakeShareLinksSource Loaded(params ShareLink[] links) =>
        new(RepositoryResult<IReadOnlyList<ShareLink>>.Loaded(links, Now));

    private sealed class FakeShareLinksSource : IShareLinksSource
    {
        private readonly RepositoryResult<IReadOnlyList<ShareLink>>[] _emissions;
        private int _calls;

        public FakeShareLinksSource(params RepositoryResult<IReadOnlyList<ShareLink>>[] emissions) =>
            _emissions = emissions.Length == 0
                ? new[] { RepositoryResult<IReadOnlyList<ShareLink>>.Empty(Now) }
                : emissions;

        public int Calls => _calls;

        public long? LastDriveId { get; private set; }

        public RepositoryResult<IReadOnlyList<ShareLink>> First() => _emissions[0];

        public async IAsyncEnumerable<RepositoryResult<IReadOnlyList<ShareLink>>> StreamAsync(
            long driveId,
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            LastDriveId = driveId;
            _calls++;
            foreach (RepositoryResult<IReadOnlyList<ShareLink>> emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
                await Task.Yield();
            }
        }
    }

    private sealed class FakeShareLinksCommands : IShareLinksCommands
    {
        private readonly ShareCreateOutcome _createOutcome;
        private readonly ShareRevokeOutcome _revokeOutcome;

        public FakeShareLinksCommands(ShareCreateOutcome? create = null, ShareRevokeOutcome? revoke = null)
        {
            _createOutcome = create ?? ShareCreateOutcome.Ok(new ShareCreateResult("tok-default", null, 1));
            _revokeOutcome = revoke ?? ShareRevokeOutcome.Ok();
        }

        public int CreateCalls { get; private set; }

        public int RevokeCalls { get; private set; }

        public long? LastCreateDriveId { get; private set; }

        public CreateShareBody? LastCreateBody { get; private set; }

        public string? LastRevokeToken { get; private set; }

        public Task<ShareCreateOutcome> CreateAsync(long driveId, CreateShareBody body, CancellationToken cancellationToken = default)
        {
            CreateCalls++;
            LastCreateDriveId = driveId;
            LastCreateBody = body;
            return Task.FromResult(_createOutcome);
        }

        public Task<ShareRevokeOutcome> RevokeAsync(string token, CancellationToken cancellationToken = default)
        {
            RevokeCalls++;
            LastRevokeToken = token;
            return Task.FromResult(_revokeOutcome);
        }
    }
}
