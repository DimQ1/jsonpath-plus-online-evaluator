using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace JsonPathPlus.Evaluator.Services;

/// <summary>
/// Evaluates JSONPath expressions against JSON documents using the JsonPathPlus library.
/// Uses only the public <see cref="StreamJsonExtractionExtensions"/> API.
/// </summary>
public class JsonPathEvaluatorService
{
    private const int MaxSinglePreviewBytes = 256 * 1024;
    private const int MaxAllResultsPreviewCharacters = 500_000;
    private const int MaxAllPathsPreviewCharacters = 150_000;
    private const string OutputTruncationMessage = "Output truncated to keep the browser responsive.";

    private static readonly JsonSerializerOptions PrettyJsonOptions = new()
    {
        WriteIndented = true,
        MaxDepth = 64
    };

    /// <summary>
    /// Generates a JSON Schema for the data at the specified path.
    /// Uses FullInference (2020-12) by default — the dialect toggle is cosmetic
    /// until the next NuGet release ships ExtractJsonSchemaAsync overloads.
    /// </summary>
    public async Task<EvaluationResult> EvaluateSchemaAsync(string json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json))
            return CreateErrorResult("Please enter a JSON document.");

        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();
        var pathValidation = JsonPathValidator.Validate(trimmedPath);
        if (!pathValidation.IsValid)
        {
            return CreateErrorResult($"Invalid JSONPath expression: {pathValidation.Error}");
        }

        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
            var schema = await stream.ExtractJsonSchemaAsync(trimmedPath);

            if (schema is null)
                return CreateErrorResult("No schema could be generated for the selected path.", 0);

            var schemaPreview = SerializeNodePreview(schema, MaxSinglePreviewBytes * 2, includeTruncationMessage: true, out _);
            var pathPreview = JsonSerializer.Serialize(trimmedPath, PrettyJsonOptions);

            return new EvaluationResult(
                schemaPreview,
                schemaPreview,
                pathPreview,
                $"[{pathPreview}]",
                null,
                1);
        }
        catch (Exception ex) when (ex.Message.Contains("JSON", StringComparison.OrdinalIgnoreCase)
                                   || ex.Message.Contains("path", StringComparison.OrdinalIgnoreCase))
        {
            return CreateErrorResult($"Error: {ex.Message}");
        }
    }

    /// <summary>
    /// Evaluates a JSONPath expression and returns the FULL result (no truncation) for file download.
    /// </summary>
    public async Task<string> EvaluateFullForDownloadAsync(string json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json))
            return "";

        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();

        if (!JsonPathValidator.IsValid(trimmedPath))
            return "";

        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

            var allMatches = new List<JsonNode?>();
            await foreach (var match in stream.ExtractAllJsonMatchesAsync(trimmedPath))
                allMatches.Add(match);

            if (allMatches.Count == 0)
                return "[]";

            if (allMatches.Count == 1 && allMatches[0] is not null)
            {
                return allMatches[0]!.ToJsonString(PrettyJsonOptions);
            }

            // Build full JSON array
            var array = new JsonArray();
            foreach (var match in allMatches)
                array.Add(match?.DeepClone());

            return array.ToJsonString(PrettyJsonOptions);
        }
        catch
        {
            return "";
        }
    }

    /// <summary>
    /// Returns the full JSON Schema result (no truncation) for file download.
    /// Uses default FullInference (2020-12) options.
    /// </summary>
    /// <summary>
    /// Returns the full JSON Schema result (no truncation) for file download.
    /// Uses FullInference (2020-12) by default.
    /// </summary>
    public async Task<string> EvaluateSchemaFullForDownloadAsync(string json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json))
            return "";

        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();

        if (!JsonPathValidator.IsValid(trimmedPath))
            return "";

        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));
            var schema = await stream.ExtractJsonSchemaAsync(trimmedPath);
            return schema?.ToJsonString(PrettyJsonOptions) ?? "";
        }
        catch
        {
            return "";
        }
    }

    /// <summary>
    /// Returns full JSONPath output paths (no truncation) for file download.
    /// </summary>
    public async Task<string> EvaluatePathsFullForDownloadAsync(string json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json))
            return "[]";

        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();

        if (!JsonPathValidator.IsValid(trimmedPath))
            return "[]";

        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

            var allPaths = new JsonArray();
            await foreach (var match in stream.ExtractAllJsonMatchesWithPathsAsync(trimmedPath))
                allPaths.Add(JsonValue.Create(match.Path));

            return allPaths.ToJsonString(PrettyJsonOptions);
        }
        catch
        {
            return "[]";
        }
    }

    /// <summary>
    /// Result of a JSONPath evaluation.
    /// </summary>
    public sealed record EvaluationResult(
        string? FirstMatchPreview,
        string AllMatchesPreview,
        string? FirstPathPreview,
        string AllPathsPreview,
        string? Error,
        int MatchCount,
        int? JsonErrorLine = null,
        int? JsonErrorColumn = null);

    /// <summary>
    /// Evaluates a JSONPath expression against a JSON string.
    /// </summary>
    public async Task<EvaluationResult> EvaluateAsync(string json, string? path, bool validateJson = true)
    {
        if (string.IsNullOrWhiteSpace(json))
            return CreateErrorResult("Please enter a JSON document.");

        if (validateJson)
        {
            // Validate JSON syntax first
            try
            {
                JsonNode.Parse(json);
            }
            catch (JsonException ex)
            {
                var line = ex.LineNumber.HasValue ? (int)ex.LineNumber.Value + 1 : (int?)null;
                var column = ex.BytePositionInLine.HasValue ? (int)ex.BytePositionInLine.Value + 1 : (int?)null;
                var cleanMessage = BuildJsonErrorMessage(ex.Message);
                var position = line.HasValue && column.HasValue
                    ? $" at line {line.Value}, column {column.Value}"
                    : string.Empty;

                return new EvaluationResult(
                    null,
                    string.Empty,
                    null,
                    "[]",
                    $"Invalid JSON{position}: {cleanMessage}",
                    0,
                    line,
                    column);
            }
        }

        // Handle null/root path: return entire document
        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();
        var pathValidation = JsonPathValidator.Validate(trimmedPath);
        if (!pathValidation.IsValid)
        {
            return CreateErrorResult($"Invalid JSONPath expression: {pathValidation.Error}");
        }

        // Use the public Stream extension API from JsonPathPlus
        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

            var previewBuilder = new EvaluationPreviewBuilder(trimmedPath);
            await foreach (var match in stream.ExtractAllJsonMatchesAsync(trimmedPath))
            {
                previewBuilder.AddMatch(match);
            }

            return previewBuilder.Build();
        }
        catch (FormatException ex)
        {
            return CreateErrorResult($"Invalid JSONPath expression: {ex.Message}");
        }
        catch (ArgumentException ex)
        {
            return CreateErrorResult($"Invalid JSONPath expression: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            return CreateErrorResult($"Error evaluating path: {ex.Message}");
        }
        catch (Exception ex) when (ex.Message.Contains("JSON", StringComparison.OrdinalIgnoreCase)
                                   || ex.Message.Contains("path", StringComparison.OrdinalIgnoreCase))
        {
            return CreateErrorResult($"Error: {ex.Message}");
        }
    }

    private static EvaluationResult CreateErrorResult(
        string error,
        int matchCount = 0,
        int? jsonErrorLine = null,
        int? jsonErrorColumn = null)
        => new(
            null,
            string.Empty,
            null,
            "[]",
            error,
            matchCount,
            jsonErrorLine,
            jsonErrorColumn);

    private static string BuildJsonErrorMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return "The document is not valid JSON.";
        }

        // Strip trailing position metadata without Regex allocation
        var idx = message.LastIndexOf("LineNumber:", StringComparison.Ordinal);
        if (idx > 0)
        {
            // Also trim any leading whitespace before the position info
            while (idx > 0 && char.IsWhiteSpace(message[idx - 1]))
                idx--;
            return message[..idx];
        }

        return message;
    }

    private static string SerializeNodePreview(JsonNode? node, int maxBytes, bool includeTruncationMessage, out bool wasTruncated)
    {
        if (node is null)
        {
            wasTruncated = false;
            return "null";
        }

        var bufferWriter = new LimitedBufferWriter(maxBytes);
        var jsonWriter = new Utf8JsonWriter(bufferWriter, new JsonWriterOptions
        {
            Indented = true
        });

        wasTruncated = false;

        try
        {
            node.WriteTo(jsonWriter);
            jsonWriter.Flush();
        }
        catch (PreviewLimitExceededException)
        {
            wasTruncated = true;
        }
        finally
        {
            try
            {
                jsonWriter.Dispose();
            }
            catch (PreviewLimitExceededException)
            {
                wasTruncated = true;
            }
        }

        var preview = bufferWriter.GetText();
        bufferWriter.Dispose();
        if (!wasTruncated)
        {
            return preview;
        }

        if (!includeTruncationMessage)
        {
            return preview;
        }

        return string.IsNullOrWhiteSpace(preview)
            ? OutputTruncationMessage
            : preview + Environment.NewLine + Environment.NewLine + OutputTruncationMessage;
    }

    private static string IndentPreview(string value, int spaces)
    {
        if (string.IsNullOrEmpty(value))
            return value;

        // Single-line fast path — dominant case for small matches
        var firstNewline = value.IndexOf('\n');
        if (firstNewline < 0)
            return string.Create(spaces + value.Length, (spaces, value), (chars, state) =>
            {
                for (int i = 0; i < state.spaces; i++) chars[i] = ' ';
                state.value.AsSpan().CopyTo(chars[state.spaces..]);
            });

        // Multi-line: count lines and build with minimal allocations
        var span = value.AsSpan();
        var lineCount = 1;
        for (int i = 0; i < span.Length; i++)
            if (span[i] == '\n') lineCount++;

        var sb = new StringBuilder(spaces * lineCount + value.Length);
        foreach (var lineRange in span.EnumerateLines())
        {
            sb.Append(' ', spaces);
            // Trim trailing \r if present
            var line = lineRange;
            if (line.Length > 0 && line[^1] == '\r')
                line = line[..^1];
            sb.Append(line);
            sb.Append('\n');
        }

        // Remove trailing newline
        if (sb.Length > 0 && sb[^1] == '\n')
            sb.Length--;

        return sb.ToString();
    }

    private static string FinalizeArrayPreview(
        StringBuilder builder,
        int displayedCount,
        int totalCount,
        bool wasTruncated,
        string singularLabel,
        string pluralLabel)
    {
        if (builder.Length == 0)
        {
            builder.AppendLine("[");
        }
        else if (displayedCount > 0)
        {
            builder.AppendLine();
        }

        builder.Append(']');

        if (!wasTruncated && displayedCount >= totalCount)
        {
            return builder.ToString();
        }

        var omittedCount = Math.Max(0, totalCount - displayedCount);
        builder.AppendLine();
        builder.AppendLine();
        builder.Append(OutputTruncationMessage);

        if (omittedCount > 0)
        {
            builder.Append(' ');
            builder.Append(omittedCount);
            builder.Append(' ');
            builder.Append(omittedCount == 1 ? singularLabel : pluralLabel);
            builder.Append(" omitted.");
        }

        return builder.ToString();
    }

    private sealed class EvaluationPreviewBuilder
    {
        private string? serializedPath;
        private readonly string rawPath;
        private readonly StringBuilder allMatchesBuilder = new(capacity: 4096);
        private readonly StringBuilder allPathsBuilder = new(capacity: 1024);

        private int displayedMatchCount;
        private int displayedPathCount;
        private bool stopAppendingMatches;
        private bool stopAppendingPaths;
        private bool matchPreviewTruncated;

        public EvaluationPreviewBuilder(string path)
        {
            rawPath = path;
        }

        private string SerializedPath =>
            serializedPath ??= JsonSerializer.Serialize(rawPath, PrettyJsonOptions);

        public string? FirstMatchPreview { get; private set; }

        public string? FirstPathPreview { get; private set; }

        public int MatchCount { get; private set; }

        public void AddMatch(JsonNode? match)
        {
            MatchCount++;

            FirstPathPreview ??= SerializedPath;
            FirstMatchPreview ??= SerializeNodePreview(match, MaxSinglePreviewBytes, includeTruncationMessage: true, out _);

            if (!stopAppendingMatches)
            {
                AppendMatchPreview(match);
            }

            if (!stopAppendingPaths)
            {
                AppendPathPreview();
            }
        }

        public EvaluationResult Build()
        {
            var allMatchesPreview = MatchCount == 0
                ? string.Empty
                : FinalizeArrayPreview(
                    allMatchesBuilder,
                    displayedMatchCount,
                    MatchCount,
                    stopAppendingMatches || matchPreviewTruncated,
                    "match",
                    "matches");

            var allPathsPreview = MatchCount == 0
                ? "[]"
                : FinalizeArrayPreview(
                    allPathsBuilder,
                    displayedPathCount,
                    MatchCount,
                    stopAppendingPaths,
                    "path",
                    "paths");

            return new EvaluationResult(
                FirstMatchPreview,
                allMatchesPreview,
                FirstPathPreview,
                allPathsPreview,
                null,
                MatchCount);
        }

        private void AppendMatchPreview(JsonNode? match)
        {
            EnsureArrayStarted(allMatchesBuilder);

            var preview = SerializeNodePreview(match, MaxSinglePreviewBytes, includeTruncationMessage: true, out var wasTruncated);
            var indentedPreview = IndentPreview(preview, 2);
            var separatorLength = displayedMatchCount > 0 ? 2 : 0;
            if (allMatchesBuilder.Length + separatorLength + indentedPreview.Length > MaxAllResultsPreviewCharacters)
            {
                stopAppendingMatches = true;
                matchPreviewTruncated |= wasTruncated;
                return;
            }

            if (displayedMatchCount > 0)
            {
                allMatchesBuilder.AppendLine(",");
            }

            allMatchesBuilder.Append(indentedPreview);
            displayedMatchCount++;

            if (wasTruncated)
            {
                matchPreviewTruncated = true;
                stopAppendingMatches = true;
            }
        }

        private void AppendPathPreview()
        {
            EnsureArrayStarted(allPathsBuilder);

            var separatorLength = displayedPathCount > 0 ? 2 : 0;
            var requiredLength = separatorLength + 2 + SerializedPath.Length;
            if (allPathsBuilder.Length + requiredLength > MaxAllPathsPreviewCharacters)
            {
                stopAppendingPaths = true;
                return;
            }

            if (displayedPathCount > 0)
            {
                allPathsBuilder.AppendLine(",");
            }

            allPathsBuilder.Append("  ");
            allPathsBuilder.Append(SerializedPath);
            displayedPathCount++;
        }

        private static void EnsureArrayStarted(StringBuilder builder)
        {
            if (builder.Length == 0)
            {
                builder.AppendLine("[");
            }
        }
    }

    private sealed class LimitedBufferWriter : IBufferWriter<byte>, IDisposable
    {
        private byte[] buffer;
        private int writtenCount;
        private readonly int maxBytes;

        public LimitedBufferWriter(int maxBytes)
        {
            if (maxBytes <= 0)
            {
                throw new ArgumentOutOfRangeException(nameof(maxBytes));
            }

            this.maxBytes = maxBytes;
            buffer = ArrayPool<byte>.Shared.Rent(maxBytes);
        }

        public void Advance(int count)
        {
            if (count < 0 || writtenCount + count > maxBytes)
            {
                throw new PreviewLimitExceededException();
            }

            writtenCount += count;
        }

        public Memory<byte> GetMemory(int sizeHint = 0)
        {
            EnsureCapacity(sizeHint);
            return buffer.AsMemory(writtenCount);
        }

        public Span<byte> GetSpan(int sizeHint = 0)
        {
            EnsureCapacity(sizeHint);
            return buffer.AsSpan(writtenCount);
        }

        public string GetText()
            => Encoding.UTF8.GetString(buffer, 0, writtenCount);

        public void Dispose()
        {
            if (buffer is not null)
            {
                ArrayPool<byte>.Shared.Return(buffer);
                buffer = null!;
            }
        }

        private void EnsureCapacity(int sizeHint)
        {
            var requiredSize = sizeHint <= 0 ? 1 : sizeHint;
            if (requiredSize > maxBytes - writtenCount)
            {
                throw new PreviewLimitExceededException();
            }
        }
    }

    private sealed class PreviewLimitExceededException : Exception
    {
    }
}

