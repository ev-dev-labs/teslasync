using System.ComponentModel;

namespace TeslaSync.App.Core.Forms;

/// <summary>Outcome of validating a single field.</summary>
public readonly record struct ValidationResult(bool IsValid, string? Error)
{
    /// <summary>A passing result.</summary>
    public static ValidationResult Valid => new(true, null);

    /// <summary>A failing result carrying a localized message.</summary>
    public static ValidationResult Invalid(string error) => new(false, error);
}

/// <summary>
/// UI-thread-free validation state backing the form controls (<c>TsFormField</c>,
/// <c>TsInput</c> error border, <c>TsCurrencyInput</c>, …). Holds the current
/// error so the WinUI control just toggles its danger border and announces the
/// message to assistive tech.
/// </summary>
public sealed class FieldValidationState : INotifyPropertyChanged
{
    private string? _error;

    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Localized error message, or null when valid.</summary>
    public string? Error
    {
        get => _error;
        private set
        {
            if (_error == value)
            {
                return;
            }

            _error = value;
            Raise(nameof(Error));
            Raise(nameof(IsValid));
            Raise(nameof(HasError));
        }
    }

    /// <summary>True when there is no error.</summary>
    public bool IsValid => _error is null;

    /// <summary>True when an error is present.</summary>
    public bool HasError => _error is not null;

    /// <summary>Apply a validation result.</summary>
    public void Apply(ValidationResult result) => Error = result.IsValid ? null : result.Error;

    /// <summary>Set an explicit error (or clear when null).</summary>
    public void SetError(string? error) => Error = string.IsNullOrEmpty(error) ? null : error;

    /// <summary>Clear any error.</summary>
    public void Clear() => Error = null;

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}

/// <summary>
/// Pure, localizable field validators. Each takes the already-localized message
/// to return on failure so the rules stay UI- and culture-agnostic.
/// </summary>
public static class Validators
{
    /// <summary>Fails when the value is null/blank.</summary>
    public static ValidationResult Required(string? value, string message) =>
        string.IsNullOrWhiteSpace(value) ? ValidationResult.Invalid(message) : ValidationResult.Valid;

    /// <summary>Fails when <paramref name="value"/> is outside [min, max].</summary>
    public static ValidationResult InRange(double value, double min, double max, string message) =>
        value < min || value > max ? ValidationResult.Invalid(message) : ValidationResult.Valid;

    /// <summary>Fails when the trimmed length is outside [min, max].</summary>
    public static ValidationResult Length(string? value, int min, int max, string message)
    {
        var len = value?.Trim().Length ?? 0;
        return len < min || len > max ? ValidationResult.Invalid(message) : ValidationResult.Valid;
    }

    /// <summary>Runs each rule in order and returns the first failure (or valid).</summary>
    public static ValidationResult All(params ValidationResult[] results)
    {
        ArgumentNullException.ThrowIfNull(results);
        foreach (var result in results)
        {
            if (!result.IsValid)
            {
                return result;
            }
        }

        return ValidationResult.Valid;
    }
}
