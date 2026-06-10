// GATE G12 Playwright e2e:
// (a) paste-link happy path to You're-live in two screens
// (b) describe-it with disambiguation + hosted-form destination, then a form
//     submission on the hosted page produces a canonical ConversionEvent
// (c) catalog CSV path
// (d) restricted product reaches Submit-for-review and is blocked from live
// Screenshots at all three viewports.
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:3105";

const VIEWPORTS = [
  { name: "phone", width: 375, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
];

async function findProductId(page: Page, title: string): Promise<string> {
  const res = await page.request.get(`${API}/internal/products`);
  const { products } = (await res.json()) as { products: { id: string; title: string }[] };
  const match = products.find((p) => p.title.includes(title));
  expect(match, `product ${title} should exist`).toBeDefined();
  return match!.id;
}

test.describe.configure({ mode: "serial" });

test("(a) paste-link happy path: two screens to You're live", async ({ page }) => {
  await page.goto("/add");
  // Screen 1 — Add.
  await page.getByTestId("add-input").fill(`${API}/demo/product-page`);
  await page.getByTestId("continue-button").click();
  // Screen 2 — Review (plan + creative previews).
  await expect(page.getByText("Here's the plan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("plan-sentence")).toContainText("Walnut Coffee Table");
  await expect(page.getByTestId("plan-sentence")).toContainText(
    "We'll start small and put more money behind whatever works.",
  );
  await expect(page.getByTestId("creative-tile").first()).toBeVisible();
  // Launch untouched.
  await page.getByTestId("launch-button").click();
  await expect(page.getByTestId("confirm-title")).toHaveText("You're live.", {
    timeout: 20_000,
  });
  // The spend cap line pulls the real configured cap (suggested 300/day for mid tier).
  await expect(page.getByTestId("spend-cap-line")).toContainText("We'll never spend more than");
});

test("(b) describe-it: disambiguation → hosted form → live → form submission measures a Lead", async ({
  page,
}) => {
  await page.goto("/add");
  await page.getByTestId("add-input").fill("Bloom things");
  await page.getByTestId("continue-button").click();

  // The single product-vs-service question (FLOW §4.5).
  await expect(page.getByTestId("disambiguation-question")).toHaveText(
    "Is this closer to selling a product, or offering a service?",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: "Offering a service" }).click();

  await expect(page.getByText("Here's the plan")).toBeVisible({ timeout: 20_000 });
  // No link given → People go to shows Choose; resolve it inline (FLOW §6).
  await expect(page.getByTestId("destination-line")).toHaveText("Choose");
  await page.getByRole("button", { name: "Edit People go to" }).click();
  await expect(page.getByText("When someone taps your ad, where should they go?")).toBeVisible();
  await page.getByRole("radio", { name: /A form we make for you/ }).check();
  await page.getByTestId("use-this").click();
  await expect(page.getByTestId("destination-line")).toHaveText("A form we make for you");

  await page.getByTestId("launch-button").click();
  await expect(page.getByTestId("confirm-title")).toHaveText("You're live.", { timeout: 20_000 });

  // The hosted form is a measurement surface: submit → canonical Lead (G2).
  const productId = await findProductId(page, "Bloom things");
  await page.goto(`${API}/hosted/f/${productId}?fbclid=e2e-click-1`);
  await page.locator('input[name="name"]').fill("Test Person");
  await page.locator('input[name="email"]').fill("person@example.com");
  await page.locator('input[name="phone"]').fill("+971500000001");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("form-thanks")).toBeVisible();

  const detail = await page.request.get(`${API}/internal/products/${productId}`);
  const { funnel } = (await detail.json()) as { funnel: { stage: string; count: number }[] };
  expect(funnel.find((f) => f.stage === "Lead")?.count).toBeGreaterThanOrEqual(1);
  expect(funnel.find((f) => f.stage === "ViewContent")?.count).toBeGreaterThanOrEqual(1);
});

test("(c) catalog CSV path: multi-product confirmation and single launch", async ({ page }) => {
  const rows = ["SKU,Product Name,Price,Currency,Stock", ...Array.from({ length: 5 }, (_, i) => `S-${i},Catalog Item ${i + 1},${120 + i * 10}.00,AED,5`)];
  await page.goto("/add");
  await page.getByTestId("file-input").setInputFiles({
    name: "catalog.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(rows.join("\n")),
  });
  await expect(page.getByText("Here's the plan")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("plan-sentence")).toContainText("We found 5 products.");
  await expect(page.getByTestId("plan-sentence")).toContainText(
    "show each person the ones they're most likely to buy",
  );
  // No destination on a CSV → hosted page is the easy default.
  await page.getByRole("button", { name: "Edit People go to" }).click();
  await page.getByRole("radio", { name: /A simple page we make for you/ }).check();
  await page.getByTestId("use-this").click();
  await page.getByTestId("launch-button").click();
  await expect(page.getByTestId("confirm-title")).toHaveText("You're live.", { timeout: 20_000 });
});

test("(d) restricted product reaches Submit-for-review and is blocked from live until sign-off", async ({
  page,
}) => {
  await page.goto("/add");
  await page
    .getByTestId("add-input")
    .fill("Personal loans with fast approval and low rates in Dubai");
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("Here's the plan")).toBeVisible({ timeout: 20_000 });

  // Restricted notice + button changes to Submit for review (FLOW §8.6).
  await expect(page.getByTestId("restricted-notice")).toContainText(
    "need a quick check before they go live",
  );
  const launchButton = page.getByTestId("launch-button");
  await expect(launchButton).toHaveText("Submit for review");

  // Destination first (no link), then submit.
  await page.getByRole("button", { name: "Edit People go to" }).click();
  await page.getByRole("radio", { name: /A form we make for you/ }).check();
  await page.getByTestId("use-this").click();
  await launchButton.click();
  await expect(page.getByTestId("confirm-title")).toHaveText("Submitted for review", {
    timeout: 20_000,
  });
  await expect(
    page.getByText("Submitted — we'll email you when your ads are approved."),
  ).toBeVisible();

  // Blocked from live: product is In review, no campaigns exist.
  const productId = await findProductId(page, "Personal loans");
  const detail = await page.request.get(`${API}/internal/products/${productId}`);
  const data = (await detail.json()) as {
    product: { status: string };
    campaigns: unknown[];
  };
  expect(data.product.status).toBe("in_review");
  expect(data.campaigns.length).toBe(0);
});

test("creation flow screenshots at all three viewports", async ({ page }) => {
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/add");
    await page.waitForSelector('[data-testid="add-input"]');
    await expect(page).toHaveScreenshot(`creation-add-${vp.name}.png`, { fullPage: true });
  }
  // Review screen at all widths (paste-link to reach it once, resize after).
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/add");
  await page.getByTestId("add-input").fill(`${API}/demo/product-page`);
  await page.getByTestId("continue-button").click();
  await expect(page.getByText("Here's the plan")).toBeVisible({ timeout: 20_000 });
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await expect(page).toHaveScreenshot(`creation-review-${vp.name}.png`, { fullPage: true });
  }
});
