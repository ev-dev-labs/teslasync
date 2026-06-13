using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Admin;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>APIKeysPage</c> surface's WinUI-free logic — the API-key JSON adapters, the
/// permission/row projection (labels, status chips, metadata, expired flag, Narrator names), the registration
/// metadata, the PII-safe diagnostics and the view-model's state matrix (loading / loaded / empty / offline /
/// error) plus its create / delete / revoke actions. Mirrors the web page
/// (web/src/features/admin/pages/APIKeysPage.tsx). The WinUI view itself is exercised by the app build; its
/// per-region visibility is driven entirely by the <see cref="ApiKeysDisplay"/> projection asserted here.
/// </summary>
public sealed class APIKeysPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // ---- ApiKey adapter (web APIKey) ----------------------------------------------------------------

    [Fact]
    public void ApiKey_FromJson_reads_snake_case_fields()
    {
        const string json = """
        {
          "id": 42, "name": "CI Pipeline", "key_prefix": "ts_abc123...", "permissions": "read-write",
          "created_at": "2026-06-10T08:00:00Z", "last_used_at": "2026-06-12T09:30:00Z", "expires_at": null
        }
        """;
        using var doc = JsonDocument.Parse(json);

        var key = ApiKey.FromJson(doc.RootElement);

        Assert.Equal(42, key.Id);
        Assert.Equal("CI Pipeline", key.Name);
        Assert.Equal("ts_abc123...", key.KeyPrefix);
        Assert.Equal("read-write", key.Permissions);
        Assert.NotNull(key.CreatedAt);
        Assert.NotNull(key.LastUsedAt);
        Assert.Null(key.ExpiresAt);
    }

    [Fact]
    public void ApiKey_FromJson_tolerates_missing_fields_and_defaults_permission()
    {
        using var doc = JsonDocument.Parse("""{ "id": "7", "name": "Minimal" }""");

        var key = ApiKey.FromJson(doc.RootElement);

        Assert.Equal(7, key.Id);                 // numeric-string id tolerated
        Assert.Equal(string.Empty, key.KeyPrefix);
        Assert.Equal("read", key.Permissions);   // missing permissions -> read
        Assert.Null(key.LastUsedAt);
        Assert.Null(key.ExpiresAt);
    }

    [Fact]
    public void ApiKey_IsExpired_compares_against_now()
    {
        var expired = new ApiKey(1, "Old", "p", "read", Now.AddDays(-30), null, Now.AddDays(-1));
        var live = new ApiKey(2, "New", "p", "read", Now.AddDays(-1), null, Now.AddDays(30));
        var perpetual = new ApiKey(3, "Forever", "p", "read", Now, null, null);

        Assert.True(expired.IsExpired(Now));
        Assert.False(live.IsExpired(Now));
        Assert.False(perpetual.IsExpired(Now));
    }

    [Fact]
    public void ApiKeyList_FromJson_parses_array_and_handles_empty()
    {
        const string json = """
        [
          { "id": 1, "name": "A", "key_prefix": "ts_a...", "permissions": "read", "created_at": "2026-06-01T00:00:00Z" },
          { "id": 2, "name": "B", "key_prefix": "ts_b...", "permissions": "admin", "created_at": "2026-06-02T00:00:00Z" }
        ]
        """;
        using var doc = JsonDocument.Parse(json);

        var list = ApiKeyList.FromJson(doc.RootElement);

        Assert.True(list.HasData);
        Assert.Equal(2, list.Keys.Count);
        Assert.Equal("A", list.Keys[0].Name);

        using var notArray = JsonDocument.Parse("""{ "error": "nope" }""");
        Assert.False(ApiKeyList.FromJson(notArray.RootElement).HasData);

        using var empty = JsonDocument.Parse("[]");
        Assert.False(ApiKeyList.FromJson(empty.RootElement).HasData);
    }

    [Fact]
    public void CreatedApiKey_FromJson_reads_one_time_secret()
    {
        const string json = """
        { "id": 99, "key": "ts_deadbeefdeadbeef", "name": "My Application", "key_prefix": "ts_deadbe...", "permissions": "admin" }
        """;
        using var doc = JsonDocument.Parse(json);

        var created = CreatedApiKey.FromJson(doc.RootElement);

        Assert.Equal(99, created.Id);
        Assert.Equal("ts_deadbeefdeadbeef", created.Key);
        Assert.Equal("My Application", created.Name);
        Assert.Equal("admin", created.Permissions);
    }

    // ---- Permission projection (web PermissionBadge) ------------------------------------------------

    [Theory]
    [InlineData("read", "Read", StatusKind.Success)]
    [InlineData("read-write", "Read-Write", StatusKind.Warning)]
    [InlineData("admin", "Admin", StatusKind.Info)]
    [InlineData("nonsense", "Read", StatusKind.Success)]
    public void Permission_projects_label_and_status(string permission, string expectedLabel, StatusKind expectedStatus)
    {
        var (label, status, glyph) = ApiKeysProjection.Permission(permission, Localizer);

        Assert.Equal(expectedLabel, label);
        Assert.Equal(expectedStatus, status);
        Assert.False(string.IsNullOrEmpty(glyph));
    }

    // ---- Row + chrome projection --------------------------------------------------------------------

    [Fact]
    public void Project_chrome_uses_web_strings()
    {
        var display = ApiKeysProjection.Project(ApiKeyList.Empty, ApiKeysState.Empty, Localizer, Now);

        Assert.Equal("API Keys", display.Title);
        Assert.Equal("Manage programmatic access to TeslaSync", display.Subtitle);
        Assert.Equal("Create Key", display.CreateLabel);
        Assert.Equal("No API keys", display.EmptyTitle);
        Assert.Equal(
            "Create an API key to enable programmatic access to TeslaSync data and controls.",
            display.EmptyMessage);
        Assert.Empty(display.Rows);
    }

    [Fact]
    public void Project_rows_carry_metadata_and_flags()
    {
        var keys = new ApiKeyList(new[]
        {
            new ApiKey(1, "Live Key", "ts_live...", "read", Now.AddDays(-5), Now.AddDays(-1), Now.AddDays(30)),
            new ApiKey(2, "Stale Key", "ts_old...", "admin", Now.AddDays(-90), null, Now.AddDays(-2)),
        });

        var display = ApiKeysProjection.Project(keys, ApiKeysState.Loaded, Localizer, Now);

        Assert.Equal(2, display.Rows.Count);

        var live = display.Rows[0];
        Assert.Equal("Live Key", live.Name);
        Assert.Equal("Read", live.PermissionLabel);
        Assert.False(live.IsExpired);
        Assert.True(live.CanRevoke);
        Assert.StartsWith("Created ", live.CreatedText, StringComparison.Ordinal);
        Assert.True(live.HasLastUsed);
        Assert.StartsWith("Last used ", live.LastUsedText, StringComparison.Ordinal);
        Assert.Equal("Revoke", live.RevokeTooltip);
        Assert.Equal("Delete", live.DeleteTooltip);

        var expired = display.Rows[1];
        Assert.Equal("Admin", expired.PermissionLabel);
        Assert.True(expired.IsExpired);
        Assert.False(expired.CanRevoke);
        Assert.Equal("Expired", expired.ExpiredLabel);
        Assert.False(expired.HasLastUsed);
        Assert.Equal(string.Empty, expired.LastUsedText);
    }

    [Theory]
    [InlineData(ApiKeysState.Loading)]
    [InlineData(ApiKeysState.Error)]
    public void Project_loading_and_error_render_no_rows(ApiKeysState state)
    {
        var keys = new ApiKeyList(new[] { new ApiKey(1, "K", "p", "read", Now, null, null) });

        var display = ApiKeysProjection.Project(keys, state, Localizer, Now);

        Assert.Empty(display.Rows);
    }

    // ---- View-model state matrix --------------------------------------------------------------------

    [Fact]
    public async Task ViewModel_resolves_empty_state()
    {
        var source = new FakeApiKeysSource(
            RepositoryResult<ApiKeyList>.Loading(),
            RepositoryResult<ApiKeyList>.Empty(Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(ApiKeysState.Empty, vm.State);
        Assert.False(vm.HasKeys);
        Assert.False(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_resolves_loaded_rows()
    {
        var source = new FakeApiKeysSource(
            RepositoryResult<ApiKeyList>.Loading(),
            RepositoryResult<ApiKeyList>.Loaded(SampleList(), Now));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(ApiKeysState.Loaded, vm.State);
        Assert.True(vm.HasKeys);
        Assert.Single(vm.Display.Rows);
    }

    [Fact]
    public async Task ViewModel_resolves_error_with_message()
    {
        var source = new FakeApiKeysSource(
            RepositoryResult<ApiKeyList>.Loading(),
            RepositoryResult<ApiKeyList>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(ApiKeysState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_offline_keeps_content_and_message()
    {
        var source = new FakeApiKeysSource(
            RepositoryResult<ApiKeyList>.Loading(),
            RepositoryResult<ApiKeyList>.OfflineCached(SampleList(), Now, new RepositoryError(RepositoryErrorKind.Offline, "down")));
        using var vm = NewViewModel(source);

        await vm.LoadAsync();

        Assert.Equal(ApiKeysState.Offline, vm.State);
        Assert.True(vm.HasKeys);
        Assert.False(string.IsNullOrEmpty(vm.ErrorMessage));
    }

    // ---- Mutations (web useCreateApiKey / useDeleteApiKey / useRevokeApiKey) -------------------------

    [Fact]
    public async Task ViewModel_create_records_call_toasts_and_returns_secret()
    {
        var source = new FakeApiKeysSource(RepositoryResult<ApiKeyList>.Loaded(SampleList(), Now));
        using var vm = NewViewModel(source);
        var toasts = Capture(vm);
        await vm.LoadAsync();

        var created = await vm.CreateKeyAsync("My Application", "read-write");

        Assert.NotNull(created);
        Assert.Equal("ts_secret_value", created!.Key);
        Assert.Contains(source.Created, c => c.Name == "My Application" && c.Permissions == "read-write");
        Assert.Contains(toasts, t => !t.IsError);
    }

    [Fact]
    public async Task ViewModel_create_failure_toasts_error_and_returns_null()
    {
        var source = new FakeApiKeysSource(RepositoryResult<ApiKeyList>.Loaded(SampleList(), Now)) { ThrowOnCreate = true };
        using var vm = NewViewModel(source);
        var toasts = Capture(vm);

        var created = await vm.CreateKeyAsync("My Application", "read");

        Assert.Null(created);
        Assert.Contains(toasts, t => t.IsError);
    }

    [Fact]
    public async Task ViewModel_delete_records_call_and_toasts()
    {
        var source = new FakeApiKeysSource(RepositoryResult<ApiKeyList>.Loaded(SampleList(), Now));
        using var vm = NewViewModel(source);
        var toasts = Capture(vm);

        await vm.DeleteKeyAsync(7);

        Assert.Contains(7L, source.Deleted);
        Assert.Contains(toasts, t => !t.IsError);
    }

    [Fact]
    public async Task ViewModel_revoke_records_call_and_toasts()
    {
        var source = new FakeApiKeysSource(RepositoryResult<ApiKeyList>.Loaded(SampleList(), Now));
        using var vm = NewViewModel(source);
        var toasts = Capture(vm);

        await vm.RevokeKeyAsync(7);

        Assert.Contains(7L, source.Revoked);
        Assert.Contains(toasts, t => !t.IsError);
    }

    // ---- Registration + diagnostics -----------------------------------------------------------------

    [Fact]
    public void Registration_exposes_contract_operation_ids()
    {
        Assert.Equal("APIKeys", ApiKeysRegistration.RouteName);
        Assert.Equal("api-keys", ApiKeysRegistration.RoutePath);
        Assert.Equal("APIKeysPage", ApiKeysRegistration.Slug);
        Assert.Equal("get_api_v1_api_keys", ApiKeysRegistration.ListOperation);
        Assert.Equal("post_api_v1_api_keys", ApiKeysRegistration.CreateOperation);
        Assert.Equal("delete_api_v1_api_keys_id", ApiKeysRegistration.DeleteOperation);
        Assert.Equal("post_api_v1_api_keys_id_revoke", ApiKeysRegistration.RevokeOperation);
        Assert.Equal("API Keys", ApiKeysRegistration.Title(Localizer));
        Assert.Equal("Manage programmatic access to TeslaSync", ApiKeysRegistration.Subtitle(Localizer));
    }

    [Fact]
    public void Diagnostics_records_view_opened_without_pii()
    {
        var lines = new List<string>();
        var diagnostics = new ApiKeysDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Single(lines);
        Assert.Equal("view.opened slug=APIKeysPage", lines[0]);
    }

    // ---- Helpers ------------------------------------------------------------------------------------

    private static ApiKeysPageViewModel NewViewModel(IApiKeysSource source) =>
        new(source, Localizer, clock: () => Now);

    private static ApiKeyList SampleList() =>
        new(new[] { new ApiKey(7, "CI Pipeline", "ts_ci...", "read", Now.AddDays(-3), Now.AddDays(-1), null) });

    private static List<ApiKeysToast> Capture(ApiKeysPageViewModel vm)
    {
        var toasts = new List<ApiKeysToast>();
        vm.ToastRequested += (_, toast) => toasts.Add(toast);
        return toasts;
    }

    private sealed class FakeApiKeysSource : IApiKeysSource
    {
        private readonly RepositoryResult<ApiKeyList>[] _emissions;

        public FakeApiKeysSource(params RepositoryResult<ApiKeyList>[] emissions) => _emissions = emissions;

        public List<(string Name, string Permissions)> Created { get; } = new();

        public List<long> Deleted { get; } = new();

        public List<long> Revoked { get; } = new();

        public CreatedApiKey CreatedResult { get; set; } =
            new(99, "ts_secret_value", "My Application", "ts_secret...", "read");

        public bool ThrowOnCreate { get; set; }

        public async IAsyncEnumerable<RepositoryResult<ApiKeyList>> StreamApiKeysAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }

        public Task<CreatedApiKey> CreateAsync(string name, string permissions, CancellationToken cancellationToken = default)
        {
            if (ThrowOnCreate)
            {
                throw new InvalidOperationException("create failed");
            }

            Created.Add((name, permissions));
            return Task.FromResult(CreatedResult);
        }

        public Task DeleteAsync(long id, CancellationToken cancellationToken = default)
        {
            Deleted.Add(id);
            return Task.CompletedTask;
        }

        public Task RevokeAsync(long id, CancellationToken cancellationToken = default)
        {
            Revoked.Add(id);
            return Task.CompletedTask;
        }
    }
}
