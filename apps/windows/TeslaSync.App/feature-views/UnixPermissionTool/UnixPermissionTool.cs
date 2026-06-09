using Microsoft.UI.Dispatching;
using Microsoft.UI.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using Windows.UI;
using DisplayTokens = TeslaSync.App.Components.DataDisplay.DisplayTokens;
using LiveRegion = TeslaSync.App.Components.Feedback.LiveRegion;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The native WinUI 3 UnixPermissionTool surface — a parity port of
/// web/src/features/admin/components/devtools/tools/UnixPermissionTool.tsx. It mirrors the web
/// <c>ToolCard</c> (a <see cref="TsGlassPanel"/> with a green-tinted <c>Lock</c> header glyph, title and
/// description) wrapping the tool body: a two-up row of a <see cref="TsInput"/> octal field (example
/// value "755", web <c>Input</c>) and a <see cref="TsSelect"/> preset picker over the six common modes
/// (web <c>Select</c>), beneath which — once the value is a valid three-digit octal (web
/// <c>{symbolic &amp;&amp; (…)}</c>) — the owner / group / other breakdown grid renders (each triad tinted
/// with its semantic token: owner=success, group=info, other=warning, matching the web
/// emerald/cyan/amber text) above a copyable symbolic-string row (web <c>&lt;code&gt;</c> +
/// <c>CopyButton</c>). Before a valid octal is entered the same region shows a friendly empty hint rather
/// than a blank box. All state and the octal→symbolic math flow through the shared
/// <see cref="UnixPermissionToolViewModel"/> + the pure <see cref="UnixPermissionProjection"/> adapter; the
/// view never computes inline. Every string resolves through the i18n facade, every interactive element
/// carries a Narrator name, and each settled breakdown is announced through a polite live region. The
/// surface uses no animation, so the reduced-motion contract is satisfied by construction. The web field's
/// inline decorative <c>Lock</c> icon is not reproduced inside the field — the shared <see cref="TsInput"/>
/// primitive (owned by the component-library bundle) has no icon slot, and the same <c>Lock</c> semantic is
/// already carried by the header glyph — so it is intentionally omitted rather than faked.
/// </summary>
public sealed partial class UnixPermissionTool : ContentControl, IDisposable
{
    private const byte ChipFillAlpha = 31;    // ~12% — the web bg-neon-green/10 icon-chip wash
    private const byte ChipBorderAlpha = 64;  // ~25% — the web ring-neon-green/20 icon-chip ring

    private readonly UnixPermissionToolViewModel _viewModel;
    private readonly UnixPermissionToolDiagnostics _diagnostics;
    private readonly DispatcherQueue? _dispatcher;

    private readonly StackPanel _root = new();
    private readonly TsInput _octalInput = new();
    private readonly TsSelect _presetSelect = new();
    private readonly Border _resultHost = new();
    private readonly TextBlock _announcer = new();

    private bool _started;
    private bool _renderQueued;
    private bool _disposed;
    private bool _syncing;
    private string? _announced;

    /// <summary>Creates the surface over its localizer and optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade resolving every label (web <c>useTranslation</c>).</param>
    /// <param name="diagnostics">Optional PII-safe diagnostics collector for the <c>view.opened</c> event.</param>
    public UnixPermissionTool(ILocalizer localizer, UnixPermissionToolDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _diagnostics = diagnostics ?? new UnixPermissionToolDiagnostics();
        _viewModel = new UnixPermissionToolViewModel(localizer);
        _dispatcher = DispatcherQueue.GetForCurrentThread();

        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        VerticalContentAlignment = VerticalAlignment.Stretch;

        BuildChrome();
        AutomationProperties.SetName(this, _viewModel.Title);

        _viewModel.PropertyChanged += OnViewModelPropertyChanged;
        Loaded += OnLoaded;
        Unloaded += OnUnloaded;
        Render();
    }

    /// <summary>The diagnostics surface slug this view registers under (<c>UnixPermissionTool</c>).</summary>
    public static string Slug => UnixPermissionToolRegistration.Slug;

    private void BuildChrome()
    {
        var panel = new TsGlassPanel();

        _root.Orientation = Orientation.Vertical;
        _root.Spacing = 12;
        _root.Padding = new Thickness(20);

        _root.Children.Add(BuildHeader());
        _root.Children.Add(BuildInputs());

        _resultHost.MinHeight = 64;
        _root.Children.Add(_resultHost);

        _announcer.FontSize = 11;
        _announcer.Foreground = DisplayTokens.TextMuted;
        _announcer.TextWrapping = TextWrapping.Wrap;
        _announcer.Visibility = Visibility.Collapsed;
        LiveRegion.Configure(_announcer);
        _root.Children.Add(_announcer);

        panel.Content = _root;
        Content = panel;
    }

