import { buildApp } from "./app";
import { env } from "./config/env";
import { startOverdueJob } from "./jobs/overdue.job";

async function start() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    app.log.info(`Server running on http://0.0.0.0:${env.PORT}`);
    app.log.info(`Swagger docs at http://0.0.0.0:${env.PORT}/api/v1/docs`);
    startOverdueJob();
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
