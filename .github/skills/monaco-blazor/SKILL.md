---
name: monaco-blazor
description: >
  Integrate monaco-editor into a Blazor WebAssembly project via AMD CDN loader
  and JS interop. Use when adding a code/text editor widget to a Blazor WASM
  page — read/write content, handle change events, set error markers, apply
  custom options, suppress context-menu items, or dispose editors safely.
argument-hint: 'Describe the editor(s) needed: language, read/write, Blazor events to wire'
user-invocable: true
---

# Monaco Editor in Blazor WebAssembly

## When to Use
Use this skill when asked to:
- embed Monaco editor in a Blazor WASM page
- wire Monaco change events to a `[JSInvokable]` C# method
- set text, error markers, or scroll position from C#
- suppress context-menu items (e.g. "Change All Occurrences")
- create read-only result/diff editors alongside editable ones
- dispose editors safely when the Blazor component is disposed

## Outcome
A working Monaco integration with:
- lazy AMD loader (no npm/bundler required)
- IIFE JS interop module with a clean public surface (`window.myMonaco.*`)
- `DotNetObjectReference<T>` for two-way C# ↔ JS messaging
- safe `dispose()` that cleans up editors, models, and observers

---

## Key Concepts

### Models vs Editors
- A **model** holds content + language + URI. Reuse models across editor instances.
- An **editor** is the DOM view. Always `dispose()` the editor when done; dispose the model only if no other editor uses it.
- Two models can share the same URI only if they are the same `ITextModel` instance.

### URI uniqueness
```js
var uri = monaco.Uri.parse('file:///myfile.json');
var model = monaco.editor.getModel(uri) || monaco.editor.createModel('', 'json', uri);
```
Use `getModel` before `createModel` to avoid "model already exists" errors on hot reload.

---

## Project Structure

```
wwwroot/
  index.html            ← load AMD loader here
  js/
    monacoInterop.js    ← IIFE interop module
```

---

## Step 1 — index.html: load AMD loader

Add **before** the Blazor script tag:

```html
<!-- Monaco AMD loader (no bundler needed) -->
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/loader.js"></script>

<!-- Your interop module (IIFE, not ES module) -->
<script src="js/monacoInterop.js"></script>
```

> **Do NOT** use `type="module"` on monacoInterop.js — the AMD loader and
> `window.require` must be in the global scope before Monaco is loaded.

---

## Step 2 — monacoInterop.js: lazy loader + IIFE pattern

Use a single IIFE so internal state (editor refs, model refs, dotNet ref) is
module-scoped and not polluting `window`.

