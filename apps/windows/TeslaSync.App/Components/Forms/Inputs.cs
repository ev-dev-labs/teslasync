using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;
using Windows.System;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Search field with a leading glyph and a clear affordance (mirrors the web
/// <c>SearchInput</c>). Wraps a tokenized <see cref="TsInput"/>; raises
/// <see cref="QueryChanged"/> as the user types and exposes the current
/// <see cref="Query"/> two-ways.
/// </summary>
public partial class TsSearchInput : ContentControl
{
    private readonly TsInput _input = new();
    private readonly FontIcon _icon = new() { Glyph = "\uE721", FontSize = 14 };
    private readonly TsButton _clear = new() { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE711", Visibility = Visibility.Collapsed };
    private bool _syncing;

    public static readonly DependencyProperty QueryProperty = DependencyProperty.Register(
        nameof(Query), typeof(string), typeof(TsSearchInput),
        new PropertyMetadata(string.Empty, OnQueryChanged));

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsSearchInput),
        new PropertyMetadata(string.Empty, OnPromptTextChanged));

    public TsSearchInput()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var grid = new Grid { ColumnSpacing = 6 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        _icon.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(_icon, 0);
        Grid.SetColumn(_input, 1);
        Grid.SetColumn(_clear, 2);
        grid.Children.Add(_icon);
        grid.Children.Add(_input);
        grid.Children.Add(_clear);

        _input.TextChanged += (_, _) =>
        {
            if (_syncing)
            {
                return;
            }

            Query = _input.Text;
        };
        _clear.Click += (_, _) =>
        {
            Query = string.Empty;
            _input.Focus(FocusState.Programmatic);
        };
        AutomationProperties.SetName(_clear, "Clear search");
        Content = grid;
    }

    /// <summary>Raised whenever the query text changes.</summary>
    public event EventHandler<string>? QueryChanged;

    /// <summary>Current search query.</summary>
    public string Query
    {
        get => (string)GetValue(QueryProperty);
        set => SetValue(QueryProperty, value);
    }

    /// <summary>Localized prompt / hint text.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    private static void OnQueryChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsSearchInput)d;
        var value = (string)e.NewValue;
        input._syncing = true;
        if (input._input.Text != value)
        {
            input._input.Text = value;
        }

        input._syncing = false;
        input._clear.Visibility = string.IsNullOrEmpty(value) ? Visibility.Collapsed : Visibility.Visible;
        input.QueryChanged?.Invoke(input, value);
    }

    private static void OnPromptTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsSearchInput)d)._input.Hint = (string)e.NewValue;
}

/// <summary>
/// Currency amount field (mirrors the web <c>CurrencyInput</c>). Stores the value
/// as integer micro-units (<see cref="Micros"/>) via <see cref="CurrencyMicro"/>
/// so currencies with 0/2/3 fractional digits round-trip without float drift.
/// Parsing/formatting are culture- and symbol-aware; the value commits on focus
/// loss.
/// </summary>
public partial class TsCurrencyInput : ContentControl
{
    private readonly TsInput _input = new();
    private bool _syncing;

    public static readonly DependencyProperty MicrosProperty = DependencyProperty.Register(
        nameof(Micros), typeof(long?), typeof(TsCurrencyInput),
        new PropertyMetadata(null, OnValueChanged));

    public static readonly DependencyProperty CurrencyCodeProperty = DependencyProperty.Register(
        nameof(CurrencyCode), typeof(string), typeof(TsCurrencyInput),
        new PropertyMetadata("USD", OnValueChanged));

    public static readonly DependencyProperty PrecisionProperty = DependencyProperty.Register(
        nameof(Precision), typeof(int), typeof(TsCurrencyInput),
        new PropertyMetadata(2, OnValueChanged));

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsCurrencyInput),
        new PropertyMetadata(string.Empty, OnPromptTextChanged));

    public TsCurrencyInput()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _input.LostFocus += (_, _) => Commit();
        Content = _input;
        Format();
    }

    /// <summary>Raised when the committed value changes.</summary>
    public event EventHandler<long?>? ValueChanged;

    /// <summary>The amount in integer micro-units (1 unit = 1,000,000), or null.</summary>
    public long? Micros
    {
        get => (long?)GetValue(MicrosProperty);
        set => SetValue(MicrosProperty, value);
    }

    /// <summary>ISO-4217 currency code driving the symbol.</summary>
    public string CurrencyCode
    {
        get => (string)GetValue(CurrencyCodeProperty);
        set => SetValue(CurrencyCodeProperty, value);
    }

    /// <summary>Fractional digits shown.</summary>
    public int Precision
    {
        get => (int)GetValue(PrecisionProperty);
        set => SetValue(PrecisionProperty, value);
    }

    /// <summary>Localized prompt / hint text.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsCurrencyInput)d;
        if (input._syncing)
        {
            return;
        }

        input.Format();
    }

    private static void OnPromptTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsCurrencyInput)d)._input.Hint = (string)e.NewValue;

    private void Commit()
    {
        var parsed = CurrencyMicro.Parse(_input.Text, CurrencyCode, CultureInfo.CurrentCulture);
        _syncing = true;
        Micros = parsed;
        _syncing = false;
        Format();
        ValueChanged?.Invoke(this, parsed);
    }

    private void Format()
    {
        _input.Text = CurrencyMicro.Format(Micros, CurrencyCode, CultureInfo.CurrentCulture, Math.Max(0, Precision));
    }
}

