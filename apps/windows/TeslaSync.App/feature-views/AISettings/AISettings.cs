using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Behavior;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Helix (AI) settings surface — a parity port of
/// web/src/features/settings/components/AISettings.tsx. It composes the web's single <c>GlassPanel</c>: a
/// header (the Helix mark, title and subtitle), the opt-in mode radiogroup (off / local-only / cloud, each
/// with a description, plus the off-mode banner), the inline cost-cap spend bar shown only in cloud mode with
/// a non-zero cap (today's spend / cap, a tone-banded bar and a warn/critical hint), and the Save action.
/// Every state renders — a loading affordance, the populated form, an explicit retry surface on hard failure,
/// plus stale and offline freshness chips. All data and the ADR-015 save patch flow through the shared
/// <see cref="AiSettingsViewModel"/>; the view never performs HTTP. Every string resolves through the i18n
/// facade and every interactive element carries a Narrator name. The provider, feature-toggle and restore
/// child surfaces are composed by their own prompts (W-0199 / W-0200 / W-0201) and bind to the same holder.
/// </summary>
public sealed partial class AISettings : ContentControl, IDisposable
{
    private const string HelixGlyph = "\uEA80"; // Segoe Fluent — Lightbulb (decorative Helix mark)

    private readonly AiSettingsViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly AiSettingsDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new() { Spacing = 16 };

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;

    /// <summary>Creates the surface over its data source, localizer and diagnostics.</summary>
    public AISettings(
        IAiSettingsSource source,
        ILocalizer localizer,
        AiSettingsDiagnostics? diagnostics = null,
        Func<DateTimeOffset>? clock = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new AiSettingsDiagnostics();
        _viewModel = new AiSettingsViewModel(source, localizer, clock);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;
        AutomationProperties.SetName(this, AiSettingsRegistration.Title(localizer));

        Content = _root;

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>ai-settings-panel</c>).</summary>
    public static string SurfaceId => AiSettingsRegistration.Id;

    /// <summary>The backing state holder (exposed for hosting/diagnostics).</summary>
    public AiSettingsViewModel ViewModel => _viewModel;

