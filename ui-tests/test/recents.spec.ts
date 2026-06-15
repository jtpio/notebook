// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import path from 'path';

import { expect, IJupyterLabPageFixture } from '@jupyterlab/galata';

import { test } from './fixtures';

import { waitForNotebook } from './utils';

const NOTEBOOK = 'simple.ipynb';

test.use({ autoGoto: false });

/**
 * Open the "Recents" tab in the tree view and wait for its panel to be visible.
 */
async function openRecentsTab(page: IJupyterLabPageFixture): Promise<void> {
  await page.locator('.jp-TreePanel >> text="Recents"').click();
  await expect(page.locator('#main-panel #jp-recents-tree')).toBeVisible();
}

test.describe('Recents', () => {
  test('should show the Recents tab in the tree view', async ({
    page,
    tmpPath,
  }) => {
    await page.goto(`tree/${tmpPath}`);

    await expect(page.locator('.jp-TreePanel >> text="Recents"')).toBeVisible();

    await openRecentsTab(page);

    await expect(
      page.getByRole('heading', { name: /Recently Opened/ })
    ).toBeVisible();
  });

  test.describe('with a recently opened notebook', () => {
    test.beforeEach(async ({ page, tmpPath }) => {
      await page.contents.uploadFile(
        path.resolve(__dirname, `./notebooks/${NOTEBOOK}`),
        `${tmpPath}/${NOTEBOOK}`
      );

      // Open the notebook so it is recorded as recently opened, and wait for it
      // to be fully loaded so the recents are persisted before navigating away.
      await page.goto(`notebooks/${tmpPath}/${NOTEBOOK}`);
      await waitForNotebook(page);
    });

    test('should list the notebook in the Recents tab', async ({
      page,
      tmpPath,
    }) => {
      await page.goto(`tree/${tmpPath}`);
      await openRecentsTab(page);

      // The notebook is listed...
      await expect(
        page.locator(
          `#jp-recents-tree .jp-RunningSessions-itemLabel >> text="${NOTEBOOK}"`
        )
      ).toBeVisible();

      // ...and the parent directory is filtered out, so only the document is
      // shown.
      await expect(
        page.locator('#jp-recents-tree .jp-RunningSessions-item')
      ).toHaveCount(1);
    });

    test('should reopen the notebook from the Recents tab', async ({
      page,
      tmpPath,
    }) => {
      await page.goto(`tree/${tmpPath}`);
      await openRecentsTab(page);

      // Clicking the recent item opens the document in a new browser tab.
      const [notebook] = await Promise.all([
        page.waitForEvent('popup'),
        page
          .locator(
            `#jp-recents-tree .jp-RunningSessions-itemLabel >> text="${NOTEBOOK}"`
          )
          .click(),
      ]);

      await notebook.waitForSelector('.jp-Notebook');
      expect(notebook.url()).toContain(`/notebooks/${tmpPath}/${NOTEBOOK}`);
      await notebook.close();
    });

    test('should forget the notebook from the Recents tab', async ({
      page,
      tmpPath,
    }) => {
      await page.goto(`tree/${tmpPath}`);
      await openRecentsTab(page);

      const item = page.locator('#jp-recents-tree .jp-RunningSessions-item', {
        hasText: NOTEBOOK,
      });
      await expect(item).toBeVisible();

      // Reveal and click the "Forget" button to remove the document.
      await item.hover();
      await item.locator('.jp-RunningSessions-itemShutdown').click();

      await expect(item).toHaveCount(0);
    });
  });
});