/// <summary>
/// Unit-aware numeric field (mirrors the web <c>UnitInput</c>). The canonical
/// value is always SI (<see cref="SiValue"/>); the user edits in the active
/// display unit defined by <see cref="Factor"/> / <see cref="Offset"/> with a
/// trailing <see cref="UnitLabel"/>. Conversions happen only at this display
/// boundary, per the SI cutover.
/// </summary>
public partial class TsUnitInput : ContentControl
{
    private readonly TsInput _input = new();
    private readonly Caption _unit = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly UnitInputModel _model;
    private bool _syncing;

    public static readonly DependencyProperty SiValueProperty = DependencyProperty.Register(
        nameof(SiValue), typeof(double?), typeof(TsUnitInput),
        new PropertyMetadata(null, OnModelChanged));

    public static readonly DependencyProperty FactorProperty = DependencyProperty.Register(
        nameof(Factor), typeof(double), typeof(TsUnitInput),
        new PropertyMetadata(1.0, OnModelChanged));

    public static readonly DependencyProperty OffsetProperty = DependencyProperty.Register(
        nameof(Offset), typeof(double), typeof(TsUnitInput),
        new PropertyMetadata(0.0, OnModelChanged));

    public static readonly DependencyProperty PrecisionProperty = DependencyProperty.Register(
        nameof(Precision), typeof(int), typeof(TsUnitInput),
        new PropertyMetadata(1, OnModelChanged));

    public static readonly DependencyProperty UnitLabelProperty = DependencyProperty.Register(
        nameof(UnitLabel), typeof(string), typeof(TsUnitInput),
        new PropertyMetadata(string.Empty, OnUnitLabelChanged));

    public TsUnitInput()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _model = new UnitInputModel(UnitConversion.Identity, 1);

        var grid = new Grid { ColumnSpacing = 8 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(_input, 0);
        Grid.SetColumn(_unit, 1);
        grid.Children.Add(_input);
        grid.Children.Add(_unit);

        _input.LostFocus += (_, _) => Commit();
        Content = grid;
        ApplyModel();
    }

    /// <summary>Raised when the committed SI value changes.</summary>
    public event EventHandler<double?>? ValueChanged;

    /// <summary>Canonical SI value (null when empty).</summary>
    public double? SiValue
    {
        get => (double?)GetValue(SiValueProperty);
        set => SetValue(SiValueProperty, value);
    }

    /// <summary>Display-unit multiplier (display = si * Factor + Offset).</summary>
    public double Factor
    {
        get => (double)GetValue(FactorProperty);
        set => SetValue(FactorProperty, value);
    }

    /// <summary>Display-unit offset.</summary>
    public double Offset
    {
        get => (double)GetValue(OffsetProperty);
        set => SetValue(OffsetProperty, value);
    }

    /// <summary>Display-unit fractional digits.</summary>
    public int Precision
    {
        get => (int)GetValue(PrecisionProperty);
        set => SetValue(PrecisionProperty, value);
    }

    /// <summary>Localized trailing unit label (e.g. "km", "°F").</summary>
    public string UnitLabel
    {
        get => (string)GetValue(UnitLabelProperty);
        set => SetValue(UnitLabelProperty, value);
    }

    private static void OnModelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsUnitInput)d;
        if (input._syncing)
        {
            return;
        }

        input.ApplyModel();
    }

    private static void OnUnitLabelChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var input = (TsUnitInput)d;
        input._unit.Value = (string)e.NewValue;
        input._unit.Visibility = string.IsNullOrEmpty((string)e.NewValue) ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Commit()
    {
        if (_model.TrySetFromDisplay(_input.Text))
        {
            _input.HasError = false;
            _syncing = true;
            SiValue = _model.SiValue;
            _syncing = false;
            _input.Text = _model.Display;
            ValueChanged?.Invoke(this, _model.SiValue);
        }
        else
        {
            _input.HasError = true;
        }
    }

    private void ApplyModel()
    {
        _model.Conversion = new UnitConversion(Factor, Offset);
        _model.Precision = Math.Max(0, Precision);
        _model.SiValue = SiValue;
        _input.Text = _model.Display;
    }
}

