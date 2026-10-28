import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const documentPath = '/documents/mock_doc_001';
const v1 = `${documentPath}/versions/mock_ver_001_001`;
const v2 = `${documentPath}/versions/mock_ver_001_002`;
const apiPath = '/api/v1/documents/mock_doc_001';

test('catalog search, pagination and structural filters', async ({
  page,
  request,
}) => {
  await page.goto('/documents');
  await expect(page.getByText('20 of 36 documents')).toBeVisible();
  await page.getByRole('button', { name: 'Load more documents' }).click();
  await expect(page.getByText('36 of 36 documents')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Search documents' })
    .fill('recovery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('1 of 1 documents')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all' }).click();
  const document = (await (await request.get(apiPath)).json()).data;
  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filter details' });
  await dialog
    .getByRole('combobox', { name: 'Field', exact: true })
    .selectOption({ label: 'SHA-256' });
  await dialog
    .getByRole('combobox', { name: 'Condition', exact: true })
    .selectOption('equals');
  await dialog
    .getByLabel('Value', { exact: true })
    .fill(document.latestVersion.checksum.value);
  await dialog.getByRole('button', { name: 'Add filter', exact: true }).click();
  await expect(page.getByText('1 of 1 documents')).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: /Recovery handbook.*Open document details/,
    })
  ).toBeVisible();
});

