namespace JsonPathPlus.Evaluator.Workers;

public sealed class JsonPathWorkerEvaluationResult
{
    public List<string> PrettyMatches { get; set; } = new();

    public List<string> AllMatchPaths { get; set; } = new();

    public string? Error { get; set; }

    public int MatchCount { get; set; }

    public int? JsonErrorLine { get; set; }

    public int? JsonErrorColumn { get; set; }

    public JsonPathWorkerEvaluationResult()
    {
    }

    public JsonPathWorkerEvaluationResult(
        List<string> prettyMatches,
        List<string> allMatchPaths,
        string? error,
        int matchCount,
        int? jsonErrorLine = null,
        int? jsonErrorColumn = null)
    {
        PrettyMatches = prettyMatches;
        AllMatchPaths = allMatchPaths;
        Error = error;
        MatchCount = matchCount;
        JsonErrorLine = jsonErrorLine;
        JsonErrorColumn = jsonErrorColumn;
    }
}