    private StackPanel BuildHeader()
    {
        var iconHost = new Border
        {
            Width = 40,
            Height = 40,
            CornerRadius = DisplayTokens.Radius("TsRadiusMd", 10),
            Background = Tinted(UnixPermissionToolRegistration.AccentColorKey, ChipFillAlpha),
            BorderBrush = Tinted(UnixPermissionToolRegistration.AccentColorKey, ChipBorderAlpha),
            BorderThickness = new Thickness(1),
            VerticalAlignment = VerticalAlignment.Top,
        };
        var glyph = new FontIcon
        {
            Glyph = UnixPermissionToolRegistration.IconGlyph,
            FontSize = 20,
            Foreground = DisplayTokens.Brush(UnixPermissionToolRegistration.AccentBrushKey),
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetAccessibilityView(glyph, AccessibilityView.Raw);
        iconHost.Child = glyph;

        var titleText = new TextBlock
        {
            Text = _viewModel.Title,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Foreground = DisplayTokens.TextPrimary,
            TextWrapping = TextWrapping.Wrap,
        };
        var descriptionText = new TextBlock
        {
            Text = _viewModel.Description,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            TextWrapping = TextWrapping.Wrap,
        };

        var textColumn = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        textColumn.Children.Add(titleText);
        textColumn.Children.Add(descriptionText);

        var header = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 12,
            HorizontalAlignment = HorizontalAlignment.Stretch,
        };
        header.Children.Add(iconHost);
        header.Children.Add(textColumn);
        return header;
    }

    private Grid BuildInputs()
    {
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        _octalInput.Header = _viewModel.OctalLabel;
        _octalInput.Hint = _viewModel.OctalHint;
        _octalInput.Text = _viewModel.Octal;
        AutomationProperties.SetName(_octalInput, _viewModel.OctalAccessibleName);
        _octalInput.TextChanged += OnOctalChanged;
        Grid.SetColumn(_octalInput, 0);
        grid.Children.Add(_octalInput);

        _presetSelect.Header = _viewModel.PresetsLabel;
        _presetSelect.HorizontalAlignment = HorizontalAlignment.Stretch;
        _presetSelect.ItemsSource = _viewModel.Presets;
        _presetSelect.DisplayMemberPath = nameof(PermissionPreset.Label);
        _presetSelect.SelectedItem = _viewModel.SelectedPreset;
        AutomationProperties.SetName(_presetSelect, _viewModel.PresetsAccessibleName);
        _presetSelect.SelectionChanged += OnPresetChanged;
        Grid.SetColumn(_presetSelect, 1);
        grid.Children.Add(_presetSelect);

        return grid;
    }

    private void OnOctalChanged(object sender, TextChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        _viewModel.Octal = _octalInput.Text;
    }

