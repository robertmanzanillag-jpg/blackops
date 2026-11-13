declare module "containment-handlers" {
  export function getHandlers(storage: unknown, reader: unknown, owner: unknown): Record<string, (req: unknown, res: unknown) => Promise<void>>;
  export function scheduleHandler(deps: unknown): (req: unknown, res: unknown) => Promise<void>;
  export function cleanupUploads(deps: unknown, now: number): void;
  export function workerVerifyOnly(entry: unknown, network: string): boolean;
  export function workerFailure(error: unknown, verifyOnly: boolean, entry: unknown, network: string, runNpm: (args: string[]) => Promise<void>): Promise<void>;
}
