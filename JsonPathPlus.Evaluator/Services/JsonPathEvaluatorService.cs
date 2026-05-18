using System;
using System.Collections.Generic;
using System.IO;
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
        string? Error,
        int MatchCount)
    {
        public JsonNode? FirstMatch => MatchCount > 0 ? AllMatches[0] : null;
    }

    /// <summary>
    /// Evaluates a JSONPath expression against a JSON string.
    /// </summary>
    public async Task<EvaluationResult> EvaluateAsync(string json, string? path)
    {
        if (string.IsNullOrWhiteSpace(json))
            return new EvaluationResult(new List<JsonNode?>(), "Please enter a JSON document.", 0);

        // Validate JSON syntax first
        try
        {
            JsonNode.Parse(json);
        }
        catch (JsonException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                $"Invalid JSON: {ex.Message}",
                0);
        }

        // Handle null/root path: return entire document
        var trimmedPath = string.IsNullOrWhiteSpace(path) ? "$" : path.Trim();
        if (trimmedPath == "$")
        {
            var root = JsonNode.Parse(json);
            return new EvaluationResult(
                new List<JsonNode?> { root! },
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

            return new EvaluationResult(
                allMatches,
                null,
                allMatches.Count);
        }
        catch (FormatException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                $"Invalid JSONPath expression: {ex.Message}",
                0);
        }
        catch (ArgumentException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                $"Invalid JSONPath expression: {ex.Message}",
                0);
        }
        catch (InvalidOperationException ex)
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                $"Error evaluating path: {ex.Message}",
                0);
        }
        catch (Exception ex) when (ex.Message.Contains("JSON", StringComparison.OrdinalIgnoreCase)
                                   || ex.Message.Contains("path", StringComparison.OrdinalIgnoreCase))
        {
            return new EvaluationResult(
                new List<JsonNode?>(),
                $"Error: {ex.Message}",
                0);
        }
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