    private void OnPresetChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_syncing)
        {
            return;
        }

        if (_presetSelect.SelectedItem is PermissionPreset preset)
        {
            _viewModel.Octal = preset.Value;
        }
    }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_started)
        {
            return;
        }

        _started = true;
        _diagnostics.RecordViewOpened();
    }

    private void OnUnloaded(object sender, RoutedEventArgs e) => Dispose();

    /// <summary>Detach from the view-model and input handlers (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _viewModel.PropertyChanged -= OnViewModelPropertyChanged;
        _octalInput.TextChanged -= OnOctalChanged;
        _presetSelect.SelectionChanged -= OnPresetChanged;
        Loaded -= OnLoaded;
        Unloaded -= OnUnloaded;
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
        SyncInputs();

        _resultHost.Child = _viewModel.HasBreakdown ? BuildResolved() : BuildEmpty();

        UpdateAnnouncer();
    }

    private void SyncInputs()
    {
        _syncing = true;
        try
        {
            if (!string.Equals(_octalInput.Text, _viewModel.Octal, StringComparison.Ordinal))
            {
                _octalInput.Text = _viewModel.Octal;
            }

            _octalInput.HasError = _viewModel.IsInvalidInput;

            PermissionPreset? desired = _viewModel.SelectedPreset;
            if (!ReferenceEquals(_presetSelect.SelectedItem, desired))
            {
                _presetSelect.SelectedItem = desired;
            }
        }
        finally
        {
            _syncing = false;
        }
    }

    private StackPanel BuildResolved()
    {
        var column = new StackPanel { Spacing = 8 };
        column.Children.Add(BuildBreakdownGrid());
        column.Children.Add(BuildSymbolicRow());
        return column;
    }

    private Grid BuildBreakdownGrid()
    {
        PermissionBreakdown breakdown = _viewModel.Breakdown!;

        var grid = new Grid { ColumnSpacing = 8 };
        for (int i = 0; i < 3; i++)
        {
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        }

        Border owner = BuildCell(_viewModel.OwnerLabel, breakdown.Owner, DisplayTokens.Brush("TsColorSuccessBrush"));
        Border group = BuildCell(_viewModel.GroupLabel, breakdown.Group, DisplayTokens.Brush("TsColorInfoBrush"));
        Border other = BuildCell(_viewModel.OtherLabel, breakdown.Other, DisplayTokens.Brush("TsColorWarningBrush"));

        Grid.SetColumn(owner, 0);
        Grid.SetColumn(group, 1);
        Grid.SetColumn(other, 2);
        grid.Children.Add(owner);
        grid.Children.Add(group);
        grid.Children.Add(other);

        AutomationProperties.SetName(grid, _viewModel.ResultAnnouncement ?? _viewModel.Title);
        return grid;
    }

    private static Border BuildCell(string label, string value, Brush valueBrush)
    {
        var labelText = new TextBlock
        {
            Text = label,
            FontSize = 12,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        var valueText = new TextBlock
        {
            Text = value,
            FontSize = 14,
            FontFamily = MonoFont(),
            Foreground = valueBrush,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            IsTextSelectionEnabled = true,
        };

        var column = new StackPanel { Spacing = 2, HorizontalAlignment = HorizontalAlignment.Stretch };
        column.Children.Add(labelText);
        column.Children.Add(valueText);

        var cell = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Padding = new Thickness(12, 8, 12, 8),
            Background = DisplayTokens.Surface,
            Child = column,
        };
        AutomationProperties.SetName(cell, $"{label}: {value}");
        return cell;
    }

    private Border BuildSymbolicRow()
    {
        string symbolic = _viewModel.Symbolic;

        var code = new TextBlock
        {
            Text = symbolic,
            FontSize = 14,
            FontFamily = MonoFont(),
            Foreground = DisplayTokens.TextPrimary,
            VerticalAlignment = VerticalAlignment.Center,
            IsTextSelectionEnabled = true,
        };

        var copy = new TsCopyButton
        {
            ValueToCopy = symbolic,
            CopyLabel = _viewModel.CopyLabel,
            CopiedLabel = _viewModel.CopiedLabel,
            Size = ControlSize.Small,
            VerticalAlignment = VerticalAlignment.Center,
        };
        AutomationProperties.SetName(copy, $"{_viewModel.CopyAccessibleName} {symbolic}");

        var row = new Grid { ColumnSpacing = 8, Padding = new Thickness(12, 8, 12, 8) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(code, 0);
        Grid.SetColumn(copy, 1);
        row.Children.Add(code);
        row.Children.Add(copy);

        var host = new Border
        {
            CornerRadius = DisplayTokens.Radius("TsRadiusSm", 6),
            Background = DisplayTokens.Surface,
            Child = row,
        };
        AutomationProperties.SetName(host, symbolic);
        return host;
    }

    private Border BuildEmpty()
    {
        var title = new TextBlock
        {
            Text = _viewModel.EmptyTitle,
            FontSize = 13,
            FontWeight = FontWeights.Medium,
            Foreground = DisplayTokens.TextSecondary,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };
        var message = new TextBlock
        {
            Text = _viewModel.EmptyMessage,
            FontSize = 12,
            Foreground = DisplayTokens.TextMuted,
            HorizontalAlignment = HorizontalAlignment.Center,
            TextAlignment = TextAlignment.Center,
            TextWrapping = TextWrapping.Wrap,
        };

        var column = new StackPanel
        {
            Spacing = 4,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
        };
        column.Children.Add(title);
        column.Children.Add(message);

        var host = new Border { Padding = new Thickness(12, 8, 12, 8), Child = column };
        AutomationProperties.SetName(host, $"{_viewModel.EmptyTitle}. {_viewModel.EmptyMessage}");
        return host;
    }

    private void UpdateAnnouncer()
    {
        string? message = _viewModel.ResultAnnouncement;
        if (string.IsNullOrEmpty(message))
        {
            _announcer.Visibility = Visibility.Collapsed;
            _announced = null;
            return;
        }

        _announcer.Text = message;
        _announcer.Visibility = Visibility.Visible;
        AutomationProperties.SetName(_announcer, message);

        if (!string.Equals(_announced, message, StringComparison.Ordinal))
        {
            _announced = message;
            LiveRegion.Announce(_announcer);
        }
    }

    private static FontFamily MonoFont() =>
        Application.Current?.Resources is { } res
        && res.TryGetValue("TsTypeFontFamilyMono", out object? value)
        && value is FontFamily family
            ? family
            : new FontFamily("Consolas");

    private static Brush Tinted(string colorKey, byte alpha)
    {
        if (Application.Current?.Resources is { } res
            && res.TryGetValue(colorKey, out object? value)
            && value is Color color)
        {
            color.A = alpha;
            return new SolidColorBrush(color);
        }

        return DisplayTokens.Surface;
    }
}
