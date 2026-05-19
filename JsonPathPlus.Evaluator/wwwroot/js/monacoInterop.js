(function () {
    var monacoBaseUrl = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs';
    var monacoReadyPromise = null;
    var hoverRegistration = null;
    var hoverEnhancerObserver = null;
    var hoverEnhancerFrame = 0;
    var hoverInteractionHandlersAttached = false;
    var pathInputElement = null;
    var pathInputTimer = null;
    var pathInputHandler = null;
    var pathInputBlurHandler = null;
    var pathInputKeydownHandler = null;
    var jsonEditor = null;
    var resultEditor = null;
    var jsonModel = null;
    var resultModel = null;
    var dotNetReference = null;
    var suppressJsonChange = false;
    var suppressPathInputChange = false;
    var contextMenuObserver = null;
    var jsonChangeTimer = null;
    var pendingJsonNotification = false;
    var jsonChangeInProgress = false;

    function hideChangeAllOccurrencesMenuItem() {
        var targets = document.querySelectorAll('div, span, a, li');
        for (var i = 0; i < targets.length; i++) {
            var node = targets[i];
            var text = (node && node.textContent ? node.textContent : '').trim();
            if (!text || text !== 'Change All Occurrences') {
                continue;
            }

            var item = node.closest
                ? node.closest('li, [role="menuitem"], .action-item, .monaco-action-bar .action-item')
                : null;

            if (!item) {
                item = node.parentElement || node;
            }

            item.style.display = 'none';
            item.setAttribute('aria-hidden', 'true');
        }
    }

    function scheduleHideChangeAllOccurrencesMenuItem() {
        window.setTimeout(hideChangeAllOccurrencesMenuItem, 0);
        window.setTimeout(hideChangeAllOccurrencesMenuItem, 40);
    }

    function ensureContextMenuFilter() {
        if (contextMenuObserver) {
            return;
        }

        contextMenuObserver = new MutationObserver(function () {
            hideChangeAllOccurrencesMenuItem();
        });

        contextMenuObserver.observe(document.body, { childList: true, subtree: true });
        hideChangeAllOccurrencesMenuItem();
    }

    function disposeContextMenuFilter() {
        if (!contextMenuObserver) {
            return;
        }

        contextMenuObserver.disconnect();
        contextMenuObserver = null;
    }

    function scheduleHoverEnhancement() {
        if (hoverEnhancerFrame) {
            return;
        }

        hoverEnhancerFrame = window.requestAnimationFrame(function () {
            hoverEnhancerFrame = 0;
            enhanceVisibleJsonPathHover();
        });
    }

    function ensureHoverEnhancer() {
        if (hoverEnhancerObserver) {
            return;
        }

        ensureHoverInteractionHandlers();

        hoverEnhancerObserver = new MutationObserver(function () {
            scheduleHoverEnhancement();
        });

        hoverEnhancerObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        scheduleHoverEnhancement();
    }

    function disposeHoverEnhancer() {
        if (hoverEnhancerFrame) {
            window.cancelAnimationFrame(hoverEnhancerFrame);
            hoverEnhancerFrame = 0;
        }

        disposeHoverInteractionHandlers();

        if (!hoverEnhancerObserver) {
            return;
        }

        hoverEnhancerObserver.disconnect();
        hoverEnhancerObserver = null;
    }

    function ensureHoverInteractionHandlers() {
        if (hoverInteractionHandlersAttached) {
            return;
        }

        document.addEventListener('pointerdown', onDelegatedJsonPathCopyPointerDown, true);
        document.addEventListener('click', onDelegatedJsonPathCopyClicked, true);
        hoverInteractionHandlersAttached = true;
    }

    function disposeHoverInteractionHandlers() {
        if (!hoverInteractionHandlersAttached) {
            return;
        }

        document.removeEventListener('pointerdown', onDelegatedJsonPathCopyPointerDown, true);
        document.removeEventListener('click', onDelegatedJsonPathCopyClicked, true);
        hoverInteractionHandlersAttached = false;
    }

    function onDelegatedJsonPathCopyPointerDown(event) {
        var hover = getJsonPathCopyHover(event.target);
        if (!hover) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        var jsonPath = hover.dataset ? hover.dataset.jsonPath || '' : '';
        if (!jsonPath) {
            return;
        }

        writeTextToClipboard(jsonPath)
            .then(function () {
                showCopyFeedback(hover);
            })
            .catch(function () { });
    }

    function onDelegatedJsonPathCopyClicked(event) {
        // Already handled by pointerdown; suppress click.
        var hover = getJsonPathCopyHover(event.target);
        if (hover) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    function getJsonPathCopyHover(target) {
        if (!target || !target.closest) {
            return null;
        }

        return target.closest('.jsonpath-hover-clickable');
    }

    function showCopyFeedback(hover) {
        if (!hover) {
            return;
        }

        var existing = hover.querySelector('.jsonpath-hover-copy-feedback');
        if (existing) {
            existing.remove();
        }

        var feedback = document.createElement('span');
        feedback.className = 'jsonpath-hover-copy-feedback';
        feedback.textContent = '\u2714 Copied!';
        hover.appendChild(feedback);

        window.setTimeout(function () {
            if (feedback.parentNode) {
                feedback.remove();
            }
        }, 1500);
    }

    function enhanceVisibleJsonPathHover() {
        var visibleHovers = document.querySelectorAll('.monaco-hover:not(.hidden) .hover-row-contents');
        for (var i = 0; i < visibleHovers.length; i++) {
            var hoverContents = visibleHovers[i];
            var title = hoverContents.querySelector('.markdown-hover .hover-contents .rendered-markdown p strong');
            if (!title) {
                continue;
            }

            var titleText = (title.textContent || '').trim();
            if (titleText !== 'JsonPath' && titleText !== 'Normalized Path') {
                continue;
            }

            title.textContent = 'JsonPath';

            var codeContainer = hoverContents.querySelector('.code-hover-contents .rendered-markdown');
            if (!codeContainer) {
                continue;
            }

            var jsonPath = (codeContainer.textContent || '').trim();
            if (!jsonPath) {
                continue;
            }

            var codeHover = codeContainer.closest('.markdown-hover');
            if (!codeHover) {
                continue;
            }

            codeHover.classList.add('jsonpath-hover-code');
            codeHover.classList.add('jsonpath-hover-clickable');
            codeHover.dataset.jsonPath = jsonPath;

            // Remove leftover button DOM from previous iterations
            var oldActions = codeHover.querySelector('.jsonpath-hover-actions');
            if (oldActions) {
                oldActions.remove();
            }
        }
    }

    function writeTextToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text).catch(function () {
                return copyTextWithExecCommand(text);
            });
        }

        return copyTextWithExecCommand(text);
    }

    function copyTextWithExecCommand(text) {
        return new Promise(function (resolve, reject) {
            var textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', 'readonly');
            textarea.style.position = 'fixed';
            textarea.style.top = '-1000px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            textarea.setSelectionRange(0, textarea.value.length);

            try {
                var copied = document.execCommand('copy');
                document.body.removeChild(textarea);
                if (copied) {
                    resolve();
                    return;
                }

                reject(new Error('Copy command was rejected.'));
            } catch (error) {
                document.body.removeChild(textarea);
                reject(error);
            }
        });
    }

    function clearJsonChangeTimer() {
        if (!jsonChangeTimer) {
            return;
        }

        window.clearTimeout(jsonChangeTimer);
        jsonChangeTimer = null;
    }

    function notifyJsonDocumentChanged() {
        if (!dotNetReference || jsonChangeInProgress) {
            return;
        }

        jsonChangeInProgress = true;
        try {
            // Only send a flag — no JSON payload. The data stays in the Monaco model.
            dotNetReference.invokeMethodAsync('OnJsonDocumentTouched')
                .catch(function () {
                    // Silently recover from interop failures (e.g., during disposal)
                })
                .then(function () {
                    jsonChangeInProgress = false;
                    if (pendingJsonNotification) {
                        pendingJsonNotification = false;
                        scheduleJsonChangeNotification();
                    }
                });
        } catch (e) {
            jsonChangeInProgress = false;
        }
    }

    function scheduleJsonChangeNotification() {
        clearJsonChangeTimer();
        jsonChangeTimer = window.setTimeout(function () {
            notifyJsonDocumentChanged();
        }, 200);
    }

    function clearPathInputTimer() {
        if (!pathInputTimer) {
            return;
        }

        window.clearTimeout(pathInputTimer);
        pathInputTimer = null;
    }

    function notifyPathInputChanged() {
        if (!pathInputElement || !dotNetReference) {
            return;
        }

        dotNetReference.invokeMethodAsync('OnPathInputChanged', pathInputElement.value);
    }

    function schedulePathInputNotification() {
        clearPathInputTimer();
        pathInputTimer = window.setTimeout(function () {
            notifyPathInputChanged();
        }, 250);
    }

    function detachPathInput() {
        clearPathInputTimer();

        if (!pathInputElement) {
            return;
        }

        if (pathInputHandler) {
            pathInputElement.removeEventListener('input', pathInputHandler);
        }
        if (pathInputBlurHandler) {
            pathInputElement.removeEventListener('blur', pathInputBlurHandler);
        }
        if (pathInputKeydownHandler) {
            pathInputElement.removeEventListener('keydown', pathInputKeydownHandler);
        }

        pathInputHandler = null;
        pathInputBlurHandler = null;
        pathInputKeydownHandler = null;
        pathInputElement = null;
    }

    function attachPathInput(element, initialValue) {
        detachPathInput();

        if (!element) {
            return;
        }

        pathInputElement = element;
        pathInputElement.value = initialValue || '';

        pathInputHandler = function () {
            if (suppressPathInputChange || !dotNetReference) {
                return;
            }

            if (window.jsonPathWorkerClient && typeof window.jsonPathWorkerClient.cancelActive === 'function') {
                window.jsonPathWorkerClient.cancelActive();
            }

            schedulePathInputNotification();
        };

        pathInputBlurHandler = function () {
            if (suppressPathInputChange || !dotNetReference) {
                return;
            }

            clearPathInputTimer();
            notifyPathInputChanged();
        };

        pathInputKeydownHandler = function (event) {
            if (event.key !== 'Enter' || suppressPathInputChange || !dotNetReference) {
                return;
            }

            clearPathInputTimer();
            notifyPathInputChanged();
        };

        pathInputElement.addEventListener('input', pathInputHandler);
        pathInputElement.addEventListener('blur', pathInputBlurHandler);
        pathInputElement.addEventListener('keydown', pathInputKeydownHandler);
    }

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
                        { value: '**JsonPath**' },
                        { value: formatHoverCodeBlock(path) }
                    ]
                };
            }
        });
    }

    function formatHoverCodeBlock(value) {
        var formattedPath = formatPathForDisplay(value);
        return '```text\n' + formattedPath.replace(/```/g, '\\`\\`\\`') + '\n```';
    }

    function formatPathForDisplay(path) {
        if (!path || path[0] !== '$') {
            return path || '$';
        }

        return path.replace(/\[(\d+)\]|\['((?:\\.|[^'])*)'\]/g, function (_, arrayIndex, rawProperty) {
            if (typeof arrayIndex !== 'undefined') {
                return '[' + arrayIndex + ']';
            }

            var propertyName = rawProperty
                .replace(/\\'/g, "'")
                .replace(/\\\\/g, '\\');

            if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)) {
                return '.' + propertyName;
            }

            return "['" + rawProperty + "']";
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
            hover: {
                enabled: true,
                sticky: true
            },
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
            renderLineHighlight: 'line',
            maxTokenizationLineLength: 200000,
            largeFileOptimizations: true
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
        initialize: async function (pathElement, jsonElement, resultElement, reference, initialPath, initialJson, initialResult) {
            var monacoInstance = await ensureMonaco();
            dotNetReference = reference;
            attachPathInput(pathElement, initialPath);

            if (jsonEditor) {
                jsonEditor.dispose();
            }
            if (resultEditor) {
                resultEditor.dispose();
            }

            jsonModel = getOrCreateModel(monacoInstance, 'file:///json', initialJson || '');
            resultModel = getOrCreateModel(monacoInstance, 'file:///result', initialResult || '');

            jsonEditor = monacoInstance.editor.create(jsonElement, Object.assign(editorOptions(false), {
                model: jsonModel,
                formatOnPaste: false,
                formatOnType: false
            }));
            resultEditor = monacoInstance.editor.create(resultElement, Object.assign(editorOptions(true), { model: resultModel }));
            ensureContextMenuFilter();
            ensureHoverEnhancer();

            if (jsonEditor && typeof jsonEditor.onContextMenu === 'function') {
                jsonEditor.onContextMenu(function () {
                    scheduleHideChangeAllOccurrencesMenuItem();
                });
            }

            if (resultEditor && typeof resultEditor.onContextMenu === 'function') {
                resultEditor.onContextMenu(function () {
                    scheduleHideChangeAllOccurrencesMenuItem();
                });
            }

            // Override Ctrl+F2 so Change All Occurrences cannot be triggered from keyboard.
            jsonEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.F2, function () { });
            resultEditor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.F2, function () { });

            jsonEditor.onDidChangeModelContent(function () {
                if (suppressJsonChange || !dotNetReference) {
                    return;
                }

                if (jsonEditor
                    && typeof jsonEditor.hasTextFocus === 'function'
                    && jsonEditor.hasTextFocus()
                    && window.jsonPathWorkerClient
                    && typeof window.jsonPathWorkerClient.cancelActive === 'function') {
                    window.jsonPathWorkerClient.cancelActive();
                }

                if (jsonChangeInProgress) {
                    // Mark pending so we re-fire after the current call completes.
                    pendingJsonNotification = true;
                    return;
                }

                scheduleJsonChangeNotification();
            });
        },
        setPathValue: function (value) {
            if (!pathInputElement || pathInputElement.value === (value || '')) {
                return;
            }

            suppressPathInputChange = true;
            pathInputElement.value = value || '';
            suppressPathInputChange = false;
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
        getJsonValue: function () {
            return jsonModel ? jsonModel.getValue() : '';
        },
        evaluateCurrent: function (path, validateJson) {
            if (!jsonModel || !window.jsonPathWorkerClient || typeof window.jsonPathWorkerClient.evaluate !== 'function') {
                return Promise.reject(new Error('Worker client is not available.'));
            }

            var json = jsonModel.getValue();
            return window.jsonPathWorkerClient.evaluate(json, path, validateJson);
        },
        setLocalStorage: function (key, value) {
            try {
                localStorage.setItem(key, value);
            } catch (e) { /* quota exceeded or unavailable */ }
        },
        getLocalStorage: function (key) {
            try {
                return localStorage.getItem(key) || '';
            } catch (e) {
                return '';
            }
        },
        dispose: function () {
            detachPathInput();
            disposeContextMenuFilter();
            disposeHoverEnhancer();
            clearJsonChangeTimer();
            pendingJsonNotification = false;
            jsonChangeInProgress = false;

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