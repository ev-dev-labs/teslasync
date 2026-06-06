using TeslaSync.App.Core.Settings;
using Xunit;

namespace TeslaSync.App.Tests.Settings;

/// <summary>Verifies the <see cref="AppSettingsService"/> load / update / reset / flush funnel.</summary>
public sealed class AppSettingsServiceTests
{
    [Fact]
    public async Task LoadAsync_normalizes_and_publishes_current()
    {
        var store = new InMemoryAppSettingsStore(AppSettings.Default with { MaxCacheEntries = 5, Units = UnitSystemPreference.Imperial });
        var service = new AppSettingsService(store);
        AppSettings? published = null;
        service.Changed += (_, s) => published = s;

        var loaded = await service.LoadAsync();

        Assert.Equal(AppSettings.MinCacheEntries, loaded.MaxCacheEntries);
        Assert.Equal(UnitSystemPreference.Imperial, loaded.Units);
        Assert.Equal(loaded, service.Current);
        Assert.Equal(loaded, published);
    }

    [Fact]
    public async Task UpdateAsync_persists_and_raises_changed()
    {
        var store = new InMemoryAppSettingsStore();
        var service = new AppSettingsService(store);
        var raised = 0;
        service.Changed += (_, _) => raised++;

        var updated = await service.UpdateAsync(s => s with { Theme = AppThemePreference.Dark });

        Assert.Equal(AppThemePreference.Dark, updated.Theme);
        Assert.Equal(AppThemePreference.Dark, service.Current.Theme);
        Assert.Equal(1, store.SaveCount);
        Assert.Equal(1, raised);
        Assert.Equal(AppThemePreference.Dark, (await store.LoadAsync()).Theme);
    }

    [Fact]
    public async Task UpdateAsync_is_a_noop_when_unchanged()
    {
        var store = new InMemoryAppSettingsStore();
        var service = new AppSettingsService(store);
        await service.LoadAsync();
        var raised = 0;
        service.Changed += (_, _) => raised++;

        await service.UpdateAsync(s => s with { Theme = AppThemePreference.System });

        Assert.Equal(0, raised);
        Assert.Equal(0, store.SaveCount);
    }

    [Fact]
    public async Task UpdateAsync_keeps_memory_state_when_persistence_fails()
    {
        var store = new InMemoryAppSettingsStore { FailNextSave = true };
        var service = new AppSettingsService(store);

        var updated = await service.UpdateAsync(s => s with { TelemetryOptIn = true });

        Assert.True(updated.TelemetryOptIn);
        Assert.True(service.Current.TelemetryOptIn);
    }

    [Fact]
    public async Task ResetAsync_restores_defaults()
    {
        var store = new InMemoryAppSettingsStore(AppSettings.Default with { Theme = AppThemePreference.Dark, TelemetryOptIn = true });
        var service = new AppSettingsService(store);
        await service.LoadAsync();

        var reset = await service.ResetAsync();

        Assert.Equal(AppSettings.Default, reset);
        Assert.Equal(AppSettings.Default, service.Current);
    }

    [Fact]
    public async Task FlushAsync_persists_current_snapshot()
    {
        var store = new InMemoryAppSettingsStore();
        var service = new AppSettingsService(store);
        await service.UpdateAsync(s => s with { VerboseLogging = true });
        var savesBefore = store.SaveCount;

        await service.FlushAsync();

        Assert.Equal(savesBefore + 1, store.SaveCount);
        Assert.True((await store.LoadAsync()).VerboseLogging);
    }
}
