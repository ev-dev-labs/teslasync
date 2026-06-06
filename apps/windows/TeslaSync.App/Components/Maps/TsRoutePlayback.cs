using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using TeslaSync.App.Components.A11y;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Maps;

namespace TeslaSync.App.Components.Maps;

/// <summary>
/// Animated GPS trip replay (port of the web <c>RoutePlayback</c>). Drives the
/// headless <see cref="RoutePlaybackEngine"/> from a 50 ms <see cref="DispatcherTimer"/>
/// to move a marker along the trip polyline, with play/pause, reset, a speed selector
/// (1×–100×) and a scrubbable progress slider. The trail + marker are rendered onto an
/// attached <see cref="TsMapControl"/>. Empty trips show an empty state; the current
/// position is announced to assistive technology.
/// </summary>
public partial class TsRoutePlayback : ContentControl
{
    private readonly StackPanel _column = new() { Spacing = 12 };
    private readonly StackPanel _transport = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 10,
        VerticalAlignment = VerticalAlignment.Center,
    };

    private readonly TsButton _playPause = new() { IconGlyph = "\uE768", Variant = TeslaSync.App.Core.ButtonVariant.Primary };
    private readonly TsButton _reset = new() { IconGlyph = "\uE72C", Variant = TeslaSync.App.Core.ButtonVariant.Secondary };
    private readonly ComboBox _speed = new() { MinWidth = 80 };
    private readonly Slider _scrubber = new() { Minimum = 0, Maximum = 1000, StepFrequency = 1, MinWidth = 200 };
    private readonly Text _time = new() { Value = "00:00 / 00:00" };
    private readonly TsEmptyState _empty = new();
    private readonly TsAnnouncerRegion _announcer = new();

    private readonly TsMapPolyline _trail = new();
    private readonly TsAnimatedMarker _marker = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(RoutePlaybackEngine.TickMs) };

    private RoutePlaybackEngine _engine = new([]);
    private TsMapControl? _map;
    private bool _suppressScrub;
    private int _lastAnnouncedIndex = -1;

    public static readonly DependencyProperty PlayLabelProperty = DependencyProperty.Register(
        nameof(PlayLabel), typeof(string), typeof(TsRoutePlayback), new PropertyMetadata("Play"));

    public static readonly DependencyProperty PauseLabelProperty = DependencyProperty.Register(
        nameof(PauseLabel), typeof(string), typeof(TsRoutePlayback), new PropertyMetadata("Pause"));

    public TsRoutePlayback()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        _empty.IconGlyph = "\uE707";
        _empty.Title = "No route to replay";
        _empty.Message = "No GPS points were recorded for this trip.";

        foreach (int speed in RoutePlaybackEngine.Speeds)
        {
            _speed.Items.Add(new ComboBoxItem
            {
                Content = string.Create(CultureInfo.InvariantCulture, $"{speed}×"),
                Tag = speed,
            });
        }

        _speed.SelectedIndex = 0;
        AutomationProperties.SetName(_speed, "Playback speed");
        AutomationProperties.SetName(_scrubber, "Playback position");
        AutomationProperties.SetName(_playPause, PlayLabel);
        AutomationProperties.SetName(_reset, "Restart");

        _playPause.Click += (_, _) => Toggle();
        _reset.Click += (_, _) => ResetPlayback();
        _scrubber.ValueChanged += OnScrub;
        _timer.Tick += OnTick;

        _transport.Children.Add(_playPause);
        _transport.Children.Add(_reset);
        _transport.Children.Add(_speed);
        _transport.Children.Add(_scrubber);
        _transport.Children.Add(_time);

        _column.Children.Add(_transport);
        _column.Children.Add(_empty);
        _column.Children.Add(_announcer);
        Content = _column;

        RenderEmptyState();
    }

    /// <summary>Localized "play" label.</summary>
    public string PlayLabel
    {
        get => (string)GetValue(PlayLabelProperty);
        set => SetValue(PlayLabelProperty, value);
    }

    /// <summary>Localized "pause" label.</summary>
    public string PauseLabel
    {
        get => (string)GetValue(PauseLabelProperty);
        set => SetValue(PauseLabelProperty, value);
    }

    /// <summary>Attach the map the trail + marker render onto.</summary>
    public void Attach(TsMapControl map)
    {
        ArgumentNullException.ThrowIfNull(map);
        _map = map;
        map.AddOverlay(_trail);
        map.AddOverlay(_marker);
    }

    /// <summary>Load a trip's GPS samples and reset playback to the start.</summary>
    public void SetTrail(IReadOnlyList<PlaybackPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        _engine = new RoutePlaybackEngine(points);
        _lastAnnouncedIndex = -1;
        Stop();

        var trail = _engine.Trail();
        _trail.SetPoints(trail);
        _map?.SetHasGeometry(trail.Count > 0);

        if (!_engine.IsEmpty && _map is not null)
        {
            _map.FitBounds(trail);
            var first = _engine.Current;
            if (first is { } point)
            {
                _marker.Location = new GeoPoint(point.Lat, point.Lng);
                _marker.Project(_map);
            }

            _map.Invalidate();
        }

        _announcer.Announce(CoordinateSummary.Route(trail));
        RenderEmptyState();
        UpdateReadout();
    }

    private int SelectedSpeed => _speed.SelectedItem is ComboBoxItem { Tag: int s } ? s : 1;

    private void RenderEmptyState()
    {
        bool empty = _engine.IsEmpty;
        _empty.Visibility = empty ? Visibility.Visible : Visibility.Collapsed;
        _transport.Visibility = empty ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Toggle()
    {
        if (_engine.IsEmpty)
        {
            return;
        }

        if (_timer.IsEnabled)
        {
            Stop();
        }
        else
        {
            if (_engine.AtEnd)
            {
                _engine.Reset();
            }

            _timer.Start();
            _playPause.IconGlyph = "\uE769";
            AutomationProperties.SetName(_playPause, PauseLabel);
        }
    }

    private void Stop()
    {
        _timer.Stop();
        _playPause.IconGlyph = "\uE768";
        AutomationProperties.SetName(_playPause, PlayLabel);
    }

    private void ResetPlayback()
    {
        Stop();
        _engine.Reset();
        SyncMarker();
        UpdateReadout();
    }

    private void OnTick(object? sender, object e)
    {
        bool done = _engine.Advance(SelectedSpeed);
        SyncMarker();
        UpdateReadout();
        AnnouncePosition();

        if (done)
        {
            Stop();
        }
    }

    private void OnScrub(object sender, RangeBaseValueChangedEventArgs e)
    {
        if (_suppressScrub || _engine.IsEmpty)
        {
            return;
        }

        _engine.SeekToProgress(e.NewValue / _scrubber.Maximum);
        SyncMarker();
        UpdateReadout();
    }

    private void SyncMarker()
    {
        if (_map is null)
        {
            return;
        }

        var current = _engine.Current;
        if (current is { } point)
        {
            _marker.MoveTo(new GeoPoint(point.Lat, point.Lng), _map);
        }
    }

    private void UpdateReadout()
    {
        _suppressScrub = true;
        _scrubber.Value = _engine.Progress * _scrubber.Maximum;
        _suppressScrub = false;

        string elapsed = RoutePlaybackEngine.FormatDuration(_engine.ElapsedMs);
        string total = RoutePlaybackEngine.FormatDuration(_engine.TotalMs);
        _time.Value = string.Create(CultureInfo.InvariantCulture, $"{elapsed} / {total}");
    }

    private void AnnouncePosition()
    {
        if (_engine.CurrentIndex == _lastAnnouncedIndex)
        {
            return;
        }

        _lastAnnouncedIndex = _engine.CurrentIndex;
        var current = _engine.Current;
        if (current is { } point)
        {
            _announcer.Announce(CoordinateSummary.Position(
                _engine.CurrentIndex, _engine.Points.Count, new GeoPoint(point.Lat, point.Lng)));
        }
    }
}
