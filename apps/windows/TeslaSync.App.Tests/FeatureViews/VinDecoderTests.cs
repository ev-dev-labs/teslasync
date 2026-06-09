using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the VinDecoder feature-view's UI-thread-free logic — the pure VIN decode (the web
/// <c>decoded</c> memo: the eleven-character threshold, the upper-cased fixed-position table lookups and the
/// serial tail), the localized cell projection, the registry / diagnostics metadata, and the state-holder
/// view-model's per-state transitions (ready / empty), localized labels and Narrator names. Mirrors the web
/// spec (web/src/features/admin/components/devtools/tools/VinDecoder.tsx and
/// web/src/features/admin/components/devtools/constants.ts).
/// </summary>
public sealed class VinDecoderTests
{
    private const string CanonicalVin = "5YJ3E1EA1NF000001"; // web field sample VIN

    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    private static VinDecoderViewModel NewViewModel(ILocalizer? localizer = null) =>
        new(localizer ?? Localizer);

    // ---- Decode: threshold (web `if (vin.length < 11) return null`) --------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("5YJ3E1EA1")]    // 9
    [InlineData("5YJ3E1EA1N")]   // 10
    public void Decode_below_threshold_is_null(string? vin)
    {
        Assert.Null(VinDecoding.Decode(vin));
    }

    [Theory]
    [InlineData("5YJ3E1EA1NF")]  // exactly 11
    [InlineData("5YJ3E1EA1NF0")] // 12
    [InlineData(CanonicalVin)]   // 17
    public void Decode_at_or_above_threshold_is_not_null(string vin)
    {
        Assert.NotNull(VinDecoding.Decode(vin));
    }

    [Fact]
    public void Decode_threshold_is_eleven()
    {
        Assert.Equal(11, VinDecoding.MinLength);
    }

    // ---- Decode: canonical sample (web sample VIN) ------------------------------------

    [Fact]
    public void Decode_canonical_vin_matches_web_segments()
    {
        var result = VinDecoding.Decode(CanonicalVin);

        Assert.NotNull(result);
        Assert.Equal("Tesla (USA)", result!.Manufacturer);
        Assert.Equal("Model 3", result.Model);
        Assert.Equal("Dual Motor AWD", result.Drive);
        Assert.Equal("2022", result.Year);
        Assert.Equal("Fremont, CA", result.Plant);
        Assert.Equal("000001", result.Serial);
    }

    [Fact]
    public void Decode_china_vin_matches_web_segments()
    {
        // LRW WMI, model Y (idx 3), drive 2 (idx 7), year R (idx 9), plant C (idx 10), serial tail.
        var result = VinDecoding.Decode("LRWYGCE2XRC123456");

        Assert.NotNull(result);
        Assert.Equal("Tesla (China)", result!.Manufacturer);
        Assert.Equal("Model Y", result.Model);
        Assert.Equal("Dual Motor AWD", result.Drive);
        Assert.Equal("2024", result.Year);
        Assert.Equal("Shanghai, China", result.Plant);
        Assert.Equal("123456", result.Serial);
    }

    // ---- Decode: per-table lookups (web VIN_* maps) ------------------------------------

    [Theory]
    [InlineData("5YJ", "Tesla (USA)")]
    [InlineData("LRW", "Tesla (China)")]
    [InlineData("7SA", "Tesla (EU/Berlin)")]
    [InlineData("XP7", "Tesla (USA)")]
    public void Decode_manufacturer_uses_first_three_chars(string wmi, string expected)
    {
        var result = VinDecoding.Decode(wmi + "00000000");

        Assert.Equal(expected, result!.Manufacturer);
    }

    [Theory]
    [InlineData('S', "Model S")]
    [InlineData('3', "Model 3")]
    [InlineData('X', "Model X")]
    [InlineData('Y', "Model Y")]
    public void Decode_model_uses_char_index_three(char code, string expected)
    {
        var result = VinDecoding.Decode("5YJ" + code + "0000000");

        Assert.Equal(expected, result!.Model);
    }

