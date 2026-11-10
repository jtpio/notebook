// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import path from 'path';

import { expect } from '@jupyterlab/galata';

import { Page } from '@playwright/test';

import { test } from './fixtures';

import { waitForKernelReady } from './utils';

const NOTEBOOK = 'simple_toc.ipynb';

const LEFT_PANEL = 'View>Left Sidebar>Show Table of Contents';

const RIGHT_PANEL = 'View>Right Sidebar>Show Notebook Tools';

/**
 * The header, the toolbar and the notebook, which must stay aligned.
 */
const CONTENT = [
  '#top-panel',
  '#menu-panel',
  '.jp-NotebookPanel-toolbar',
  '.jp-WindowedPanel-viewport',
];

/**
 * Get the left and right edges of the visible content elements.
 */
async function getEdges(page: Page): Promise<number[][]> {
  const edges = [];
  for (const selector of CONTENT) {
    const box = await page.locator(selector).boundingBox();
    if (box) {
      edges.push([box.x, box.x + box.width]);
    }
  }
  return edges;
}

test.use({ autoGoto: false });

test.describe('Side panels', () => {
  test.beforeEach(async ({ page, tmpPath }) => {
    await page.contents.uploadFile(
      path.resolve(__dirname, `./notebooks/${NOTEBOOK}`),
      `${tmpPath}/${NOTEBOOK}`
    );
    await page.goto(`notebooks/${tmpPath}/${NOTEBOOK}`);
    await waitForKernelReady(page);
  });

  test.describe('Wide window', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('The panels should open beside the content without moving it', async ({
      page,
    }) => {
      const edges = await getEdges(page);

      await page.menu.clickMenuItem(LEFT_PANEL);
      await page.menu.clickMenuItem(RIGHT_PANEL);
      await expect(page.locator('#jp-left-stack')).toBeVisible();
      await expect(page.locator('#jp-right-stack')).toBeVisible();

      expect(await getEdges(page)).toEqual(edges);
    });
  });

  test.describe('Narrow window', () => {
    test.use({ viewport: { width: 1280, height: 720 } });

    test('The header should stay aligned with the content pushed by a panel', async ({
      page,
    }) => {
      const edges = await getEdges(page);

      await page.menu.clickMenuItem(LEFT_PANEL);
      const panel = page.locator('#jp-left-stack');
      await expect(panel).toBeVisible();
      const { width } = (await panel.boundingBox())!;

      // The left edges all follow the panel, the right edges do not move.
      expect(await getEdges(page)).toEqual(
        edges.map(([, right]) => [width, right])
      );
    });

    for (const side of ['left', 'right'] as const) {
      test(`The ${side} panel should be resizable`, async ({ page }) => {
        await page.menu.clickMenuItem(
          side === 'left' ? LEFT_PANEL : RIGHT_PANEL
        );
        const panel = page.locator(`#jp-${side}-stack`);
        const handle = panel.locator('.jp-SidePanel-resizeHandle');
        await expect(panel).toBeVisible();
        const { width } = (await panel.boundingBox())!;

        // Drag the handle 100px towards the content.
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + (side === 'left' ? 100 : -100), y, {
          steps: 5,
        });
        await page.mouse.up();

        // The content follows the edge of the panel.
        const resized = (await panel.boundingBox())!;
        expect(resized.width).toBe(width + 100);
        const edges = await getEdges(page);
        if (side === 'left') {
          expect(edges.map(([left]) => left)).toEqual(
            CONTENT.map(() => resized.x + resized.width)
          );
        } else {
          expect(edges.map(([, right]) => right)).toEqual(
            CONTENT.map(() => resized.x)
          );
        }

        await handle.dblclick();
        expect((await panel.boundingBox())!.width).toBe(width);
      });
    }
  });

  test.describe('Small window', () => {
    test.use({ viewport: { width: 800, height: 720 } });

    test('Two panels should overlay the content without moving it', async ({
      page,
    }) => {
      const edges = await getEdges(page);

      await page.menu.clickMenuItem(LEFT_PANEL);
      await page.menu.clickMenuItem(RIGHT_PANEL);
      await expect(page.locator('#jp-left-stack')).toBeVisible();
      await expect(page.locator('#jp-right-stack')).toBeVisible();

      expect(await getEdges(page)).toEqual(edges);
    });
  });

  test.describe('Mobile', () => {
    test.use({ viewport: { width: 524, height: 800 } });

    test('The panels should overlay the content without moving it', async ({
      page,
    }) => {
      const edges = await getEdges(page);

      await page.menu.clickMenuItem(LEFT_PANEL);
      await expect(page.locator('#jp-left-stack')).toBeVisible();

      expect(await getEdges(page)).toEqual(edges);
    });
  });
});
