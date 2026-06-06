using System.ComponentModel;

namespace TeslaSync.App.Core.Charts;

/// <summary>
/// Tracks which series are hidden via the interactive legend (mirrors the web
/// useChartLegendState / ChartHiddenSeriesContext). Toggling a legend entry hides
/// or shows its series; <see cref="VisibleSeries"/> filters a bound series list.
/// UI-thread-free so legend behaviour is unit-tested headlessly.
/// </summary>
public sealed class ChartLegendState : INotifyPropertyChanged
{
    private readonly HashSet<string> _hidden = new(StringComparer.Ordinal);

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The names of currently hidden series.</summary>
    public IReadOnlyCollection<string> HiddenSeries => _hidden;

    /// <summary>True when the named series is currently drawn.</summary>
    public bool IsVisible(string seriesName)
    {
        ArgumentException.ThrowIfNullOrEmpty(seriesName);
        return !_hidden.Contains(seriesName);
    }

    /// <summary>Flips the visibility of a series and returns the new visible state.</summary>
    public bool Toggle(string seriesName)
    {
        ArgumentException.ThrowIfNullOrEmpty(seriesName);
        bool nowVisible;
        if (_hidden.Remove(seriesName))
        {
            nowVisible = true;
        }
        else
        {
            _hidden.Add(seriesName);
            nowVisible = false;
        }

        Raise();
        return nowVisible;
    }

    /// <summary>Forces a series visible or hidden.</summary>
    public void SetVisible(string seriesName, bool visible)
    {
        ArgumentException.ThrowIfNullOrEmpty(seriesName);
        var changed = visible ? _hidden.Remove(seriesName) : _hidden.Add(seriesName);
        if (changed)
        {
            Raise();
        }
    }

    /// <summary>Clears all hidden state (every series visible again).</summary>
    public void Reset()
    {
        if (_hidden.Count == 0)
        {
            return;
        }

        _hidden.Clear();
        Raise();
    }

    /// <summary>Returns only the series that are currently visible, order preserved.</summary>
    public IReadOnlyList<ChartSeries> VisibleSeries(IReadOnlyList<ChartSeries> series)
    {
        ArgumentNullException.ThrowIfNull(series);
        var result = new List<ChartSeries>(series.Count);
        foreach (var s in series)
        {
            if (IsVisible(s.Name))
            {
                result.Add(s);
            }
        }

        return result;
    }

    private void Raise() =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(HiddenSeries)));
}
