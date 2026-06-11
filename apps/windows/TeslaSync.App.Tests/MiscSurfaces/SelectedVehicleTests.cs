using TeslaSync.App.MiscSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.MiscSurfaces;

/// <summary>
/// Headless verification of the selected-vehicle store's UI-thread-free logic — the persisted-id
/// parse / validate guard, the in-memory storage seam, and the state-holder's hydrate / persist / clear /
/// cross-instance / no-op behaviour. Mirrors the web spec one-for-one
/// (web/src/store/selectedVehicle.tsx + web/src/store/__tests__/selectedVehicle.test.tsx). The WinUI parts
/// (SelectedVehicleProvider and the LocalSettings-backed storage in selectedVehicle.cs) are exercised by the
/// app build.
/// </summary>
public sealed class SelectedVehicleTests
{
    // ── id parse / validate (web loadInitial guard: Number.isFinite(n) && n > 0) ─────────────────────────

    [Theory]
    [InlineData("42", 42L)]
    [InlineData("7", 7L)]
    [InlineData("99", 99L)]
    [InlineData(" 42 ", 42L)] // web Number() trims surrounding whitespace
    public void Parse_accepts_positive_integers(string raw, long expected) =>
        Assert.Equal(expected, SelectedVehicleId.Parse(raw));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-number")] // web: ignores garbage values
    [InlineData("0")]            // web: ignores non-positive ids
    [InlineData("-3")]
    public void Parse_rejects_blank_garbage_and_non_positive(string? raw) =>
        Assert.Null(SelectedVehicleId.Parse(raw));

    [Theory]
    [InlineData(1L, true)]
    [InlineData(0L, false)]
    [InlineData(-1L, false)]
    public void IsValid_requires_a_positive_id(long id, bool expected) =>
        Assert.Equal(expected, SelectedVehicleId.IsValid(id));

    [Fact]
    public void Format_serializes_id_and_clears_on_null()
    {
        Assert.Equal("7", SelectedVehicleId.Format(7));
        Assert.Null(SelectedVehicleId.Format(null));
    }

    // ── store: hydrate / persist / clear (web test parity) ───────────────────────────────────────────────

    [Fact]
    public void Store_starts_null_when_storage_is_empty()
    {
        using var store = new SelectedVehicleStore(new InMemorySelectedVehicleStorage());

        Assert.Null(store.VehicleId);
    }

    [Fact]
    public void Store_hydrates_from_storage_on_construction()
    {
        using var store = new SelectedVehicleStore(new InMemorySelectedVehicleStorage("42"));

        Assert.Equal(42L, store.VehicleId);
    }

    [Theory]
    [InlineData("not-a-number")]
    [InlineData("0")]
    public void Store_ignores_invalid_persisted_values(string raw)
    {
        using var store = new SelectedVehicleStore(new InMemorySelectedVehicleStorage(raw));

        Assert.Null(store.VehicleId);
    }

    [Fact]
    public void SetVehicleId_updates_state_and_persists()
    {
        var storage = new InMemorySelectedVehicleStorage();
        using var store = new SelectedVehicleStore(storage);

        store.SetVehicleId(7);

        Assert.Equal(7L, store.VehicleId);
        Assert.Equal("7", storage.Raw);
    }

    [Fact]
    public void SetVehicleId_null_clears_the_persisted_value()
    {
        var storage = new InMemorySelectedVehicleStorage("7");
        using var store = new SelectedVehicleStore(storage);
        Assert.Equal(7L, store.VehicleId);

        store.SetVehicleId(null);

        Assert.Null(store.VehicleId);
        Assert.Null(storage.Raw);
    }

    [Fact]
    public void SetVehicleId_raises_property_changed_and_changed()
    {
        var storage = new InMemorySelectedVehicleStorage();
        using var store = new SelectedVehicleStore(storage);
        var properties = new List<string?>();
        long? changedTo = -1;
        store.PropertyChanged += (_, e) => properties.Add(e.PropertyName);
        store.Changed += (_, e) => changedTo = e.VehicleId;

        store.SetVehicleId(5);

        Assert.Contains(nameof(SelectedVehicleStore.VehicleId), properties);
        Assert.Equal(5L, changedTo);
    }

    // ── store: cross-instance (web cross-tab 'storage' event) ────────────────────────────────────────────

    [Fact]
    public void Store_responds_to_cross_instance_storage_events()
    {
        var storage = new InMemorySelectedVehicleStorage();
        using var store = new SelectedVehicleStore(storage);
        Assert.Null(store.VehicleId);

        storage.RaiseExternalChange("99");
        Assert.Equal(99L, store.VehicleId);

        storage.RaiseExternalChange(null);
        Assert.Null(store.VehicleId);
    }

    [Theory]
    [InlineData("garbage")]
    [InlineData("0")]
    [InlineData("-1")]
    public void Store_ignores_invalid_cross_instance_values(string newValue)
    {
        var storage = new InMemorySelectedVehicleStorage();
        using var store = new SelectedVehicleStore(storage);
        store.SetVehicleId(8);

        storage.RaiseExternalChange(newValue);

        // web onStorage ignores invalid / non-positive newValue, leaving the current selection untouched.
        Assert.Equal(8L, store.VehicleId);
    }

    [Fact]
    public void Store_dispose_unsubscribes_from_external_changes()
    {
        var storage = new InMemorySelectedVehicleStorage();
        var store = new SelectedVehicleStore(storage);
        store.SetVehicleId(3);
        store.Dispose();

        storage.RaiseExternalChange("50");

        Assert.Equal(3L, store.VehicleId);
    }

    // ── no-op fallback (web: useSelectedVehicleStore used outside the provider) ───────────────────────────

    [Fact]
    public void NoOp_scope_is_inert()
    {
        var scope = SelectedVehicleStore.NoOp;

        Assert.Null(scope.VehicleId);
        scope.SetVehicleId(42);
        Assert.Null(scope.VehicleId);
    }

    [Fact]
    public void NoOp_scope_is_a_shared_singleton() =>
        Assert.Same(SelectedVehicleStore.NoOp, NoOpSelectedVehicleScope.Instance);

    // ── diagnostics (view.opened, PII-safe — never the id) ───────────────────────────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new SelectedVehicleDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=selectedVehicle", Assert.Single(lines));
    }

    [Fact]
    public void Registration_slug_and_storage_key_match_the_web_source()
    {
        Assert.Equal("selectedVehicle", SelectedVehicleRegistration.Slug);
        Assert.Equal("teslasync-selected-vehicle", SelectedVehicleRegistration.StorageKey);
    }
}
