import { createApp } from "./app.js";
const { app, config, recordDeployment } = await createApp({ logger: true });
try {
  await app.listen({ port: config.port, host: config.host });
  await recordDeployment();
} catch (error) {
  await app.close();
  throw error;
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
