# AGENTS

## Project Scope
- Interactive Blazor WebAssembly JSONPath evaluator, inspired by [jsonpath.com](https://jsonpath.com/).
- Target framework: net8.0.
- Live site: [dimq1.github.io/jsonpath-plus-online-evaluator](https://dimq1.github.io/jsonpath-plus-online-evaluator/)
- Consumes [JsonPathPlus](https://www.nuget.org/packages/JsonPathPlus) v1.0.0 for JSON path evaluation.
- Sibling workspace: JsonPathPlus library at `../JsonPathPlus`.

## Start Here
- Product and feature status: [README.md](../README.md)
- Library AGENTS: [../JsonPathPlus/AGENTS.md](../JsonPathPlus/AGENTS.md)

## Build And Run
- Build: `dotnet build JsonPathPlus.Evaluator/JsonPathPlus.Evaluator.csproj`
- Run dev server: `dotnet run --project JsonPathPlus.Evaluator/JsonPathPlus.Evaluator.csproj --framework net8.0`
- Publish for prod: `dotnet publish JsonPathPlus.Evaluator/JsonPathPlus.Evaluator.csproj -c Release -o publish`

## Architecture

### Single Page App
- **1 page**: [Index.razor](JsonPathPlus.Evaluator/Pages/Index.razor) (~600 lines, single `@code` block)
- **1 service**: [JsonPathEvaluatorService.cs](JsonPathPlus.Evaluator/Services/JsonPathEvaluatorService.cs) — wraps `StreamJsonExtractionExtensions` public API
- **1 CSS file**: [app.css](JsonPathPlus.Evaluator/wwwroot/css/app.css) — no framework, CSS variables, responsive grid

### Three-Panel Layout
- **Header**: title, version badge, action buttons (Reset, Share, NuGet link, GitHub link)
- **Path input bar**: JSONPath expression input + First/All toggle
- **Left panel**: JSON document textarea + Import File button
- **Right panel**: Evaluation results (match count, pretty-printed JSON)
- **Footer**: Collapsible syntax reference table (18 clickable examples)

### Key Patterns
- **Debounced evaluation**: 300ms `Timer` between keystroke and re-evaluation
- **URL sharing**: `#json={escaped}&path={escaped}` hash encoding; restored on init
- **Error routing**: `jsonError` for invalid JSON, `pathError` for invalid path expression
- **File import**: Blazor `InputFile` component, max 10MB
- **JS interop**: clipboard API, URL hash parsing, file picker trigger

## Deployment
- **Trigger**: push to `main` that changes files under `JsonPathPlus.Evaluator/**`
- **Workflow**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
  1. `dotnet publish -c Release -o publish`
  2. Rewrite `<base href>` to `/jsonpath-plus-online-evaluator/`
  3. Push `publish/wwwroot` to `gh-pages` branch via `peaceiris/actions-gh-pages@v4`
- **Live URL**: `https://dimq1.github.io/jsonpath-plus-online-evaluator/`

## Known Pitfalls
- `.nojekyll` must be present in `wwwroot` or GitHub Pages won't serve `_framework/` files.
- `nuget.config` clears sources to only `nuget.org` — corporate feeds cause 401.
- The workflow path filter means changes to `.github/workflows/deploy.yml` alone won't trigger deployment; also touch a file under `JsonPathPlus.Evaluator/`.
- The `ghaction-rewrite-base-href` action only has `v1` / `v1.1.0` tags; `v2` does not exist.

## Agent Behavior Guidance
- The evaluator is a thin consumer of JsonPathPlus; changes to evaluation logic should happen in the library first.
- When modifying [Index.razor](JsonPathPlus.Evaluator/Pages/Index.razor), the single `@code` block holds all state; keep it that way unless the file grows significantly.
- Keep CSS changes scoped to the evaluator — don't cross-contaminate with library styles.
- Prefer `dotnet build` before `dotnet run` to catch Razor/Blazor compilation errors early.
