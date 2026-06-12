using System.Runtime.CompilerServices;
using System.Text.Json;
using Microsoft.UI.Xaml;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using AnalyticsViews = TeslaSync.App.FeatureViews.Analytics;
using YearReviewViews = TeslaSync.App.FeatureViews.YearReview;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The <c>YearReviewPage</c>'s <see cref="ISlideContentFactory"/> — the native analogue of the web
/// <c>SlideRenderer</c>'s child-component imports (web/src/features/analytics/components/review/SlideRenderer.tsx).
/// The web page resolves one <c>YearReview</c> object and threads it into every slide; this factory does the
/// same: it builds each sibling slide surface from the single already-resolved
/// <see cref="YearReviewReport.Raw"/> object the page fetched once, so no slide re-fetches. Presentational slides
/// receive a model parsed from the shared JSON; the cache-then-network slides (<c>StatHeroSlide</c>,
/// <c>SavingsSlide</c>, <c>PatternsSlide</c>) receive a fixed in-memory source that replays the same resolved
/// payload as a single loaded emission. The <c>comparisons</c> kind has no native sibling surface yet (it is its
/// own P2 prompt), so the factory returns <see langword="null"/> there and <c>SlideRenderer</c> falls back to its
/// never-blank localized empty surface (ADR-011). UI construction only — no HTTP.
/// </summary>
internal sealed class YearReviewSlideContentFactory : ISlideContentFactory
{
    private readonly ILocalizer _localizer;
    private readonly UnitPref _units;
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the factory over the i18n facade, the active unit preference and an optional clock.</summary>
    public YearReviewSlideContentFactory(ILocalizer localizer, UnitPref units, Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _units = units;
        _clock = clock ?? (() => DateTimeOffset.Now);
    }

    /// <inheritdoc />
    public UIElement? CreateContent(SlideContentRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        JsonElement raw = request.Data.Raw;

        return request.Kind switch
        {
            SlideKind.Title => new TitleSlide(_localizer, TitleSlideModel.Parse(raw)),
            SlideKind.StatHero => new StatHeroSlide(BuildTotalsSource(raw), _localizer, MapField(request.Field), _units),
            SlideKind.StatChart => new YearReviewViews.StatChartSlide(_localizer, BuildStatChartModel(raw)),
            SlideKind.DriveHighlight => BuildDriveHighlight(request, raw),
            SlideKind.ChargingBreakdown => new ChargingBreakdownSlide(_localizer, BuildChargingModel(raw)),
            SlideKind.Savings => new SavingsSlide(BuildSavingsSource(raw), _localizer),
            SlideKind.Environment => new AnalyticsViews.EnvironmentSlide(_localizer, BuildEnvironmentModel(raw)),
            SlideKind.Patterns => new PatternsSlide(BuildPatternsSource(raw), _localizer, request.Data.Year, _units),
            SlideKind.Summary => new SummarySlide(_localizer, new SummarySlideModel(YearReviewSummary.ParseNullable(raw)), _units),

            // 'comparisons' has no native sibling surface yet, and the unknown arm (web default: null) — both
            // fall through to SlideRenderer's never-blank localized empty surface.
            _ => null,
        };
    }

    // ── Presentational slide models (parsed from the shared resolved payload) ───────────────────────────────

    private static YearReviewViews.StatChartSlideModel BuildStatChartModel(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Object)
        {
            return YearReviewViews.StatChartSlideModel.Empty;
        }

        var months = new List<YearReviewViews.StatChartMonth>();
        if (raw.TryGetProperty("monthly_stats", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var month in arr.EnumerateArray())
            {
                if (month.ValueKind == JsonValueKind.Object)
                {
                    months.Add(new YearReviewViews.StatChartMonth(
                        (int)JsonReads.Long(month, "month"),
                        JsonReads.Long(month, "drives")));
                }
            }
        }

