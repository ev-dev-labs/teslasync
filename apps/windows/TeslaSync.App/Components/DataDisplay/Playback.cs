using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.Components.DataDisplay;

/// <summary>
/// Speed-selector menu for trip replay (mirrors the web <c>PlaybackSpeedMenu</c>).
/// Lists the canonical <see cref="PlaybackSpeed.Speeds"/> multipliers and raises
/// <see cref="SpeedChanged"/> when the user picks one.
/// </summary>
public sealed partial class TsPlaybackSpeedMenu : ContentControl
{
    /// <summary>The selected speed multiplier.</summary>
    public static readonly DependencyProperty SpeedProperty = DependencyProperty.Register(
        nameof(Speed), typeof(int), typeof(TsPlaybackSpeedMenu), new PropertyMetadata(1, OnChanged));

    private readonly DropDownButton _button = new();

    /// <summary>Raised when the user selects a new speed.</summary>
    public event EventHandler<int>? SpeedChanged;

    /// <summary>Initialise the menu.</summary>
    public TsPlaybackSpeedMenu()
    {
        IsTabStop = false;
        BuildFlyout();
        Content = _button;
        Rebuild();
    }

    /// <summary>The selected speed.</summary>
    public int Speed
    {
        get => (int)GetValue(SpeedProperty);
        set => SetValue(SpeedProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPlaybackSpeedMenu)d).Rebuild();

    private void BuildFlyout()
    {
        var flyout = new MenuFlyout();
        foreach (int speed in PlaybackSpeed.Speeds)
        {
            int captured = speed;
            var item = new MenuFlyoutItem { Text = $"{captured}\u00d7" };
            item.Click += (_, _) =>
            {
                Speed = captured;
                SpeedChanged?.Invoke(this, captured);
            };
            flyout.Items.Add(item);
        }

        _button.Flyout = flyout;
    }

    private void Rebuild()
    {
        _button.Content = $"{Speed}\u00d7";
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, $"Playback speed {Speed} times");
    }
}

/// <summary>
/// Transport bar for trip replay (mirrors the web <c>PlaybackControls</c>): step-back,
/// play/pause, step-forward buttons plus an embedded <see cref="TsPlaybackSpeedMenu"/>.
/// State is driven by <see cref="IsPlaying"/> / <see cref="Speed"/>; user intent is
/// surfaced through the events.
/// </summary>
public sealed partial class TsPlaybackControls : ContentControl
{
    /// <summary>Whether playback is currently running.</summary>
    public static readonly DependencyProperty IsPlayingProperty = DependencyProperty.Register(
        nameof(IsPlaying), typeof(bool), typeof(TsPlaybackControls), new PropertyMetadata(false, OnChanged));

    /// <summary>The active speed multiplier.</summary>
    public static readonly DependencyProperty SpeedProperty = DependencyProperty.Register(
        nameof(Speed), typeof(int), typeof(TsPlaybackControls), new PropertyMetadata(1, OnChanged));

    private readonly Button _playPause = new();
    private readonly TsPlaybackSpeedMenu _speedMenu = new();

    /// <summary>Raised when the user toggles play/pause (carries the new IsPlaying state).</summary>
    public event EventHandler<bool>? PlayPauseToggled;

    /// <summary>Raised when the user requests stepping backward.</summary>
    public event EventHandler? StepBack;

    /// <summary>Raised when the user requests stepping forward.</summary>
    public event EventHandler? StepForward;

    /// <summary>Raised when the user changes the speed.</summary>
    public event EventHandler<int>? SpeedChanged;

    /// <summary>Initialise the transport bar.</summary>
    public TsPlaybackControls()
    {
        IsTabStop = false;
        BuildTree();
        Rebuild();
    }

    /// <summary>Whether playback is running.</summary>
    public bool IsPlaying
    {
        get => (bool)GetValue(IsPlayingProperty);
        set => SetValue(IsPlayingProperty, value);
    }

    /// <summary>The active speed.</summary>
    public int Speed
    {
        get => (int)GetValue(SpeedProperty);
        set => SetValue(SpeedProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsPlaybackControls)d).Rebuild();

