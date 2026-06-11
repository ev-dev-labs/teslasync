using TeslaSync.App.Core.Units;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// The date-formatting seam the <see cref="ExportModalViewModel"/> binds to (P1/S8 state-holder seam) — the
/// native analogue of the web <c>useDateFormat()</c> hook the modal calls as <c>formatDate(dashboard.updatedAt)</c>
/// to render the "Updated {{date}}" caption. The view-model never reaches for a formatter or clock itself; the
/// concrete <see cref="SystemExportDateFormatter"/> (or a test fake) supplies the formatted string.
/// </summary>
public interface IExportDateFormatter
{
    /// <summary>
    /// Format <paramref name="value"/> as a locale-aware medium date (web <c>formatDate</c>), or the em-dash
    /// fallback when it is <c>null</c> / unparseable.
    /// </summary>
    string FormatDate(DateTimeOffset? value);
}

/// <summary>
/// The default <see cref="IExportDateFormatter"/> — formats through the shared <see cref="DateTimeFormatting"/>
/// behavior port using the <see cref="DateTimeVariant.Date"/> tier ("Apr 4, 2026"), which is the 1:1 native port
/// of the web <c>lib/dateFormat</c> medium-date variant that <c>useDateFormat().formatDate</c> resolves to. The
/// clock is injectable so the (relative-tier) fallback is deterministic in tests; the date tier itself is
/// clock-independent. WinUI-free so the composition is unit-tested without a UI host.
/// </summary>
public sealed class SystemExportDateFormatter : IExportDateFormatter
{
    private readonly Func<DateTimeOffset> _now;

    /// <summary>Creates the formatter over an optional clock (defaults to <see cref="DateTimeOffset.Now"/>).</summary>
    public SystemExportDateFormatter(Func<DateTimeOffset>? now = null) => _now = now ?? (() => DateTimeOffset.Now);

    /// <inheritdoc />
    public string FormatDate(DateTimeOffset? value) =>
        DateTimeFormatting.Format(value, DateTimeVariant.Date, _now());
}
