using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using TeslaSync.App.Core;

namespace TeslaSync.App.Components.UI;

/// <summary>
/// Inline edit-in-place field (mirrors the web <c>EditableText</c>). Renders the
/// current value as text with an edit affordance; activating it swaps to a
/// <see cref="TsInput"/> with confirm/cancel. Enter/Escape commit/cancel, and
/// focus restores to the trigger when editing ends.
/// </summary>
public partial class TsEditableText : ContentControl
{
    private readonly TextBlock _display = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TsButton _edit = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE70F" };
    private readonly TsInput _input = new();
    private readonly TsButton _confirm = new() { Variant = ButtonVariant.Primary, IconGlyph = "\uE73E" };
    private readonly TsButton _cancel = new() { Variant = ButtonVariant.Subtle, IconGlyph = "\uE711" };
    private readonly StackPanel _displayPanel;
    private readonly StackPanel _editPanel;
    private readonly Grid _root;
    private bool _editing;

    public static readonly DependencyProperty ValueProperty = DependencyProperty.Register(
        nameof(Value), typeof(string), typeof(TsEditableText),
        new PropertyMetadata(null, OnValueChanged));

    public static readonly DependencyProperty PromptProperty = DependencyProperty.Register(
        nameof(Prompt), typeof(string), typeof(TsEditableText), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty EditLabelProperty = DependencyProperty.Register(
        nameof(EditLabel), typeof(string), typeof(TsEditableText), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty ConfirmLabelProperty = DependencyProperty.Register(
        nameof(ConfirmLabel), typeof(string), typeof(TsEditableText), new PropertyMetadata(null, OnLabelsChanged));

    public static readonly DependencyProperty CancelLabelProperty = DependencyProperty.Register(
        nameof(CancelLabel), typeof(string), typeof(TsEditableText), new PropertyMetadata(null, OnLabelsChanged));

    public TsEditableText()
    {
        IsTabStop = false;
        _displayPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4 };
        _displayPanel.Children.Add(_display);
        _displayPanel.Children.Add(_edit);

        _editPanel = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Visibility = Visibility.Collapsed };
        _editPanel.Children.Add(_input);
        _editPanel.Children.Add(_confirm);
        _editPanel.Children.Add(_cancel);

        _root = new Grid();
        _root.Children.Add(_displayPanel);
        _root.Children.Add(_editPanel);
        Content = _root;

        _edit.Click += (s, e) => BeginEdit();
        _confirm.Click += (s, e) => Commit();
        _cancel.Click += (s, e) => CancelEdit();
        _input.KeyDown += OnInputKeyDown;

        Render();
    }

    /// <summary>Raised when an edit is committed with the new value.</summary>
    public event EventHandler<string>? ValueCommitted;

    public string? Value
    {
        get => (string?)GetValue(ValueProperty);
        set => SetValue(ValueProperty, value);
    }

    /// <summary>Localized hint shown inside the editor.</summary>
    public string? Prompt
    {
        get => (string?)GetValue(PromptProperty);
        set => SetValue(PromptProperty, value);
    }

    public string? EditLabel
    {
        get => (string?)GetValue(EditLabelProperty);
        set => SetValue(EditLabelProperty, value);
    }

    public string? ConfirmLabel
    {
        get => (string?)GetValue(ConfirmLabelProperty);
        set => SetValue(ConfirmLabelProperty, value);
    }

    public string? CancelLabel
    {
        get => (string?)GetValue(CancelLabelProperty);
        set => SetValue(CancelLabelProperty, value);
    }

    private static void OnValueChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsEditableText)d).Render();

    private static void OnLabelsChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsEditableText)d).ApplyLabels();

    private void BeginEdit()
    {
        _editing = true;
        _input.Text = Value ?? string.Empty;
        Render();
        _input.Focus(FocusState.Programmatic);
    }

    private void Commit()
    {
        Value = _input.Text;
        _editing = false;
        Render();
        _edit.Focus(FocusState.Programmatic);
        ValueCommitted?.Invoke(this, Value ?? string.Empty);
    }

    private void CancelEdit()
    {
        _editing = false;
        Render();
        _edit.Focus(FocusState.Programmatic);
    }

    private void OnInputKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter)
        {
            e.Handled = true;
            Commit();
        }
        else if (e.Key == Windows.System.VirtualKey.Escape)
        {
            e.Handled = true;
            CancelEdit();
        }
    }

    private void Render()
    {
        _display.Text = string.IsNullOrEmpty(Value) ? "\u2014" : Value;
        _displayPanel.Visibility = _editing ? Visibility.Collapsed : Visibility.Visible;
        _editPanel.Visibility = _editing ? Visibility.Visible : Visibility.Collapsed;
        ApplyLabels();
    }

    private void ApplyLabels()
    {
        _input.Hint = Prompt;
        Apply(_edit, EditLabel);
        Apply(_confirm, ConfirmLabel);
        Apply(_cancel, CancelLabel);
    }

    private static void Apply(TsButton button, string? label)
    {
        if (!string.IsNullOrEmpty(label))
        {
            AutomationProperties.SetName(button, label);
            ToolTipService.SetToolTip(button, label);
        }
    }
}