    [Theory]
    [InlineData('1', "Single Motor RWD")]
    [InlineData('2', "Dual Motor AWD")]
    [InlineData('3', "Performance AWD")]
    [InlineData('4', "Single Motor RWD (LFP)")]
    [InlineData('A', "Dual Motor AWD")]
    [InlineData('B', "Dual Motor AWD")]
    [InlineData('F', "Performance AWD")]
    [InlineData('P', "Performance")]
    [InlineData('E', "Dual Motor")]
    [InlineData('N', "Dual Motor")]
    public void Decode_drive_uses_char_index_seven(char code, string expected)
    {
        var result = VinDecoding.Decode("5YJ3000" + code + "000");

        Assert.Equal(expected, result!.Drive);
    }

    [Theory]
    [InlineData('H', "2017")]
    [InlineData('J', "2018")]
    [InlineData('K', "2019")]
    [InlineData('L', "2020")]
    [InlineData('M', "2021")]
    [InlineData('N', "2022")]
    [InlineData('P', "2023")]
    [InlineData('R', "2024")]
    [InlineData('S', "2025")]
    [InlineData('T', "2026")]
    public void Decode_year_uses_char_index_nine(char code, string expected)
    {
        var result = VinDecoding.Decode("5YJ300000" + code + "0");

        Assert.Equal(expected, result!.Year);
    }

    [Theory]
    [InlineData('F', "Fremont, CA")]
    [InlineData('A', "Austin, TX")]
    [InlineData('B', "Berlin, Germany")]
    [InlineData('C', "Shanghai, China")]
    [InlineData('G', "Gigafactory")]
    [InlineData('E', "Palo Alto, CA")]
    public void Decode_plant_uses_char_index_ten(char code, string expected)
    {
        var result = VinDecoding.Decode("5YJ3000000" + code);

        Assert.Equal(expected, result!.Plant);
    }

    // ---- Decode: unknown segments (web `?? t('Unknown')` deferred to null) --------------

    [Fact]
    public void Decode_unmatched_segments_are_null()
    {
        var result = VinDecoding.Decode("00000000000"); // 11 zeros

        Assert.NotNull(result);
        Assert.Null(result!.Manufacturer);
        Assert.Null(result.Model);
        Assert.Null(result.Drive);
        Assert.Null(result.Year);
        Assert.Null(result.Plant);
        Assert.Equal(string.Empty, result.Serial);
    }

    // ---- Decode: case-insensitive (web `upper = vin.toUpperCase()`) --------------------

    [Fact]
    public void Decode_uppercases_before_lookup()
    {
        var lower = VinDecoding.Decode(CanonicalVin.ToLowerInvariant());
        var upper = VinDecoding.Decode(CanonicalVin);

        Assert.Equal(upper, lower);
        Assert.Equal("Tesla (USA)", lower!.Manufacturer);
        Assert.Equal("000001", lower.Serial); // serial is upper-cased too (web slices `upper`)
    }

    // ---- Decode: serial tail (web `upper.slice(11)`) -----------------------------------

    [Theory]
    [InlineData("5YJ3E1EA1NF", "")]          // exactly 11 -> empty tail
    [InlineData("5YJ3E1EA1NFZ", "Z")]        // one extra char
    [InlineData(CanonicalVin, "000001")]     // full VIN
    public void Decode_serial_is_the_tail_from_index_eleven(string vin, string expected)
    {
        Assert.Equal(expected, VinDecoding.Decode(vin)!.Serial);
    }

    [Fact]
    public void Decode_does_not_trim_whitespace()
    {
        // Web measures raw vin.length and never trims; 11 spaces clears the threshold but matches nothing.
        var result = VinDecoding.Decode(new string(' ', 11));

        Assert.NotNull(result);
        Assert.Null(result!.Manufacturer);
        Assert.Equal(string.Empty, result.Serial);
    }

    // ---- Field catalog (web Object.entries order + i18n keys) --------------------------

    [Fact]
    public void Field_catalog_is_ordered_with_web_keys()
    {
        var keys = VinDecoderField.All.Select(f => f.LabelKey).ToArray();

        Assert.Equal(
            new[]
            {
                "devtools.utils.vin_mfr",
                "devtools.utils.vin_model",
                "devtools.utils.vin_drive",
                "devtools.utils.vin_year",
                "devtools.utils.vin_plant",
                "devtools.utils.vin_serial",
            },
            keys);
    }

