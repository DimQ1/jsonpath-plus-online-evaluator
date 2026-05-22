(function () {
    var workerState = null;
    var nextRequestId = 0;
    var cancellationMessage = 'EvaluationCanceled';

    function formatError(error) {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error || 'Unknown worker error.');
    }

    function createWorkerState() {
        var workerUrl = new URL('js/jsonPathEvaluationWorker.js', document.baseURI);
        var worker = new Worker(workerUrl, { type: 'module' });
        var resolveReady = null;
        var rejectReady = null;

        var state = {
            worker: worker,
            activeRequest: null,
            readyPromise: new Promise(function (resolve, reject) {
                resolveReady = resolve;
                rejectReady = reject;
            }),
            resolveReady: resolveReady,
            rejectReady: rejectReady,
            isReady: false
        };

        worker.addEventListener('message', function (event) {
            var data = event.data || {};

            switch (data.command) {
                case 'ready':
                    state.isReady = true;
                    if (state.resolveReady) {
                        state.resolveReady();
                        state.resolveReady = null;
                        state.rejectReady = null;
                    }
                    break;
                case 'startup-error':
                    if (state.rejectReady) {
                        state.rejectReady(new Error(data.error || 'Failed to start evaluator worker.'));
                        state.resolveReady = null;
                        state.rejectReady = null;
                    }
                    break;
                case 'response':
                    if (!state.activeRequest || state.activeRequest.requestId !== data.requestId) {
                        return;
                    }

                    var pending = state.activeRequest;
                    state.activeRequest = null;

                    if (data.error) {
                        pending.reject(new Error(data.error));
                        return;
                    }

                    pending.resolve(data.result);
                    break;
            }
        });

        worker.addEventListener('error', function (event) {
            var error = new Error(event.message || 'Evaluator worker crashed.');

            if (state.rejectReady) {
                state.rejectReady(error);
                state.resolveReady = null;
                state.rejectReady = null;
            }

            if (state.activeRequest) {
                state.activeRequest.reject(error);
                state.activeRequest = null;
            }

            if (workerState === state) {
                workerState = null;
            }
        });

        return state;
    }

    function ensureWorkerState() {
        if (!workerState) {
            workerState = createWorkerState();
        }

        return workerState;
    }

    function terminateWorkerState(state, errorMessage) {
        if (!state) {
            return;
        }

        if (state.rejectReady) {
            state.rejectReady(new Error(errorMessage || cancellationMessage));
            state.resolveReady = null;
            state.rejectReady = null;
        }

        if (state.activeRequest) {
            state.activeRequest.reject(new Error(errorMessage || cancellationMessage));
            state.activeRequest = null;
        }

        state.worker.terminate();

        if (workerState === state) {
            workerState = null;
        }
    }

    window.jsonPathWorkerClient = {
        evaluate: async function (json, path, validateJson) {
            var state = ensureWorkerState();
            await state.readyPromise;

            if (workerState !== state) {
                throw new Error(cancellationMessage);
            }

            if (state.activeRequest) {
                terminateWorkerState(state, cancellationMessage);
                throw new Error(cancellationMessage);
            }

            var requestId = ++nextRequestId;
            return await new Promise(function (resolve, reject) {
                state.activeRequest = {
                    requestId: requestId,
                    resolve: resolve,
                    reject: reject
                };

                state.worker.postMessage({
                    command: 'evaluate',
                    requestId: requestId,
                    json: json,
                    path: path,
                    validateJson: validateJson
                });
            });
        },
        cancelActive: function () {
            terminateWorkerState(workerState, cancellationMessage);
        },
        formatError: formatError
    };
})();