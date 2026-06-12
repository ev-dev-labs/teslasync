using System.Text.Json;
using System.Threading.Tasks;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the FormatterPrefsBridge shared surface's UI-thread-free logic — the registration
/// metadata (slug, formatter defaults, the locale/precision contract), the settings data adapter
/// (<see cref="FormatterPrefsSnapshot.FromJson"/> / <see cref="FormatterPrefsSnapshot.FromSettings"/> +
/// <c>resolveLocale</c> / precision clamp), the formatter globals (<see cref="FormatterPrefsStore"/>), the
/// PII-safe diagnostics, the two state-holder seams (<see cref="StaticFormatterPrefsSource"/> /
/// <see cref="RepositoryFormatterPrefsSource"/> and <see cref="StaticSettingsChangeSignal"/>), and the
/// <see cref="FormatterPrefsBridgeViewModel"/> that mirrors the web component's two effects: apply-on-resolve
/// with the exact <c>lastLocale</c> / <c>lastDecimals</c> de-dupe, and refetch-on-broadcast. Mirrors the web
/// spec one-for-one (web/src/components/FormatterPrefsBridge.tsx, web/src/lib/numberFormat.ts,
/// web/src/lib/locale.ts, web/src/api/hooks/useSettings.ts). The web source renders <see langword="null"/>, so
/// it has no titles/labels/i18n keys and no loading/empty/error/stale/offline chrome — the surface's behaviour
/// is the side-effect sync verified here. The WinUI view (shared-surfaces/FormatterPrefsBridge/FormatterPrefsBridge.cs)
/// is exercised by the app build.
/// </summary>
public sealed class FormatterPrefsBridgeTests
{
    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static FormatterPrefsBridgeViewModel Bridge(
        IFormatterPrefsSource source,
        out FormatterPrefsStore store,
        ISettingsChangeSignal? signal = null)
    {
        store = new FormatterPrefsStore();
        return new FormatterPrefsBridgeViewModel(source, store, signal);
    }

    // ── registration (anonymous, null-rendering web component: slug + formatter contract) ────────────────

    [Fact]
    public void Registration_slug_matches_the_prompt_surface_slug() =>
        Assert.Equal("FormatterPrefsBridge", FormatterPrefsBridgeRegistration.Slug);

    [Fact]
    public void Registration_exposes_the_web_numberFormat_defaults()
    {
        Assert.Equal("en-US", FormatterPrefsBridgeRegistration.DefaultLocale);
        Assert.Equal(2, FormatterPrefsBridgeRegistration.DefaultPrecision);
        Assert.Equal(0, FormatterPrefsBridgeRegistration.MinPrecision);
        Assert.Equal(20, FormatterPrefsBridgeRegistration.MaxPrecision);
    }

    [Fact]
    public void Registration_uses_the_go_api_snake_case_settings_keys()
    {
        Assert.Equal("locale", FormatterPrefsBridgeRegistration.LocaleKey);
        Assert.Equal("decimal_precision", FormatterPrefsBridgeRegistration.DecimalPrecisionKey);
    }

    // ── adapter: resolveLocale (web lib/locale.ts) ───────────────────────────────────────────────────────

    [Theory]
    [InlineData(null, "en-US")]
    [InlineData("", "en-US")]
    [InlineData("   ", "en-US")]
    [InlineData("de-DE", "de-DE")]
    [InlineData("  fr-FR  ", "fr-FR")]
    public void ResolveLocale_falls_back_to_en_us_for_blank_and_trims(string? input, string expected) =>
        Assert.Equal(expected, FormatterPrefsBridgeRegistration.ResolveLocale(input));

    // ── adapter: precision clamp (web setGlobalPrecision Math.max(0, Math.min(20, ...))) ──────────────────

    [Theory]
    [InlineData(2, 2)]
    [InlineData(-5, 0)]
    [InlineData(25, 20)]
    [InlineData(0, 0)]
    [InlineData(20, 20)]
    public void ClampPrecision_bounds_to_zero_through_twenty(int input, int expected) =>
        Assert.Equal(expected, FormatterPrefsBridgeRegistration.ClampPrecision(input));

    // ── adapter: FromSettings (web `resolveLocale(settings.locale)` + `settings.decimal_precision ?? 2`) ──