```js
(function () {
    var monacoBaseUrl = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs';
    var monacoReadyPromise = null;
    var editor = null;
    var editorModel = null;
    var dotNetReference = null;
    var suppressChange = false;

    // ── Lazy Monaco load ──────────────────────────────────────────────────────
    function ensureMonaco() {
        if (monacoReadyPromise) return monacoReadyPromise;
        monacoReadyPromise = new Promise(function (resolve, reject) {
            if (!window.require) {
                reject(new Error('AMD loader not found. Add loader.js before monacoInterop.js.'));
                return;
            }
            window.require.config({ paths: { vs: monacoBaseUrl } });
            window.require(['vs/editor/editor.main'], function () {
                resolve(window.monaco);
            }, reject);
        });
        return monacoReadyPromise;
    }

    // ── Model helper ─────────────────────────────────────────────────────────
    function getOrCreateModel(monacoInstance, uriText, value, language) {
        var uri = monacoInstance.Uri.parse(uriText);
        var model = monacoInstance.editor.getModel(uri);
        if (!model) {
            model = monacoInstance.editor.createModel(value || '', language || 'json', uri);
        } else if (model.getValue() !== (value || '')) {
            model.setValue(value || '');
        }
        return model;
    }

    // ── Default editor options ────────────────────────────────────────────────
    function editorOptions(readOnly) {
        return {
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            formatOnPaste: !readOnly,
            formatOnType: !readOnly,
            readOnly: readOnly,
            lineNumbers: 'on',
            folding: true,
            tabSize: 2,
            insertSpaces: true,
            fontSize: 13,
            fontFamily: 'Cascadia Code, Fira Code, Consolas, monospace',
            occurrencesHighlight: 'off',
            selectionHighlight: false
        };
    }

    // ── Public API ────────────────────────────────────────────────────────────
    window.myMonaco = {
        // Call from Blazor OnAfterRenderAsync (firstRender only).
        // elementRef  — @ref on the host <div>
        // dotNetRef   — DotNetObjectReference<MyComponent>
        // initialValue — initial text
        initialize: async function (elementRef, dotNetRef, initialValue) {
            var monacoInstance = await ensureMonaco();
            dotNetReference = dotNetRef;

            if (editor) { editor.dispose(); }

            editorModel = getOrCreateModel(monacoInstance, 'file:///editor', initialValue || '', 'json');
            editor = monacoInstance.editor.create(elementRef, Object.assign(editorOptions(false), {
                model: editorModel
            }));

            editor.onDidChangeModelContent(function () {
                if (suppressChange || !dotNetReference) return;
                dotNetReference.invokeMethodAsync('OnEditorContentChanged', editorModel.getValue());
            });
        },

        // Push a new value from C# without triggering the change callback.
        setValue: function (value) {
            if (!editorModel || editorModel.getValue() === (value || '')) return;
            suppressChange = true;
            editorModel.setValue(value || '');
            suppressChange = false;
        },

        getValue: function () {
            return editorModel ? editorModel.getValue() : '';
        },

        // Show an inline error squiggle at a specific line/column.
        setErrorMarker: function (line, column, message) {
            if (!window.monaco || !editorModel) return;
            if (!line || !message) {
                window.monaco.editor.setModelMarkers(editorModel, 'myapp', []);
                return;
            }
            window.monaco.editor.setModelMarkers(editorModel, 'myapp', [{
                severity: window.monaco.MarkerSeverity.Error,
                message: message,
                startLineNumber: Math.max(1, line),
                startColumn: Math.max(1, column || 1),
                endLineNumber: Math.max(1, line),
                endColumn: Math.max(1, column || 1) + 1
            }]);
        },

        revealLine: function (line) {
            if (editor && line) {
                editor.revealLineInCenter(line);
                editor.setPosition({ lineNumber: line, column: 1 });
                editor.focus();
            }
        },

        focus: function () {
            if (editor) editor.focus();
        },

        dispose: function () {
            if (editor) { editor.dispose(); editor = null; }
            dotNetReference = null;
        }
    };
})();
```

---

## Step 3 — Razor component

```razor
@page "/editor-demo"
@inject IJSRuntime JS
@implements IAsyncDisposable

<div @ref="editorHostRef"
     style="height: 400px; border: 1px solid #ccc;"
     aria-label="Code editor">
</div>

@if (!string.IsNullOrEmpty(content))
{
    <pre>@content</pre>
}

@code {
    private ElementReference editorHostRef;
    private DotNetObjectReference<EditorDemo>? dotNetRef;
    private string content = "";
    private bool monacoReady;

    protected override async Task OnAfterRenderAsync(bool firstRender)
    {
        if (!firstRender) return;

        dotNetRef = DotNetObjectReference.Create(this);
        await JS.InvokeVoidAsync(
            "myMonaco.initialize",
            editorHostRef,
            dotNetRef,
            "{ \"hello\": \"world\" }");

        monacoReady = true;
    }

    // Called by Monaco JS on every edit (debounce in JS if needed).
    [JSInvokable]
    public Task OnEditorContentChanged(string value)
    {
        content = value;
        StateHasChanged();
        return Task.CompletedTask;
    }

    // Push a value into the editor from C# without triggering OnEditorContentChanged.
    private async Task SetEditorValueAsync(string value)
    {
        if (!monacoReady) return;
        await JS.InvokeVoidAsync("myMonaco.setValue", value);
    }

    public async ValueTask DisposeAsync()
    {
        if (monacoReady)
        {
            try { await JS.InvokeVoidAsync("myMonaco.dispose"); }
            catch { /* ignore teardown failures */ }
        }
        dotNetRef?.Dispose();
    }
}
```

---

## Step 4 — Multiple editors on one page

Use separate IIFE namespaces or a factory pattern:

