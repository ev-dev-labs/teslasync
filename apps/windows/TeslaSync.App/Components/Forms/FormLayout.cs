using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using TeslaSync.App.Components.Feedback;
using TeslaSync.App.Components.UI;
using TeslaSync.App.Core.Forms;

namespace TeslaSync.App.Components.Forms;

/// <summary>
/// Titled form section wrapper (mirrors the web <c>FormSection</c>). Groups
/// related fields under a localized <see cref="Title"/> and optional
/// <see cref="Description"/>, hosting the fields in <see cref="SectionContent"/>
/// inside a tokenized glass panel.
/// </summary>
public partial class TsFormSection : ContentControl
{
    private readonly SectionTitle _title = new();
    private readonly Text _description = new();
    private readonly ContentPresenter _content = new();

    public static readonly DependencyProperty TitleProperty = DependencyProperty.Register(
        nameof(Title), typeof(string), typeof(TsFormSection),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty DescriptionProperty = DependencyProperty.Register(
        nameof(Description), typeof(string), typeof(TsFormSection),
        new PropertyMetadata(string.Empty, OnHeaderChanged));

    public static readonly DependencyProperty SectionContentProperty = DependencyProperty.Register(
        nameof(SectionContent), typeof(object), typeof(TsFormSection),
        new PropertyMetadata(null, OnSectionContentChanged));

    public TsFormSection()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _description.Visibility = Visibility.Collapsed;

        var header = new StackPanel { Spacing = 2 };
        header.Children.Add(_title);
        header.Children.Add(_description);

        var column = new StackPanel { Spacing = 12 };
        column.Children.Add(header);
        column.Children.Add(_content);

        Content = new TsGlassPanel { Padding = new Thickness(16), Content = column };
        ApplyHeader();
    }

    /// <summary>Localized section heading.</summary>
    public string Title
    {
        get => (string)GetValue(TitleProperty);
        set => SetValue(TitleProperty, value);
    }

    /// <summary>Optional localized supporting description.</summary>
    public string Description
    {
        get => (string)GetValue(DescriptionProperty);
        set => SetValue(DescriptionProperty, value);
    }

    /// <summary>The fields hosted by the section.</summary>
    public object? SectionContent
    {
        get => GetValue(SectionContentProperty);
        set => SetValue(SectionContentProperty, value);
    }

    private static void OnHeaderChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFormSection)d).ApplyHeader();

    private static void OnSectionContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFormSection)d)._content.Content = e.NewValue;

    private void ApplyHeader()
    {
        _title.Value = Title;
        _title.Visibility = string.IsNullOrEmpty(Title) ? Visibility.Collapsed : Visibility.Visible;
        _description.Value = Description;
        _description.Visibility = string.IsNullOrEmpty(Description) ? Visibility.Collapsed : Visibility.Visible;
        AutomationProperties.SetName(this, Title);
    }
}

/// <summary>
/// Labelled form field wrapper (mirrors the web <c>FormField</c>). Renders a
/// localized <see cref="Label"/> (with an optional required marker), hosts the
/// editing control in <see cref="FieldContent"/> and shows either
/// <see cref="HelperText"/> or — when set — a validation
/// <see cref="ErrorMessage"/>. Call <see cref="AttachValidation"/> to bind a
/// <see cref="FieldValidationState"/> so errors flow in automatically.
/// </summary>
public partial class TsFormField : ContentControl
{
    private readonly Label _label = new();
    private readonly Text _required = new() { Value = "*" };
    private readonly ContentPresenter _content = new();
    private readonly HelperText _helper = new();
    private readonly ErrorText _error = new();
    private FieldValidationState? _validation;

