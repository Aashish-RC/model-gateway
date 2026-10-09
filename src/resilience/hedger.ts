import { HedgeConfig, HedgedExecutionResult } from './types.js';

export class RequestHedger {
  /**
   * Executes a primary asynchronous task and, if it does not complete within `delayMs`,
   * launches a speculative backup task concurrently. The first to succeed wins, and
   * the other is aborted cleanly.
   */
  public static async executeWithHedge<T>(
    primaryFn: (signal: AbortSignal) => Promise<T>,
    backupFn: (signal: AbortSignal) => Promise<T>,
    config: HedgeConfig
  ): Promise<HedgedExecutionResult<T>> {
    if (!config.enabled || config.delayMs <= 0) {
      const startTime = Date.now();
      const primaryController = new AbortController();
      const result = await primaryFn(primaryController.signal);
      return {
        result,
        hedged: false,
        winner: 'primary',
        primaryLatencyMs: Date.now() - startTime,
      };
    }

    const primaryController = new AbortController();
    const backupController = new AbortController();
    const startTime = Date.now();

    let backupStarted = false;
    let backupStartTime = 0;
    let timerId: NodeJS.Timeout | null = null;

    return new Promise<HedgedExecutionResult<T>>((resolve, reject) => {
      let isResolved = false;
      let primaryError: Error | null = null;
      let backupError: Error | null = null;

      // 1. Kick off primary execution
      const primaryPromise = primaryFn(primaryController.signal)
        .then((result) => {
          if (isResolved) return;
          isResolved = true;
          if (timerId) clearTimeout(timerId);
          if (backupStarted) {
            backupController.abort();
          }
          resolve({
            result,
            hedged: backupStarted,
            winner: 'primary',
            primaryLatencyMs: Date.now() - startTime,
            backupLatencyMs: backupStarted ? Date.now() - backupStartTime : undefined,
          });
        })
        .catch((err) => {
          primaryError = err;
          // If backup is not running and hasn't scheduled yet, reject or start backup immediately
          if (!backupStarted) {
            if (timerId) clearTimeout(timerId);
            // Primary failed early; start backup immediately if not yet started
            startBackup();
          } else if (backupError) {
            // Both failed
            if (!isResolved) {
              isResolved = true;
              reject(
                new Error(
                  `Both primary and hedged backup failed. Primary: ${primaryError?.message}, Backup: ${backupError?.message}`
                )
              );
            }
          }
        });

      // 2. Schedule backup after delayMs
      const startBackup = () => {
        if (backupStarted || isResolved) return;
        backupStarted = true;
        backupStartTime = Date.now();

        backupFn(backupController.signal)
          .then((result) => {
            if (isResolved) return;
            isResolved = true;
            primaryController.abort();
            resolve({
              result,
              hedged: true,
              winner: 'backup',
              primaryLatencyMs: Date.now() - startTime,
              backupLatencyMs: Date.now() - backupStartTime,
            });
          })
          .catch((err) => {
            backupError = err;
            if (primaryError && !isResolved) {
              isResolved = true;
              reject(
                new Error(
                  `Both primary and hedged backup failed. Primary: ${primaryError?.message}, Backup: ${backupError?.message}`
                )
              );
            }
          });
      };

      timerId = setTimeout(() => {
        startBackup();
      }, config.delayMs);
    });
  }
}
