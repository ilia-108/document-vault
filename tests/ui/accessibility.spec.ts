import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('library and text version details are accessible in both themes', async ({
  page,
}) => {
  await page.goto('/documents');
  await expect(page.getByText('20 of 36 documents')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.goto('/documents/mock_doc_001/versions/mock_ver_001_001');
  await expect(
    page.getByRole('heading', { name: 'Restore procedure' })
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
});
