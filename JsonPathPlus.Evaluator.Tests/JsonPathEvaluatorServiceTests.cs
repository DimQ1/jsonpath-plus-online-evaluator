using System.Text;
using System.Text.Json;
using JsonPathPlus.Evaluator.Services;
using JsonPathPlus.Evaluator.Workers;
using Xunit;

namespace JsonPathPlus.Evaluator.Tests;

public sealed class JsonPathEvaluatorServiceTests
{
    private const string OutputTruncationMessage = "Output truncated to keep the browser responsive.";

    [Fact]
    public async Task EvaluateAsync_WithManyLargeMatches_BoundsWorkerPayload()
    {
        var json = BuildLargePayloadDocument(itemCount: 140, payloadCharacters: 4_096);
        var service = new JsonPathEvaluatorService();

        var result = await service.EvaluateAsync(json, "$.items[*]");

        Assert.Null(result.Error);
        Assert.Equal(140, result.MatchCount);
        Assert.NotNull(result.FirstMatchPreview);
        Assert.Contains("\"payload\"", result.FirstMatchPreview!, StringComparison.Ordinal);
        Assert.Contains(OutputTruncationMessage, result.AllMatchesPreview, StringComparison.Ordinal);
        Assert.True(result.AllMatchesPreview.Length <= 505_000, $"All-matches preview length was {result.AllMatchesPreview.Length} characters.");

        var workerPayload = new JsonPathWorkerEvaluationResult(
            result.FirstMatchPreview,
            result.AllMatchesPreview,
            result.FirstPathPreview,
            result.AllPathsPreview,
            result.Error,
            result.MatchCount,
            result.JsonErrorLine,
            result.JsonErrorColumn);

        var serializedPayload = JsonSerializer.Serialize(workerPayload);
        Assert.Contains(OutputTruncationMessage, serializedPayload, StringComparison.Ordinal);
        Assert.True(serializedPayload.Length < json.Length, $"Worker payload length {serializedPayload.Length} should stay below source length {json.Length}.");
    }

    [Fact]
    public async Task EvaluateAsync_WithThousandsOfMatches_BoundsPathPreview()
    {
        var json = BuildScalarDocument(itemCount: 12_000);
        var service = new JsonPathEvaluatorService();

        var result = await service.EvaluateAsync(json, "$.items[*]");

        Assert.Null(result.Error);
        Assert.Equal(12_000, result.MatchCount);
        Assert.NotNull(result.FirstPathPreview);
        Assert.Equal("\"$.items[*]\"", result.FirstPathPreview);
        Assert.Contains(OutputTruncationMessage, result.AllPathsPreview, StringComparison.Ordinal);
        Assert.True(result.AllPathsPreview.Length <= 155_000, $"All-paths preview length was {result.AllPathsPreview.Length} characters.");
    }

    private static string BuildLargePayloadDocument(int itemCount, int payloadCharacters)
    {
        var payload = new string('x', payloadCharacters);
        var builder = new StringBuilder(itemCount * (payloadCharacters + 48));
        builder.Append("{\"items\":[");

        for (var index = 0; index < itemCount; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            builder
                .Append("{\"id\":")
                .Append(index)
                .Append(",\"payload\":\"")
                .Append(payload)
                .Append("\"}");
        }

        builder.Append("]}");
        return builder.ToString();
    }

    private static string BuildScalarDocument(int itemCount)
    {
        var builder = new StringBuilder(itemCount * 3 + 16);
        builder.Append("{\"items\":[");

        for (var index = 0; index < itemCount; index++)
        {
            if (index > 0)
            {
                builder.Append(',');
            }

            builder.Append(index % 10);
        }

        builder.Append("]}");
        return builder.ToString();
    }
}