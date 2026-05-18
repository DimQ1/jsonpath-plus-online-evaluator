using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;

namespace JsonPathPlus.Evaluator.Services;

/// <summary>
/// Evaluates JSONPath expressions against JSON documents using the JsonPathPlus library.
/// Uses only the public <see cref="StreamJsonExtractionExtensions"/> API.
/// </summary>
public class JsonPathEvaluatorService
{
    /// <summary>
    /// Result of a JSONPath evaluation.
    /// </summary>
    public sealed record EvaluationResult(
        List<JsonNode?> AllMatches,
        List<string> AllMatchPaths,
        string? Error,
        int MatchCount,
        int? JsonErrorLine = null,
        int? JsonErrorColumn = null)
    {
        public JsonNode? FirstMatch => MatchCount > 0 ? AllMatches[0] : null;
    }

    /// <summary>
    /// Evaluates a JSONPath expression against a JSON string.
    /// </summary>
    public async Task<EvaluationResult> EvaluateAsync(string json, string? path, bool validateJson = true)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new EvaluationResult(new List<JsonNode?>(), new List<string>(), "Please enter a JSON document.", 0);

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
                    new List<JsonNode?>(),
                    new List<string>(),
                    $"Invalid JSON{position}: {cleanMessage}",
                    0,
                    line,
                    column);
            }
        }

        // Handle null/root path: return entire document
        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();
        if (trimmedPath == "$")
        {
            var root = JsonNode.Parse(json);
            return new EvaluationResult(
                new List<JsonNode?> { root! },
                new List<string> { "$" },
                null,
                1);
        }

        // Use the public Stream extension API from JsonPathPlus
        try
        {
            using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

            // Try parsing the path first to get an early error
            // Note: The Stream extension methods will throw on invalid path,
            // so we use try/catch to provide user-friendly errors
            var allMatches = new List<JsonNode?>();
            await foreach (var match in stream.ExtractAllJsonMatchesAsync(trimmedPath))
            {
                allMatches.Add(match);
            }

            // JsonPathPlus public API does not return concrete paths for each match,
            // so use the evaluated expression for display context.
            var allMatchPaths = Enumerable.Repeat(trimmedPath, allMatches.Count).ToList();

            return new EvaluationResult(
                allMatches,
                allMatchPaths,
                null,
                allMatches.Count);
        }
        catch (FormatException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                new List<string>(),
                $"Invalid JSONPath expression: {ex.Message}",
                0);
        }
        catch (ArgumentException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                new List<string>(),
                $"Invalid JSONPath expression: {ex.Message}",
                0);
        }
        catch (InvalidOperationException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                new List<string>(),
                $"Error evaluating path: {ex.Message}",
                0);
        }
        catch (Exception ex) when (ex.Message.Contains("JSON", StringComparison.OrdinalIgnoreCase)
                                   || ex.Message.Contains("path", StringComparison.OrdinalIgnoreCase))
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                new List<string>(),
                $"Error: {ex.Message}",
                0);
        }
    }

    private static string BuildJsonErrorMessage(string message)
    {
        if (string.IsNullOrWhiteSpace(message))
        {
            return "The document is not valid JSON.";
        }

        return Regex.Replace(
            message,
            @"\s*LineNumber:\s*\d+\s*\|\s*BytePositionInLine:\s*\d+\.?\s*$",
            string.Empty,
            RegexOptions.CultureInvariant);
    }

    /// <summary>
    /// Pretty-prints a JsonNode to a formatted JSON string.
    /// </summary>
    public static string PrettyPrint(JsonNode? node)
    {
        if (node is null)
            return "null";

        var options = new JsonSerializerOptions
        {
            WriteIndented = true,
            MaxDepth = 64
        };

        return node.ToJsonString(options);
    }
}

