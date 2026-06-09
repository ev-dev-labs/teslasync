namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The digest port the <see cref="HashCalculatorViewModel"/> computes a hash through (P1/S8 state-holder
/// seam) — the native analogue of the web tool's <c>crypto.subtle.digest('SHA-256', …)</c> call
/// (web/src/features/admin/components/devtools/tools/HashCalculator.tsx). Routing the digest through a seam
/// keeps the view-model free of cryptographic detail and lets a test substitute a deterministic or faulting
/// computer to exercise the success and error branches. The view never computes a digest itself.
/// </summary>
public interface IHashComputer
{
    /// <summary>Compute the SHA-256 digest of <paramref name="input"/> and return the classified outcome.</summary>
    /// <param name="input">The text to hash (web <c>inputVal</c>).</param>
    /// <param name="cancellationToken">Cancels a superseded or disposed run.</param>
    Task<HashCalculatorOutcome> ComputeAsync(string input, CancellationToken cancellationToken = default);
}

/// <summary>
/// The single real <see cref="IHashComputer"/> — the native data adapter for one SHA-256 run. It UTF-8
/// encodes the input, hashes it with SHA-256 and renders the lowercase hex digest via
/// <see cref="HashCalculatorFormat.Sha256Hex"/>, mirroring the web tool's
/// <c>crypto.subtle.digest('SHA-256', new TextEncoder().encode(inputVal))</c> + lowercase-hex join. The
/// digest is computed entirely on this device — there is no network — so the run settles synchronously and
/// is wrapped in <see cref="Task.FromResult{TResult}"/>. A thrown fault is folded into a failed outcome (the
/// web <c>catch { setHashResult(t('Hash Error')) }</c>) rather than propagating, so the view-model always
/// settles into <see cref="HashCalculatorState.Computed"/> or <see cref="HashCalculatorState.Failed"/>; a
/// genuine cancellation (the surface was disposed) is re-thrown so the view-model can drop the superseded run
/// silently.
/// </summary>
public sealed class Sha256HashComputer : IHashComputer
{
    /// <inheritdoc />
    public Task<HashCalculatorOutcome> ComputeAsync(string input, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();

        try
        {
            string hex = HashCalculatorFormat.Sha256Hex(input);
            return Task.FromResult(HashCalculatorOutcome.Succeeded(hex));
        }
        catch (OperationCanceledException)
        {
            // The surface was disposed (or the run superseded): let the view-model drop it silently.
            throw;
        }
        catch (Exception)
        {
            // Web parity: the digest catch resolves to the localized "Hash Error" line so the tool always
            // settles. The view-model owns the localized message; the computer only reports the fault.
            return Task.FromResult(HashCalculatorOutcome.Faulted());
        }
    }
}
