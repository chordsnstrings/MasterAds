// Demo dataset: 3 products across statuses, sample decisions, conversions,
// costs. Used by repository tests, UI development, and Playwright e2e.
import { createDb, closeDb, type Db } from "./client.js";
import { createRepos } from "./repos.js";

export async function seed(db: Db): Promise<void> {
  const repos = createRepos(db);

  // Idempotent: skip when the demo data is already present.
  if (await repos.products.get("prod_demo_sofa")) return;

  const playbook = await repos.playbooks.upsertByVertical({
    id: "pb_demo_ecom",
    vertical: "ecommerce_physical_goods",
    objective: "purchases",
    funnelEvents: ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    creativeAngles: ["lifestyle", "feature_focused", "value_convenience"],
    formatMix: ["1:1", "9:16", "16:9"],
    audienceStrategy: "broad_platform_ai",
    complianceConstraints: [],
    performancePriors: { expected_cvr: 0.02 },
    status: "active",
  });

  const sofa = await repos.products.insert({
    id: "prod_demo_sofa",
    mode: "catalog",
    vertical: "ecommerce_physical_goods",
    sourceRef: "https://demo.example/sofa",
    title: "Sofa range",
    description: "Three-seater modular sofa in washed linen.",
    price: "2400.0000",
    currency: "AED",
    url: "https://demo.example/sofa",
    images: ["https://demo.example/sofa.jpg"],
    category: "home_furnishings",
    availability: "in_stock",
    status: "autonomous",
  });

  const charger = await repos.products.insert({
    id: "prod_demo_charger",
    mode: "offer",
    vertical: "local_services_leadgen",
    sourceRef: "text",
    title: "EV charger installation",
    description: "Home EV charger supply and installation, certified electricians.",
    price: "1800.0000",
    currency: "AED",
    rawInput: "We install EV chargers at home in Dubai, certified, from AED 1800",
    category: "home_services",
    availability: "in_stock",
    status: "learning",
  });

  await repos.products.insert({
    id: "prod_demo_villa",
    mode: "offer",
    vertical: "property_leadgen",
    sourceRef: "text",
    title: "Villa lease",
    description: "4-bedroom villa leasing in Jumeirah, viewings this week.",
    currency: "AED",
    rawInput: "4 bed villa for lease in Jumeirah, book a viewing",
    category: "property",
    availability: "in_stock",
    status: "draft",
  });

  const spec = await repos.specs.insert({
    id: "spec_demo_sofa",
    productId: sofa.id,
    playbookId: playbook.id,
    businessModel: "ecommerce",
    terminalEvent: "Purchase",
    optimizationEvent: "Purchase",
    funnelStages: ["ViewContent", "AddToCart", "InitiateCheckout", "Purchase"],
    priceTier: "high",
    creativeAngle: "lifestyle",
    policyCategory: "standard",
    targetPlatforms: ["meta", "tiktok"],
    audienceStrategy: "broad_platform_ai",
    formatMix: ["1:1", "9:16", "16:9"],
    goal: "more_sales",
    dailyBudget: "500.0000",
    budgetCurrency: "AED",
    destination: { kind: "url", value: "https://demo.example/sofa" },
  });

  const campaign = await repos.campaigns.insertIdempotent({
    id: "camp_demo_sofa_meta",
    specId: spec.id,
    platform: "meta",
    platformCampaignId: "stub_meta_demo_1",
    campaignType: "advantage_plus",
    objective: "purchases",
    optimizationEvent: "Purchase",
    budget: "500.0000",
    status: "autonomous",
    learningState: "exited",
    allocationAutonomous: true,
    promotedAt: new Date("2026-06-01T00:00:00Z"),
  });

  await repos.creatives.insert({
    id: "cr_demo_sofa_1",
    productId: sofa.id,
    variantNo: 1,
    format: "1:1",
    assetType: "image",
    assetRef: "stub://creative/sofa/1",
    payload: { headline: "Sink in. Stay a while.", body: "Modular comfort in washed linen." },
    contentId: sofa.id,
    predictedScore: "0.7100",
    status: "launched",
  });

  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    await repos.conversions.insertIdempotent({
      eventName: "Purchase",
      eventTime: new Date(now - i * 3_600_000),
      value: "2400.0000",
      currency: "AED",
      contentId: sofa.id,
      clickIds: { fbclid: `demo-fbclid-${i}`, fbp: "fb.1.123.456" },
      hashedIdentifiers: { email_sha256: "a".repeat(64) },
      eventId: `demo-purchase-${i}`,
      sourceSite: "demo-store",
      dedupKey: `demo-store:demo-purchase-${i}`,
      reconciliationKey: `Purchase:demo-purchase-${i}`,
      canonical: true,
    });
  }

  const decision = await repos.decisions.insert({
    loop: "medium",
    worker: "allocation",
    actionType: "budget_change",
    targetRef: `campaign:${campaign.id}`,
    rationale: "Checkout rate up 22% over 5 days; shifting budget toward this product.",
    evidence: [{ metric: "checkout_rate", window: "5d", result: "+22%" }],
    predictedOutcome: "+15% purchases at stable cost per purchase",
    guardrailStatus: "passed",
    executed: true,
    productId: sofa.id,
  });
  await repos.decisions.insertOutcome({
    decisionId: decision.id,
    actualOutcome: "+12% purchases at -3% cost per purchase",
    scoredDelta: "0.8000",
  });

  await repos.costs.insert({
    costType: "ad_spend",
    providerOrPlatform: "meta",
    units: {},
    amount: "12400.000000",
    currency: "AED",
    productId: sofa.id,
    campaignId: campaign.id,
    occurredAt: new Date(now - 86_400_000),
  });
  await repos.costs.insert({
    costType: "ai_inference",
    operation: "creative_image",
    providerOrPlatform: "stub-creative",
    model: "stub-image-1",
    units: { images: 9 },
    unitPrice: "0.04000000",
    amount: "0.360000",
    currency: "USD",
    productId: sofa.id,
    occurredAt: new Date(now - 86_400_000),
  });
  await repos.costs.insert({
    costType: "ai_inference",
    operation: "classification",
    providerOrPlatform: "stub-llm",
    model: "stub-classifier-1",
    units: { input_tokens: 1200, output_tokens: 300 },
    unitPrice: "0.00000300",
    amount: "0.004500",
    currency: "USD",
    productId: charger.id,
    occurredAt: new Date(now - 7_200_000),
  });

  await repos.siteKeys.create("demo-store", "demo-store-key", "Demo storefront");
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const db = createDb();
  seed(db)
    .then(async () => {
      console.log(JSON.stringify({ msg: "seed complete" }));
      await closeDb(db);
    })
    .catch(async (err) => {
      console.error(err);
      await closeDb(db);
      process.exit(1);
    });
}