    public static readonly DependencyProperty LabelProperty = DependencyProperty.Register(
        nameof(Label), typeof(string), typeof(TsFormField),
        new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty IsRequiredProperty = DependencyProperty.Register(
        nameof(IsRequired), typeof(bool), typeof(TsFormField),
        new PropertyMetadata(false, OnChanged));

    public static readonly DependencyProperty FieldContentProperty = DependencyProperty.Register(
        nameof(FieldContent), typeof(object), typeof(TsFormField),
        new PropertyMetadata(null, OnFieldContentChanged));

    public static readonly DependencyProperty HelperTextProperty = DependencyProperty.Register(
        nameof(HelperText), typeof(string), typeof(TsFormField),
        new PropertyMetadata(string.Empty, OnChanged));

    public static readonly DependencyProperty ErrorMessageProperty = DependencyProperty.Register(
        nameof(ErrorMessage), typeof(string), typeof(TsFormField),
        new PropertyMetadata(string.Empty, OnChanged));

    public TsFormField()
    {
        IsTabStop = false;
        HorizontalContentAlignment = HorizontalAlignment.Stretch;
        _required.Foreground = TypographyTokens.Brush("TsColorDangerBrush");
        _required.Visibility = Visibility.Collapsed;

        var labelRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 2 };
        labelRow.Children.Add(_label);
        labelRow.Children.Add(_required);

        var column = new StackPanel { Spacing = 4 };
        column.Children.Add(labelRow);
        column.Children.Add(_content);
        column.Children.Add(_helper);
        column.Children.Add(_error);
        Content = column;
        LiveRegion.Configure(_error, assertive: true);
        ApplyState();
    }

    /// <summary>Localized field label.</summary>
    public string Label
    {
        get => (string)GetValue(LabelProperty);
        set => SetValue(LabelProperty, value);
    }

    /// <summary>Whether the field shows a required marker.</summary>
    public bool IsRequired
    {
        get => (bool)GetValue(IsRequiredProperty);
        set => SetValue(IsRequiredProperty, value);
    }

    /// <summary>The editing control hosted by the field.</summary>
    public object? FieldContent
    {
        get => GetValue(FieldContentProperty);
        set => SetValue(FieldContentProperty, value);
    }

    /// <summary>Optional localized helper text (hidden while an error shows).</summary>
    public string HelperText
    {
        get => (string)GetValue(HelperTextProperty);
        set => SetValue(HelperTextProperty, value);
    }

    /// <summary>Localized validation error (empty clears the error state).</summary>
    public string ErrorMessage
    {
        get => (string)GetValue(ErrorMessageProperty);
        set => SetValue(ErrorMessageProperty, value);
    }

    /// <summary>
    /// Bind a <see cref="FieldValidationState"/> so its error flows into
    /// <see cref="ErrorMessage"/> automatically.
    /// </summary>
    public void AttachValidation(FieldValidationState validation)
    {
        ArgumentNullException.ThrowIfNull(validation);
        if (_validation is not null)
        {
            _validation.PropertyChanged -= OnValidationChanged;
        }

        _validation = validation;
        _validation.PropertyChanged += OnValidationChanged;
        ErrorMessage = validation.Error ?? string.Empty;
    }

    private static void OnChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFormField)d).ApplyState();

    private static void OnFieldContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((TsFormField)d)._content.Content = e.NewValue;

    private void OnValidationChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e) =>
        ErrorMessage = _validation?.Error ?? string.Empty;

    private void ApplyState()
    {
        _label.Value = Label;
        _required.Visibility = IsRequired ? Visibility.Visible : Visibility.Collapsed;

        var hasError = !string.IsNullOrEmpty(ErrorMessage);
        _error.Value = ErrorMessage;
        _error.Visibility = hasError ? Visibility.Visible : Visibility.Collapsed;

        _helper.Value = HelperText;
        _helper.Visibility = !hasError && !string.IsNullOrEmpty(HelperText) ? Visibility.Visible : Visibility.Collapsed;

        if (hasError)
        {
            LiveRegion.Announce(_error);
        }

        AutomationProperties.SetName(this, Label);
    }
}