/// <summary>
/// Chip / token input (mirrors the web <c>TagInput</c>). Backed by
/// <see cref="TagInputModel"/>: Enter or a separator commits the buffer as a tag,
/// Backspace on an empty buffer removes the last tag, and each chip has a remove
/// affordance. De-duplication and an optional cap are enforced by the model.
/// </summary>
public partial class TsTagInput : ContentControl
{
    private readonly TagInputModel _model = new();
    private readonly StackPanel _chips = new() { Orientation = Orientation.Horizontal, Spacing = 6 };
    private readonly TextBox _buffer = new() { MinWidth = 120, BorderThickness = new Thickness(0) };

    public static readonly DependencyProperty PromptTextProperty = DependencyProperty.Register(
        nameof(PromptText), typeof(string), typeof(TsTagInput),
        new PropertyMetadata(string.Empty, OnPromptTextChanged));

    public static readonly DependencyProperty RemoveTagAutomationNameProperty = DependencyProperty.Register(
        nameof(RemoveTagAutomationName), typeof(string), typeof(TsTagInput),
        new PropertyMetadata("Remove tag"));

    public TsTagInput()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;

        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(_chips);
        row.Children.Add(_buffer);

        var surface = new Border
        {
            Child = new ScrollViewer
            {
                Content = row,
                HorizontalScrollMode = ScrollMode.Auto,
                HorizontalScrollBarVisibility = ScrollBarVisibility.Auto,
                VerticalScrollBarVisibility = ScrollBarVisibility.Disabled,
            },
            BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(8, 6, 8, 6),
            Background = TypographyTokens.Brush("TsColorSurfaceBrush"),
        };

        _buffer.KeyDown += OnBufferKeyDown;
        Content = surface;
        RenderChips();
    }

    /// <summary>Raised when the tag set changes.</summary>
    public event EventHandler<IReadOnlyList<string>>? TagsChanged;

    /// <summary>Localized prompt shown in the input buffer.</summary>
    public string PromptText
    {
        get => (string)GetValue(PromptTextProperty);
        set => SetValue(PromptTextProperty, value);
    }

    /// <summary>Localized accessible name for a chip's remove button.</summary>
    public string RemoveTagAutomationName
    {
        get => (string)GetValue(RemoveTagAutomationNameProperty);
        set => SetValue(RemoveTagAutomationNameProperty, value);
    }

    /// <summary>The current tags.</summary>
    public IReadOnlyList<string> Tags => _model.Tags;

    /// <summary>Replace the current tags.</summary>
    public void SetTags(IEnumerable<string> tags)
    {
        _model.Set(tags);
        RenderChips();
        TagsChanged?.Invoke(this, _model.Tags);
    }

    private static void OnPromptTextChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsTagInput)d)._buffer.PlaceholderText = (string)e.NewValue; // parity:allow PlaceholderText is the WinUI hint API

    private void OnBufferKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key is VirtualKey.Enter)
        {
            if (_model.Add(_buffer.Text))
            {
                _buffer.Text = string.Empty;
                OnTagsChanged();
            }

            e.Handled = true;
        }
        else if (e.Key is VirtualKey.Back && string.IsNullOrEmpty(_buffer.Text))
        {
            if (_model.RemoveLast())
            {
                OnTagsChanged();
            }
        }
    }

    private void OnTagsChanged()
    {
        RenderChips();
        TagsChanged?.Invoke(this, _model.Tags);
    }

    private void RenderChips()
    {
        _chips.Children.Clear();
        foreach (var tag in _model.Tags)
        {
            var captured = tag;
            var label = new Text { Value = tag, VerticalAlignment = VerticalAlignment.Center };
            var remove = new TsButton { Variant = TeslaSync.App.Core.ButtonVariant.Icon, IconGlyph = "\uE711" };
            AutomationProperties.SetName(remove, $"{RemoveTagAutomationName}: {tag}");
            remove.Click += (_, _) =>
            {
                if (_model.Remove(captured))
                {
                    OnTagsChanged();
                }
            };

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
            row.Children.Add(label);
            row.Children.Add(remove);
            _chips.Children.Add(new Border
            {
                Child = row,
                CornerRadius = new CornerRadius(999),
                BorderBrush = TypographyTokens.Brush("TsColorBorderBrush"),
                BorderThickness = new Thickness(1),
                Padding = new Thickness(8, 2, 4, 2),
            });
        }
    }
}
