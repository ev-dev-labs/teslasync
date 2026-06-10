using System.Runtime.CompilerServices;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the GeneralSettings surface's UI-thread-free logic — the settings JSON parse adapter (the
/// fourteen unit / range / cost / locale keys plus the full-replace merge body), the wire-token mapping, the Tesla
/// setting-enum parser, the car-preference / vehicle envelopes, the projection (every label, option list, banner,
/// i18n key and accessibility label), the cache-then-network result mapper, the registration metadata, the
/// diagnostics, and the state-holder view-model's per-state transitions (loading / loaded / empty / error / stale /
/// offline) plus its dirty-state diff, optimistic save and sync-from-car flow. Mirrors the web spec
/// (web/src/features/settings/components/GeneralSettings.tsx).
/// </summary>
public sealed class GeneralSettingsTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 9, 12, 5, 0, TimeSpan.Zero);

    // ---- Parse adapter (web useSettings read) --------------------------------------

    [Fact]
    public void FromJson_reads_every_editable_field()
    {
        var settings = GeneralServerSettings.FromJson(Json("""
        {
          "unit_of_length": "mi", "unit_of_temp": "F", "unit_of_pressure": "psi",
          "preferred_range": "ideal", "decimal_precision": 3, "language": "de",
          "currency_symbol": "\u20ac", "locale": "de-DE", "tz_display_default": "utc",
          "timezone_user": "America/Los_Angeles", "base_cost_per_kwh": 0.25,
          "gas_price_per_unit": 4.5, "gas_unit": "liter", "gas_efficiency_mpg": 30
        }
        """));

        var form = settings.Form;
        Assert.Equal(DistanceUnit.Mi, form.DistanceUnit);
        Assert.Equal(TemperatureUnit.Fahrenheit, form.TemperatureUnit);
        Assert.Equal(PressureUnit.Psi, form.PressureUnit);
        Assert.Equal(PreferredRange.Ideal, form.PreferredRange);
        Assert.Equal(3, form.DecimalPrecision);
        Assert.Equal("de", form.Language);
        Assert.Equal("\u20ac", form.CurrencySymbol);
        Assert.Equal("de-DE", form.Locale);
        Assert.Equal(TimeZoneDisplay.Utc, form.TzDisplayDefault);
        Assert.Equal("America/Los_Angeles", form.TimezoneUser);
        Assert.Equal(0.25, form.BaseCostPerKwh);
        Assert.Equal(4.5, form.GasPricePerUnit);
        Assert.Equal(GasUnit.Liter, form.GasUnit);
        Assert.Equal(30, form.GasEfficiencyMpg);
    }

    [Fact]
    public void FromJson_defaults_absent_or_invalid_fields()
    {
        var settings = GeneralServerSettings.FromJson(Json("""{ "unit_of_length": "nonsense", "decimal_precision": 99 }"""));

        Assert.Equal(DistanceUnit.Km, settings.Form.DistanceUnit);
        Assert.Equal(TemperatureUnit.Celsius, settings.Form.TemperatureUnit);
        Assert.Equal(PressureUnit.Bar, settings.Form.PressureUnit);
        Assert.Equal(GeneralFormValues.MaxPrecision, settings.Form.DecimalPrecision); // clamped to 20
        Assert.Equal("en", settings.Form.Language);
        Assert.Equal("$", settings.Form.CurrencySymbol);
    }

    [Fact]
    public void FromJson_returns_defaults_for_non_object()
    {
        var settings = GeneralServerSettings.FromJson(Json("[]"));

        Assert.Equal(GeneralFormValues.Default, settings.Form);
        Assert.Empty(settings.Raw);
    }

    [Fact]
    public void FromJson_tolerates_numbers_encoded_as_strings()
    {
        var settings = GeneralServerSettings.FromJson(Json("""{ "base_cost_per_kwh": "0.18", "decimal_precision": "4" }"""));

        Assert.Equal(0.18, settings.Form.BaseCostPerKwh);
        Assert.Equal(4, settings.Form.DecimalPrecision);
    }

    [Fact]
    public void ToRequestBody_preserves_other_fields_and_authors_the_editable_keys()
    {
        var settings = GeneralServerSettings.FromJson(Json("""
        { "unit_of_length": "km", "theme": "tesla-red", "alert_email": "a@b.c" }
        """));

        var body = settings.WithForm(settings.Form with
        {
            DistanceUnit = DistanceUnit.Mi,
            TemperatureUnit = TemperatureUnit.Fahrenheit,
            BaseCostPerKwh = 0.2,
            DecimalPrecision = 5,
            GasUnit = GasUnit.Liter,
        }).ToRequestBody();

        // The web partial-merge keeps every other field of the settings document...
        Assert.True(body.ContainsKey("theme"));
        Assert.True(body.ContainsKey("alert_email"));

        // ...and authors the editable keys from the typed form (snake_case wire tokens).
        Assert.Equal("mi", (string?)body["unit_of_length"]);
        Assert.Equal("F", (string?)body["unit_of_temp"]);
        Assert.Equal(0.2, (double?)body["base_cost_per_kwh"]);
        Assert.Equal(5, (int?)body["decimal_precision"]);
        Assert.Equal("liter", (string?)body["gas_unit"]);
    }

    [Fact]
    public void Precision_preview_matches_the_web_toFixed()
    {
        Assert.Equal("14.25", (GeneralFormValues.Default with { DecimalPrecision = 2 }).PrecisionPreview());
        Assert.Equal("14", (GeneralFormValues.Default with { DecimalPrecision = 0 }).PrecisionPreview());
        Assert.Equal("14.2485", (GeneralFormValues.Default with { DecimalPrecision = 4 }).PrecisionPreview());
    }

    [Fact]
    public void Default_form_matches_the_web_DEFAULT_FORM()
    {
        var form = GeneralFormValues.Default;

        Assert.Equal(DistanceUnit.Km, form.DistanceUnit);
        Assert.Equal(TemperatureUnit.Celsius, form.TemperatureUnit);
        Assert.Equal(PressureUnit.Bar, form.PressureUnit);
        Assert.Equal(PreferredRange.Rated, form.PreferredRange);
        Assert.Equal(2, form.DecimalPrecision);
        Assert.Equal("en", form.Language);
        Assert.Equal("$", form.CurrencySymbol);
        Assert.Equal("en-US", form.Locale);
        Assert.Equal(TimeZoneDisplay.Vehicle, form.TzDisplayDefault);
        Assert.Equal(string.Empty, form.TimezoneUser);
        Assert.Equal(0.12, form.BaseCostPerKwh);
        Assert.Equal(3.50, form.GasPricePerUnit);
        Assert.Equal(GasUnit.Gallon, form.GasUnit);
        Assert.Equal(25, form.GasEfficiencyMpg);
    }

    // ---- Wire token mapping --------------------------------------------------------

    [Theory]
    [InlineData(DistanceUnit.Km, "km")]
    [InlineData(DistanceUnit.Mi, "mi")]
    public void Distance_tokens_round_trip(DistanceUnit choice, string token)
    {
        Assert.Equal(token, GeneralWire.Token(choice));
        Assert.Equal(choice, GeneralWire.ParseDistance(token));
    }

    [Theory]
    [InlineData(TimeZoneDisplay.Vehicle, "vehicle")]
    [InlineData(TimeZoneDisplay.User, "user")]
    [InlineData(TimeZoneDisplay.Utc, "utc")]
    public void TzDisplay_tokens_round_trip(TimeZoneDisplay choice, string token)
    {
        Assert.Equal(token, GeneralWire.Token(choice));
        Assert.Equal(choice, GeneralWire.ParseTzDisplay(token));
    }

    [Fact]
    public void Unknown_tokens_fall_back_to_defaults()
    {
        Assert.Equal(DistanceUnit.Km, GeneralWire.ParseDistance(null));
        Assert.Equal(TemperatureUnit.Celsius, GeneralWire.ParseTemperature("???"));
        Assert.Equal(PressureUnit.Bar, GeneralWire.ParsePressure(""));
        Assert.Equal(PreferredRange.Rated, GeneralWire.ParsePreferredRange("x"));
        Assert.Equal(GasUnit.Gallon, GeneralWire.ParseGasUnit(null));
        Assert.Equal(TimeZoneDisplay.Vehicle, GeneralWire.ParseTzDisplay("x"));
    }

    // ---- Tesla setting-enum parser (web parseSettingEnum) --------------------------

    [Fact]
    public void SettingEnumParser_strips_tesla_prefixes()
    {
        Assert.Equal("Miles", SettingEnumParser.Parse("DistanceUnitMiles", SettingEnumParser.Category.Distance));
        Assert.Equal("Celsius", SettingEnumParser.Parse("TemperatureUnitCelsius", SettingEnumParser.Category.Temperature));
        Assert.Equal("PSI", SettingEnumParser.Parse("PressureUnitPsi", SettingEnumParser.Category.Pressure));
        Assert.Equal("\u2014", SettingEnumParser.Parse(null, SettingEnumParser.Category.Distance));
    }

    [Fact]
    public void SettingEnumParser_detects_intent()
    {
        Assert.True(SettingEnumParser.IsMiles("DistanceUnitMiles"));
        Assert.False(SettingEnumParser.IsMiles("DistanceUnitKilometers"));
        Assert.True(SettingEnumParser.IsFahrenheit("TemperatureUnitFahrenheit"));
        Assert.True(SettingEnumParser.IsPsi("PressureUnitPsi"));
        Assert.True(SettingEnumParser.IsBar("PressureUnitBar"));
        Assert.False(SettingEnumParser.IsBar(null));
    }

    // ---- Envelopes -----------------------------------------------------------------

    [Fact]
    public void CarPreferences_parse_and_guards()
    {
        var prefs = CarPreferences.FromJson(Json("""
        { "setting_distance_unit": "DistanceUnitMiles", "setting_temperature_unit": "TemperatureUnitFahrenheit",
          "setting_tire_pressure_unit": "PressureUnitPsi", "setting_24hr_time": true }
        """));

        Assert.NotNull(prefs);
        Assert.True(prefs!.HasUnitInfo);
        Assert.True(prefs.HasClockInfo);
        Assert.True(prefs.Is24HourClock);
        Assert.Null(CarPreferences.FromJson(Json("[]")));
        Assert.False(CarPreferences.FromJson(Json("{}"))!.HasUnitInfo);
        Assert.False(CarPreferences.FromJson(Json("{}"))!.HasClockInfo);
    }

    [Fact]
    public void VehicleSummary_reads_the_first_vehicle_id()
    {
        var vehicle = VehicleSummary.FirstFrom(Json("""[{ "id": 42, "name": "Model 3", "vin": "X" }, { "id": 7 }]"""));

        Assert.NotNull(vehicle);
        Assert.Equal(42, vehicle!.Id);
        Assert.Equal("Model 3", vehicle.Name);
        Assert.Null(VehicleSummary.FirstFrom(Json("[]")));
        Assert.Null(VehicleSummary.FirstFrom(Json("{}")));
    }

    // ---- Projection: titles, options + i18n ----------------------------------------

    [Fact]
    public void Projection_resolves_header_through_i18n()
    {
        var display = GeneralSettingsProjection.Project(Localizer, carPrefs: null);

        Assert.Equal("Application", display.Title);
        Assert.Equal("Units, language, and cost preferences", display.Subtitle);
    }

    [Fact]
    public void Projection_unit_selects_carry_localized_option_labels()
    {
        var display = GeneralSettingsProjection.Project(Localizer, carPrefs: null);

        Assert.Equal("Distance Unit", display.DistanceLabel);
        Assert.Equal(new[] { "Kilometers", "Miles" }, display.DistanceOptions.Select(o => o.Label).ToArray());
        Assert.Equal(new[] { "km", "mi" }, display.DistanceOptions.Select(o => o.Value).ToArray());
        Assert.Equal(new[] { "Celsius", "Fahrenheit" }, display.TemperatureOptions.Select(o => o.Label).ToArray());
        Assert.Equal(new[] { "Bar", "PSI" }, display.PressureOptions.Select(o => o.Label).ToArray());
        Assert.Equal(new[] { "Rated", "Ideal" }, display.PreferredRangeOptions.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void Projection_locale_currency_language_and_tz_options_are_present()
    {
        var display = GeneralSettingsProjection.Project(Localizer, carPrefs: null);

        Assert.Equal("Number & Date Locale", display.LocaleLabel);
        Assert.Equal(7, display.LocaleOptions.Count);
        Assert.Equal(10, display.CurrencyOptions.Count);
        Assert.Equal(5, display.LanguageOptions.Count);
        Assert.Equal("English", display.LanguageOptions[0].Label);
        Assert.Equal(new[] { "vehicle", "user", "utc" }, display.TzDisplayOptions.Select(o => o.Value).ToArray());
        Assert.Equal("Vehicle's local time (recommended)", display.TzDisplayOptions[0].Label);
        Assert.Equal(new[] { "/ gallon", "/ liter" }, display.GasUnitOptions.Select(o => o.Label).ToArray());
    }

    [Fact]
    public void Projection_cost_and_timezone_labels_resolve()
    {
        var display = GeneralSettingsProjection.Project(Localizer, carPrefs: null);

        Assert.Equal("Electricity Cost (per kWh)", display.ElectricityCostLabel);
        Assert.Equal("Gas Price (for EV vs ICE comparison)", display.GasPriceLabel);
        Assert.Equal("Comparison Vehicle MPG", display.ComparisonMpgLabel);
        Assert.Equal("Average MPG of equivalent gas car", display.MpgPlaceholder);
        Assert.Equal("My Time Zone Override", display.TimezoneUserLabel);
        Assert.Equal("e.g. America/Los_Angeles (leave blank for browser default)", display.TimezoneUserPlaceholder);
        Assert.StartsWith("IANA tz name", display.TimezoneUserHint, StringComparison.Ordinal);
        Assert.Equal("Save Settings", display.SaveLabel);
        Assert.Equal("Settings saved", display.SettingsSavedLabel);
        Assert.Equal("You have unsaved settings.", display.UnsavedLabel);
    }

    [Fact]
    public void Projection_sync_banner_only_renders_with_unit_info()
    {
        Assert.Null(GeneralSettingsProjection.Project(Localizer, carPrefs: null).Sync);
        Assert.Null(GeneralSettingsProjection.Project(Localizer, new CarPreferences(null, null, null, null)).Sync);

        var sync = GeneralSettingsProjection.Project(
            Localizer,
            new CarPreferences("DistanceUnitMiles", "TemperatureUnitFahrenheit", "PressureUnitPsi", null)).Sync;

        Assert.NotNull(sync);
        Assert.Equal("Car uses Miles / Fahrenheit / PSI", sync!.CarUsesText);
        Assert.Equal("Sync from Car", sync.ActionLabel);
        Assert.StartsWith("Sync your app", sync.Hint, StringComparison.Ordinal);
    }

    [Fact]
    public void Projection_clock_banner_reflects_24h_flag()
    {
        var clock24 = GeneralSettingsProjection.Project(Localizer, new CarPreferences(null, null, null, true)).Clock;
        Assert.NotNull(clock24);
        Assert.Equal("Car clock format", clock24!.Label);
        Assert.Equal("24-hour", clock24.Value);

        var clock12 = GeneralSettingsProjection.Project(Localizer, new CarPreferences(null, null, null, false)).Clock;
        Assert.Equal("12-hour", clock12!.Value);

        Assert.Null(GeneralSettingsProjection.Project(Localizer, new CarPreferences(null, null, null, null)).Clock);
    }

    [Fact]
    public void ComposeSyncDetail_matches_the_web_toast_body()
    {
        var detail = GeneralSettingsProjection.ComposeSyncDetail(
            Localizer, DistanceUnit.Mi, TemperatureUnit.Fahrenheit, PressureUnit.Psi);

        Assert.Equal("Distance: Miles, Temperature: Fahrenheit, Pressure: PSI", detail);

        // Web parity: an unchanged unit defaults to the metric branch.
        var partial = GeneralSettingsProjection.ComposeSyncDetail(Localizer, null, TemperatureUnit.Fahrenheit, null);
        Assert.Equal("Distance: Kilometers, Temperature: Fahrenheit, Pressure: Bar", partial);
    }

    // ---- a11y: every field exposes a non-empty accessible label --------------------

    [Fact]
    public void Projection_every_field_has_an_accessible_label()
    {
        var display = GeneralSettingsProjection.Project(Localizer, carPrefs: null);

        foreach (var label in new[]
                 {
                     display.DistanceLabel, display.TemperatureLabel, display.PressureLabel,
                     display.PreferredRangeLabel, display.DecimalPrecisionLabel, display.LanguageLabel,
                     display.CurrencyLabel, display.LocaleLabel, display.TzDisplayLabel,
                     display.TimezoneUserLabel, display.ElectricityCostLabel, display.GasPriceLabel,
                     display.ComparisonMpgLabel, display.SaveLabel, display.AutomationName,
                 })
        {
            Assert.False(string.IsNullOrWhiteSpace(label));
        }

        Assert.All(display.DistanceOptions, o => Assert.False(string.IsNullOrWhiteSpace(o.Label)));
        Assert.All(display.CurrencyOptions, o => Assert.False(string.IsNullOrWhiteSpace(o.Label)));
    }

    // ---- Result mapper -------------------------------------------------------------

    [Fact]
    public void Map_preserves_lifecycle_status_and_parses_the_value()
    {
        var json = Json("""{ "unit_of_length": "mi" }""");

        Assert.Equal(LoadStatus.Loading, GeneralSettingsResultMapper.Map(RepositoryResult<JsonElement>.Loading()).Status);

        var cached = GeneralSettingsResultMapper.Map(RepositoryResult<JsonElement>.Cached(json, Now, stale: true));
        Assert.Equal(LoadStatus.Cached, cached.Status);
        Assert.True(cached.IsStale);
        Assert.Equal(DistanceUnit.Mi, cached.Value!.Form.DistanceUnit);

        var loaded = GeneralSettingsResultMapper.Map(RepositoryResult<JsonElement>.Loaded(json, Now));
        Assert.Equal(LoadStatus.Loaded, loaded.Status);

        Assert.Equal(LoadStatus.Empty, GeneralSettingsResultMapper.Map(RepositoryResult<JsonElement>.Empty(Now)).Status);

        var offline = GeneralSettingsResultMapper.Map(
            RepositoryResult<JsonElement>.OfflineCached(json, Now, new RepositoryError(RepositoryErrorKind.Network, "x")));
        Assert.Equal(LoadStatus.Offline, offline.Status);
        Assert.NotNull(offline.Value);

        var failure = GeneralSettingsResultMapper.Map(
            RepositoryResult<JsonElement>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        Assert.Equal(LoadStatus.Error, failure.Status);
        Assert.NotNull(failure.Error);
    }

    // ---- Registration metadata + diagnostics ---------------------------------------

    [Fact]
    public void Registration_matches_surface_contract()
    {
        Assert.Equal("general-settings", GeneralSettingsRegistration.Id);
        Assert.Equal("settings", GeneralSettingsRegistration.Category);
        Assert.Equal("GeneralSettings", GeneralSettingsRegistration.Slug);
        Assert.Equal("Application", GeneralSettingsRegistration.Title(Localizer));
    }

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new GeneralSettingsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=GeneralSettings", Assert.Single(lines));
    }

    // ---- View-model: per-state matrix ----------------------------------------------

    [Fact]
    public async Task ViewModel_loading_then_loaded_hydrates_the_draft()
    {
        var settings = Settings("mi");
        var source = new FakeSource(
            RepositoryResult<GeneralServerSettings>.Loading(),
            RepositoryResult<GeneralServerSettings>.Loaded(settings, Now));
        using var vm = new GeneralSettingsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(GeneralSettingsState.Loaded, vm.State);
        Assert.Equal(DistanceUnit.Mi, vm.Draft.DistanceUnit);
        Assert.False(vm.IsDirty);
        Assert.True(vm.FormEpoch > 0);
    }

    [Fact]
    public async Task ViewModel_empty_renders_defaults_and_is_editable()
    {
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Empty(Now));
        using var vm = new GeneralSettingsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(GeneralSettingsState.Empty, vm.State);
        Assert.Equal(GeneralFormValues.Default, vm.Draft);
    }

    [Fact]
    public async Task ViewModel_error_exposes_retry_message()
    {
        var source = new FakeSource(
            RepositoryResult<GeneralServerSettings>.Failure(new RepositoryError(RepositoryErrorKind.Server, "boom")));
        using var vm = new GeneralSettingsViewModel(source, Localizer);

        await vm.LoadAsync();

        Assert.Equal(GeneralSettingsState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.False(string.IsNullOrWhiteSpace(vm.ErrorMessage));
    }

    [Fact]
    public async Task ViewModel_stale_and_offline_keep_the_form_visible()
    {
        var settings = Settings("km");
        var stale = new FakeSource(RepositoryResult<GeneralServerSettings>.Cached(settings, Now, stale: true));
        using var staleVm = new GeneralSettingsViewModel(stale, Localizer);
        await staleVm.LoadAsync();
        Assert.Equal(GeneralSettingsState.Stale, staleVm.State);
        Assert.True(staleVm.IsStale);

        var offline = new FakeSource(RepositoryResult<GeneralServerSettings>.OfflineCached(
            settings, Now, new RepositoryError(RepositoryErrorKind.Offline, "down")));
        using var offlineVm = new GeneralSettingsViewModel(offline, Localizer);
        await offlineVm.LoadAsync();
        Assert.Equal(GeneralSettingsState.Offline, offlineVm.State);
        Assert.False(string.IsNullOrWhiteSpace(offlineVm.ErrorMessage));
    }

    // ---- View-model: dirty diff, save, sync ----------------------------------------

    [Fact]
    public async Task ViewModel_edit_marks_dirty_then_save_clears_it()
    {
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Loaded(Settings("km"), Now));
        using var vm = new GeneralSettingsViewModel(source, Localizer);
        await vm.LoadAsync();

        var epochBefore = vm.FormEpoch;
        vm.SetDistanceUnit(DistanceUnit.Mi);
        Assert.True(vm.IsDirty);
        Assert.Equal(epochBefore, vm.FormEpoch); // a user edit does not bump the epoch (keeps focus)

        GeneralSettingsNotice? notice = null;
        vm.NoticeRequested += (_, n) => notice = n;

        await vm.SaveAsync();

        Assert.Equal(1, source.SaveCount);
        Assert.Equal("mi", (string?)source.LastSaved!.ToRequestBody()["unit_of_length"]);
        Assert.False(vm.IsDirty);
        Assert.True(vm.JustSaved);
        Assert.True(vm.FormEpoch > epochBefore); // a committed save replaces the draft
        Assert.NotNull(notice);
        Assert.Equal(GeneralSettingsNoticeKind.Success, notice!.Kind);
        Assert.Equal("Settings saved", notice.Title);
    }

    [Fact]
    public async Task ViewModel_save_failure_raises_error_notice_and_keeps_draft()
    {
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Loaded(Settings("km"), Now))
        {
            ThrowOnSave = true,
        };
        using var vm = new GeneralSettingsViewModel(source, Localizer);
        await vm.LoadAsync();
        vm.SetDistanceUnit(DistanceUnit.Mi);

        GeneralSettingsNotice? notice = null;
        vm.NoticeRequested += (_, n) => notice = n;

        await vm.SaveAsync();

        Assert.Equal(GeneralSettingsNoticeKind.Error, notice!.Kind);
        Assert.Equal("Failed to save", notice.Title);
        Assert.Equal(DistanceUnit.Mi, vm.Draft.DistanceUnit); // edit retained for retry
        Assert.True(vm.IsDirty);
        Assert.False(vm.IsSaving);
    }

    [Fact]
    public async Task ViewModel_sync_from_car_applies_units_and_saves()
    {
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Loaded(Settings("km"), Now))
        {
            Vehicle = new VehicleSummary(42, "Model 3"),
            Prefs = new CarPreferences("DistanceUnitMiles", "TemperatureUnitFahrenheit", "PressureUnitPsi", true),
        };
        using var vm = new GeneralSettingsViewModel(source, Localizer);
        await vm.LoadAsync();

        Assert.Equal(42, source.LastCarPrefVehicleId);
        Assert.NotNull(vm.Display.Sync); // banner reprojected after the car-pref read

        GeneralSettingsNotice? notice = null;
        vm.NoticeRequested += (_, n) => notice = n;

        await vm.SyncFromCarAsync();

        Assert.Equal(DistanceUnit.Mi, vm.Draft.DistanceUnit);
        Assert.Equal(TemperatureUnit.Fahrenheit, vm.Draft.TemperatureUnit);
        Assert.Equal(PressureUnit.Psi, vm.Draft.PressureUnit);
        Assert.Equal(1, source.SaveCount);
        Assert.Equal(GeneralSettingsNoticeKind.Success, notice!.Kind);
        Assert.Equal("Units synced from car", notice.Title);
        Assert.Equal("Distance: Miles, Temperature: Fahrenheit, Pressure: PSI", notice.Detail);
    }

    [Fact]
    public async Task ViewModel_sync_from_car_saves_even_when_units_already_match()
    {
        // Web parity: a detected unit is written even when it equals the current value (updates is non-empty).
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Loaded(Settings("km"), Now))
        {
            Vehicle = new VehicleSummary(9, "Model S"),
            Prefs = new CarPreferences("DistanceUnitKilometers", "TemperatureUnitCelsius", "PressureUnitBar", null),
        };
        using var vm = new GeneralSettingsViewModel(source, Localizer);
        await vm.LoadAsync();

        GeneralSettingsNotice? notice = null;
        vm.NoticeRequested += (_, n) => notice = n;

        await vm.SyncFromCarAsync();

        Assert.Equal(1, source.SaveCount);
        Assert.Equal(GeneralSettingsNoticeKind.Success, notice!.Kind);
        Assert.Equal("Units synced from car", notice.Title);
        Assert.Equal("Distance: Kilometers, Temperature: Celsius, Pressure: Bar", notice.Detail);
    }

    [Fact]
    public async Task ViewModel_sync_from_car_with_no_detectable_units_raises_info_notice()
    {
        // The car reports no detectable unit preferences — the web "No changes" defensive path (the sync
        // function only guards on a null carPrefs, not on detectable units).
        var source = new FakeSource(RepositoryResult<GeneralServerSettings>.Loaded(Settings("km"), Now))
        {
            Vehicle = new VehicleSummary(7, "Model Y"),
            Prefs = new CarPreferences(null, null, null, null),
        };
        using var vm = new GeneralSettingsViewModel(source, Localizer);
        await vm.LoadAsync();

        GeneralSettingsNotice? notice = null;
        vm.NoticeRequested += (_, n) => notice = n;

        await vm.SyncFromCarAsync();

        Assert.Equal(0, source.SaveCount);
        Assert.Equal(GeneralSettingsNoticeKind.Info, notice!.Kind);
        Assert.Equal("No changes", notice.Title);
        Assert.Equal("Could not detect car unit preferences", notice.Detail);
    }

    // ---- helpers -------------------------------------------------------------------

    private static GeneralServerSettings Settings(string distance) =>
        GeneralServerSettings.FromJson(Json($$"""{ "unit_of_length": "{{distance}}" }"""));

    private static JsonElement Json(string raw) => JsonDocument.Parse(raw).RootElement.Clone();

    private sealed class FakeSource : IGeneralSettingsSource
    {
        private readonly RepositoryResult<GeneralServerSettings>[] _emissions;

        public FakeSource(params RepositoryResult<GeneralServerSettings>[] emissions) => _emissions = emissions;

        public bool ThrowOnSave { get; init; }

        public VehicleSummary? Vehicle { get; init; }

        public CarPreferences? Prefs { get; init; }

        public int SaveCount { get; private set; }

        public GeneralServerSettings? LastSaved { get; private set; }

        public long? LastCarPrefVehicleId { get; private set; }

        public async IAsyncEnumerable<RepositoryResult<GeneralServerSettings>> StreamSettingsAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            foreach (var emission in _emissions)
            {
                cancellationToken.ThrowIfCancellationRequested();
                yield return emission;
            }

            await Task.CompletedTask.ConfigureAwait(false);
        }

        public Task<GeneralServerSettings> SaveAsync(GeneralServerSettings settings, CancellationToken cancellationToken = default)
        {
            SaveCount++;
            LastSaved = settings;
            if (ThrowOnSave)
            {
                throw new InvalidOperationException("save failed");
            }

            return Task.FromResult(settings);
        }

        public Task<VehicleSummary?> GetFirstVehicleAsync(CancellationToken cancellationToken = default) =>
            Task.FromResult(Vehicle);

        public Task<CarPreferences?> GetCarPreferencesAsync(long vehicleId, CancellationToken cancellationToken = default)
        {
            LastCarPrefVehicleId = vehicleId;
            return Task.FromResult(Prefs);
        }
    }
}