    [Fact]
    public void FromSettings_resolves_locale_and_defaults_precision()
    {
        var snapshot = FormatterPrefsSnapshot.FromSettings(rawLocale: null, rawPrecision: null);

        Assert.Equal("en-US", snapshot.Locale);
        Assert.Equal(2, snapshot.Precision);
    }

    [Fact]
    public void FromSettings_carries_precision_verbatim_before_the_store_clamp()
    {
        // web: `decimals = settings.decimal_precision ?? 2` is compared verbatim; clamping happens only inside
        // setGlobalPrecision. The snapshot therefore preserves an out-of-range value (the store clamps later).
        var snapshot = FormatterPrefsSnapshot.FromSettings("de-DE", 25);

        Assert.Equal("de-DE", snapshot.Locale);
        Assert.Equal(25, snapshot.Precision);
    }

    // ── adapter: FromJson (web useSettings query payload) ────────────────────────────────────────────────

    [Fact]
    public void FromJson_projects_locale_and_decimal_precision()
    {
        var snapshot = FormatterPrefsSnapshot.FromJson(Json("""{"locale":"fr-FR","decimal_precision":3}"""));

        Assert.Equal("fr-FR", snapshot.Locale);
        Assert.Equal(3, snapshot.Precision);
    }

    [Fact]
    public void FromJson_tolerates_a_numeric_string_precision()
    {
        var snapshot = FormatterPrefsSnapshot.FromJson(Json("""{"locale":"de-DE","decimal_precision":"4"}"""));

        Assert.Equal(4, snapshot.Precision);
    }

    [Fact]
    public void FromJson_falls_back_when_keys_are_absent()
    {
        var snapshot = FormatterPrefsSnapshot.FromJson(Json("""{"theme":"dark"}"""));

        Assert.Equal(FormatterPrefsSnapshot.Default, snapshot);
    }

    [Fact]
    public void FromJson_falls_back_for_a_blank_locale()
    {
        var snapshot = FormatterPrefsSnapshot.FromJson(Json("""{"locale":"","decimal_precision":1}"""));

        Assert.Equal("en-US", snapshot.Locale);
        Assert.Equal(1, snapshot.Precision);
    }

    [Fact]
    public void FromJson_returns_defaults_for_a_non_object_payload() =>
        Assert.Equal(FormatterPrefsSnapshot.Default, FormatterPrefsSnapshot.FromJson(Json("42")));

    // ── formatter globals: FormatterPrefsStore (web numberFormat module globals) ──────────────────────────

    [Fact]
    public void Store_starts_at_the_web_defaults()
    {
        var store = new FormatterPrefsStore();

        Assert.Equal("en-US", store.Locale);
        Assert.Equal(2, store.Precision);
    }

    [Theory]
    [InlineData("", "en-US")]
    [InlineData("   ", "en-US")]
    [InlineData("ja-JP", "ja-JP")]
    public void Store_locale_setter_clamps_blank_to_en_us(string input, string expected)
    {
        var store = new FormatterPrefsStore { Locale = input };

        Assert.Equal(expected, store.Locale);
    }

    [Theory]
    [InlineData(25, 20)]
    [InlineData(-1, 0)]
    [InlineData(6, 6)]
    public void Store_precision_setter_clamps_to_range(int input, int expected)
    {
        var store = new FormatterPrefsStore { Precision = input };

        Assert.Equal(expected, store.Precision);
    }

    [Fact]
    public void Store_change_event_fires_only_when_a_value_moves()
    {
        var store = new FormatterPrefsStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;

        store.Locale = "de-DE";   // moves
        store.Locale = "de-DE";   // no-op
        store.Precision = 4;      // moves
        store.Precision = 4;      // no-op

        Assert.Equal(2, changes);
    }

    [Fact]
    public void Store_format_number_uses_the_current_globals()
    {
        var store = new FormatterPrefsStore { Precision = 2 };

        Assert.Equal("1,234.50", store.FormatNumber(1234.5));
    }

    [Fact]
    public void Store_format_number_honors_per_call_overrides()
    {
        var store = new FormatterPrefsStore { Precision = 2 };

        Assert.Equal("1,000", store.FormatNumber(1000, decimals: 0));
    }

