import { createApp } from "./app.ts";
import { configFromEnv } from "./config.ts";
import type { Workflow, Run } from "../shared/domain.ts";

const config = configFromEnv();
const { app, runtime, store, core } = createApp(config);
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Dingdong listening on ${config.base}`);
  runtime.start();
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
let probing = false,
  scheduling = false;
const probe = setInterval(async () => {
  if (config.coreOnly || probing) return;
  probing = true;
  try {
    await runtime.invoke("project_list", {}, "health");
    runtime.lastError = null;
  } catch {
    runtime.ready = false;
  } finally {
    probing = false;
  }
}, 5000);
const scheduler = setInterval(async () => {
  if (scheduling || (!runtime.ready && !config.coreOnly)) return;
  scheduling = true;
  try {
    for (const w of store
      .list<Workflow>("workflows")
      .filter(
        (w) =>
          w.active && w.nextRunAt && w.nextRunAt <= new Date().toISOString(),
      )) {
      core.pauseChangedSchedules(w.projectId, "scheduler");
      if (!store.get<Workflow>("workflows", w.id)?.active) continue;
      if (
        store
          .list<Run>("runs")
          .some(
            (r) =>
              r.workflowId === w.id &&
              ["running", "needs_review"].includes(r.status),
          )
      )
        continue;
      try {
        await runtime.invoke(
          "run_start",
          { workflowId: w.id, revision: w.revision, input: w.defaultInput },
          "scheduler",
          `schedule:${w.id}:${w.nextRunAt}`,
        );
        const latest = store.get<Workflow>("workflows", w.id)!;
        if (latest.revision === w.revision && latest.active)
          store.put("workflows", w.id, {
            ...latest,
            nextRunAt: new Date(
              Date.now() + (w.cadence === "weekly" ? 7 : 1) * 86400000,
            ).toISOString(),
          });
      } catch {
        /* Retry only this same idempotent slot, never invent a new run key. */
      }
    }
  } finally {
    scheduling = false;
  }
}, 60000);
let closing = false;
const stop = (exitCode = 0) => {
  if (closing) return;
  closing = true;
  clearInterval(probe);
  clearInterval(scheduler);
  runtime.stop();
  server.close(() => {
    store.close();
    process.exit(exitCode);
  });
  setTimeout(() => process.exit(exitCode), 8000).unref();
};
runtime.onUnexpectedExit = () => stop(1);
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
