import { buildServer } from './server.js';
import { loadConfig } from './config/index.js';

async function main() {
  const config = loadConfig();
  const server = await buildServer({ config });

  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      server.log.info({ signal }, 'Shutting down server gracefully...');
      try {
        await server.close();
        process.exit(0);
      } catch (err) {
        server.log.error({ err }, 'Error during server shutdown');
        process.exit(1);
      }
    });
  }

  try {
    const address = await server.listen({
      host: config.server.host,
      port: config.server.port,
    });
    server.log.info(`Smart AI Gateway listening at ${address}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();
