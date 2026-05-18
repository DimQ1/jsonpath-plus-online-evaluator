using System.Linq;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;
using System.Text.Json;
using JsonPathPlus.Evaluator.Services;

namespace JsonPathPlus.Evaluator.Workers;

[SupportedOSPlatform("browser")]
internal static partial class JsonPathEvaluationWorkerExports
{
    [JSExport]
    internal static async Task<string> EvaluateAsync(string json, string? path, bool validateJson)
    {
        var evaluator = new JsonPathEvaluatorService();
        var result = await evaluator.EvaluateAsync(json, path, validateJson);

        var payload = new JsonPathWorkerEvaluationResult(
            result.FirstMatchPreview,
            result.AllMatchesPreview,
            result.FirstPathPreview,
            result.AllPathsPreview,
            result.Error,
            result.MatchCount,
            result.JsonErrorLine,
            result.JsonErrorColumn);

        return JsonSerializer.Serialize(payload);
    }
}