```js
// Pattern: factory returning editor instances
window.myMonaco = (function () {
    var instances = {};

    return {
        create: async function (id, elementRef, dotNetRef, initialValue, language, readOnly) {
            var monacoInstance = await ensureMonaco();
            if (instances[id]) instances[id].editor.dispose();

            var model = getOrCreateModel(monacoInstance, 'file:///' + id, initialValue || '', language || 'json');
            var ed = monacoInstance.editor.create(elementRef, Object.assign(editorOptions(!!readOnly), { model: model }));

            if (dotNetRef && !readOnly) {
                ed.onDidChangeModelContent(function () {
                    dotNetRef.invokeMethodAsync('OnEditorContentChanged', id, model.getValue());
                });
            }

            instances[id] = { editor: ed, model: model };
        },

        setValue: function (id, value) {
            var inst = instances[id];
            if (!inst || inst.model.getValue() === (value || '')) return;
            inst.model.setValue(value || '');
        },

        dispose: function (id) {
            if (instances[id]) {
                instances[id].editor.dispose();
                delete instances[id];
            }
        }
    };
})();
```

---

## Common Pitfalls

| Problem | Cause | Fix |
|---|---|---|
| Editor renders but is 0px tall | Container has no height | Set explicit `height` or `flex: 1` on host `<div>` |
| "Model already exists" on hot reload | `createModel` called twice for same URI | Always call `getModel(uri)` first |
| Change event loops | C# sets value → JS fires `onDidChangeModelContent` → C# sets again | Guard with `suppressChange` flag |
| `DotNetObjectReference` leak | Not disposed on page teardown | Call `dotNetRef?.Dispose()` in `DisposeAsync` |
| Context-menu items still show | Monaco re-renders menu DOM after opening | Use `MutationObserver` + `onContextMenu` hook (see Suppress Menu Items section) |
| Editor blank after Blazor navigation | Editor disposed but model not re-created | Call `initialize` again in `OnAfterRenderAsync(firstRender: true)` |
| Read-only editor still editable | `readOnly` option ignored | Also set `domReadOnly: true` in options for full keyboard lock |

---

## Suppress Context-Menu Items

Monaco re-builds the context-menu DOM every time it opens, so `display:none` set
once is insufficient. Use a `MutationObserver` + an `onContextMenu` hook:

```js
var menuObserver = null;

function hideMenuItem(labelText) {
    document.querySelectorAll('div, span, li').forEach(function (node) {
        if ((node.textContent || '').trim() !== labelText) return;
        var item = (node.closest && node.closest('li, [role="menuitem"], .action-item')) || node.parentElement || node;
        item.style.display = 'none';
        item.setAttribute('aria-hidden', 'true');
    });
}

function scheduleHide(labelText) {
    window.setTimeout(function () { hideMenuItem(labelText); }, 0);
    window.setTimeout(function () { hideMenuItem(labelText); }, 40);
}

function startMenuFilter(labelText) {
    if (menuObserver) return;
    menuObserver = new MutationObserver(function () { hideMenuItem(labelText); });
    menuObserver.observe(document.body, { childList: true, subtree: true });
}

// After editor.create():
editor.onContextMenu(function () { scheduleHide('Change All Occurrences'); });
startMenuFilter('Change All Occurrences');

// Override keyboard shortcut too (Ctrl+F2):
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2, function () {});
```

---

## Language Diagnostics (JSON example)

```js
monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    trailingCommas: 'error'
});
```
Call once after `require(['vs/editor/editor.main'], ...)` resolves.

---

## Error Markers from C#

```csharp
await JS.InvokeVoidAsync("myMonaco.setErrorMarker", lineNumber, column, "Invalid JSON at this position");
// Clear:
await JS.InvokeVoidAsync("myMonaco.setErrorMarker", null, null, null);
```

---

## Blazor WASM Web Worker note

If Monaco is also used inside a Blazor WASM Web Worker (via `dotnet.create()`),
disable debug-symbol downloads in the worker to prevent `Failed to fetch *.pdb` errors:

```js
// In jsonPathEvaluationWorker.js or equivalent:
const { getAssemblyExports, getConfig } = await dotnet
    .withDebugging(0)   // ← prevents PDB download inside worker
    .create();
```

---

## References
- Monaco API docs: https://microsoft.github.io/monaco-editor/docs.html
- Monaco playground: https://microsoft.github.io/monaco-editor/playground.html
- ESM integration guide: https://github.com/microsoft/monaco-editor/blob/main/docs/integrate-esm.md
- monaco.d.ts (full API): https://github.com/microsoft/monaco-editor/blob/gh-pages/node_modules/monaco-editor/monaco.d.ts
- This project's interop: [JsonPathPlus.Evaluator/wwwroot/js/monacoInterop.js](../../../../JsonPathPlus.Evaluator/wwwroot/js/monacoInterop.js)