    [Fact]
    public void Store_apply_to_overlays_locale_and_precision_onto_a_unit_pref()
    {
        var store = new FormatterPrefsStore { Locale = "de-DE", Precision = 3 };

        var pref = store.ApplyTo(UnitPref.Metric);

        Assert.Equal("de-DE", pref.Locale);
        Assert.Equal(3, pref.Precision);
        Assert.Equal(UnitPref.Metric.Distance, pref.Distance);
        Assert.Equal(UnitPref.Metric.Speed, pref.Speed);
    }

    [Fact]
    public void Store_apply_to_rejects_a_null_base_pref()
    {
        var store = new FormatterPrefsStore();

        Assert.Throws<ArgumentNullException>(() => store.ApplyTo(null!));
    }

    [Fact]
    public void Shared_store_is_a_singleton() =>
        Assert.Same(FormatterPrefsStore.Shared, FormatterPrefsStore.Shared);

    // ── diagnostics (view.opened, PII-safe — never a locale or precision value) ──────────────────────────

    [Fact]
    public void Diagnostics_record_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new FormatterPrefsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=FormatterPrefsBridge", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_without_a_sink_still_count_opens()
    {
        var diagnostics = new FormatterPrefsDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ── seam: StaticFormatterPrefsSource + StaticSettingsChangeSignal ────────────────────────────────────

    [Fact]
    public void Static_source_starts_unresolved()
    {
        var source = new StaticFormatterPrefsSource();

        Assert.Null(source.Current);
    }

    [Fact]
    public void Static_source_set_resolves_and_raises_changed()
    {
        var source = new StaticFormatterPrefsSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Set(new FormatterPrefsSnapshot("de-DE", 3));

        Assert.Equal(new FormatterPrefsSnapshot("de-DE", 3), source.Current);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Static_source_refresh_counts_and_raises()
    {
        var source = new StaticFormatterPrefsSource();
        var raised = 0;
        source.Changed += (_, _) => raised++;

        source.Refresh();

        Assert.Equal(1, source.RefreshCount);
        Assert.Equal(1, raised);
    }

    [Fact]
    public void Settings_change_signal_raises_its_event()
    {
        var signal = new StaticSettingsChangeSignal();
        var raised = 0;
        signal.SettingsChanged += (_, _) => raised++;

        signal.Raise();

        Assert.Equal(1, raised);
    }

    // ── view-model: apply on resolve (web effect 1) ──────────────────────────────────────────────────────

    [Fact]
    public void Bridge_applies_nothing_while_settings_are_unresolved()
    {
        var source = new StaticFormatterPrefsSource();
        using var vm = Bridge(source, out var store);

        Assert.Equal("en-US", store.Locale);
        Assert.Equal(2, store.Precision);
    }

    [Fact]
    public void Bridge_applies_locale_and_precision_when_settings_resolve()
    {
        var source = new StaticFormatterPrefsSource();
        using var vm = Bridge(source, out var store);

        source.Set(new FormatterPrefsSnapshot("de-DE", 4));

        Assert.Equal("de-DE", store.Locale);
        Assert.Equal(4, store.Precision);
    }

    [Fact]
    public void Bridge_applies_a_snapshot_already_present_at_construction()
    {
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("fr-FR", 1));
        using var vm = Bridge(source, out var store);

        Assert.Equal("fr-FR", store.Locale);
        Assert.Equal(1, store.Precision);
    }

    [Fact]
    public void Bridge_does_not_rewrite_an_identical_snapshot()
    {
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("de-DE", 5));
        var store = new FormatterPrefsStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;
        using var vm = new FormatterPrefsBridgeViewModel(source, store);
        Assert.Equal(2, changes); // locale + precision both moved off the en-US/2 defaults

        source.Set(new FormatterPrefsSnapshot("de-DE", 5)); // identical refetch

        Assert.Equal(2, changes); // no redundant write
    }

    [Fact]
    public void Bridge_writes_only_the_field_that_changed()
    {
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("de-DE", 5));
        var store = new FormatterPrefsStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;
        using var vm = new FormatterPrefsBridgeViewModel(source, store);
        Assert.Equal(2, changes);

        source.Set(new FormatterPrefsSnapshot("fr-FR", 5)); // only locale moves
        Assert.Equal(3, changes);
        Assert.Equal("fr-FR", store.Locale);

