import { createApp } from "./app.js";
const { app, config } = await createApp({ logger: true });
await app.listen({ port: config.port, host: config.host });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
