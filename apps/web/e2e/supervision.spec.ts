// GATE G11: every screen renders with seed data at 375/768/1280 (screenshots);
// axe passes; attention flow (see → fix → clears) works e2e; kill switch
// togglable from Settings.
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const VIEWPORTS = [
  { name: "phone", width: 375, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];

const SCREENS = [
  { name: "overview", path: "/", ready: '[data-testid="status-headline"]' },
  { name: "products", path: "/products", ready: '[data-testid="product-card"]' },
  { name: "activity", path: "/activity", ready: '[data-testid="activity-item"]' },
  { name: "settings", path: "/settings", ready: '[data-testid="kill-switch-toggle"]' },
];

async function checkA11y(page: Page): Promise<void> {
  // Entrance animations fade text in; let finite animations finish so axe
  // measures contrast at the settled state (infinite pulses are decorative).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => {
          const t = a.effect?.getTiming();
          return t !== undefined && t.iterations !== Infinity;
        })
        .map((a) => a.finished.catch(() => null)),
    ),
  );
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`),
  ).toEqual([]);
}

for (const screen of SCREENS) {
  for (const vp of VIEWPORTS) {
    test(`${screen.name} renders at ${vp.name} (${vp.width}px)`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(screen.path);
      await page.waitForSelector(screen.ready);
      await expect(page).toHaveScreenshot(`${screen.name}-${vp.name}.png`, {
        fullPage: true,
        mask: [page.locator("[data-mask]")],
      });
    });
  }
  test(`${screen.name} passes axe (WCAG AA)`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(screen.path);
    await page.waitForSelector(screen.ready);
    await checkA11y(page);
  });
}

test("product detail renders at all widths and passes axe", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="product-card"]');
  await page.locator('[data-testid="product-card"]', { hasText: "Sofa range" }).click();
  await page.waitForSelector('[data-testid="pause-button"]');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page).toHaveScreenshot(`product-detail-${vp.name}.png`, {
      fullPage: true,
      mask: [page.locator("[data-mask]")],
    });
  }
  await checkA11y(page);
});

test("the activity why expansion shows evidence", async ({ page }) => {
  await page.goto("/activity");
  await page.waitForSelector('[data-testid="activity-item"]');
  const first = page.locator('[data-testid="activity-item"]').first();
  await first.getByRole("button", { name: "why" }).click();
  await expect(first.getByText("Expected:")).toBeVisible();
});

test("attention flow: see item → fix → clears", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="attention-area"]');
  const cards = page.locator('[data-testid="attention-card"]');
  const before = await cards.count();
  expect(before).toBeGreaterThan(0);
  // Fix the coverage warning (a resolvable item).
  await cards
    .filter({ hasText: "stopped reporting" })
    .first()
    .getByRole("button", { name: "Fix" })
    .click();
  await expect(cards.filter({ hasText: "stopped reporting" })).toHaveCount(0);
});

test("kill switch is togglable from Settings", async ({ page }) => {
  await page.goto("/settings");
  const toggle = page.locator('[data-testid="kill-switch-toggle"]');
  const state = page.locator('[data-testid="kill-switch-state"]');
  await expect(state).toContainText("Running normally");
  await toggle.click();
  await expect(state).toContainText("Stopped");
  // Confirm via API that the DB flag is engaged.
  const engaged = await page.evaluate(async () => {
    const res = await fetch("/internal/kill-switch");
    return ((await res.json()) as { engaged: boolean }).engaged;
  });
  expect(engaged).toBe(true);
  await toggle.click();
  await expect(state).toContainText("Running normally");
});

test("pause and resume a product from its detail screen", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="product-card"]', { hasText: "Sofa range" }).click();
  const pauseButton = page.locator('[data-testid="pause-button"]');
  await pauseButton.click();
  await expect(pauseButton).toContainText("Resume");
  await expect(page.locator('[data-testid="status-chip"]').first()).toContainText("Paused");
  await pauseButton.click();
  await expect(pauseButton).toContainText("Pause");
});

test("restricted sign-off queue approves from Settings", async ({ page }) => {
  await page.goto("/settings");
  const approve = page.locator('[data-testid="signoff-approve"]');
  await expect(approve).toHaveCount(1); // restricted finance playbook
  await approve.click();
  await expect(page.getByText("Nothing waiting for approval.")).toBeVisible();
});

test("product detail shows the per-ad view (W9)", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="product-card"]', { hasText: "Sofa range" }).click();
  await page.waitForSelector('[data-testid="pause-button"]');
  await expect(page.locator('[data-testid="ad-tile"]').first()).toBeVisible();
});

test("custom rules: add, toggle, remove (W9)", async ({ page }) => {
  await page.goto("/settings");
  await page.waitForSelector('[data-testid="rule-name"]');
  await page.locator('[data-testid="rule-name"]').fill("Watch the spend");
  await page.locator('[data-testid="rule-threshold"]').fill("100");
  await page.locator('[data-testid="rule-add"]').click();
  const row = page.locator('[data-testid="rule-row"]', { hasText: "Watch the spend" });
  await expect(row).toBeVisible();
  await row.locator('[data-testid="rule-toggle"]').click();
  await expect(row.locator('[data-testid="rule-toggle"]')).toContainText("Off");
  await row.locator('[data-testid="rule-delete"]').click();
  await expect(row).toHaveCount(0);
});
