// Local development only: production initialization and unseal belong to operators.
const {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const base = 'http://127.0.0.1:8200';
const directory = '.local/secrets';
const bootstrapPath = `${directory}/openbao-init.json`;
async function call(path, body, token, method = 'POST') {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Vault-Token': token } : {}),
    },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`OpenBao ${path} failed (${response.status})`);
  return response.status === 204 ? {} : response.json();
}
async function main() {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const status = await call('sys/init', undefined, undefined, 'GET');
  let bootstrap;
  if (!status.initialized) {
    if (existsSync(bootstrapPath))
      throw new Error(
        'Saved initialization material exists for a different OpenBao instance; refusing to replace it.'
      );
    bootstrap = await call('sys/init', {
      secret_shares: 1,
      secret_threshold: 1,
    });
    writeFileSync(bootstrapPath, JSON.stringify(bootstrap), {
      flag: 'wx',
      mode: 0o600,
    });
  } else {
    if (!existsSync(bootstrapPath))
      throw new Error(
        'OpenBao is already initialized. Use its existing operator credentials; initialization will not be repeated.'
      );
    bootstrap = JSON.parse(readFileSync(bootstrapPath, 'utf8'));
  }
  const sealed = await call('sys/seal-status', undefined, undefined, 'GET');
  if (sealed.sealed)
    await call('sys/unseal', { key: bootstrap.keys_base64[0] });
  let active = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await fetch(`${base}/v1/sys/health`, {
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 200) {
      active = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!active) throw new Error('OpenBao did not become active after unseal');
  const mounts = await call(
    'sys/mounts',
    undefined,
    bootstrap.root_token,
    'GET'
  );
  if (!mounts.data?.['transit/'])
    await call('sys/mounts/transit', { type: 'transit' }, bootstrap.root_token);
  await call(
    'transit/keys/document-vault',
    { type: 'aes256-gcm96', exportable: false },
    bootstrap.root_token
  );
  await call(
    'sys/policies/acl/document-vault',
    { policy: readFileSync('infra/openbao/application-policy.hcl', 'utf8') },
    bootstrap.root_token
  );
  const token = await call(
    'auth/token/create',
    {
      policies: ['document-vault'],
      no_default_policy: true,
      renewable: true,
      ttl: '168h',
      display_name: 'document-vault-local',
    },
    bootstrap.root_token
  );
  writeFileSync(`${directory}/openbao-app-token`, token.auth.client_token, {
    mode: 0o600,
  });
  console.log(
    'Local OpenBao is ready. A restricted application token was saved in .local/secrets/openbao-app-token. No secret was printed.'
  );
}
main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
