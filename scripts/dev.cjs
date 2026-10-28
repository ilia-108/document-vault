const { spawn } = require('node:child_process');
const net = require('node:net');

const checkPort = port =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(new Error(`Port ${port} is already in use`))
    );
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });

async function main() {
  await Promise.all([checkPort(3040), checkPort(3045)]);
  const children = [
    spawn('yarn', ['mock:server'], { stdio: 'inherit' }),
    spawn('yarn', ['dev:ui'], { stdio: 'inherit' }),
  ];
  let stopping = false;
  const stop = code => {
    if (stopping) return;
    stopping = true;
    children.forEach(child => child.kill('SIGTERM'));
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
