using System.Collections.Generic;
using TeslaSync.App.FeatureViews;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the status <c>helpers</c> surface — the WinUI-free 1:1 port of
/// web/src/features/system/components/status/helpers.tsx. The web module is a pure utility collection (no
/// component / hooks / data / render states), so the parity surface here is the six helper functions plus
/// the diagnostics contract; each web branch — the colour / foreground / icon tone vocabulary, the
/// deliberate <c>connected</c> badge-vs-colour discrepancy, the <c>formatUptime</c> cascade and the
/// <c>formatBytes</c> unit ladder (with locale grouping) — is asserted exhaustively.
/// </summary>
public sealed class HelpersTests
{
    private static readonly string[] SuccessStatuses =
        ["healthy", "ok", "online", "connected", "ready", "sent", "completed"];

    private static readonly string[] WarningStatuses =
        ["degraded", "warning", "pending", "queued", "processing"];

    private static readonly string[] DangerStatuses =
        ["unhealthy", "offline", "error", "down", "failed"];

    // ---- Classify (web getStatusColor / statusTextClass / getStatusIcon shared switch) -------------

    [Fact]
    public void Classify_maps_every_success_status()
    {
        foreach (string status in SuccessStatuses)
        {
            Assert.Equal(StatusColorTone.Success, StatusHelpers.Classify(status));
        }
    }

    [Fact]
    public void Classify_maps_every_warning_status()
    {
        foreach (string status in WarningStatuses)
        {
            Assert.Equal(StatusColorTone.Warning, StatusHelpers.Classify(status));
        }
    }

