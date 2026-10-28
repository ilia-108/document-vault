const { spawn } = require('node:child_process');
const net = require('node:net');
const { existsSync } = require('node:fs');
const path = require('node:path');

const checkPort = port =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is already in use`))
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });

async function main() {
  const serverMode = process.argv.includes('--server');
  await Promise.all([checkPort(3040), checkPort(serverMode ? 3050 : 3045)]);
  const serverEnvironment = { ...process.env };
  if (
    serverMode &&
    !serverEnvironment.BAO_TOKEN_FILE &&
    existsSync('.local/secrets/openbao-app-token')
  ) {
    serverEnvironment.BAO_ADDR ||= 'http://127.0.0.1:8200';
    serverEnvironment.BAO_TOKEN_FILE = path.resolve(
      '.local/secrets/openbao-app-token'
    );
  }
  const children = [
    serverMode
      ? spawn('go', ['run', './server/cmd/document-vault'], {
          stdio: 'inherit',
          detached: process.platform !== 'win32',
          env: serverEnvironment,
        })
      : spawn('yarn', ['mock:server'], {
          stdio: 'inherit',
          detached: process.platform !== 'win32',
        }),
    spawn('yarn', ['dev:ui'], {
      stdio: 'inherit',
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        ...(serverMode
          ? {
              DOCUMENT_API_URL: 'http://127.0.0.1:3050',
              DOCUMENT_RUNTIME_CONFIG: '/runtimeConfig.server.js',
            }
          : {}),
      },
    }),
  ];
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    children.forEach(child => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        /* The child may already have exited. */
      }
    });
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  children.forEach(child => child.on('exit', code => stop(code || 0)));
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
