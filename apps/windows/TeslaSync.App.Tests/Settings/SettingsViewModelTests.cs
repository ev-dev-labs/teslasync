using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Settings;
using Xunit;

namespace TeslaSync.App.Tests.Settings;

/// <summary>Verifies the <see cref="SettingsViewModel"/> commands and cache management.</summary>
public sealed class SettingsViewModelTests
{
    [Fact]
    public async Task Setters_update_current_and_raise_changed()
    {
        var (vm, _, _) = CreateViewModel();
        var raised = 0;
        vm.Changed += (_, _) => raised++;

        await vm.SetThemeAsync(AppThemePreference.Dark);
        await vm.SetUnitsAsync(UnitSystemPreference.Imperial);
        await vm.SetTelemetryOptInAsync(true);

        Assert.Equal(AppThemePreference.Dark, vm.Current.Theme);
        Assert.Equal(UnitSystemPreference.Imperial, vm.Current.Units);
        Assert.True(vm.Current.TelemetryOptIn);
        Assert.Equal(3, raised);
    }

    [Fact]
    public async Task SetMaxCacheEntriesAsync_is_clamped_by_the_service()
    {
        var (vm, _, _) = CreateViewModel();

        await vm.SetMaxCacheEntriesAsync(5);

        Assert.Equal(AppSettings.MinCacheEntries, vm.Current.MaxCacheEntries);
    }

    [Fact]
    public async Task ClearCacheAsync_delegates_to_the_cache_store()
    {
        var (vm, _, cache) = CreateViewModel();
        cache.Entries = 12;

        Assert.True(vm.SupportsCacheManagement);
        Assert.Equal(12, await vm.GetCacheEntryCountAsync());

        await vm.ClearCacheAsync();

        Assert.Equal(1, cache.ClearCount);
        Assert.Equal(0, await vm.GetCacheEntryCountAsync());
    }

    [Fact]
    public async Task Cache_management_is_a_safe_noop_without_a_cache()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore());
        var vm = new SettingsViewModel(service);

        Assert.False(vm.SupportsCacheManagement);
        Assert.Equal(0, await vm.GetCacheEntryCountAsync());
        await vm.ClearCacheAsync();
    }

    [Fact]
    public async Task ResetAsync_restores_defaults()
    {
        var (vm, _, _) = CreateViewModel();
        await vm.SetThemeAsync(AppThemePreference.Light);

        await vm.ResetAsync();

        Assert.Equal(AppSettings.Default, vm.Current);
    }

    private static (SettingsViewModel Vm, AppSettingsService Service, FakeCacheStore Cache) CreateViewModel()
    {
        var service = new AppSettingsService(new InMemoryAppSettingsStore());
        var cache = new FakeCacheStore();
        return (new SettingsViewModel(service, cache), service, cache);
    }

    private sealed class FakeCacheStore : ICacheStore
    {
        public int Entries { get; set; }

        public int ClearCount { get; private set; }

        public Task InitializeAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<CacheEntry?> ReadAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult<CacheEntry?>(null);

        public Task WriteAsync(string key, string payload, DateTimeOffset fetchedAt, CancellationToken cancellationToken = default)
        {
            Entries++;
            return Task.CompletedTask;
        }

        public Task<bool> RemoveAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult(false);

        public Task<int> CountAsync(CancellationToken cancellationToken = default) => Task.FromResult(Entries);

        public Task<int> EvictAsync(CancellationToken cancellationToken = default) => Task.FromResult(0);

        public Task ClearAsync(CancellationToken cancellationToken = default)
        {
            ClearCount++;
            Entries = 0;
            return Task.CompletedTask;
        }
    }
}
