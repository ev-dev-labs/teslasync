using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.DataDisplay;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.Core.Widgets;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 Gas-vs-Electric savings calculator — a parity port of
/// web/src/features/charging/components/cost-analysis/SavingsCalculator.tsx. It reproduces every web section:
/// the green-glow titled glass panel with the calculator glyph, the "Your Assumptions" column with the three
/// editable number fields (Gas Price, Gas Car MPG, Electricity Rate) and the "Reset Defaults" button, and the
/// "Comparison" column with the four readout cards (Gas Cost equivalent, EV Cost actual, Total Savings, Monthly
/// Savings) that recompute live as the assumptions change — or the "Not enough data for comparison" message
/// when there is nothing to compare. The web component is presentational (its parent <c>CostAnalysisPage</c>
/// owns the charging-sessions query); this self-contained surface additionally renders the query lifecycle as
/// explicit loading (skeleton chrome), whole-surface empty, stale (chip) / offline (chip) and hard-error
/// (QueryError + retry) branches — no surface is ever hidden. All data flows through the shared
/// <see cref="SavingsCalculatorViewModel"/>; the view never performs HTTP. Every string resolves through the
/// i18n facade, each field / card carries a Narrator name, and state changes are announced through a polite
/// live region. The surface adds no custom motion, so reduced-motion is honoured by construction.
/// </summary>
public sealed partial class SavingsCalculator : ContentControl, IDisposable
{
    private const double InputColumnMinWidth = 240;
    private const double CardValueFontSize = 22;
    private const double TitleFontSize = 14;
    private const double NoDataMinHeight = 128;

    private const string SuccessBrushKey = "TsColorSuccessBrush";
    private const string DangerBrushKey = "TsColorDangerBrush";
    private const string InfoBrushKey = "TsColorInfoBrush";

    private readonly SavingsCalculatorViewModel _viewModel;
    private readonly ILocalizer _localizer;
    private readonly SavingsCalculatorDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly TsGlassPanel _panel = new() { Glow = GlassGlow.Green };
    private readonly StackPanel _panelStack = new() { Spacing = 16 };
    private readonly Grid _headerRow = new();
    private readonly StackPanel _statusRow = new()
    {
        Orientation = Orientation.Horizontal,
        Spacing = 8,
        HorizontalAlignment = HorizontalAlignment.Right,
        VerticalAlignment = VerticalAlignment.Center,
    };
    private readonly TsDataFreshness _freshness = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly ContentControl _bodyHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly ContentControl _comparisonHost = new() { HorizontalContentAlignment = HorizontalAlignment.Stretch };
    private readonly Caption _statusLine = new();

    private readonly TsInput _gasPriceInput = NumberField();
    private readonly TsInput _mpgInput = NumberField();
    private readonly TsInput _elecRateInput = NumberField();
    private readonly TsButton _resetButton = new()
    {
        Variant = ButtonVariant.Secondary,
        HorizontalAlignment = HorizontalAlignment.Stretch,
        Margin = new Thickness(0, 4, 0, 0),
    };

    private readonly TsQueryError _queryError = new();
    private Grid? _contentGrid;
    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _suppressInput;

