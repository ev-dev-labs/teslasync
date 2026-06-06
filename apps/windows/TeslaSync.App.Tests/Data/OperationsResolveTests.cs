using System.Reflection;
using TeslaSync.App.Core.Data.Net;
using Xunit;
using GeneratedApi = TeslaSync.Windows.Generated.Api;

namespace TeslaSync.App.Tests.Data;

/// <summary>
/// Contract-drift guard: every operation id the repositories reference (the constants
/// in <see cref="Operations"/>) must resolve against the generated endpoint table, and
/// each must be a GET whose declared path-parameter count matches its template. If the
/// regenerated client ever renames or drops an operation, this test fails at build/test
/// time instead of at runtime.
/// </summary>
public sealed class OperationsResolveTests
{
    public static IEnumerable<object[]> AllOperationIds()
    {
        foreach (var nested in typeof(Operations).GetNestedTypes(BindingFlags.Public))
        {
            foreach (var field in nested.GetFields(BindingFlags.Public | BindingFlags.Static))
            {
                if (field.IsLiteral && field.FieldType == typeof(string))
                {
                    yield return new object[] { (string)field.GetValue(null)! };
                }
            }
        }
    }

    [Fact]
    public void Discovers_a_substantial_set_of_operations()
    {
        Assert.True(AllOperationIds().Count() >= 40, "Expected the repositories to cover at least 40 operations.");
    }

    [Theory]
    [MemberData(nameof(AllOperationIds))]
    public void Operation_resolves_and_path_params_match(string operationId)
    {
        var descriptor = GeneratedApi.ApiEndpoints.All.SingleOrDefault(e => e.OperationId == operationId);
        Assert.True(descriptor is not null, $"Operation '{operationId}' is not in the generated endpoint table.");

        Assert.Equal(GeneratedApi.HttpMethod.Get, descriptor!.Method);

        var braceCount = descriptor.Path.Count(c => c == '{');
        Assert.Equal(braceCount, descriptor.PathParams.Count);
    }
}
