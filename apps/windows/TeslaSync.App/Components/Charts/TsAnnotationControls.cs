using System.Collections.Generic;
using System.Globalization;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>
/// Lists the user annotations held by a <see cref="ChartAnnotationState"/> (mirrors
/// the web <c>AnnotationList</c>). Each row shows the annotation label / value with a
/// remove action, and the list re-renders whenever the underlying state changes so it
/// stays in sync with the chart's annotation layer.
/// </summary>
public partial class TsAnnotationList : ContentControl
{
    private readonly StackPanel _items = new() { Spacing = 4 };
    private ChartAnnotationState? _state;

    public TsAnnotationList()
    {
        IsTabStop = false;
        Content = _items;
    }

    /// <summary>The annotation state to display; subscribing keeps the list live.</summary>
    public ChartAnnotationState? State
    {
        get => _state;
        set
        {
            if (_state is not null)
            {
                _state.PropertyChanged -= OnStateChanged;
            }

            _state = value;
            if (_state is not null)
            {
                _state.PropertyChanged += OnStateChanged;
            }

            Rebuild();
        }
    }

    private void OnStateChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) => Rebuild();

    private void Rebuild()
    {
        _items.Children.Clear();
        if (_state is null)
        {
            return;
        }

        if (_state.Items.Count == 0)
        {
            _items.Children.Add(new Caption { Value = "No annotations" });
            return;
        }

        foreach (var annotation in _state.Items)
        {
            _items.Children.Add(BuildRow(annotation));
        }
    }

    private Grid BuildRow(ChartAnnotation annotation)
    {
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var caption = string.IsNullOrEmpty(annotation.Label)
            ? string.Create(CultureInfo.InvariantCulture, $"{annotation.Kind} @ {annotation.Value:0.##}")
            : annotation.Label!;
        var label = new Label { Value = caption };
        Grid.SetColumn(label, 0);
        row.Children.Add(label);

        var remove = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Size = ControlSize.Small,
            IconGlyph = "\uE74D",
        };
        AutomationProperties.SetName(remove, $"Remove annotation {caption}");
        remove.Click += (s, e) => _state?.Remove(annotation.Id);
        Grid.SetColumn(remove, 1);
        row.Children.Add(remove);

        return row;
    }
}

/// <summary>
/// A popover form that adds a reference annotation to a chart (mirrors the web
/// <c>AddAnnotationPopover</c>). The user picks a horizontal / vertical line, types a
/// value and optional label, and the confirmed annotation is pushed into the bound
/// <see cref="ChartAnnotationState"/> — which the chart's annotation layer and
/// <see cref="TsAnnotationList"/> both observe.
/// </summary>
public partial class TsAddAnnotationPopover : ContentControl
{
    private readonly TsSelect _kind = new() { Hint = "Type", MinWidth = 140 };
    private readonly TsInput _value = new() { Hint = "Value", MinWidth = 120 };
    private readonly TsInput _label = new() { Hint = "Label (optional)", MinWidth = 160 };

    public TsAddAnnotationPopover()
    {
        IsTabStop = false;

        _kind.Items.Add(ChartAnnotationKind.VerticalLine);
        _kind.Items.Add(ChartAnnotationKind.HorizontalLine);
        _kind.Items.Add(ChartAnnotationKind.Band);
        _kind.SelectedIndex = 0;

        var form = new StackPanel { Spacing = 8, MinWidth = 220 };
        form.Children.Add(new Label { Value = "Add annotation" });
        form.Children.Add(_kind);
        form.Children.Add(_value);
        form.Children.Add(_label);

        var confirm = new TsButton { Variant = ButtonVariant.Primary, Text = "Add" };
        confirm.Click += OnConfirm;
        form.Children.Add(confirm);

        var flyout = new Flyout { Content = form };
        var trigger = new TsButton
        {
            Variant = ButtonVariant.Subtle,
            Text = "Annotate",
            IconGlyph = "\uE70F",
            Flyout = flyout,
        };

        Content = trigger;
    }

    /// <summary>The annotation state the confirmed annotation is added to.</summary>
    public ChartAnnotationState? State { get; set; }

    private void OnConfirm(object sender, RoutedEventArgs e)
    {
        if (State is null ||
            !double.TryParse(_value.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ||
            _kind.SelectedItem is not ChartAnnotationKind kind)
        {
            _value.HasError = true;
            return;
        }

        _value.HasError = false;
        var id = string.Create(CultureInfo.InvariantCulture, $"ann-{System.Environment.TickCount64}");
        State.Add(new ChartAnnotation(id, kind, value)
        {
            Label = string.IsNullOrWhiteSpace(_label.Text) ? null : _label.Text,
        });

        _value.Text = string.Empty;
        _label.Text = string.Empty;
    }
}