        source.Set(new FormatterPrefsSnapshot("fr-FR", 8)); // only precision moves
        Assert.Equal(4, changes);
        Assert.Equal(8, store.Precision);
    }

    [Fact]
    public void Bridge_records_a_default_valued_first_resolve_without_a_write()
    {
        // web: when the resolved value already equals the global, lastLocale/lastDecimals are recorded but no
        // setGlobalX is called. en-US + 2 equal the store defaults, so no Changed should fire.
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("en-US", 2));
        var store = new FormatterPrefsStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;
        using var vm = new FormatterPrefsBridgeViewModel(source, store);

        Assert.Equal(0, changes);
        Assert.Equal("en-US", store.Locale);
        Assert.Equal(2, store.Precision);
    }

    [Fact]
    public void Bridge_clamps_an_out_of_range_precision_and_dedupes_it()
    {
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("en-US", 25));
        var store = new FormatterPrefsStore();
        var changes = 0;
        store.Changed += (_, _) => changes++;
        using var vm = new FormatterPrefsBridgeViewModel(source, store);

        Assert.Equal(1, changes);        // only precision moved (locale stayed en-US)
        Assert.Equal(20, store.Precision); // clamped at the store boundary

        source.Set(new FormatterPrefsSnapshot("en-US", 25)); // identical out-of-range value
        Assert.Equal(1, changes);        // compared verbatim against the last applied 25 → no rewrite
    }

    [Fact]
    public void Bridge_raises_property_changed_for_applied_fields()
    {
        var source = new StaticFormatterPrefsSource();
        using var vm = Bridge(source, out _);
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        source.Set(new FormatterPrefsSnapshot("de-DE", 4));

        Assert.Contains(nameof(FormatterPrefsBridgeViewModel.CurrentLocale), raised);
        Assert.Contains(nameof(FormatterPrefsBridgeViewModel.CurrentPrecision), raised);
        Assert.Equal("de-DE", vm.CurrentLocale);
        Assert.Equal(4, vm.CurrentPrecision);
    }

    // ── view-model: refetch on broadcast (web effect 2) ──────────────────────────────────────────────────

    [Fact]
    public void Bridge_forwards_a_broadcast_to_a_settings_refetch()
    {
        var source = new StaticFormatterPrefsSource();
        var signal = new StaticSettingsChangeSignal();
        using var vm = Bridge(source, out _, signal);

        signal.Raise();

        Assert.Equal(1, source.RefreshCount);
    }

    [Fact]
    public void Bridge_notify_settings_changed_triggers_a_refetch()
    {
        var source = new StaticFormatterPrefsSource();
        using var vm = Bridge(source, out _);

        vm.NotifySettingsChanged();

        Assert.Equal(1, source.RefreshCount);
    }

    [Fact]
    public void Bridge_defaults_to_the_shared_globals_when_no_store_is_supplied()
    {
        // An unresolved source applies nothing, so the shared singleton is observed without being mutated.
        var source = new StaticFormatterPrefsSource();
        using var vm = new FormatterPrefsBridgeViewModel(source);

        Assert.Same(FormatterPrefsStore.Shared, vm.Store);
    }

    // ── view-model: disposal unsubscribes (web effect cleanups) ──────────────────────────────────────────

    [Fact]
    public void Bridge_stops_applying_after_disposal()
    {
        var source = new StaticFormatterPrefsSource();
        var vm = Bridge(source, out var store);
        vm.Dispose();

        source.Set(new FormatterPrefsSnapshot("de-DE", 9));

        Assert.Equal("en-US", store.Locale);
        Assert.Equal(2, store.Precision);
    }

    [Fact]
    public void Bridge_stops_forwarding_broadcasts_after_disposal()
    {
        var source = new StaticFormatterPrefsSource();
        var signal = new StaticSettingsChangeSignal();
        var vm = Bridge(source, out _, signal);
        vm.Dispose();

        signal.Raise();

        Assert.Equal(0, source.RefreshCount);
    }

    // ── production seam: RepositoryFormatterPrefsSource (web useSettings query) ───────────────────────────

    private static async IAsyncEnumerable<RepositoryResult<JsonElement>> StreamOf(
        TaskCompletionSource done,
        params RepositoryResult<JsonElement>[] items)
    {
        try
        {
            foreach (var item in items)
            {
                await Task.Yield();
                yield return item;
            }
        }
        finally
        {
            done.TrySetResult();
        }
    }

    private static async Task DrainAsync(TaskCompletionSource done, int timeoutMs = 5000)
    {
        var completed = await Task.WhenAny(done.Task, Task.Delay(timeoutMs));
        Assert.True(ReferenceEquals(completed, done.Task), "settings stream did not complete within the timeout");
        await done.Task;
    }

    [Fact]
    public async Task Repository_source_projects_a_loaded_settings_document()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var source = new RepositoryFormatterPrefsSource(
            _ => StreamOf(
                done,
                RepositoryResult<JsonElement>.Loading(),
                RepositoryResult<JsonElement>.Loaded(Json("""{"locale":"de-DE","decimal_precision":3}"""), DateTimeOffset.Now)));

        await DrainAsync(done);

        Assert.Equal(new FormatterPrefsSnapshot("de-DE", 3), source.Current);
    }

    [Fact]
    public async Task Repository_source_projects_a_cached_settings_document()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var source = new RepositoryFormatterPrefsSource(
            _ => StreamOf(
                done,
                RepositoryResult<JsonElement>.Cached(Json("""{"locale":"fr-FR","decimal_precision":1}"""), DateTimeOffset.Now, stale: false)));

        await DrainAsync(done);

        Assert.Equal(new FormatterPrefsSnapshot("fr-FR", 1), source.Current);
    }

    [Fact]
    public async Task Repository_source_keeps_the_cached_value_while_offline()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var source = new RepositoryFormatterPrefsSource(
            _ => StreamOf(
                done,
                RepositoryResult<JsonElement>.OfflineCached(
                    Json("""{"locale":"ja-JP","decimal_precision":0}"""),
                    DateTimeOffset.Now,
                    new RepositoryError(RepositoryErrorKind.Offline, "offline"))));

        await DrainAsync(done);

        Assert.Equal(new FormatterPrefsSnapshot("ja-JP", 0), source.Current);
    }

    [Fact]
    public async Task Repository_source_stays_unresolved_for_value_less_emissions()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var source = new RepositoryFormatterPrefsSource(
            _ => StreamOf(
                done,
                RepositoryResult<JsonElement>.Loading(),
                RepositoryResult<JsonElement>.Empty()));

        await DrainAsync(done);

        Assert.Null(source.Current);
    }

    [Fact]
    public async Task Repository_source_drives_the_bridge_end_to_end()
    {
        var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        using var source = new RepositoryFormatterPrefsSource(
            _ => StreamOf(
                done,
                RepositoryResult<JsonElement>.Loaded(Json("""{"locale":"de-DE","decimal_precision":3}"""), DateTimeOffset.Now)));
        var store = new FormatterPrefsStore();
        using var vm = new FormatterPrefsBridgeViewModel(source, store);

        await DrainAsync(done);
        // The Changed callback applies on the pump thread; give the bridge a beat to observe the final emission.
        await Task.Delay(50);

        Assert.Equal("de-DE", store.Locale);
        Assert.Equal(3, store.Precision);
    }

    [Fact]
    public void Repository_source_rejects_a_null_stream() =>
        Assert.Throws<ArgumentNullException>(() => new RepositoryFormatterPrefsSource(null!));

    // ── accessibility / parity: the surface is side-effect-only (no interactive elements to label) ────────

    [Fact]
    public void Bridge_exposes_no_interactive_affordance_only_read_only_observability()
    {
        // The web component renders null: there is no button/input/labelled control, so there are no interactive
        // elements requiring an accessible name. The bridge exposes only read-only globals plus the refetch
        // trigger; applying settings produces no visible/accessible surface.
        var source = new StaticFormatterPrefsSource(new FormatterPrefsSnapshot("de-DE", 3));
        using var vm = Bridge(source, out var store);

        Assert.Equal(store.Locale, vm.CurrentLocale);
        Assert.Equal(store.Precision, vm.CurrentPrecision);
        Assert.Equal("FormatterPrefsBridge", FormatterPrefsBridgeViewModel.Slug);
    }
}
