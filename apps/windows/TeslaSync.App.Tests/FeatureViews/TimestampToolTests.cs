using System.Globalization;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the timestamp surface's UI-thread-free logic — the pure conversion adapter
/// (Unix/ISO parsing, Unix-seconds + <c>toISOString()</c> rendering, the local + relative-time formatters),
/// the state-holder view-model's per-field transitions (empty / valid / invalid), the registration
/// metadata, the PII-safe diagnostics, the localized labels + Narrator names, and the exact set of i18n
/// keys. Mirrors the web spec (web/src/features/admin/components/devtools/tools/TimestampTool.tsx). The
/// WinUI view itself is exercised by the app build.
/// </summary>
public sealed class TimestampToolTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // 1700000000 == 2023-11-14T22:13:20Z; 1704067200 == 2024-01-01T00:00:00Z (well-known instants).
    private const long Sample = 1700000000L;
    private const string SampleIso = "2023-11-14T22:13:20.000Z";
    private const string NewYear2024 = "2024-01-01T00:00:00Z";

    private static TimestampToolViewModel NewViewModel(ILocalizer? localizer = null) =>
        new(localizer ?? Localizer, CultureInfo.InvariantCulture, TimeZoneInfo.Utc);

    // ---- Converter adapter (port of fromUnix / fromIso / helpers) -------------------

    [Fact]
    public void ParseUnix_ten_digit_value_is_seconds()
    {
        DateTimeOffset? parsed = TimestampConverter.ParseUnix("1700000000");

        Assert.NotNull(parsed);
        Assert.Equal(Sample, TimestampConverter.ToUnixSeconds(parsed!.Value));
        Assert.Equal(SampleIso, TimestampConverter.ToIsoString(parsed.Value));
    }

    [Fact]
    public void ParseUnix_thirteen_digit_value_is_milliseconds()
    {
        // > 10 chars → already milliseconds, so it lands on the same instant as the seconds form.
        DateTimeOffset? parsed = TimestampConverter.ParseUnix("1700000000000");

        Assert.NotNull(parsed);
        Assert.Equal(Sample, TimestampConverter.ToUnixSeconds(parsed!.Value));
    }

    [Fact]
    public void ParseUnix_length_boundary_switches_seconds_and_millis()
    {
        // 10 chars → seconds (×1000); 11 chars → milliseconds. The raw string length decides, like JS.
        DateTimeOffset? tenChars = TimestampConverter.ParseUnix("1700000000");
        DateTimeOffset? elevenChars = TimestampConverter.ParseUnix("17000000000");

        Assert.Equal(Sample, TimestampConverter.ToUnixSeconds(tenChars!.Value));
        Assert.Equal(17000000L, TimestampConverter.ToUnixSeconds(elevenChars!.Value));
    }

    [Fact]
    public void ParseUnix_uses_leading_integer_like_js_parseint()
    {
        // "1700000000abc" is 13 chars (> 10) so it is treated as ms; parseInt stops at 'a' → 1700000000 ms.
        DateTimeOffset? parsed = TimestampConverter.ParseUnix("1700000000abc");

        Assert.NotNull(parsed);
        Assert.Equal(1700000L, TimestampConverter.ToUnixSeconds(parsed!.Value));
    }

    [Fact]
    public void ParseUnix_supports_negative_values()
    {
        DateTimeOffset? parsed = TimestampConverter.ParseUnix("-1000");

        Assert.NotNull(parsed);
        Assert.Equal(-1000L, TimestampConverter.ToUnixSeconds(parsed!.Value));
    }

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("   ")]
    [InlineData("1700000000000000000000")] // 22 digits → overflows Int64 → out of representable range
    public void ParseUnix_returns_null_for_unparseable_or_out_of_range(string value)
    {
        Assert.Null(TimestampConverter.ParseUnix(value));
    }

    [Fact]
    public void ParseUnix_null_is_null()
    {
        Assert.Null(TimestampConverter.ParseUnix(null));
    }

    [Fact]
    public void ParseIso_parses_zulu_instant()
    {
        DateTimeOffset? parsed = TimestampConverter.ParseIso(NewYear2024);

        Assert.NotNull(parsed);
        Assert.Equal(1704067200L, TimestampConverter.ToUnixSeconds(parsed!.Value));
        Assert.Equal("2024-01-01T00:00:00.000Z", TimestampConverter.ToIsoString(parsed.Value));
    }

    [Fact]
    public void ParseIso_honours_explicit_offset()
    {
        // 05:00 at +05:00 is the same instant as 00:00Z.
        DateTimeOffset? parsed = TimestampConverter.ParseIso("2024-01-01T05:00:00+05:00");

        Assert.NotNull(parsed);
        Assert.Equal(1704067200L, TimestampConverter.ToUnixSeconds(parsed!.Value));
    }

    [Theory]
    [InlineData("")]
    [InlineData("not a date")]
    [InlineData("2024-13-99")]
    public void ParseIso_returns_null_for_unparseable(string value)
    {
        Assert.Null(TimestampConverter.ParseIso(value));
    }

    [Fact]
    public void ParseIso_null_is_null()
    {
        Assert.Null(TimestampConverter.ParseIso(null));
    }

    [Fact]
    public void ToUnixSeconds_floors_toward_negative_infinity()
    {
        // -1500 ms → Math.floor(-1.5) == -2 seconds (web parity), not truncation toward zero (-1).
        DateTimeOffset instant = DateTimeOffset.FromUnixTimeMilliseconds(-1500);

        Assert.Equal(-2L, TimestampConverter.ToUnixSeconds(instant));
    }

    [Fact]
    public void FormatLocal_matches_web_locale_string_shape()
    {
        DateTimeOffset instant = DateTimeOffset.FromUnixTimeSeconds(1704119400); // 2024-01-01T14:30:00Z

        string formatted = TimestampConverter.FormatLocal(instant, TimeZoneInfo.Utc, CultureInfo.InvariantCulture);

        Assert.Equal("Jan 1, 2024, 02:30 PM", formatted);
    }

    [Theory]
    [InlineData(30, "30s ago")]
    [InlineData(90, "1m ago")]
    [InlineData(3700, "1h ago")]
    [InlineData(90000, "1d ago")]
    public void GetRelativeTime_buckets_like_web_helper(long secondsAgo, string expected)
    {
        DateTimeOffset now = DateTimeOffset.FromUnixTimeSeconds(Sample);
        DateTimeOffset past = DateTimeOffset.FromUnixTimeSeconds(Sample - secondsAgo);

        Assert.Equal(expected, TimestampConverter.GetRelativeTime(past, now));
    }

    [Fact]
    public void GetRelativeTime_reads_ago_for_future_instants_like_web_abs()
    {
        DateTimeOffset now = DateTimeOffset.FromUnixTimeSeconds(Sample);
        DateTimeOffset future = DateTimeOffset.FromUnixTimeSeconds(Sample + 45);

        Assert.Equal("45s ago", TimestampConverter.GetRelativeTime(future, now));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public void ViewModel_initial_state_is_empty_for_both_fields()
    {
        var vm = NewViewModel();

        Assert.Equal(TimestampFieldState.Empty, vm.UnixState);
        Assert.False(vm.HasUnixResult);
        Assert.Equal(TimestampFieldState.Empty, vm.IsoState);
        Assert.False(vm.HasIsoResult);
    }

    [Fact]
    public void ViewModel_now_projection_tracks_now()
    {
        var vm = NewViewModel();
        vm.Now = DateTimeOffset.FromUnixTimeSeconds(Sample);

        Assert.Equal("1700000000", vm.NowUnixText);
        Assert.Equal(SampleIso, vm.NowIsoText);
    }

    [Fact]
    public void ViewModel_valid_unix_input_projects_all_three_rows()
    {
        var vm = NewViewModel();
        vm.Now = DateTimeOffset.FromUnixTimeSeconds(Sample);
        vm.Unix = "1700000000";

        Assert.Equal(TimestampFieldState.Valid, vm.UnixState);
        Assert.True(vm.HasUnixResult);
        Assert.Equal(SampleIso, vm.UnixIsoText);
        Assert.Equal("Nov 14, 2023, 10:13 PM", vm.UnixLocalText);
        Assert.Equal("0s ago", vm.UnixRelativeText);
    }

    [Fact]
    public void ViewModel_invalid_unix_input_hides_block()
    {
        var vm = NewViewModel();
        vm.Unix = "abc";

        Assert.Equal(TimestampFieldState.Invalid, vm.UnixState);
        Assert.False(vm.HasUnixResult);
    }

    [Fact]
    public void ViewModel_clearing_unix_returns_to_empty()
    {
        var vm = NewViewModel();
        vm.Unix = "1700000000";
        Assert.True(vm.HasUnixResult);

        vm.Unix = string.Empty;

        Assert.Equal(TimestampFieldState.Empty, vm.UnixState);
        Assert.False(vm.HasUnixResult);
    }

    [Fact]
    public void ViewModel_valid_iso_input_projects_unix_local_relative()
    {
        var vm = NewViewModel();
        vm.Now = DateTimeOffset.FromUnixTimeSeconds(Sample);
        vm.Iso = NewYear2024;

        Assert.Equal(TimestampFieldState.Valid, vm.IsoState);
        Assert.True(vm.HasIsoResult);
        Assert.Equal("1704067200", vm.IsoUnixText);
        Assert.Equal("Jan 1, 2024, 12:00 AM", vm.IsoLocalText);
        Assert.Equal("47d ago", vm.IsoRelativeText);
    }

    [Fact]
    public void ViewModel_invalid_iso_input_hides_block()
    {
        var vm = NewViewModel();
        vm.Iso = "nope";

        Assert.Equal(TimestampFieldState.Invalid, vm.IsoState);
        Assert.False(vm.HasIsoResult);
    }

    [Fact]
    public void ViewModel_raises_property_changed_for_unix_projection()
    {
        var vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Unix = "1700000000";

        Assert.Contains(nameof(TimestampToolViewModel.Unix), changed);
        Assert.Contains(nameof(TimestampToolViewModel.UnixState), changed);
        Assert.Contains(nameof(TimestampToolViewModel.HasUnixResult), changed);
        Assert.Contains(nameof(TimestampToolViewModel.UnixIsoText), changed);
    }

    [Fact]
    public void ViewModel_now_change_raises_live_row()
    {
        var vm = NewViewModel();
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Now = DateTimeOffset.FromUnixTimeSeconds(Sample);

        Assert.Contains(nameof(TimestampToolViewModel.Now), changed);
        Assert.Contains(nameof(TimestampToolViewModel.NowUnixText), changed);
        Assert.Contains(nameof(TimestampToolViewModel.NowIsoText), changed);
    }

    [Fact]
    public void ViewModel_setting_same_value_does_not_raise()
    {
        var vm = NewViewModel();
        vm.Unix = "1700000000";
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Unix = "1700000000"; // unchanged

        Assert.Empty(changed);
    }

    // ---- Example hints (web placeholders) ------------------------------------------

    [Fact]
    public void Registration_exposes_web_example_hints()
    {
        Assert.Equal("1700000000", TimestampToolRegistration.UnixHint);
        Assert.Equal("2024-01-01T00:00:00Z", TimestampToolRegistration.IsoHint);
    }

    // ---- Accessibility names (Narrator) --------------------------------------------

    [Fact]
    public void ViewModel_exposes_non_empty_accessible_names()
    {
        var vm = NewViewModel();

        Assert.False(string.IsNullOrWhiteSpace(vm.NowAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.UnixInputAccessibleName));
        Assert.False(string.IsNullOrWhiteSpace(vm.IsoInputAccessibleName));

        Assert.Equal("Now", vm.NowAccessibleName);
        Assert.Equal("Unix Timestamp", vm.UnixInputAccessibleName);
        Assert.Equal("Iso Timestamp", vm.IsoInputAccessibleName);
    }

    // ---- Registration metadata (web registry parity) -------------------------------

    [Fact]
    public void Registration_matches_web_tool()
    {
        Assert.Equal("timestamp", TimestampToolRegistration.Id);
        Assert.Equal("devtools", TimestampToolRegistration.Category);
        Assert.Equal("TimestampTool", TimestampToolRegistration.Slug);
        Assert.Equal("Timestamp", TimestampToolRegistration.Name(Localizer));
        Assert.Equal("Timestamp Desc", TimestampToolRegistration.Description(Localizer));
        Assert.Equal("green", TimestampToolRegistration.AccentName);
        Assert.Equal("TsColorSuccessColor", TimestampToolRegistration.AccentColorKey);
        Assert.Equal("TsColorSuccessBrush", TimestampToolRegistration.AccentBrushKey);
        Assert.False(string.IsNullOrEmpty(TimestampToolRegistration.IconGlyph));
        Assert.False(string.IsNullOrEmpty(TimestampToolRegistration.UnixIconGlyph));
        Assert.False(string.IsNullOrEmpty(TimestampToolRegistration.IsoIconGlyph));
    }

    // ---- Diagnostics (view.opened, PII-safe) ---------------------------------------

    [Fact]
    public void Diagnostics_emits_view_opened_with_slug()
    {
        var lines = new List<string>();
        var diagnostics = new TimestampToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimestampTool", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_never_emits_input_values()
    {
        // The sink must never receive a user-entered timestamp.
        var lines = new List<string>();
        var diagnostics = new TimestampToolDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("1700000000", StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains(NewYear2024, StringComparison.Ordinal));
    }

    // ---- i18n key parity (web t() call sites) --------------------------------------

    [Fact]
    public void ViewModel_routes_every_web_t_key_through_the_localizer()
    {
        var recorder = new RecordingLocalizer();
        var vm = new TimestampToolViewModel(recorder, CultureInfo.InvariantCulture, TimeZoneInfo.Utc);

        // Touch every localized surface the view renders.
        _ = vm.Title;
        _ = vm.Description;
        _ = vm.NowLabel;
        _ = vm.UnixInputLabel;
        _ = vm.IsoInputLabel;
        _ = vm.IsoLabel;
        _ = vm.LocalLabel;
        _ = vm.RelativeLabel;
        _ = vm.UnixLabel;

        string[] expected =
        [
            "Timestamp",
            "Timestamp Desc",
            "Now",
            "Unix Timestamp",
            "Iso Timestamp",
            "Iso",
            "Local",
            "Relative",
            "Unix",
        ];

        foreach (string key in expected)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