    [Fact]
    public void Classify_maps_every_danger_status()
    {
        foreach (string status in DangerStatuses)
        {
            Assert.Equal(StatusColorTone.Danger, StatusHelpers.Classify(status));
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown")]
    [InlineData("connecting")]
    [InlineData("   ")]
    public void Classify_falls_back_to_neutral(string? status) =>
        Assert.Equal(StatusColorTone.Neutral, StatusHelpers.Classify(status));

    [Theory]
    [InlineData("HEALTHY", StatusColorTone.Success)]
    [InlineData("Online", StatusColorTone.Success)]
    [InlineData("Degraded", StatusColorTone.Warning)]
    [InlineData("FAILED", StatusColorTone.Danger)]
    public void Classify_is_case_insensitive(string status, StatusColorTone expected) =>
        Assert.Equal(expected, StatusHelpers.Classify(status));

    // ---- StatusColorHex (web getStatusColor) -------------------------------------------------------

    [Fact]
    public void StatusColorHex_uses_exact_web_hex()
    {
        Assert.Equal("#22c55e", StatusHelpers.SuccessHex);
        Assert.Equal("#f59e0b", StatusHelpers.WarningHex);
        Assert.Equal("#ef4444", StatusHelpers.DangerHex);
        Assert.Equal("#6b7280", StatusHelpers.NeutralHex);

        Assert.Equal(StatusHelpers.SuccessHex, StatusHelpers.StatusColorHex("healthy"));
        Assert.Equal(StatusHelpers.WarningHex, StatusHelpers.StatusColorHex("pending"));
        Assert.Equal(StatusHelpers.DangerHex, StatusHelpers.StatusColorHex("error"));
        Assert.Equal(StatusHelpers.NeutralHex, StatusHelpers.StatusColorHex("nonsense"));
        Assert.Equal(StatusHelpers.NeutralHex, StatusHelpers.StatusColorHex(null));
    }

    // ---- StatusForegroundBrushKey (web statusTextClass) --------------------------------------------

    [Theory]
    [InlineData("online", "TsColorSuccessBrush")]
    [InlineData("queued", "TsColorWarningBrush")]
    [InlineData("down", "TsColorDangerBrush")]
    [InlineData("mystery", "TsColorTextMutedBrush")]
    [InlineData(null, "TsColorTextMutedBrush")]
    public void StatusForegroundBrushKey_maps_to_token(string? status, string expected) =>
        Assert.Equal(expected, StatusHelpers.StatusForegroundBrushKey(status));

    // ---- StatusGlyph (web getStatusIcon) -----------------------------------------------------------

    [Fact]
    public void StatusGlyph_maps_each_tone_to_its_segoe_glyph()
    {
        Assert.Equal(StatusHelpers.SuccessGlyph, StatusHelpers.StatusGlyph("completed"));
        Assert.Equal(StatusHelpers.DangerGlyph, StatusHelpers.StatusGlyph("offline"));
        Assert.Equal(StatusHelpers.WarningGlyph, StatusHelpers.StatusGlyph("warning"));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unrecognised")]
    public void StatusGlyph_default_branch_uses_warning_glyph(string? status) =>
        // Web parity: the default getStatusIcon branch returns an AlertTriangle (the warning glyph).
        Assert.Equal(StatusHelpers.WarningGlyph, StatusHelpers.StatusGlyph(status));

    // ---- BadgeVariant (web statusToBadgeVariant) ---------------------------------------------------

    [Fact]
    public void BadgeVariant_maps_success_set_without_connected()
    {
        foreach (string status in new[] { "healthy", "ok", "online", "ready", "sent", "completed" })
        {
            Assert.Equal(StatusBadgeVariant.Success, StatusHelpers.BadgeVariant(status));
        }
    }

    [Fact]
    public void BadgeVariant_maps_warning_and_danger_sets()
    {
        foreach (string status in WarningStatuses)
        {
            Assert.Equal(StatusBadgeVariant.Warning, StatusHelpers.BadgeVariant(status));
        }

        foreach (string status in DangerStatuses)
        {
            Assert.Equal(StatusBadgeVariant.Danger, StatusHelpers.BadgeVariant(status));
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("unknown")]
    public void BadgeVariant_falls_back_to_neutral(string? status) =>
        Assert.Equal(StatusBadgeVariant.Neutral, StatusHelpers.BadgeVariant(status));

    [Fact]
    public void Connected_is_green_for_colour_but_neutral_for_badge()
    {
        // The web source's statusToBadgeVariant "success" set omits "connected" while getStatusColor /
        // statusTextClass / getStatusIcon include it. This discrepancy is reproduced verbatim.
        Assert.Equal(StatusColorTone.Success, StatusHelpers.Classify("connected"));
        Assert.Equal(StatusHelpers.SuccessHex, StatusHelpers.StatusColorHex("connected"));
        Assert.Equal(StatusHelpers.SuccessGlyph, StatusHelpers.StatusGlyph("connected"));
        Assert.Equal(StatusBadgeVariant.Neutral, StatusHelpers.BadgeVariant("connected"));
    }

    // ---- FormatUptime (web formatUptime) -----------------------------------------------------------

    [Theory]
    [InlineData(0, "0m")]
    [InlineData(59, "0m")]
    [InlineData(60, "1m")]
    [InlineData(3540, "59m")]
    [InlineData(3600, "1h 0m")]
    [InlineData(3661, "1h 1m")]
    [InlineData(86400, "1d 0h 0m")]
    [InlineData(90061, "1d 1h 1m")]
    [InlineData(172800, "2d 0h 0m")]
    public void FormatUptime_matches_web_cascade(double seconds, string expected) =>
        Assert.Equal(expected, StatusHelpers.FormatUptime(seconds));

    [Theory]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void FormatUptime_hardens_non_domain_inputs(double seconds) =>
        Assert.Equal("0m", StatusHelpers.FormatUptime(seconds));

    // ---- FormatBytes (web formatBytes) -------------------------------------------------------------

    [Theory]
    [InlineData(0, "0 B")]
    [InlineData(1, "1.0 B")]
    [InlineData(512, "512.0 B")]
    [InlineData(1023, "1,023.0 B")]      // locale grouping via the fmtNumber port
    [InlineData(1024, "1.0 KB")]
    [InlineData(1536, "1.5 KB")]
    [InlineData(1048576, "1.0 MB")]      // 1024^2
    [InlineData(5242880, "5.0 MB")]      // 5 * 1024^2
    [InlineData(1073741824, "1.0 GB")]   // 1024^3
    [InlineData(1099511627776, "1.0 TB")] // 1024^4
    [InlineData(2199023255552, "2.0 TB")] // 2 * 1024^4
    public void FormatBytes_matches_web_units(double bytes, string expected) =>
        Assert.Equal(expected, StatusHelpers.FormatBytes(bytes));

    [Fact]
    public void FormatBytes_clamps_petabyte_into_terabytes()
    {
        // Web would index sizes[5] (== undefined) for a petabyte; the native port clamps into TB.
        const double petabyte = 1024d * 1024d * 1024d * 1024d * 1024d;
        Assert.EndsWith(" TB", StatusHelpers.FormatBytes(petabyte), System.StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    public void FormatBytes_hardens_non_finite_input(double bytes) =>
        Assert.Equal("0 B", StatusHelpers.FormatBytes(bytes));

    // ---- Diagnostics (P1/S11 view.opened contract) -------------------------------------------------

    [Fact]
    public void Registration_slug_is_helpers() =>
        Assert.Equal("helpers", HelpersRegistration.Slug);

    [Fact]
    public void Diagnostics_records_view_opened_with_slug()
    {
        var emitted = new List<string>();
        var diagnostics = new HelpersDiagnostics(emitted.Add);

        diagnostics.RecordViewOpened();
        diagnostics.RecordViewOpened();

        Assert.Equal(2, diagnostics.ViewsOpened);
        Assert.Equal(["view.opened slug=helpers", "view.opened slug=helpers"], emitted);
    }

    [Fact]
    public void Diagnostics_counts_without_a_sink()
    {
        var diagnostics = new HelpersDiagnostics();

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
    }
}