    /// <summary>Creates the surface over its data source, localizer, diagnostics, distance unit and currency.</summary>
    /// <param name="source">The cache-then-network data port (P1/S8 state-holder seam).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    /// <param name="distanceUnit">The display distance unit (web <c>unitPrefs.distance</c>; default miles).</param>
    /// <param name="currencySymbol">The currency symbol (web hardcodes "$"; default "$").</param>
    public SavingsCalculator(
        ISavingsCalculatorSource source,
        ILocalizer localizer,
        SavingsCalculatorDiagnostics? diagnostics = null,
        DistanceUnit distanceUnit = DistanceUnit.Mi,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _diagnostics = diagnostics ?? new SavingsCalculatorDiagnostics();
        _viewModel = new SavingsCalculatorViewModel(source, localizer, distanceUnit, currencySymbol);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        _queryError.ActionInvoked += OnRetryInvoked;
        _resetButton.Click += OnResetClick;
        _gasPriceInput.TextChanged += OnGasPriceChanged;
        _mpgInput.TextChanged += OnMpgChanged;
        _elecRateInput.TextChanged += OnElectricityRateChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The canonical surface id (<c>savings-calculator</c>).</summary>
    public static string SurfaceId => SavingsCalculatorRegistration.Id;

    /// <summary>The diagnostics surface slug this view registers under (<c>SavingsCalculator</c>).</summary>
    public static string Slug => SavingsCalculatorRegistration.Slug;

    /// <summary>The backing state holder (exposed for hosting / diagnostics).</summary>
    public SavingsCalculatorViewModel ViewModel => _viewModel;

    /// <summary>
    /// Convenience factory that wires the repository-backed <see cref="SavingsCalculatorSource"/> from the
    /// shared data layer (the host's P2-core dependencies).
    /// </summary>
    public static SavingsCalculator Create(
        IWidgetVehicleSource vehicles,
        IApiClient api,
        CacheThenNetworkEngine engine,
        ApiClientOptions options,
        ILocalizer localizer,
        SavingsCalculatorDiagnostics? diagnostics = null,
        DistanceUnit distanceUnit = DistanceUnit.Mi,
        string? currencySymbol = null,
        long? vehicleId = null)
    {
        var source = new SavingsCalculatorSource(vehicles, api, engine, options, vehicleId);
        return new SavingsCalculator(source, localizer, diagnostics, distanceUnit, currencySymbol);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _queryError.ActionInvoked -= OnRetryInvoked;
        _resetButton.Click -= OnResetClick;
        _gasPriceInput.TextChanged -= OnGasPriceChanged;
        _mpgInput.TextChanged -= OnMpgChanged;
        _elecRateInput.TextChanged -= OnElectricityRateChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
        _viewModel.Dispose();
        GC.SuppressFinalize(this);
    }

    private void BuildChrome()
    {
        _headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _headerRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var title = BuildTitle();
        Grid.SetColumn(title, 0);
        Grid.SetColumn(_statusRow, 1);
        _headerRow.Children.Add(title);
        _headerRow.Children.Add(_statusRow);

        _statusLine.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_statusLine);

        _panelStack.Children.Add(_headerRow);
        _panelStack.Children.Add(_bodyHost);
        _panelStack.Children.Add(_statusLine);
        _panel.Content = _panelStack;
        Content = _panel;
    }

    private StackPanel BuildTitle()
    {
        var row = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var icon = new FontIcon
        {
            Glyph = SavingsCalculatorRegistration.TitleGlyph,
            FontSize = 16,
            Foreground = DisplayTokens.Brush(SuccessBrushKey),
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(icon, AccessibilityView.Raw);

        var text = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = TitleFontSize,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
        };

        row.Children.Add(icon);
        row.Children.Add(text);
        return row;
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

    private void OnRetryInvoked(object? sender, EventArgs e) => _ = _viewModel.RetryAsync();

    private void OnResetClick(object sender, RoutedEventArgs e)
    {
        _viewModel.ResetInputs();
        SeedInputs();
    }

    private void OnGasPriceChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressInput)
        {
            return;
        }

