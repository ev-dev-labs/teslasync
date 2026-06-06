using TeslaSync.App.Core.Auth;
using Xunit;

namespace TeslaSync.App.Tests.Auth;

public sealed class TokenRedactionTests
{
    [Fact]
    public void RedactsBearerAuthorizationHeaders()
    {
        const string line = "GET /api/v1/vehicles Authorization: Bearer eyJhbGciOi.JzdWIiOiJ.abc-_123";
        var redacted = TokenRedaction.Redact(line);
        Assert.DoesNotContain("eyJhbGciOi", redacted, StringComparison.Ordinal);
        Assert.Contains(TokenRedaction.Marker, redacted, StringComparison.Ordinal);
    }

    [Fact]
    public void RedactsJsonTokenFields()
    {
        const string json = "{\"access_token\":\"secret-a\",\"refresh_token\":\"secret-r\",\"expires_in\":600}";
        var redacted = TokenRedaction.Redact(json);
        Assert.DoesNotContain("secret-a", redacted, StringComparison.Ordinal);
        Assert.DoesNotContain("secret-r", redacted, StringComparison.Ordinal);
        Assert.Contains("\"expires_in\":600", redacted, StringComparison.Ordinal);
    }

    [Fact]
    public void RedactsFormEncodedGrantSecrets()
    {
        const string form = "grant_type=authorization_code&code=the-code&code_verifier=the-verifier&client_id=win";
        var redacted = TokenRedaction.Redact(form);
        Assert.DoesNotContain("the-code", redacted, StringComparison.Ordinal);
        Assert.DoesNotContain("the-verifier", redacted, StringComparison.Ordinal);
        Assert.Contains("client_id=win", redacted, StringComparison.Ordinal);
    }

    [Fact]
    public void LeavesNonSecretContentUntouched()
    {
        const string line = "vehicle_id=3 charge_state=Charging";
        Assert.Equal(line, TokenRedaction.Redact(line));
    }

    [Fact]
    public void HandlesNullAndEmpty()
    {
        Assert.Equal(string.Empty, TokenRedaction.Redact(null));
        Assert.Equal(string.Empty, TokenRedaction.Redact(string.Empty));
    }
}

public sealed class SecureTokenStoreTests
{
    [Fact]
    public async Task SaveThenLoadRoundTrips()
    {
        var store = new InMemoryTokenStore();
        var tokens = new TokenSet("a", "r", "id", 1_234);

        await store.SaveAsync(tokens);
        var loaded = await store.LoadAsync();

        Assert.Equal(tokens, loaded);
    }

    [Fact]
    public async Task ClearRemovesTheStoredSet()
    {
        var store = new InMemoryTokenStore();
        await store.SaveAsync(new TokenSet("a", "r", null, 1));

        await store.ClearAsync();

        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task LoadIsNullBeforeAnySave()
    {
        var store = new InMemoryTokenStore();
        Assert.Null(await store.LoadAsync());
    }
}