    private void BuildTree()
    {
        var back = IconButton("\uE892");
        back.Click += (_, _) => StepBack?.Invoke(this, EventArgs.Empty);

        _playPause.Click += (_, _) =>
        {
            IsPlaying = !IsPlaying;
            PlayPauseToggled?.Invoke(this, IsPlaying);
        };

        var forward = IconButton("\uE893");
        forward.Click += (_, _) => StepForward?.Invoke(this, EventArgs.Empty);

        _speedMenu.SpeedChanged += (_, speed) =>
        {
            Speed = speed;
            SpeedChanged?.Invoke(this, speed);
        };

        var row = DisplayPrimitives.Row(8);
        row.Children.Add(back);
        row.Children.Add(_playPause);
        row.Children.Add(forward);
        row.Children.Add(_speedMenu);
        Content = row;
    }

    private static Button IconButton(string glyph) => new()
    {
        Content = new FontIcon { Glyph = glyph, FontSize = 14 },
        Padding = new Thickness(8),
    };

    private void Rebuild()
    {
        _playPause.Content = new FontIcon { Glyph = IsPlaying ? "\uE769" : "\uE768", FontSize = 14 };
        _speedMenu.Speed = Speed;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(_playPause, IsPlaying ? "Pause" : "Play");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(this, IsPlaying ? "Playing" : "Paused");
    }
}

/// <summary>
/// Scrubber for trip replay (mirrors the web <c>TimelineScrubber</c>): a slider over
/// the elapsed/total seconds with clock labels formatted by the C# behavior port.
/// Raises <see cref="PositionChanged"/> as the user drags.
/// </summary>
public sealed partial class TsTimelineScrubber : ContentControl
{
    /// <summary>Elapsed seconds (the slider position).</summary>
    public static readonly DependencyProperty ElapsedSecondsProperty = DependencyProperty.Register(
        nameof(ElapsedSeconds), typeof(double), typeof(TsTimelineScrubber), new PropertyMetadata(0.0, OnElapsedChanged));

    /// <summary>Total duration in seconds.</summary>
    public static readonly DependencyProperty TotalSecondsProperty = DependencyProperty.Register(
        nameof(TotalSeconds), typeof(double), typeof(TsTimelineScrubber), new PropertyMetadata(0.0, OnChanged));

    private readonly Slider _slider = new() { Minimum = 0, StepFrequency = 1 };
    private readonly TextBlock _elapsedLabel = DisplayPrimitives.Caption();
    private readonly TextBlock _totalLabel = DisplayPrimitives.Caption();
    private bool _suppress;

    /// <summary>Raised when the user scrubs to a new elapsed position (seconds).</summary>
    public event EventHandler<double>? PositionChanged;

    /// <summary>Initialise the scrubber.</summary>
    public TsTimelineScrubber()
    {
        IsTabStop = false;
        BuildTree();
        Rebuild();
    }

    /// <summary>The elapsed seconds.</summary>
    public double ElapsedSeconds
    {
        get => (double)GetValue(ElapsedSecondsProperty);
        set => SetValue(ElapsedSecondsProperty, value);
    }

    /// <summary>The total seconds.</summary>
    public double TotalSeconds
    {
        get => (double)GetValue(TotalSecondsProperty);
        set => SetValue(TotalSecondsProperty, value);
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTimelineScrubber)d).Rebuild();

    private static void OnElapsedChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTimelineScrubber)d).Rebuild();

    private void BuildTree()
    {
        _slider.ValueChanged += (_, e) =>
        {
            if (_suppress)
            {
                return;
            }

            ElapsedSeconds = e.NewValue;
            PositionChanged?.Invoke(this, e.NewValue);
        };

        var labels = new Grid();
        labels.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        labels.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_elapsedLabel, 0);
        Grid.SetColumn(_totalLabel, 1);
        labels.Children.Add(_elapsedLabel);
        labels.Children.Add(_totalLabel);

        var column = DisplayPrimitives.Column(2);
        column.Children.Add(_slider);
        column.Children.Add(labels);
        Content = column;
    }

    private void Rebuild()
    {
        double total = Math.Max(0, TotalSeconds);
        double elapsed = Math.Clamp(ElapsedSeconds, 0, total <= 0 ? double.MaxValue : total);

        _suppress = true;
        _slider.Maximum = total <= 0 ? 1 : total;
        _slider.Value = elapsed;
        _suppress = false;

        _elapsedLabel.Text = ScalarFormatters.FormatClock(elapsed);
        _totalLabel.Text = ScalarFormatters.FormatClock(total);
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(
            this, $"{_elapsedLabel.Text} of {_totalLabel.Text}");
    }
}