test('latest resolves to a stable version URL and old versions survive reload', async ({
  page,
}) => {
  await page.goto(documentPath);
  await expect(page).toHaveURL(new RegExp(`${v2}$`));
  await page.getByRole('button', { name: /Version 1 .*UTC/ }).click();
  await expect(page).toHaveURL(new RegExp(`${v1}$`));
  await expect(
    page.getByRole('heading', { name: 'Restore procedure' })
  ).toBeVisible();
  await expect(page.getByText('Revision 1', { exact: false })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Restore procedure' })
  ).toBeVisible();
  await expect(page.getByText('PRESERVED', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Metadata' }).click();
  await expect(
    page.getByText('mock_ver_001_001', { exact: true })
  ).toBeVisible();
});

test('downloads only checksum-verified original bytes', async ({
  page,
  request,
}) => {
  const version = (
    await (await request.get(`${apiPath}/versions/mock_ver_001_001`)).json()
  ).data;
  await page.goto(v1);
  await expect(page.getByText('Not checked', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original' }).click();
  const download = await downloadPromise;
  const bytes = await readFile((await download.path())!);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(
    version.checksum.value
  );
  expect(bytes.length).toBe(version.file.sizeBytes);
  expect(download.suggestedFilename()).toBe(version.file.name);
  await expect(page.getByText('Checksum match', { exact: true })).toBeVisible();
});

test('local verification never uploads the file and resets for another version', async ({
  page,
  request,
}) => {
  const bytes = await (
    await request.get(`${apiPath}/versions/mock_ver_001_001/content`)
  ).body();
  await page.goto(v1);
  await expect(page.getByText('Revision 1', { exact: false })).toBeVisible();
  const requests: string[] = [];
  page.on('request', request =>
    requests.push(`${request.method()} ${request.url()}`)
  );
  await page.getByLabel('Choose file to verify').setInputFiles({
    name: 'local.txt',
    mimeType: 'text/plain',
    buffer: bytes,
  });
  await expect(page.getByText('Checksum match', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByLabel('Choose file to verify').setInputFiles({
    name: 'changed.txt',
    mimeType: 'text/plain',
    buffer: Buffer.concat([bytes, Buffer.from('!')]),
  });
  await expect(
    page.getByText('Checksum mismatch', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: /Version 2 LATEST/ }).click();
  await expect(page.getByText('Not checked', { exact: true })).toBeVisible();
});

test('corrupted content blocks downloads and reports mismatch', async ({
  page,
}) => {
  await page.route('**/versions/mock_ver_001_001/content', route =>
    route.fulfill({
      status: 200,
      body: 'corrupted bytes',
      contentType: 'text/plain',
    })
  );
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.goto(v1);
  await page.getByRole('button', { name: 'Download original' }).click();
  await expect(
    page.getByText('Checksum mismatch', { exact: true })
  ).toBeVisible();
  expect(downloads).toBe(0);
});

test('content transport errors are distinct from checksum mismatches', async ({
  page,
}) => {
  await page.route('**/versions/mock_ver_001_001/content', route =>
    route.fulfill({ status: 500, json: { error: 'File storage unavailable' } })
  );
  await page.goto(v1);
  await page.getByRole('button', { name: 'Download original' }).click();
  await expect(
    page.getByText('Verification error', { exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Checksum mismatch', { exact: true })
  ).not.toBeVisible();
  await expect(page.getByTestId('expected-checksum')).toBeVisible();
});

test('a newer latest version cannot change a pinned snapshot', async ({
  page,
  request,
}) => {
  await page.goto(v1);
  const expected = await page.getByTestId('expected-checksum').textContent();
  const summary = (await (await request.get(apiPath)).json()).data;
  await page.route(`**${apiPath}`, route =>
    route.fulfill({
      json: {
        data: {
          ...summary,
          title: 'Updated recovery handbook',
          latestVersionId: 'mock_ver_001_003',
          versionCount: 3,
          latestVersion: {
            ...summary.latestVersion,
            versionId: 'mock_ver_001_003',
            versionNumber: 3,
          },
        },
      },
    })
  );
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`${v1}$`));
  await expect(
    page.getByRole('heading', { name: 'Restore procedure' })
  ).toBeVisible();
  await expect(page.getByTestId('expected-checksum')).toHaveText(expected!);
  await expect(
    page.getByText('Current document title: Updated recovery handbook')
  ).toBeVisible();
});

test('foreign and missing versions have no latest fallback', async ({
  page,
}) => {
  await page.goto('/documents/mock_doc_002/versions/mock_ver_001_001');
  await expect(
    page.getByRole('heading', { name: 'Snapshot not found' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download original' })
  ).not.toBeVisible();
  await expect(page).toHaveURL(/mock_doc_002\/versions\/mock_ver_001_001$/);
});

test('history pagination preserves separate equal-content versions', async ({
  page,
}) => {
  await page.goto('/documents/mock_doc_005');
  await expect(
    page.getByRole('heading', { name: 'Architecture decisions' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Load more versions' }).click();
  await expect(
    page.getByRole('button', { name: /Version 1 .*UTC/ })
  ).toBeVisible();
  await page.getByRole('button', { name: /Version 1 .*UTC/ }).click();
  await expect(page).toHaveURL(/mock_ver_005_001$/);
});

test('text, JSON, PDF and unsupported formats have appropriate previews', async ({
  page,
}) => {
  await page.goto('/documents/mock_doc_003');
  await expect(page.locator('.text-preview')).toContainText(
    'Documentation workspace'
  );
  await page.goto('/documents/mock_doc_002');
  await expect(page.getByTitle('PDF document preview')).toBeVisible();
  await page.goto('/documents/mock_doc_012');
  await expect(
    page.getByRole('heading', { name: 'No preview for this format' })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download original' })
  ).toBeEnabled();
});

test('column preferences and theme survive reload', async ({ page }) => {
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Columns' }).click();
  await page.getByRole('checkbox', { name: 'SHA-256' }).check();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.reload();
  await expect(
    page.getByRole('columnheader', { name: /SHA-256/ })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Switch to light theme' })
  ).toBeVisible();
});

test('shared search links restore their own query', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/documents');
  await page
    .getByRole('textbox', { name: 'Search documents' })
    .fill('recovery');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('1 of 1 documents')).toBeVisible();
  await page.getByRole('button', { name: 'Share search' }).click();
  await expect(page.getByText('Search link copied')).toBeVisible();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(link).pathname).toBe('/documents');
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByText('20 of 36 documents')).toBeVisible();
  await page.goto(link);
  await expect(page.getByText('1 of 1 documents')).toBeVisible();
  await expect(
    page.getByRole('textbox', { name: 'Search documents' })
  ).toHaveValue('recovery');
});

test('keyboard tabs and the version panel work at a mobile width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(v1);
  const preview = page.getByRole('tab', { name: 'Preview', exact: true });
  await preview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(
    page.getByRole('tab', { name: 'Metadata', exact: true })
  ).toBeFocused();
  await expect(
    page.getByText('mock_ver_001_001', { exact: true })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe(
    'hidden'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
});

test('versions may have independent optional names', async ({ page }) => {
  await page.goto('/documents/mock_doc_004/versions/mock_ver_004_002');
  await expect(
    page.getByRole('heading', { name: 'Editorial guidelines' })
  ).toBeVisible();
  await expect(page.locator('.snapshot-label')).toContainText(
    'Editorial review'
  );
  await page.getByRole('tab', { name: 'Metadata', exact: true }).click();
  await expect(page.locator('.metadata-grid')).toContainText(
    'Editorial review'
  );
  await page.goto('/documents/mock_doc_001/versions/mock_ver_001_001');
  await expect(page.locator('.snapshot-label')).toContainText('Version 1');
  await expect(page.locator('.snapshot-label')).not.toContainText(
    'Editorial review'
  );
});
