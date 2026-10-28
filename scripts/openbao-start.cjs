const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
mkdirSync('.data/openbao', { recursive: true, mode: 0o700 });
const child = spawn(
  process.env.BAO_BIN || 'bao',
  ['server', '-config=infra/openbao/local.hcl'],
  { stdio: 'inherit' }
);
child.on('error', () => {
  console.error(
    'Cannot start OpenBao. Install bao or set BAO_BIN to its binary.'
  );
  process.exitCode = 1;
});
child.on('exit', code => {
  process.exitCode = code || 0;
});
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