    /// <summary>Convenience factory that wires the repository-backed <see cref="AiSettingsSource"/> from the shared data layer.</summary>
    public static AISettings Create(
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        AiSettingsDiagnostics? diagnostics = null)
    {
        var source = new AiSettingsSource(api, engine, options);
        return new AISettings(source, localizer, diagnostics);
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
        _ = _viewModel.LoadAsync();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and cancel any in-flight load (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnViewModelPropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ScheduleRender();

    private void ScheduleRender()
    {
        if (_renderQueued)
        {
            return;
        }

        _renderQueued = true;
        if (_dispatcher is { } dispatcher)
        {
            dispatcher.TryEnqueue(RenderCoalesced);
        }
        else
        {
            RenderCoalesced();
        }
    }

    private void RenderCoalesced()
    {
        _renderQueued = false;
        Render();
    }

    private void Render()
    {
        _root.Children.Clear();
        _root.Children.Add(BuildPanel());
    }

    private TsGlassPanel BuildPanel()
    {
        var column = new StackPanel { Spacing = 20 };
        column.Children.Add(BuildHeader());
        column.Children.Add(BuildBody());

        return new TsGlassPanel
        {
            Padding = new Thickness(20),
            Content = column,
        };
    }

    // ── Header ───────────────────────────────────────────────────────────────────────────────────────

    private Grid BuildHeader()
    {
        var mark = new FontIcon
        {
            Glyph = HelixGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Accent,
            VerticalAlignment = VerticalAlignment.Top,
        };
        AutomationProperties.SetAccessibilityView(mark, AccessibilityView.Raw);

        var titleColumn = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Top };
        titleColumn.Children.Add(new PanelTitle { Value = _viewModel.Title });
        titleColumn.Children.Add(new Subhead
        {
            Value = _viewModel.Subtitle,
            MaxWidth = 680,
            HorizontalAlignment = HorizontalAlignment.Left,
        });

        var lead = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        lead.Children.Add(mark);
        lead.Children.Add(titleColumn);

        var freshness = new TsDataFreshness
        {
            UpdatedAt = _viewModel.UpdatedAt,
            IsFetching = _viewModel.IsFetching,
            IsError = _viewModel.IsError,
            VerticalAlignment = VerticalAlignment.Top,
        };

        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(lead, 0);
        Grid.SetColumn(freshness, 1);
        grid.Children.Add(lead);
        grid.Children.Add(freshness);
        return grid;
    }

    // ── Body (state switch) ──────────────────────────────────────────────────────────────────────────

    private FrameworkElement BuildBody() => _viewModel.State switch
    {
        AiSettingsPanelState.Loading => BuildLoading(),
        AiSettingsPanelState.Error => BuildError(),
        _ => BuildForm(),
    };

    private StackPanel BuildForm()
    {
        var column = new StackPanel { Spacing = 16 };
        column.Children.Add(BuildModePicker());

        if (_viewModel.Mode == AiMode.Off)
        {
            column.Children.Add(new HelperText { Value = _viewModel.BannerOff });
        }

        if (_viewModel.CostCapVisible)
        {
            column.Children.Add(BuildCostCapBar(_viewModel.CostCapDisplay));
        }

        column.Children.Add(BuildSaveRow());
        return column;
    }

    private StackPanel BuildModePicker()
    {
        var stack = new StackPanel { Spacing = 8 };
        stack.Children.Add(new Caption { Value = _viewModel.ModeLegend });

        var group = new RadioButtons { MaxColumns = 1 };
        AutomationProperties.SetName(group, _viewModel.ModeLegend);
        group.Items.Add(BuildModeRadio(_viewModel.ModeOffLabel, _viewModel.ModeOffHint));
        group.Items.Add(BuildModeRadio(_viewModel.ModeLocalLabel, _viewModel.ModeLocalHint));
        group.Items.Add(BuildModeRadio(_viewModel.ModeCloudLabel, _viewModel.ModeCloudHint));
        group.SelectedIndex = (int)_viewModel.Mode;
        group.SelectionChanged += OnModeSelectionChanged;

        stack.Children.Add(group);
        return stack;
    }

    private static RadioButton BuildModeRadio(string label, string description)
    {
        var content = new StackPanel { Spacing = 2 };
        content.Children.Add(new TextBlock
        {
            Text = label,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        });
        content.Children.Add(new TextBlock
        {
            Text = description,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            TextWrapping = TextWrapping.Wrap,
        });

        var radio = new RadioButton { Content = content };
        AutomationProperties.SetName(radio, label);
        return radio;
    }

    private void OnModeSelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is RadioButtons group && group.SelectedIndex >= 0)
        {
            _viewModel.SetMode((AiMode)group.SelectedIndex);
        }
    }

    private static StackPanel BuildCostCapBar(AiCostCapDisplay display)
    {
        var stack = new StackPanel { Spacing = 8 };

        var headerRow = new Grid { ColumnSpacing = 8 };
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = new Caption { Value = display.TodayTitle };
        Grid.SetColumn(title, 0);

        var amount = new TextBlock
        {
            Text = display.AmountText,
            FontSize = 12,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.Brush(display.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Right,
            VerticalAlignment = VerticalAlignment.Center,
        };
        Grid.SetColumn(amount, 1);

        headerRow.Children.Add(title);
        headerRow.Children.Add(amount);
        stack.Children.Add(headerRow);

        var bar = new TsMetricBar
        {
            Value = display.TodayDollars,
            Max = display.CapDollars > 0 ? display.CapDollars : 1,
            Label = display.TodayTitle,
            ValueText = display.AmountText,
            AccentBrushKey = display.AccentBrushKey,
        };
        AutomationProperties.SetName(bar, display.AutomationName);
        stack.Children.Add(bar);

        if (display.Hint is { } hint)
        {
            stack.Children.Add(new HelperText { Value = hint });
        }

        return stack;
    }

    private StackPanel BuildSaveRow()
    {
        var column = new StackPanel { Spacing = 8 };

        if (_viewModel.SaveError is { } error)
        {
            var banner = new ErrorText { Value = error };
            LiveRegion.Configure(banner, assertive: true);
            column.Children.Add(banner);
        }

        var save = new TsButton
        {
            Variant = ButtonVariant.Primary,
            Text = _viewModel.SaveButtonLabel,
            IsLoading = _viewModel.IsSaving,
            IsEnabled = _viewModel.CanSave,
            HorizontalAlignment = HorizontalAlignment.Right,
        };
        AutomationProperties.SetName(save, _viewModel.SaveButtonLabel);
        save.Click += OnSave;
        column.Children.Add(save);
        return column;
    }

    private void OnSave(object sender, RoutedEventArgs e) => _ = _viewModel.SaveAsync();

    private void OnRetry(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private StackPanel BuildLoading()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            Padding = new Thickness(0, 8, 0, 8),
            VerticalAlignment = VerticalAlignment.Center,
        };
        row.Children.Add(new TsSpinner { Size = ControlSize.Small, VerticalAlignment = VerticalAlignment.Center });
        row.Children.Add(new Text
        {
            Value = _viewModel.LoadingLabel,
            Foreground = DisplayTokens.TextSecondary,
            VerticalAlignment = VerticalAlignment.Center,
        });

        AutomationProperties.SetName(row, _viewModel.LoadingLabel);
        LiveRegion.Configure(row);
        LiveRegion.Announce(row);
        return row;
    }

    private TsQueryError BuildError()
    {
        var error = new TsQueryError
        {
            Message = _viewModel.ErrorMessage ?? _viewModel.ErrorMessageDefault,
            ActionText = _viewModel.RetryLabel,
            AttemptCount = _viewModel.Attempts,
            VerticalAlignment = VerticalAlignment.Center,
        };
        error.ActionInvoked += OnRetry;
        return error;
    }
}
