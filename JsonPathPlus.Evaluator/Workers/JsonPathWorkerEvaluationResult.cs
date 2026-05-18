namespace JsonPathPlus.Evaluator.Workers;

public sealed class JsonPathWorkerEvaluationResult
{
    public string? FirstMatchPreview { get; set; }

    public string AllMatchesPreview { get; set; } = string.Empty;

    public string? FirstPathPreview { get; set; }

    public string AllPathsPreview { get; set; } = "[]";

    public string? Error { get; set; }

    public int MatchCount { get; set; }

    public int? JsonErrorLine { get; set; }

    public int? JsonErrorColumn { get; set; }

    public JsonPathWorkerEvaluationResult()
    {
    }

    public JsonPathWorkerEvaluationResult(
        string? firstMatchPreview,
        string allMatchesPreview,
        string? firstPathPreview,
        string allPathsPreview,
        string? error,
        int matchCount,
        int? jsonErrorLine = null,
        int? jsonErrorColumn = null)
    {
        FirstMatchPreview = firstMatchPreview;
        AllMatchesPreview = allMatchesPreview;
        FirstPathPreview = firstPathPreview;
        AllPathsPreview = allPathsPreview;
        Error = error;
        MatchCount = matchCount;
        JsonErrorLine = jsonErrorLine;
        JsonErrorColumn = jsonErrorColumn;
    }
}