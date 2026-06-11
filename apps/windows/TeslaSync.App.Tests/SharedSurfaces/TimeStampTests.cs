using System.Globalization;
using TeslaSync.App.SharedSurfaces.TimeStampSurface;
using Xunit;

namespace TeslaSync.App.Tests.SharedSurfaces;

/// <summary>
/// Headless verification of the TimeStamp surface's UI-thread-free logic — the pure formatting adapter
/// (the effective-format resolution, the absolute pattern, the relative tier buckets, the zone + locale
/// resolution ports of web <c>resolveTimezone</c> / <c>resolveLocale</c>), the state-holder view-model's
/// body/tooltip split and projections, the registration metadata, the PII-safe diagnostics and the
/// Narrator name. Mirrors the web spec (web/src/components/data-display/TimeStamp.tsx +
/// lib/dateFormat formatDateTime / formatRelative / formatDate, lib/timezone, lib/locale,
/// hooks/useTimeFormatPreference, hooks/useDateFormat). The WinUI view itself is exercised by the app build.
/// </summary>
public sealed class TimeStampTests
{
    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");
    private static readonly DateTimeOffset Now = new(2024, 1, 10, 12, 0, 0, TimeSpan.Zero);

    private static TimeZoneInfo FixedZone(string id, double hours) =>
        TimeZoneInfo.CreateCustomTimeZone(id, TimeSpan.FromHours(hours), id, id);

    // ---- effective-format resolution (web `effective = format === 'auto' ? pref : format`) ----------

    [Theory]
    [InlineData(TimeStampFormat.Auto, TimeStampFormat.Relative, TimeStampFormat.Relative)]
    [InlineData(TimeStampFormat.Auto, TimeStampFormat.Absolute, TimeStampFormat.Absolute)]
    [InlineData(TimeStampFormat.Relative, TimeStampFormat.Absolute, TimeStampFormat.Relative)]
    [InlineData(TimeStampFormat.Absolute, TimeStampFormat.Relative, TimeStampFormat.Absolute)]
    [InlineData(TimeStampFormat.Auto, TimeStampFormat.Auto, TimeStampFormat.Relative)] // degenerate pref → web 'relative' default
    public void ResolveEffectiveFormat_HonoursPreferenceAndOverrides(
        TimeStampFormat format, TimeStampFormat preference, TimeStampFormat expected)
    {
        Assert.Equal(expected, TimeStampFormatting.ResolveEffectiveFormat(format, preference));
    }

    // ---- absolute pattern (web formatDateTime "MMM d, yyyy, hh:mm tt") ------------------------------

    [Fact]
    public void FormatAbsolute_RendersWebLocaleStringPattern()
    {
        var morning = new DateTimeOffset(2026, 4, 4, 9, 30, 0, TimeSpan.Zero);
        var afternoon = new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero);

