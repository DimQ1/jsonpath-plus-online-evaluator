# JsonPathPlus Online Evaluator

An interactive, browser-based JSONPath evaluator built with Blazor WebAssembly, inspired by [jsonpath.com](https://jsonpath.com/). Uses the [JsonPathPlus](https://www.nuget.org/packages/JsonPathPlus) NuGet package for JSON path evaluation.

**[Try it live](https://dimq1.github.io/jsonpath-plus-online-evaluator/)**

## Features

- **JSONPath expression input** with live evaluation (300ms debounce)
- **JSON document editor** with syntax error highlighting
- **Import JSON files** from disk
- **First match / All matches** toggle
- **Syntax reference table** with 18 clickable examples
- **Share via URL** — encode JSON + path in the URL hash
- **Preloaded sample** document for immediate exploration
- **Responsive layout** — two-column on desktop, stacked on mobile

## Supported JSONPath Syntax

| Syntax | Description |
|---|---|
| `$` | Root document |
| `$.prop` | Property access |
| `$.a.b.c` | Dot-chain nesting |
| `$.arr[0]` | Array index |
| `$.arr[1:3]` | Array range |
| `$.arr[:2]` | Open-start range |
| `$.arr[2:]` | Open-end range |
| `$.arr[*]` | Wildcard array |
| `$.obj.*` | Wildcard object |
| `$.arr[-1]` | Negative index |
| `$.arr[-2:]` | Negative range |
| `$.arr[0,2]` | Union indices |
| `$.obj[n1,n2]` | Union properties |
| `$..prop` | Recursive descent |
| `$..*` | Recursive all |
| `$.arr[?(@.prop)]` | Existence filter |
| `$.arr[?(@.p < 10)]` | Comparison filter |
| `$.arr[?(@.p>1 && @.p<5)]` | Logical filter |
| `$.arr[(@.length-1)]` | Computed index |

## Local Development

```bash
# Prerequisites: .NET 8.0 SDK

# Clone the repository
git clone https://github.com/Dimq1/jsonpath-plus-online-evaluator.git
cd jsonpath-plus-online-evaluator

# Restore and run
cd JsonPathPlus.Evaluator
dotnet run

# Open http://localhost:5000 in your browser
```

## Deployment

This project is automatically deployed to GitHub Pages via GitHub Actions on every push to `main`.

**Workflow**: `.github/workflows/deploy.yml`

The workflow:
1. Restores .NET dependencies
2. Publishes the Blazor WASM app in Release mode
3. Rewrites the `<base href>` for the GitHub Pages sub-path
4. Deploys to GitHub Pages

## Built With

- [Blazor WebAssembly](https://dotnet.microsoft.com/apps/aspnet/web-apps/blazor) — .NET in the browser
- [JsonPathPlus](https://www.nuget.org/packages/JsonPathPlus) — JSONPath evaluation library
- [System.Text.Json](https://learn.microsoft.com/dotnet/api/system.text.json) — JSON parsing

## License

MIT — see the [JsonPathPlus](https://github.com/Dimq1/JsonPathPlus) repository for details.