    [Fact]
    public void Field_catalog_selectors_pull_their_segment()
    {
        var result = VinDecoding.Decode(CanonicalVin)!;
        var fields = VinDecoderField.All;

        Assert.Equal("Tesla (USA)", fields[0].Selector(result));
        Assert.Equal("Model 3", fields[1].Selector(result));
        Assert.Equal("Dual Motor AWD", fields[2].Selector(result));
        Assert.Equal("2022", fields[3].Selector(result));
        Assert.Equal("Fremont, CA", fields[4].Selector(result));
        Assert.Equal("000001", fields[5].Selector(result));
    }

    // ---- View-model: initial (empty) state (web useState('')) --------------------------

    [Fact]
    public void ViewModel_starts_empty_with_no_vin()
    {
        var vm = NewViewModel();

        Assert.Equal(string.Empty, vm.Vin);
        Assert.Equal(VinDecoderState.Empty, vm.State);
        Assert.False(vm.HasResult);
        Assert.Empty(vm.Cells);
        Assert.Null(vm.Decoded);
        Assert.False(string.IsNullOrWhiteSpace(vm.EmptyMessage));
    }

    // ---- View-model: ready state + cell projection -------------------------------------

    [Fact]
    public void ViewModel_decodes_to_six_ordered_cells()
    {
        var vm = NewViewModel();

        vm.Vin = CanonicalVin;

        Assert.Equal(VinDecoderState.Ready, vm.State);
        Assert.True(vm.HasResult);
        Assert.Equal(6, vm.Cells.Count);

        Assert.Equal("Manufacturer", vm.Cells[0].Label);
        Assert.Equal("Tesla (USA)", vm.Cells[0].Value);
        Assert.Equal("Model", vm.Cells[1].Label);
        Assert.Equal("Model 3", vm.Cells[1].Value);
        Assert.Equal("Drive", vm.Cells[2].Label);
        Assert.Equal("Dual Motor AWD", vm.Cells[2].Value);
        Assert.Equal("Year", vm.Cells[3].Label);
        Assert.Equal("2022", vm.Cells[3].Value);
        Assert.Equal("Plant", vm.Cells[4].Label);
        Assert.Equal("Fremont, CA", vm.Cells[4].Value);
        Assert.Equal("Serial", vm.Cells[5].Label);
        Assert.Equal("000001", vm.Cells[5].Value);
    }

    [Fact]
    public void ViewModel_unknown_segments_render_the_localized_unknown_value()
    {
        var vm = NewViewModel();

        vm.Vin = "00000000000"; // 11 zeros -> every lookup misses

        Assert.Equal(VinDecoderState.Ready, vm.State);
        Assert.Equal(vm.UnknownValue, vm.Cells[0].Value);
        Assert.Equal(vm.UnknownValue, vm.Cells[4].Value);
        Assert.Equal(string.Empty, vm.Cells[5].Value); // serial tail is verbatim, not "Unknown"
    }

    // ---- View-model: transitions -------------------------------------------------------

    [Fact]
    public void ViewModel_recovers_between_empty_and_ready()
    {
        var vm = NewViewModel();

        vm.Vin = CanonicalVin;
        Assert.Equal(VinDecoderState.Ready, vm.State);

        vm.Vin = "short";
        Assert.Equal(VinDecoderState.Empty, vm.State);
        Assert.Empty(vm.Cells);

        vm.Vin = "LRWYGCE2XRC123456";
        Assert.Equal(VinDecoderState.Ready, vm.State);
        Assert.Equal("Tesla (China)", vm.Cells[0].Value);
    }

    // ---- View-model: change notifications ----------------------------------------------

    [Fact]
    public void ViewModel_vin_change_raises_cells_and_state()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Vin = CanonicalVin;