        Assert.Equal("Apr 4, 2026, 09:30 AM", TimeStampFormatting.FormatAbsolute(morning, TimeZoneInfo.Utc, EnUs));
        Assert.Equal("Jun 15, 2024, 01:30 PM", TimeStampFormatting.FormatAbsolute(afternoon, TimeZoneInfo.Utc, EnUs));
    }

    [Fact]
    public void FormatAbsolute_RendersWallClockInTargetZone()
    {
        // 05:00Z in a -08:00 zone is the previous day at 21:00 local.
        var value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero);

        Assert.Equal("Dec 31, 2023, 09:00 PM", TimeStampFormatting.FormatAbsolute(value, FixedZone("Minus8", -8), EnUs));
    }

    // ---- relative tiers (web formatRelative) -------------------------------------------------------

    [Theory]
    [InlineData(30, "just now")]
    [InlineData(0, "just now")]
    [InlineData(59, "just now")]
    [InlineData(60, "1m ago")]
    [InlineData(300, "5m ago")]
    [InlineData(3540, "59m ago")]
    [InlineData(3600, "1h ago")]
    [InlineData(10800, "3h ago")]
    [InlineData(82800, "23h ago")]
    [InlineData(86400, "1d ago")]
    [InlineData(518400, "6d ago")]
    public void FormatRelative_BucketsLikeWeb(int secondsAgo, string expected)
    {
        var value = Now.AddSeconds(-secondsAgo);
        Assert.Equal(expected, TimeStampFormatting.FormatRelative(value, Now, TimeZoneInfo.Utc, EnUs));
    }

    [Fact]
    public void FormatRelative_FutureInstantReadsJustNow()
    {
        // web does not guard a negative delta: seconds < 60 still wins.
        var value = Now.AddHours(1);
        Assert.Equal("just now", TimeStampFormatting.FormatRelative(value, Now, TimeZoneInfo.Utc, EnUs));
    }

    [Fact]
    public void FormatRelative_BeyondSevenDays_FallsBackToAbsoluteDateInZone()
    {
        // 9d 7h before Now; the > 7-day branch renders web formatDate ("MMM d, yyyy") in the target zone.
        var value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero);

        Assert.Equal("Jan 1, 2024", TimeStampFormatting.FormatRelative(value, Now, TimeZoneInfo.Utc, EnUs));
        // In a -08:00 zone the same instant is the previous calendar day.
        Assert.Equal("Dec 31, 2023", TimeStampFormatting.FormatRelative(value, Now, FixedZone("Minus8", -8), EnUs));
    }

    [Fact]
    public void FormatRelative_ExactlySevenDays_UsesDateFallback()
    {
        var value = Now.AddDays(-7); // 2024-01-03 12:00Z
        Assert.Equal("Jan 3, 2024", TimeStampFormatting.FormatRelative(value, Now, TimeZoneInfo.Utc, EnUs));
    }

    // ---- resolveLocale port ------------------------------------------------------------------------

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveLocale_BlankFallsBackToEnUs(string? locale)
    {
        Assert.Equal("en-US", TimeStampFormatting.ResolveLocale(locale).Name);
    }

    [Theory]
    [InlineData("fr-FR")]
    [InlineData("de-DE")]
    public void ResolveLocale_ValidTagIsHonoured(string locale)
    {
        Assert.Equal(locale, TimeStampFormatting.ResolveLocale(locale).Name);
    }

    // ---- resolveTimezone port ----------------------------------------------------------------------

    [Fact]
    public void ResolveZoneId_Utc_IsAlwaysUtc()
    {
        Assert.Equal("UTC", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.Utc, "America/Chicago", "Europe/Paris", "America/New_York"));
    }

    [Fact]
    public void ResolveZoneId_User_PrefersOverrideThenSystem()
    {
        Assert.Equal("Europe/Paris", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.User, "America/Chicago", "Europe/Paris", "America/New_York"));
        Assert.Equal("America/New_York", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.User, "America/Chicago", null, "America/New_York"));
        Assert.Equal("America/New_York", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.User, "America/Chicago", "   ", "America/New_York"));
    }

    [Fact]
    public void ResolveZoneId_Vehicle_PrefersVehicleThenFallsBack()
    {
        Assert.Equal("America/Chicago", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.Vehicle, "America/Chicago", "Europe/Paris", "America/New_York"));
        Assert.Equal("Europe/Paris", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.Vehicle, null, "Europe/Paris", "America/New_York"));
        // A vehicle reported as bare UTC is treated as not-yet-polled → user override.
        Assert.Equal("Europe/Paris", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.Vehicle, "UTC", "Europe/Paris", "America/New_York"));
        Assert.Equal("America/New_York", TimeStampFormatting.ResolveZoneId(TimeStampTzMode.Vehicle, null, null, "America/New_York"));
    }

    [Fact]
    public void ResolveZone_UtcAndUnknownFallBack()
    {
        TimeZoneInfo fallback = FixedZone("Fallback5", -5);

        Assert.Equal(TimeZoneInfo.Utc, TimeStampFormatting.ResolveZone("UTC", fallback));
        Assert.Same(fallback, TimeStampFormatting.ResolveZone("Totally/Unknown_Zone", fallback));
        Assert.Same(fallback, TimeStampFormatting.ResolveZone(null, fallback));
        Assert.Same(fallback, TimeStampFormatting.ResolveZone("   ", fallback));
    }

    // ---- view-model: empty state -------------------------------------------------------------------

    [Fact]
    public void ViewModel_Initial_IsEmptyWithNoTooltip()
    {
        var vm = new TimeStampViewModel(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now);

        Assert.Equal(TimeStampRenderState.Empty, vm.State);
        Assert.Equal("\u2014", vm.Display);
        Assert.Null(vm.Tooltip);
        Assert.False(vm.HasTooltip);
        Assert.Equal("\u2014", vm.AccessibleName);
    }

    // ---- view-model: rendered body / tooltip split -------------------------------------------------

    [Fact]
    public void ViewModel_RelativeBody_TooltipShowsAbsolute()
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Relative,
        };

        Assert.Equal(TimeStampRenderState.Rendered, vm.State);
        Assert.Equal(TimeStampFormat.Relative, vm.EffectiveFormat);
        Assert.Equal("5m ago", vm.Display);
        Assert.True(vm.HasTooltip);
        Assert.Equal("Jan 10, 2024, 11:55 AM", vm.Tooltip);
    }

    [Fact]
    public void ViewModel_AbsoluteBody_TooltipShowsRelative()
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Absolute,
        };

        Assert.Equal(TimeStampFormat.Absolute, vm.EffectiveFormat);
        Assert.Equal("Jan 10, 2024, 11:55 AM", vm.Display);
        Assert.Equal("5m ago", vm.Tooltip);
    }

    // ---- view-model: auto honours the preference (web useTimeFormatPreference) ----------------------

    [Theory]
    [InlineData(TimeStampFormat.Relative, "5m ago")]
    [InlineData(TimeStampFormat.Absolute, "Jan 10, 2024, 11:55 AM")]
    public void ViewModel_AutoFormat_FollowsContextPreference(TimeStampFormat preference, string expectedBody)
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.Utc, formatPreference: preference),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Auto,
        };

        Assert.Equal(preference, vm.EffectiveFormat);
        Assert.Equal(expectedBody, vm.Display);
    }

    // ---- view-model: zone resolution ---------------------------------------------------------------

    [Fact]
    public void ViewModel_UtcMode_RendersUtcWallClock()
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.Vehicle),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = new DateTimeOffset(2024, 6, 15, 13, 30, 0, TimeSpan.Zero),
            Format = TimeStampFormat.Absolute,
            Mode = TimeStampTzMode.Utc,
        };

        Assert.Equal(TimeStampTzMode.Utc, vm.EffectiveMode);
        Assert.Equal("UTC", vm.ResolvedZoneId);
        Assert.Equal("Jun 15, 2024, 01:30 PM", vm.Display);
    }

    [Fact]
    public void ViewModel_UserMode_UsesInjectedSystemZoneWhenNoOverride()
    {
        TimeZoneInfo minus5 = FixedZone("Minus5", -5);
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.User),
            systemZone: minus5,
            clock: () => Now)
        {
            Value = new DateTimeOffset(2024, 1, 1, 5, 0, 0, TimeSpan.Zero), // 00:00 local at -5
            Format = TimeStampFormat.Absolute,
        };

        Assert.Equal(minus5.Id, vm.ResolvedZoneId);
        Assert.Equal("Jan 1, 2024, 12:00 AM", vm.Display);
    }

    // ---- view-model: reactivity --------------------------------------------------------------------

    [Fact]
    public void ViewModel_PreferenceChange_FlipsAutoBodyAndRaises()
    {
        var context = new MutableTimeStampContext(locale: "en-US", defaultMode: TimeStampTzMode.Utc, formatPreference: TimeStampFormat.Relative);
        var vm = new TimeStampViewModel(context, systemZone: TimeZoneInfo.Utc, clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Auto,
        };

        Assert.Equal("5m ago", vm.Display);

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        context.FormatPreference = TimeStampFormat.Absolute;

        Assert.Equal(TimeStampFormat.Absolute, vm.EffectiveFormat);
        Assert.Equal("Jan 10, 2024, 11:55 AM", vm.Display);
        Assert.Contains(nameof(TimeStampViewModel.EffectiveFormat), changed);
        Assert.Contains(nameof(TimeStampViewModel.Display), changed);
        Assert.Contains(nameof(TimeStampViewModel.Tooltip), changed);
    }

    [Fact]
    public void ViewModel_SettingValue_RaisesProjectionChanges()
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Format = TimeStampFormat.Relative,
        };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Value = Now.AddMinutes(-5);

        Assert.Contains(nameof(TimeStampViewModel.Value), changed);
        Assert.Contains(nameof(TimeStampViewModel.Display), changed);
        Assert.Contains(nameof(TimeStampViewModel.State), changed);
        Assert.Contains(nameof(TimeStampViewModel.Tooltip), changed);
        Assert.Contains(nameof(TimeStampViewModel.HasTooltip), changed);
        Assert.Contains(nameof(TimeStampViewModel.AccessibleName), changed);
    }

    [Fact]
    public void ViewModel_SettingSameValue_DoesNotRaise()
    {
        var value = Now.AddMinutes(-5);
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = value,
        };
        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        vm.Value = value; // unchanged

        Assert.Empty(changed);
    }

    [Fact]
    public void ViewModel_ClearingValue_ReturnsToEmptyAndDropsTooltip()
    {
        var vm = new TimeStampViewModel(
            new StaticTimeStampContext(defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Relative,
        };
        Assert.True(vm.HasTooltip);

        vm.Value = null;

        Assert.Equal(TimeStampRenderState.Empty, vm.State);
        Assert.Equal("\u2014", vm.Display);
        Assert.Null(vm.Tooltip);
        Assert.False(vm.HasTooltip);
    }

    [Fact]
    public void ViewModel_Dispose_DetachesFromContext()
    {
        var context = new MutableTimeStampContext(defaultMode: TimeStampTzMode.Utc, formatPreference: TimeStampFormat.Relative);
        var vm = new TimeStampViewModel(context, systemZone: TimeZoneInfo.Utc, clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
            Format = TimeStampFormat.Auto,
        };
        vm.Dispose();

        var changed = new List<string?>();
        vm.PropertyChanged += (_, e) => changed.Add(e.PropertyName);

        context.FormatPreference = TimeStampFormat.Absolute; // must not recompute after dispose

        Assert.Empty(changed);
    }

    // ---- registration ------------------------------------------------------------------------------

    [Fact]
    public void Registration_HasCanonicalSlug()
    {
        Assert.Equal("TimeStamp", TimeStampRegistration.Slug);
    }

    // ---- diagnostics (view.opened, PII-safe) -------------------------------------------------------

    [Fact]
    public void Diagnostics_EmitsViewOpenedWithSlug()
    {
        var lines = new List<string>();
        var diagnostics = new TimeStampDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TimeStamp", Assert.Single(lines));
    }

    [Fact]
    public void Diagnostics_NeverEmitsTheTimestampValue()
    {
        var lines = new List<string>();
        var diagnostics = new TimeStampDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.DoesNotContain(lines, line => line.Contains("2024", StringComparison.Ordinal));
        Assert.DoesNotContain(lines, line => line.Contains("ago", StringComparison.Ordinal));
    }

    // ---- accessibility -----------------------------------------------------------------------------

    [Fact]
    public void ViewModel_AccessibleName_IsNeverEmpty()
    {
        var empty = new TimeStampViewModel(context: null, systemZone: TimeZoneInfo.Utc, clock: () => Now);
        Assert.False(string.IsNullOrWhiteSpace(empty.AccessibleName));

        var rendered = new TimeStampViewModel(
            new StaticTimeStampContext(defaultMode: TimeStampTzMode.Utc),
            systemZone: TimeZoneInfo.Utc,
            clock: () => Now)
        {
            Value = Now.AddMinutes(-5),
        };
        Assert.False(string.IsNullOrWhiteSpace(rendered.AccessibleName));
    }
}