        _viewModel.GasPrice = SavingsCalculatorInputs.ParseGasPrice(_gasPriceInput.Text);
    }

    private void OnMpgChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressInput)
        {
            return;
        }

        _viewModel.Mpg = SavingsCalculatorInputs.ParseMpg(_mpgInput.Text);
    }

    private void OnElectricityRateChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressInput)
        {
            return;
        }

        _viewModel.ElectricityRate = SavingsCalculatorInputs.ParseElectricityRate(_elecRateInput.Text);
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
        BuildStatusRow();

        _bodyHost.Content = _viewModel.State switch
        {
            SavingsCalculatorState.Loading => BuildLoading(),
            SavingsCalculatorState.Error => BuildError(),
            SavingsCalculatorState.Empty => BuildEmpty(),
            _ => BuildContent(),
        };

        UpdateStatusLine();
        AutomationProperties.SetName(this, _viewModel.Title);
    }

    // ── Status row: stale / offline chip + freshness ─────────────────────────────────────────────────

    private void BuildStatusRow()
    {
        _statusRow.Children.Clear();

        switch (_viewModel.State)
        {
            case SavingsCalculatorState.Stale:
                _statusRow.Children.Add(BuildBadge(_viewModel.StaleLabel, StatusKind.Warning));
                break;
            case SavingsCalculatorState.Offline:
                _statusRow.Children.Add(BuildBadge(_viewModel.OfflineLabel, StatusKind.Danger));
                break;
            default:
                break;
        }

        _freshness.UpdatedAt = _viewModel.UpdatedAt;
        _freshness.IsFetching = _viewModel.IsFetching;
        _freshness.IsError = _viewModel.IsError;
        _statusRow.Children.Add(_freshness);
    }

    private static TsBadge BuildBadge(string text, StatusKind status)
    {
        var badge = new TsBadge
        {
            Status = status,
            Content = new TextBlock { Text = text, FontSize = 12 },
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(badge, text);
        return badge;
    }

    private void UpdateStatusLine()
    {
        string? message = _viewModel.StatusAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _statusLine.Visibility = Visibility.Collapsed;
            return;
        }

        _statusLine.Value = message;
        _statusLine.Visibility = Visibility.Visible;
        LiveRegion.Announce(_statusLine);
    }

    // ── Loaded content: assumptions column + comparison column ───────────────────────────────────────

    private Grid BuildContent()
    {
        var grid = _contentGrid ??= BuildContentGrid();
        UpdateComparison();
        return grid;
    }

    private Grid BuildContentGrid()
    {
        var grid = new Grid { ColumnSpacing = 24, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var inputs = BuildInputsColumn();
        Grid.SetColumn(inputs, 0);

        var comparison = BuildComparisonColumn();
        Grid.SetColumn(comparison, 1);

        grid.Children.Add(inputs);
        grid.Children.Add(comparison);
        return grid;
    }

    private StackPanel BuildInputsColumn()
    {
        var display = _viewModel.Display;
        var column = new StackPanel { Spacing = 12, MinWidth = InputColumnMinWidth };

        column.Children.Add(new Caption { Value = display.InputsLabel });
        column.Children.Add(BuildField(_gasPriceInput, display.GasPriceLabel, display.GasPriceUnit));
        column.Children.Add(BuildField(_mpgInput, display.MpgLabel, display.MpgUnit));
        column.Children.Add(BuildField(_elecRateInput, display.ElectricityRateLabel, display.ElectricityRateUnit));

        _resetButton.Text = display.ResetLabel;
        AutomationProperties.SetName(_resetButton, display.ResetLabel);
        column.Children.Add(_resetButton);

        SeedInputs();
        return column;
    }

    private static StackPanel BuildField(TsInput input, string label, string unit)
    {
        AutomationProperties.SetName(input, label);

        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            Margin = new Thickness(0, 0, 0, 4),
        };

        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        Grid.SetColumn(input, 0);

        var suffix = new Caption
        {
            Value = unit,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(suffix, AccessibilityView.Raw);
        Grid.SetColumn(suffix, 1);

        row.Children.Add(input);
        row.Children.Add(suffix);

        var field = new StackPanel { Spacing = 2 };
        field.Children.Add(labelText);
        field.Children.Add(row);
        return field;
    }

    private StackPanel BuildComparisonColumn()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new Caption { Value = _viewModel.Display.ComparisonLabel });
        column.Children.Add(_comparisonHost);
        return column;
    }

    private void UpdateComparison()
    {
        var display = _viewModel.Display;
        AutomationProperties.SetName(_comparisonHost, display.ComparisonAutomationName);
        _comparisonHost.Content = display.HasComparison ? BuildComparisonGrid(display) : BuildNoData(display);
    }

    private static Grid BuildComparisonGrid(SavingsCalculatorDisplay display)
    {
        var grid = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });

        AddCard(grid, 0, 0, display.GasCostLabel, display.GasCostValueText, display.GasCostPerDistanceText,
            DangerBrushKey, GlassGlow.None, display.GasCostAutomationName);
        AddCard(grid, 0, 1, display.EvCostLabel, display.EvCostValueText, display.EvCostPerDistanceText,
            InfoBrushKey, GlassGlow.None, display.EvCostAutomationName);
        AddCard(grid, 1, 0, display.TotalSavingsLabel, display.TotalSavingsValueText, display.OverPeriodLabel,
            SuccessBrushKey, GlassGlow.Green, display.TotalSavingsAutomationName);
        AddCard(grid, 1, 1, display.MonthlySavingsLabel, display.MonthlySavingsValueText, display.YearlySavingsText,
            SuccessBrushKey, GlassGlow.None, display.MonthlySavingsAutomationName);

        return grid;
    }

    private static void AddCard(
        Grid grid,
        int row,
        int column,
        string label,
        string value,
        string subLabel,
        string accentBrushKey,
        GlassGlow glow,
        string automationName)
    {
        var stack = new StackPanel { Spacing = 4 };
        stack.Children.Add(new Caption { Value = label });
        stack.Children.Add(new TextBlock
        {
            Text = value,
            FontSize = CardValueFontSize,
            FontWeight = FontWeights.Bold,
            Foreground = DisplayTokens.Brush(accentBrushKey),
            TextWrapping = TextWrapping.NoWrap,
        });
        stack.Children.Add(new Caption { Value = subLabel });

        var card = new TsGlassPanel
        {
            Glow = glow,
            Padding = new Thickness(12),
            Content = stack,
        };
        AutomationProperties.SetName(card, automationName);
        Grid.SetRow(card, row);
        Grid.SetColumn(card, column);
        grid.Children.Add(card);
    }

    private static Border BuildNoData(SavingsCalculatorDisplay display)
    {
        var text = new Caption
        {
            Value = display.NoDataMessage,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };

        var host = new Border
        {
            MinHeight = NoDataMinHeight,
            Child = text,
        };
        AutomationProperties.SetName(host, display.NoDataMessage);
        return host;
    }

    private void SeedInputs()
    {
        _suppressInput = true;
        _gasPriceInput.Text = FormatInput(_viewModel.GasPrice);
        _mpgInput.Text = FormatInput(_viewModel.Mpg);
        _elecRateInput.Text = FormatInput(_viewModel.ElectricityRate);
        _suppressInput = false;
    }

    // ── Empty / Loading / Error surfaces ─────────────────────────────────────────────────────────────

    private TsEmptyState BuildEmpty() => new()
    {
        Title = _viewModel.EmptyTitle,
        Message = _viewModel.EmptyMessage,
        HorizontalAlignment = HorizontalAlignment.Stretch,
    };

    private StackPanel BuildLoading()
    {
        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(new TsSkeleton { BlockHeight = 16, BlockWidth = 160 });

        var grid = new Grid { ColumnSpacing = 24 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var inputs = new StackPanel { Spacing = 12, MinWidth = InputColumnMinWidth };
        inputs.Children.Add(new TsSkeleton { BlockHeight = 48 });
        inputs.Children.Add(new TsSkeleton { BlockHeight = 48 });
        inputs.Children.Add(new TsSkeleton { BlockHeight = 48 });
        inputs.Children.Add(new TsSkeleton { BlockHeight = 36 });
        Grid.SetColumn(inputs, 0);

        var cards = new Grid { ColumnSpacing = 12, RowSpacing = 12 };
        cards.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cards.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        cards.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        cards.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (int i = 0; i < 4; i++)
        {
            var block = new TsSkeleton { BlockHeight = 72 };
            Grid.SetRow(block, i / 2);
            Grid.SetColumn(block, i % 2);
            cards.Children.Add(block);
        }

        Grid.SetColumn(cards, 1);
        grid.Children.Add(inputs);
        grid.Children.Add(cards);
        column.Children.Add(grid);

        AutomationProperties.SetName(column, _viewModel.LoadingLabel);
        return column;
    }

    private TsQueryError BuildError()
    {
        _queryError.Title = _viewModel.ErrorTitle;
        _queryError.Message = _viewModel.ErrorMessage ?? _viewModel.ErrorTitle;
        _queryError.ActionText = _viewModel.RetryLabel;
        _queryError.AttemptCount = _viewModel.Attempts;
        return _queryError;
    }

    private static TsInput NumberField()
    {
        var input = new TsInput { HorizontalAlignment = HorizontalAlignment.Stretch };
        var scope = new InputScope();
        scope.Names.Add(new InputScopeName(InputScopeNameValue.Number));
        input.InputScope = scope;
        return input;
    }

    private static string FormatInput(double value) =>
        value.ToString(System.Globalization.CultureInfo.InvariantCulture);

    protected override AutomationPeer OnCreateAutomationPeer() => new SavingsCalculatorAutomationPeer(this);

    private sealed class SavingsCalculatorAutomationPeer(SavingsCalculator owner)
        : FrameworkElementAutomationPeer(owner)
    {
        protected override AutomationControlType GetAutomationControlTypeCore() => AutomationControlType.Group;

        protected override string GetNameCore()
        {
            string name = base.GetNameCore();
            return string.IsNullOrEmpty(name)
                ? ((SavingsCalculator)Owner).ViewModel.Title
                : name;
        }
    }
}
