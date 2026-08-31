import { randomUUID } from "node:crypto";

export type PortalJobStatus = "queued" | "running" | "completed" | "failed";

export type PortalJob = {
  id: string;
  type: string;
  status: PortalJobStatus;
  message: string;
  processed: number;
  total: number;
  createdAtUtc: string;
  startedAtUtc: string | null;
  completedAtUtc: string | null;
  error: string | null;
  errors: string[];
  result: unknown;
};

export type JobReporter = {
  update(values: Partial<Pick<PortalJob, "message" | "processed" | "total">>): void;
  addError(message: string): void;
};

export class PortalJobManager {
  private readonly jobs = new Map<string, PortalJob>();

  start(
    type: string,
    initialMessage: string,
    runner: (reporter: JobReporter) => Promise<unknown>
  ): PortalJob {
    const job: PortalJob = {
      id: randomUUID(),
      type,
      status: "queued",
      message: initialMessage,
      processed: 0,
      total: 0,
      createdAtUtc: new Date().toISOString(),
      startedAtUtc: null,
      completedAtUtc: null,
      error: null,
      errors: [],
      result: null,
    };

    this.jobs.set(job.id, job);
    this.prune();

    void Promise.resolve().then(async () => {
      job.status = "running";
      job.startedAtUtc = new Date().toISOString();

      const reporter: JobReporter = {
        update: (values) => Object.assign(job, values),
        addError: (message) => job.errors.push(message),
      };

      try {
        job.result = await runner(reporter);
        job.status = job.errors.length > 0 ? "failed" : "completed";
        job.message = job.errors.length > 0
          ? `Finished with ${job.errors.length} error${job.errors.length === 1 ? "" : "s"}.`
          : "Completed.";
      } catch (error) {
        job.status = "failed";
        job.error = error instanceof Error ? error.message : String(error);
        job.message = job.error;
      } finally {
        job.completedAtUtc = new Date().toISOString();
      }
    });

    return job;
  }

  get(id: string): PortalJob | null {
    return this.jobs.get(id) ?? null;
  }

  findRunning(type: string): PortalJob | null {
    return [...this.jobs.values()].find((job) => job.type === type && ["queued", "running"].includes(job.status)) ?? null;
  }

  private prune(): void {
    const completed = [...this.jobs.values()]
      .filter((job) => ["completed", "failed"].includes(job.status))
      .sort((a, b) => a.createdAtUtc.localeCompare(b.createdAtUtc));

    for (const job of completed.slice(0, Math.max(0, completed.length - 100))) {
      this.jobs.delete(job.id);
    }
  }
}