        Assert.Contains(nameof(VinDecoderViewModel.Vin), raised);
        Assert.Contains(nameof(VinDecoderViewModel.Cells), raised);
        Assert.Contains(nameof(VinDecoderViewModel.State), raised);
        Assert.Contains(nameof(VinDecoderViewModel.HasResult), raised);
    }

    [Fact]
    public void ViewModel_vin_set_to_same_value_is_a_noop()
    {
        var vm = NewViewModel();
        var raised = new List<string?>();
        vm.PropertyChanged += (_, e) => raised.Add(e.PropertyName);

        vm.Vin = string.Empty; // already empty

        Assert.Empty(raised);
    }

    [Fact]
    public void ViewModel_null_vin_is_treated_as_empty()
    {
        var vm = NewViewModel();

        vm.Vin = CanonicalVin;
        vm.Vin = null!;

        Assert.Equal(string.Empty, vm.Vin);
        Assert.Equal(VinDecoderState.Empty, vm.State);
    }

    [Fact]
    public void ViewModel_announcement_carries_result_then_empty_message()
    {
        var vm = NewViewModel();

        Assert.Equal(vm.EmptyMessage, vm.LastAnnouncement);

        vm.Vin = CanonicalVin;
        Assert.Contains("Tesla (USA)", vm.LastAnnouncement!, StringComparison.Ordinal);

        vm.Vin = "no";
        Assert.Equal(vm.EmptyMessage, vm.LastAnnouncement);
    }

    // ---- Localized labels + a11y names -------------------------------------------------

    [Fact]
    public void ViewModel_labels_resolve_to_web_literals()
    {
        var vm = NewViewModel();

        Assert.Equal("Vin Decoder", vm.Title);
        Assert.Equal("Vin Decoder Desc", vm.Description);
        Assert.Equal("Vin", vm.VinLabel);
        Assert.Equal("Unknown", vm.UnknownValue);
    }

    [Fact]
    public void ViewModel_labels_flow_through_the_localizer()
    {
        var vm = NewViewModel(new PrefixLocalizer());

        Assert.Equal("L:Vin Decoder", vm.Title);
        Assert.Equal("L:Vin Decoder Desc", vm.Description);
        Assert.Equal("L:Vin", vm.VinLabel);
        Assert.Equal("L:Unknown", vm.UnknownValue);
        Assert.StartsWith("L:devtools.vinDecoder.empty", vm.EmptyMessage, StringComparison.Ordinal);

        vm.Vin = CanonicalVin;
        Assert.Equal("L:devtools.utils.vin_mfr", vm.Cells[0].Label);
        Assert.Equal("L:devtools.utils.vin_serial", vm.Cells[5].Label);
    }

    [Fact]
    public void ViewModel_field_name_names_the_field_and_sample_vin()
    {
        var vm = NewViewModel();

        Assert.Contains(vm.VinLabel, vm.VinFieldName, StringComparison.Ordinal);
        Assert.Contains(VinDecoderRegistration.SampleVin, vm.VinFieldName, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_cell_name_pairs_label_and_value()
    {
        var vm = NewViewModel();
        vm.Vin = CanonicalVin;
        var cell = vm.Cells[0];

        string name = vm.CellName(cell);

        Assert.Contains(cell.Label, name, StringComparison.Ordinal);
        Assert.Contains(cell.Value, name, StringComparison.Ordinal);
    }

    [Fact]
    public void ViewModel_cell_name_rejects_null_cell()
    {
        var vm = NewViewModel();

        Assert.Throws<ArgumentNullException>(() => vm.CellName(null!));
    }

    [Fact]
    public void ViewModel_rejects_null_localizer()
    {
        Assert.Throws<ArgumentNullException>(() => new VinDecoderViewModel(null!));
    }

    // ---- Registry + diagnostics (web cyan/Car metadata, P1/S11 view.opened) ------------

    [Fact]
    public void Registration_metadata_is_stable_and_semantic()
    {
        Assert.Equal("VinDecoder", VinDecoderRegistration.Slug);
        Assert.Equal("5YJ3E1EA1NF000001", VinDecoderRegistration.SampleVin);
        Assert.Equal("cyan", VinDecoderRegistration.Accent);
        Assert.Equal("\uE804", VinDecoderRegistration.Glyph);
        Assert.False(string.IsNullOrEmpty(VinDecoderRegistration.Glyph));

        Assert.Equal(ToolCardAccent.BrushKey(VinDecoderRegistration.Accent), VinDecoderRegistration.AccentBrushKey);
        Assert.StartsWith("TsColor", VinDecoderRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.EndsWith("Brush", VinDecoderRegistration.AccentBrushKey, StringComparison.Ordinal);
        Assert.DoesNotContain("neon", VinDecoderRegistration.AccentBrushKey, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var sink = new List<string>();
        var diagnostics = new VinDecoderDiagnostics(sink.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VinDecoder", Assert.Single(sink));
    }

    [Fact]
    public void Diagnostics_default_sink_is_optional()
    {
        var diagnostics = new VinDecoderDiagnostics();

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
    }

    // ---- Test doubles ------------------------------------------------------------------

    private sealed class PrefixLocalizer : ILocalizer
    {
        public string GetString(string key, string fallback) => "L:" + key;
    }
}
