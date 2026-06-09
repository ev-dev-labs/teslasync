namespace TeslaSync.App.FeatureViews.CronParser;

/// <summary>
/// The source of the surface's cron presets (P1/S8 state-holder seam). The web <c>CronParserTool</c> builds
/// its preset list inline (web/src/features/admin/components/devtools/tools/CronParser.tsx) rather than
/// reading the network — but routing the list through a seam keeps the view-model free of literals and lets a
/// test substitute an empty or alternate preset set.
/// </summary>
public interface ICronPresetSource
{
    /// <summary>The ordered cron presets to project into chips.</summary>
    IReadOnlyList<CronPreset> GetPresets();
}

/// <summary>
/// The canonical <see cref="ICronPresetSource"/> — the five presets the web <c>CronParserTool</c> registers,
/// in the same order (Every Minute, Every Hour, Every Day, Every Week, Every Month). Each entry carries the
/// web i18n key + English fallback for the chip label and the literal cron expression the chip applies
/// (web <c>{ label: t('Every Minute'), value: '* * * * *' }</c>). Headless and immutable, so the catalog is
/// asserted in unit tests.
/// </summary>
public sealed class CronPresetSource : ICronPresetSource
{
    /// <summary>The canonical, ordered preset catalog (web <c>presets</c>).</summary>
    public static IReadOnlyList<CronPreset> Canonical { get; } = new[]
    {
        new CronPreset("Every Minute", "Every Minute", "* * * * *"),
        new CronPreset("Every Hour", "Every Hour", "0 * * * *"),
        new CronPreset("Every Day", "Every Day", "0 0 * * *"),
        new CronPreset("Every Week", "Every Week", "0 0 * * 0"),
        new CronPreset("Every Month", "Every Month", "0 0 1 * *"),
    };

    /// <inheritdoc />
    public IReadOnlyList<CronPreset> GetPresets() => Canonical;
}
