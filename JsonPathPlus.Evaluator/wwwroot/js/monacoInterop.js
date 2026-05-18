(function () {
    var monacoBaseUrl = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs';
    var monacoReadyPromise = null;
    var hoverRegistration = null;
    var jsonEditor = null;
    var resultEditor = null;
    var jsonModel = null;
    var resultModel = null;
    var dotNetReference = null;
    var suppressJsonChange = false;

    function ensureMonaco() {
        if (monacoReadyPromise) {
            return monacoReadyPromise;
        }

        monacoReadyPromise = new Promise(function (resolve, reject) {
            if (!window.require) {
                reject(new Error('Monaco loader was not found.'));
                return;
            }

            window.require.config({ paths: { vs: monacoBaseUrl } });
            window.require(['vs/editor/editor.main'], function () {
                configureJsonLanguage(window.monaco);
                registerJsonHoverProvider(window.monaco);
                resolve(window.monaco);
            }, reject);
        });

        return monacoReadyPromise;
    }

    function configureJsonLanguage(monacoInstance) {
        monacoInstance.languages.json.jsonDefaults.setDiagnosticsOptions({
            validate: true,
            allowComments: false,
            trailingCommas: 'error'
        });
    }

    function registerJsonHoverProvider(monacoInstance) {
        if (hoverRegistration) {
            return;
        }

        hoverRegistration = monacoInstance.languages.registerHoverProvider('json', {
            provideHover: function (model, position) {
                var path = getJsonPathAtPosition(model, position);
                if (!path) {
                    return null;
                }

                var word = model.getWordAtPosition(position);
                var range = word
                    ? new monacoInstance.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn)
                    : new monacoInstance.Range(position.lineNumber, position.column, position.lineNumber, position.column);

                return {
                    range: range,
                    contents: [
                        { value: '**Normalized Path**' },
                        { value: '`' + path.replace(/`/g, '\\`') + '`' }
                    ]
                };
            }
        });
    }

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
            foldingStrategy: 'auto',
            showFoldingControls: 'mouseover',
            renderIndentGuides: true,
            guides: {
                indentation: true,
                highlightActiveIndentation: true,
                bracketPairs: false
            },
            tabSize: 2,
            insertSpaces: true,
            fontFamily: 'Cascadia Code, Fira Code, JetBrains Mono, Consolas, monospace',
            fontSize: 13,
            lineHeight: 20,
            padding: { top: 0, bottom: 0 },
            scrollbar: {
                verticalScrollbarSize: 12,
                horizontalScrollbarSize: 12
            },
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            occurrencesHighlight: 'off',
            selectionHighlight: false,
            renderLineHighlight: 'line'
        };
    }

    function getOrCreateModel(monacoInstance, uriText, value) {
        var uri = monacoInstance.Uri.parse(uriText);
        var model = monacoInstance.editor.getModel(uri);
        if (!model) {
            model = monacoInstance.editor.createModel(value || '', 'json', uri);
        } else if (model.getValue() !== (value || '')) {
            model.setValue(value || '');
        }

        return model;
    }

    function appendPath(path, segment) {
        if (typeof segment === 'number') {
            return path + '[' + segment + ']';
        }

        return path + "['" + String(segment).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "']";
    }

    function scanJsonString(text, start) {
        var value = '';
        var escaped = false;

        for (var index = start + 1; index < text.length; index++) {
            var ch = text[index];

            if (escaped) {
                value += ch;
                escaped = false;
                continue;
            }

            if (ch === '\\') {
                escaped = true;
                value += ch;
                continue;
            }

            if (ch === '"') {
                return { end: index + 1, value: value };
            }

            value += ch;
        }

        return { end: text.length, value: value };
    }

    function consumeValuePath(stack) {
        if (stack.length === 0) {
            return '$';
        }

        var parent = stack[stack.length - 1];
        if (parent.type === 'object') {
            var key = parent.pendingKey || '';
            parent.expecting = 'commaOrEnd';
            return appendPath(parent.path, key);
        }

        var path = appendPath(parent.path, parent.index);
        parent.expecting = 'commaOrEnd';
        return path;
    }

    function completeComma(stack) {
        if (stack.length === 0) {
            return;
        }

        var current = stack[stack.length - 1];
        if (current.type === 'object' && current.expecting === 'commaOrEnd') {
            current.pendingKey = null;
            current.expecting = 'keyOrEnd';
            return;
        }

        if (current.type === 'array' && current.expecting === 'commaOrEnd') {
            current.index++;
            current.expecting = 'valueOrEnd';
        }
    }

    function getJsonPathAtPosition(model, position) {
        var text = model.getValue();
        var offset = model.getOffsetAt(position);
        var stack = [];
        var lastPath = '$';

        for (var index = 0; index < text.length && index <= offset; index++) {
            var ch = text[index];

            if (/\s/.test(ch)) {
                continue;
            }

            if (ch === '"') {
                var scanned = scanJsonString(text, index);
                var current = stack[stack.length - 1];
                var tokenPath = null;

                if (current && current.type === 'object' && (current.expecting === 'keyOrEnd' || current.expecting === 'colon')) {
                    current.pendingKey = scanned.value;
                    current.expecting = 'colon';
                    tokenPath = appendPath(current.path, scanned.value);
                } else {
                    tokenPath = consumeValuePath(stack);
                }

                lastPath = tokenPath || lastPath;
                if (offset >= index && offset <= scanned.end) {
                    return lastPath;
                }

                index = scanned.end - 1;
                continue;
            }

            if (ch === '{' || ch === '[') {
                var containerPath = consumeValuePath(stack);
                lastPath = containerPath;
                if (offset === index) {
                    return containerPath;
                }

                stack.push(ch === '{'
                    ? { type: 'object', path: containerPath, pendingKey: null, expecting: 'keyOrEnd' }
                    : { type: 'array', path: containerPath, index: 0, expecting: 'valueOrEnd' });
                continue;
            }

            if (ch === '}' || ch === ']') {
                var closed = stack.pop();
                lastPath = closed ? closed.path : '$';
                if (offset === index) {
                    return lastPath;
                }
                continue;
            }

            if (ch === ':') {
                var objectContext = stack[stack.length - 1];
                if (objectContext && objectContext.type === 'object') {
                    objectContext.expecting = 'valueOrEnd';
                }
                continue;
            }

            if (ch === ',') {
                completeComma(stack);
                continue;
            }

            if (/[\-0-9tfn]/.test(ch)) {
                lastPath = consumeValuePath(stack);
                while (index + 1 < text.length && /[^,}\]\s]/.test(text[index + 1])) {
                    index++;
                }
            }
        }

        return lastPath;
    }

    window.jsonPathPlusMonaco = {
        initialize: async function (jsonElement, resultElement, reference, initialJson, initialResult) {
            var monacoInstance = await ensureMonaco();
            dotNetReference = reference;

            if (jsonEditor) {
                jsonEditor.dispose();
            }
            if (resultEditor) {
                resultEditor.dispose();
            }

            jsonModel = getOrCreateModel(monacoInstance, 'file:///json', initialJson || '');
            resultModel = getOrCreateModel(monacoInstance, 'file:///result', initialResult || '');

            jsonEditor = monacoInstance.editor.create(jsonElement, Object.assign(editorOptions(false), { model: jsonModel }));
            resultEditor = monacoInstance.editor.create(resultElement, Object.assign(editorOptions(true), { model: resultModel }));

            jsonEditor.onDidChangeModelContent(function () {
                if (suppressJsonChange || !dotNetReference) {
                    return;
                }

                dotNetReference.invokeMethodAsync('OnJsonDocumentChanged', jsonModel.getValue());
            });
        },
        setJsonValue: function (value) {
            if (!jsonModel || jsonModel.getValue() === (value || '')) {
                return;
            }

            suppressJsonChange = true;
            jsonModel.setValue(value || '');
            suppressJsonChange = false;
        },
        setResultValue: function (value) {
            if (!resultModel || resultModel.getValue() === (value || '')) {
                return;
            }

            resultModel.setValue(value || '');
        },
        setJsonError: function (line, column, message) {
            if (!window.monaco || !jsonModel) {
                return;
            }

            if (!line || !message) {
                window.monaco.editor.setModelMarkers(jsonModel, 'jsonpathplus', []);
                return;
            }

            var safeLine = Math.max(1, line);
            var safeColumn = Math.max(1, column || 1);
            window.monaco.editor.setModelMarkers(jsonModel, 'jsonpathplus', [{
                severity: window.monaco.MarkerSeverity.Error,
                message: message,
                startLineNumber: safeLine,
                startColumn: safeColumn,
                endLineNumber: safeLine,
                endColumn: safeColumn + 1
            }]);
        },
        revealJsonLine: function (line) {
            if (jsonEditor && line) {
                jsonEditor.revealLineInCenter(line);
                jsonEditor.setPosition({ lineNumber: line, column: 1 });
                jsonEditor.focus();
            }
        },
        focusJson: function () {
            if (jsonEditor) {
                jsonEditor.focus();
            }
        },
        dispose: function () {
            if (jsonEditor) {
                jsonEditor.dispose();
                jsonEditor = null;
            }
            if (resultEditor) {
                resultEditor.dispose();
                resultEditor = null;
            }
            dotNetReference = null;
        }
    };
})();