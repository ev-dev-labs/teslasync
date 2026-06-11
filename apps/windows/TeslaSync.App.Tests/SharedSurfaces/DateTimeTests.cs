using System.Globalization;
using TeslaSync.App.Core.Units;
using TeslaSync.App.SharedSurfaces.DateTimeSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the DateTime surface's UI-thread-free logic — the pure formatting adapter
/// (variant rendering, the zone + locale resolution ports of web <c>resolveTimezone</c> /
/// <c>resolveLocale</c>, the ISO title, the short zone designator), the state-holder view-model's
/// PURE-vs-zone-aware paths and projections, the registration metadata, the PII-safe diagnostics and the
/// Narrator name. Mirrors the web spec (web/src/components/data-display/format/DateTime.tsx +
/// lib/dateFormat, lib/timezone, lib/locale). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class DateTimeTests
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");
    private static readonly DateTimeOffset Now = new(2024, 1, 10, 12, 0, 0, TimeSpan.Zero);

    private static TimeZoneInfo FixedZone(string id, double hours) =>
        TimeZoneInfo.CreateCustomTimeZone(id, TimeSpan.FromHours(hours), id, id);

    private static TimeZoneInfo FixedZoneMinutes(string id, int minutes) =>
        TimeZoneInfo.CreateCustomTimeZone(id, TimeSpan.FromMinutes(minutes), id, id);

    // ---- Formatting adapter: empty + pure-path delegation -------------------------

    [Theory]
    [InlineData(DateTimeVariant.Full)]
    [InlineData(DateTimeVariant.Date)]
    [InlineData(DateTimeVariant.Time)]
    [InlineData(DateTimeVariant.Short)]
    [InlineData(DateTimeVariant.Relative)]
    public void Format_Null_ReturnsEmDash(DateTimeVariant variant)
    {
        Assert.Equal("\u2014", DateTimeSurfaceFormatting.Format(null, variant, Now));
        Assert.Equal("\u2014", DateTimeSurfaceFormatting.EmptyDisplay);
    }

    [Theory]
    [InlineData(DateTimeVariant.Full)]
    [InlineData(DateTimeVariant.Date)]
    [InlineData(DateTimeVariant.Time)]
    [InlineData(DateTimeVariant.Short)]
    [InlineData(DateTimeVariant.Relative)]
    public void Format_PurePath_DelegatesToSharedPort(DateTimeVariant variant)
    {
        var value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);

        // No zone/culture override → identical to TsDateTime's DateTimeFormatting port.
        Assert.Equal(
            DateTimeFormatting.Format(value, variant, Now),
            DateTimeSurfaceFormatting.Format(value, variant, Now));
    }

    // ---- Formatting adapter: zone-aware variant patterns --------------------------

    [Fact]
    public void Format_ZoneAware_RendersWallClockInTargetZone()
    {
        // 05:00Z in a -08:00 zone is the previous day at 21:00 local.
        var value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero);
        TimeZoneInfo zone = FixedZone("Minus8", -8);

        Assert.Equal("Dec 31, 2023 09:00 PM", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Full, Now, zone, EnUs));
        Assert.Equal("Dec 31, 2023", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Date, Now, zone, EnUs));
        Assert.Equal("09:00 PM", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Time, Now, zone, EnUs));
        Assert.Equal("Dec 31", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Short, Now, zone, EnUs));
    }

    [Fact]
    public void Format_ZoneAware_Utc_RendersUtcWallClock()
    {
        var value = new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero);

        Assert.Equal("01:30 PM", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Time, Now, TimeZoneInfo.Utc, EnUs));
        Assert.Equal("Jun 15, 2024 01:30 PM", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Full, Now, TimeZoneInfo.Utc, EnUs));
    }

    [Theory]
    [InlineData(30, "Just now")]
    [InlineData(0, "Just now")]
    [InlineData(300, "5m ago")]
    [InlineData(3540, "59m ago")]
    [InlineData(10800, "3h ago")]
    [InlineData(82800, "23h ago")]
    public void Format_ZoneAware_Relative_BucketsLikeWeb(int secondsAgo, string expected)
    {
        var value = Now.AddSeconds(-secondsAgo);
        Assert.Equal(expected, DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Relative, Now, TimeZoneInfo.Utc, EnUs));
    }

    [Fact]
    public void Format_ZoneAware_Relative_BeyondADay_FallsBackToAbsoluteInZone()
    {
        // 09:30Z two days back; in UTC the absolute fallback reads the UTC wall clock.
        var value = new DateTimeOffset(2024, 1, 8, 9, 30, 0, TimeSpan.Zero);

        Assert.Equal("Jan 8, 09:30 AM", DateTimeSurfaceFormatting.Format(value, DateTimeVariant.Relative, Now, TimeZoneInfo.Utc, EnUs));
    }

    // ---- resolveLocale port -------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveLocale_BlankFallsBackToEnUs(string? locale)
    {
        Assert.Equal("en-US", DateTimeSurfaceFormatting.ResolveLocale(locale).Name);
    }

    [Theory]
    [InlineData("fr-FR")]
    [InlineData("de-DE")]
    [InlineData("ja-JP")]
    public void ResolveLocale_ValidTagIsHonoured(string locale)
    {
        Assert.Equal(locale, DateTimeSurfaceFormatting.ResolveLocale(locale).Name);
    }

    // ---- resolveTimezone port -----------------------------------------------------

    [Fact]
    public void ResolveZoneId_Utc_IsAlwaysUtc()
    {
        Assert.Equal("UTC", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.Utc, "America/Chicago", "Europe/Paris", "America/New_York"));
    }

    [Fact]
    public void ResolveZoneId_User_PrefersOverrideThenSystem()
    {
        Assert.Equal("Europe/Paris", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.User, "America/Chicago", "Europe/Paris", "America/New_York"));
        Assert.Equal("America/New_York", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.User, "America/Chicago", null, "America/New_York"));
        Assert.Equal("America/New_York", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.User, "America/Chicago", "   ", "America/New_York"));
    }

    [Fact]
    public void ResolveZoneId_Vehicle_PrefersVehicleThenFallsBack()
    {
        // Vehicle wins when known.
        Assert.Equal("America/Chicago", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.Vehicle, "America/Chicago", "Europe/Paris", "America/New_York"));
        // Unpolled vehicle (blank) → user override.
        Assert.Equal("Europe/Paris", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.Vehicle, null, "Europe/Paris", "America/New_York"));
        // Unpolled vehicle reported as bare UTC → user override (web treats 'UTC' as not-yet-known).
        Assert.Equal("Europe/Paris", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.Vehicle, "UTC", "Europe/Paris", "America/New_York"));
        // Blank vehicle and no user override → system zone.
        Assert.Equal("America/New_York", DateTimeSurfaceFormatting.ResolveZoneId(DateTimeTzMode.Vehicle, null, null, "America/New_York"));
    }

    [Fact]
    public void ResolveZone_UtcAndUnknownFallBack()
    {
        TimeZoneInfo fallback = FixedZone("Fallback5", -5);

        Assert.Equal(TimeZoneInfo.Utc, DateTimeSurfaceFormatting.ResolveZone("UTC", fallback));
        Assert.Same(fallback, DateTimeSurfaceFormatting.ResolveZone("Totally/Unknown_Zone", fallback));
        Assert.Same(fallback, DateTimeSurfaceFormatting.ResolveZone(null, fallback));
        Assert.Same(fallback, DateTimeSurfaceFormatting.ResolveZone("   ", fallback));
    }

    // ---- ISO title ----------------------------------------------------------------

    [Fact]
    public void IsoTitle_NullValueIsNull()
    {
        Assert.Null(DateTimeSurfaceFormatting.IsoTitle(null));
        Assert.Null(DateTimeSurfaceFormatting.IsoTitle(null, "UTC"));
    }

    [Fact]
    public void IsoTitle_RendersUtcIsoAndOptionalZoneSuffix()
    {
        var value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.FromHours(5)); // 00:00Z

        Assert.Equal("2024-01-01T00:00:00.000Z", DateTimeSurfaceFormatting.IsoTitle(value));
        Assert.Equal("2024-01-01T00:00:00.000Z (America/Los_Angeles)", DateTimeSurfaceFormatting.IsoTitle(value, "America/Los_Angeles"));
    }

    // ---- short zone designator ----------------------------------------------------

    [Fact]
    public void TzAbbreviation_NullValueIsEmpty()
    {
        Assert.Equal(string.Empty, DateTimeSurfaceFormatting.TzAbbreviation(null, TimeZoneInfo.Utc));
    }

    [Fact]
    public void TzAbbreviation_RendersCanonicalGmtOffset()
    {
        var value = new DateTimeOffset(2024, 1, 1, 0, 0, 0, TimeSpan.Zero);

        Assert.Equal("UTC", DateTimeSurfaceFormatting.TzAbbreviation(value, TimeZoneInfo.Utc));
        Assert.Equal("GMT-8", DateTimeSurfaceFormatting.TzAbbreviation(value, FixedZone("Minus8", -8)));
        Assert.Equal("GMT+5:30", DateTimeSurfaceFormatting.TzAbbreviation(value, FixedZoneMinutes("Plus530", 330)));
        Assert.Equal("GMT+1", DateTimeSurfaceFormatting.TzAbbreviation(value, FixedZone("Plus1", 1)));
    }

    // ---- view-model: PURE path ----------------------------------------------------

    private static DateTimeViewModel PureVm(DateTimeOffset? value = null, DateTimeVariant variant = DateTimeVariant.Full) =>
        new(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now)
        {
            Value = value,
            Variant = variant,
        };

    [Fact]
    public void ViewModel_Initial_IsEmpty()
    {
        var vm = new DateTimeViewModel(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now);

        Assert.Equal(DateTimeRenderState.Empty, vm.State);
        Assert.Equal("\u2014", vm.Display);
        Assert.Null(vm.Title);
        Assert.False(vm.IsTzAware);
        Assert.False(vm.HasAbbreviation);
        Assert.Equal("\u2014", vm.AccessibleName);
    }

    [Fact]
    public void ViewModel_PurePath_MatchesSharedPortAndUtcIsoTitle()
    {
        var value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);
        var vm = PureVm(value);

        Assert.Equal(DateTimeRenderState.Rendered, vm.State);
        Assert.Equal(DateTimeFormatting.Format(value, DateTimeVariant.Full, Now), vm.Display);
        Assert.Equal("2026-04-04T09:30:00.000Z", vm.Title); // no zone suffix on the pure path
        Assert.False(vm.IsTzAware);
        Assert.Empty(vm.Abbreviation);
    }

    // ---- view-model: zone-aware path ----------------------------------------------

    [Fact]
    public void ViewModel_ModeSelectsZoneAwarePath()
    {
        var vm = PureVm(new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero), DateTimeVariant.Time);
        Assert.False(vm.IsTzAware);

        vm.Mode = DateTimeTzMode.Utc;

        Assert.True(vm.IsTzAware);
        Assert.Equal(DateTimeTzMode.Utc, vm.EffectiveMode);
        Assert.Equal("UTC", vm.ResolvedZoneId);
        Assert.Equal("01:30 PM", vm.Display);
        Assert.Equal("2024-06-15T13:30:00.000Z (UTC)", vm.Title);
    }

    [Fact]
    public void ViewModel_ShowTzAlsoSelectsZoneAwarePath_AndAppendsDesignator()
    {
        var value = new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero);
        var vm = new DateTimeViewModel(
            new StaticDateTimeContext(locale: "en-US", defaultMode: DateTimeTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = value,
            Variant = DateTimeVariant.Time,
            ShowTz = true,
        };

        Assert.True(vm.IsTzAware);
        Assert.Equal(DateTimeTzMode.Utc, vm.EffectiveMode); // mode unset → context default
        Assert.True(vm.HasAbbreviation);
        Assert.Equal("UTC", vm.Abbreviation);
        Assert.Equal("01:30 PM UTC", vm.AccessibleName);
    }

    [Fact]
    public void ViewModel_UserMode_UsesInjectedSystemZoneWhenNoOverride()
    {
        TimeZoneInfo minus5 = FixedZone("Minus5", -5);
        var value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero); // 00:00 local at -5

        var vm = new DateTimeViewModel(
            new StaticDateTimeContext(locale: "en-US", defaultMode: DateTimeTzMode.User),
            systemZone: minus5,
            clock: () => Now)
        {
            Value = value,
            Variant = DateTimeVariant.Time,
            ShowTz = true,
        };

        Assert.Equal(minus5.Id, vm.ResolvedZoneId);
        Assert.Equal("12:00 AM", vm.Display);
        Assert.Equal("GMT-5", vm.Abbreviation);
    }

    [Fact]
    public void ViewModel_ContextChange_RecomputesProjection()
    {
        var context = new MutableDateTimeContext(locale: "en-US", defaultMode: DateTimeTzMode.User);
        TimeZoneInfo minus5 = FixedZone("Minus5", -5);
        var vm = new DateTimeViewModel(context, systemZone: minus5, clock: () => Now)
        {
            Value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero),
            ShowTz = true,
        };

        Assert.Equal(minus5.Id, vm.ResolvedZoneId);
        Assert.Equal("GMT-5", vm.Abbreviation);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        context.UserTimezone = "UTC"; // user override now set

        Assert.Equal("UTC", vm.ResolvedZoneId);
        Assert.Equal("UTC", vm.Abbreviation);
        Assert.Contains(nameof(DateTimeViewModel.ResolvedZoneId), changed);
        Assert.Contains(nameof(DateTimeViewModel.Abbreviation), changed);
    }

    [Fact]
    public void ViewModel_SettingValue_RaisesProjectionChanges()
    {
        var vm = new DateTimeViewModel(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);

        Assert.Contains(nameof(DateTimeViewModel.Value), changed);
        Assert.Contains(nameof(DateTimeViewModel.Display), changed);
        Assert.Contains(nameof(DateTimeViewModel.State), changed);
        Assert.Contains(nameof(DateTimeViewModel.Title), changed);
        Assert.Contains(nameof(DateTimeViewModel.AccessibleName), changed);
    }

    [Fact]
    public void ViewModel_SettingSameValue_DoesNotRaise()
    {
        var value = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);
        var vm = PureVm(value);
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Value = value; // unchanged

        Assert.Empty(changed);
    }

    [Fact]
    public void ViewModel_SwitchingBackToPure_ClearsAbbreviationAndZoneSuffix()
    {
        var vm = new DateTimeViewModel(
            new StaticDateTimeContext(defaultMode: DateTimeTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero),
            ShowTz = true,
        };
        Assert.True(vm.HasAbbreviation);

        vm.ShowTz = false;
        vm.Mode = null;

        Assert.False(vm.IsTzAware);
        Assert.False(vm.HasAbbreviation);
        Assert.Empty(vm.Abbreviation);
        Assert.Equal("2024-06-15T13:30:00.000Z", vm.Title); // no zone suffix once pure
    }

    [Fact]
    public void ViewModel_Dispose_DetachesFromContext()
    {
        var context = new MutableDateTimeContext(defaultMode: DateTimeTzMode.User);
        var vm = new DateTimeViewModel(context, systemZone: FixedZone("Minus5", -5), clock: () => Now)
        {
            ShowTz = true,
        };
        vm.Dispose();

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        context.UserTimezone = "UTC"; // must not recompute after dispose

        Assert.Empty(changed);
    }

    // ---- registration -------------------------------------------------------------

    [Fact]
    public void Registration_HasCanonicalSlug()
    {
        Assert.Equal("DateTime", DateTimeRegistration.Slug);
    }

    // ---- diagnostics (view.opened, PII-safe) --------------------------------------

    [Fact]
    public void Diagnostics_EmitsViewOpenedWithSlug()
    {
        var lines = new List<string>();
        var diagnostics = new DateTimeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=DateTime", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_NeverEmitsTheTimestampValue()
    {
        var lines = new List<string>();
        var diagnostics = new DateTimeDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        // The slug-only line carries no ISO instant, year or zone.
        Assert.DoesNotContain(lines, line => line.Contains("2024", StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains('T', StringComparison.Ordinal) && line.Contains('Z', StringComparison.Ordinal));
    }

    // ---- accessibility ------------------------------------------------------------

    [Fact]
    public void ViewModel_AccessibleName_IsNeverEmpty()
    {
        var empty = new DateTimeViewModel(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now);
        Assert.False(string.IsNullOrWhiteSpace(empty.AccessibleName));

        var rendered = PureVm(new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero));
        Assert.False(string.IsNullOrWhiteSpace(rendered.AccessibleName));
    }
}
