import { dotnet } from '../_framework/dotnet.js';

let assemblyExportsPromise = initializeWorkerAsync();

async function initializeWorkerAsync() {
    const { getAssemblyExports, getConfig } = await dotnet.create();
    const config = getConfig();
    const assemblyExports = await getAssemblyExports(config.mainAssemblyName);
    self.postMessage({ command: 'ready' });
    return assemblyExports;
}

function formatError(error) {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error ?? 'Unknown worker error.');
}

assemblyExportsPromise.catch(error => {
    self.postMessage({ command: 'startup-error', error: formatError(error) });
});

self.addEventListener('message', async event => {
    const request = event.data;
    if (!request || request.command !== 'evaluate') {
        return;
    }

    try {
        const assemblyExports = await assemblyExportsPromise;
        const result = await assemblyExports.JsonPathPlus.Evaluator.Workers.JsonPathEvaluationWorkerExports.EvaluateAsync(
            request.json,
            request.path ?? null,
            !!request.validateJson);

        self.postMessage({
            command: 'response',
            requestId: request.requestId,
            result
        });
    }
    catch (error) {
        self.postMessage({
            command: 'response',
            requestId: request.requestId,
            error: formatError(error)
        });
    }
});