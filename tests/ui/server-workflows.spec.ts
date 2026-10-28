import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function serverMode(page: Page, signedIn = true) {
  let authenticated = signedIn;
  let settings = {
    encryptByDefault: true,
    allowPerFileOverride: false,
    keyProviderConfigured: true,
  };
  const user = { id: 'test-user', email: 'person@example.com' };
  await page.route('**/runtimeConfig.js', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: "window.runtimeConfig = { API_BASE_URL: '/api', MODE: 'server' };",
    })
  );
  await page.route('**/api/auth/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/config'))
      return route.fulfill({ json: { data: { emailMode: 'log' } } });
    if (path.endsWith('/request-code'))
      return route.fulfill({
        status: 202,
        json: { data: { message: 'Code sent' } },
      });
    if (path.endsWith('/verify-code')) {
      if (route.request().postDataJSON().code !== '123456')
        return route.fulfill({
          status: 401,
          json: { error: 'Invalid or expired sign-in code' },
        });
      authenticated = true;
      return route.fulfill({ json: { data: user } });
    }
    if (path.endsWith('/logout')) {
      authenticated = false;
      return route.fulfill({ json: { data: { signedOut: true } } });
    }
    return route.fulfill(
      authenticated
        ? { json: { data: user } }
        : { status: 401, json: { error: 'Sign in required' } }
    );
  });
  await page.route('**/api/v1/settings/encryption', async route => {
    if (route.request().method() === 'PUT')
      settings = { ...settings, ...route.request().postDataJSON() };
    return route.fulfill({ json: { data: settings } });
  });
  return {
    setSettings: (value: typeof settings) => {
      settings = value;
    },
    getSettings: () => settings,
  };
}

test('email-code sign-in, invalid code and logout', async ({ page }) => {
  await serverMode(page, false);
  await page.goto('/documents');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel('Email address').fill('person@example.com');
  await page.getByRole('button', { name: 'Send sign-in code' }).click();
  await expect(
    page.getByRole('heading', { name: 'Check your inbox' })
  ).toBeVisible();
  await page.getByLabel('Sign-in code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByText('Invalid or expired sign-in code')).toBeVisible();
  await page.getByLabel('Sign-in code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Open my library' }).click();
  await expect(page.getByText('20 of 36 documents')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
});

test('encryption defaults and per-upload permission are independent settings', async ({
  page,
}) => {
  const mock = await serverMode(page);
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Encryption settings' }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Encryption settings details',
  });
  await expect(
    dialog.getByRole('button', { name: 'Save settings' })
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await expect(
    dialog.getByRole('checkbox', { name: /Encrypt new files by default/ })
  ).toBeChecked();
  await expect(
    dialog.getByRole('checkbox', { name: /Allow encryption choices/ })
  ).not.toBeChecked();
  await dialog
    .getByRole('checkbox', { name: /Encrypt new files by default/ })
    .uncheck();
  await dialog
    .getByRole('checkbox', { name: /Allow encryption choices/ })
    .check();
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).not.toBeVisible();
  expect(mock.getSettings()).toMatchObject({
    encryptByDefault: false,
    allowPerFileOverride: true,
  });
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await expect(
    page.getByRole('checkbox', { name: 'Encrypt this file' })
  ).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Encrypt this file' }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Encrypt this file' })
  ).toBeChecked();
});

test('new document upload includes the optional version name and uses server encryption defaults', async ({
  page,
  request,
}) => {
  await serverMode(page);
  const document = (
    await (await request.get('/api/v1/documents/mock_doc_001')).json()
  ).data;
  let form = '';
  await page.route('**/api/v1/documents', async route => {
    form = route.request().postData() || '';
    return route.fulfill({
      status: 201,
      json: { data: { document, version: document.latestVersion } },
    });
  });
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Add document', exact: true }).click();
  await page.getByLabel(/Original file/).setInputFiles({
    name: 'handbook.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('original bytes'),
  });
  await page
    .getByLabel('Version name (optional)')
    .fill('Approved for publication');
  await expect(
    page.getByRole('checkbox', { name: 'Encrypt this file' })
  ).not.toBeVisible();
  await page
    .getByRole('button', { name: 'Create document', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Recovery handbook' })
  ).toBeVisible();
  expect(form).toContain('Approved for publication');
  expect(form).toContain('original bytes');
  expect(form).not.toContain('name="encrypt"');
});

test('a locked document cannot expose an unencrypted upload option', async ({
  page,
  request,
}) => {
  const mock = await serverMode(page);
  mock.setSettings({
    encryptByDefault: false,
    allowPerFileOverride: true,
    keyProviderConfigured: true,
  });
  const document = (
    await (await request.get('/api/v1/documents/mock_doc_001')).json()
  ).data;
  await page.route('**/api/v1/documents/mock_doc_001', route =>
    route.fulfill({ json: { data: { ...document, encryptionRequired: true } } })
  );
  await page.goto('/documents/mock_doc_001/versions/mock_ver_001_002');
  await page.getByRole('button', { name: 'Add version', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New version details' });
  await expect(
    dialog.getByText(
      'Encryption is required for every new version of this document.'
    )
  ).toBeVisible();
  await expect(
    dialog.getByRole('checkbox', { name: 'Encrypt this file' })
  ).not.toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Document details' })
  ).toBeVisible();
});

test('an expired session removes the open collection', async ({ page }) => {
  await serverMode(page);
  await page.goto('/documents');
  await expect(page.getByText('20 of 36 documents')).toBeVisible();
  await page.route('**/api/v1/documents/search', route =>
    route.fulfill({ status: 401, json: { error: 'Session expired' } })
  );
  await page.getByRole('button', { name: 'Refresh library' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('table')).not.toBeVisible();
});