        return new YearReviewViews.StatChartSlideModel(
            Loading: false,
            TotalDrives: JsonReads.Long(raw, "total_drives"),
            AvgDrivesPerWeek: JsonReads.Double(raw, "avg_drives_per_week"),
            MonthlyStats: months);
    }

    private static ChargingBreakdownSlideModel BuildChargingModel(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Object)
        {
            return ChargingBreakdownSlideModel.Empty;
        }

        return new ChargingBreakdownSlideModel(
            Loading: false,
            TotalChargeSessions: JsonReads.Long(raw, "total_charge_sessions"),
            AverageChargeStartSoc: JsonReads.Double(raw, "avg_charge_start_soc"),
            SuperchargerPercent: JsonReads.Double(raw, "supercharger_pct"),
            DcFastPercent: JsonReads.Double(raw, "dc_fast_pct"),
            AcOtherPercent: JsonReads.Double(raw, "ac_other_pct"));
    }

    private static AnalyticsViews.EnvironmentSlideModel BuildEnvironmentModel(JsonElement raw)
    {
        if (raw.ValueKind == JsonValueKind.Object && raw.TryGetProperty("co2_offset_kg", out _))
        {
            return AnalyticsViews.EnvironmentSlideModel.Resolved(JsonReads.Double(raw, "co2_offset_kg"));
        }

        return AnalyticsViews.EnvironmentSlideModel.Empty;
    }

    private DriveHighlightSlide BuildDriveHighlight(SlideContentRequest request, JsonElement raw)
    {
        // web slide.field === 'longest' selects data.longest_drive, otherwise data.most_efficient_drive.
        string driveKey = string.Equals(request.Field, SlideRendererProjection.LongestField, StringComparison.Ordinal)
            ? "longest_drive"
            : "most_efficient_drive";

        YearReviewDriveHighlight? drive = null;
        if (raw.ValueKind == JsonValueKind.Object && raw.TryGetProperty(driveKey, out var driveElement))
        {
            drive = YearReviewDriveHighlight.ParseNullable(driveElement);
        }

        // SlideRenderer already resolved the localized label + emoji into the request's selection.
        string label = request.DriveHighlight?.Label ?? string.Empty;
        string emoji = request.DriveHighlight?.Emoji ?? string.Empty;

        return new DriveHighlightSlide(_localizer, new DriveHighlightSlideModel(drive, label, emoji), _units);
    }

    // ── Fixed in-memory sources for the cache-then-network slides (replay the resolved payload once) ────────

    private FixedStatHeroSource BuildTotalsSource(JsonElement raw)
    {
        var totals = raw.ValueKind == JsonValueKind.Object ? YearReviewTotals.FromJson(raw) : YearReviewTotals.Empty;
        return new FixedStatHeroSource(RepositoryResult<YearReviewTotals>.Loaded(totals, _clock()));
    }

    private FixedSavingsSource BuildSavingsSource(JsonElement raw)
    {
        var snapshot = raw.ValueKind == JsonValueKind.Object ? SavingsSnapshot.FromJson(raw) : SavingsSnapshot.Empty;
        return new FixedSavingsSource(RepositoryResult<SavingsSnapshot>.Loaded(snapshot, _clock()));
    }

    private FixedPatternsSource BuildPatternsSource(JsonElement raw)
    {
        var patterns = raw.ValueKind == JsonValueKind.Object ? YearReviewPatterns.FromJson(raw) : YearReviewPatterns.Empty;
        return new FixedPatternsSource(RepositoryResult<YearReviewPatterns>.Loaded(patterns, _clock()));
    }

    private static StatHeroField MapField(string field) =>
        string.Equals(field, "energy", StringComparison.OrdinalIgnoreCase)
            ? StatHeroField.Energy
            : StatHeroField.Distance;

    private sealed class FixedStatHeroSource(RepositoryResult<YearReviewTotals> result) : IStatHeroSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<YearReviewTotals>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class FixedSavingsSource(RepositoryResult<SavingsSnapshot> result) : ISavingsSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<SavingsSnapshot>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }

    private sealed class FixedPatternsSource(RepositoryResult<YearReviewPatterns> result) : IPatternsSlideSource
    {
        public async IAsyncEnumerable<RepositoryResult<YearReviewPatterns>> StreamAsync(
            [EnumeratorCancellation] CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            yield return result;
            await Task.CompletedTask.ConfigureAwait(false);
        }
    }
}
