import { createOpenAiFactoryTextProvider } from "./software-factory-openai";
import { createOpenAiFactoryPatchGenerator } from "./software-factory-openai-builder";
import { createGitHubActionsFactoryBuilder } from "./software-factory-remote-builder";
import { createTrustedFactoryWorkerOptions, type FactoryRuntimeOptions } from "./software-factory-runtime";
import { createSoftwareFactoryWorker } from "./software-factory-worker";

export interface ResponsesFactoryBuildOptions {
  model: Parameters<typeof createOpenAiFactoryTextProvider>[0];
  sourcePaths: Readonly<Record<string, readonly string[]>>;
  maxOutputTokens: number;
  patchMode?: "plainTextEdits";
  github: Omit<Parameters<typeof createGitHubActionsFactoryBuilder>[0], "generatePatch">;
}

/** The authenticated transport stays in the control plane. Repository commands
 * never receive the API key. The durable worker reserves costs before this stage. */
export function createResponsesFactoryBuild(options: ResponsesFactoryBuildOptions) {
  const repositories = Object.keys(options.github.repositories).sort();
  if (JSON.stringify(repositories) !== JSON.stringify(Object.keys(options.sourcePaths).sort())) {
    throw new Error("FACTORY_SOURCE_REPOSITORIES_MISMATCH");
  }
  const generateText = createOpenAiFactoryTextProvider(options.model);
  const generatePatch = createOpenAiFactoryPatchGenerator({ generateText,
    sourcePaths: options.sourcePaths, maxOutputTokens: options.maxOutputTokens, patchMode: options.patchMode });
  return createGitHubActionsFactoryBuilder({ ...options.github, generatePatch });
}

/** No placeholder release or recovery handlers: startup still requires every
 * real stage and an initialized durable budget. This does not unpause the queue. */
export async function createResponsesFactoryWorker(options: ResponsesFactoryBuildOptions & {
  runtime: Omit<FactoryRuntimeOptions, "stages"> & {
    stages: Omit<FactoryRuntimeOptions["stages"], "build">;
  };
}) {
  const build = createResponsesFactoryBuild(options);
  const workerOptions = await createTrustedFactoryWorkerOptions({ ...options.runtime,
    stages: { ...options.runtime.stages, build } });
  return createSoftwareFactoryWorker(workerOptions);
}
