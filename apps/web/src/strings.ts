// ALL user-facing strings live here and are linted against the banned
// platform-jargon list (CLAUDE.md invariant 7; UX §11). Plain, active,
// confident — a competent colleague.

export const STRINGS = {
  appName: "Engine",

  nav: {
    overview: "Overview",
    products: "Products",
    activity: "Activity",
    settings: "Settings",
    addProduct: "+ Add product",
    addShort: "+ Add",
  },

  headline: {
    running: "Everything is running.",
    learning: "Learning what works.",
    needs_attention: "Something needs your attention.",
    empty: "No products yet. Add one to start.",
  },

  counts: {
    products: (n: number): string => `${n} product${n === 1 ? "" : "s"}`,
    learning: (n: number): string => `${n} learning`,
    attention: (n: number): string => `${n} need${n === 1 ? "s" : ""} attention`,
  },

  kpi: {
    spend: "Spend · 7 days",
    results: "Results · 7 days",
    netReturn: "Return on total cost",
    runningCost: "Running cost · 7 days",
    runningCostHint: "What it costs to create and manage your ads",
    incremental: "Incremental return",
    incrementalPending: "Measuring — ready in a few weeks",
    noData: "No data yet",
  },

  attention: {
    title: "Needs attention",
    fix: "Fix",
    review: "Review",
    resolved: "Done",
  },

  status: {
    draft: "Draft",
    in_review: "In review",
    launching: "Launching",
    learning: "Learning",
    autonomous: "Autonomous",
    needs_attention: "Needs attention",
    paused: "Paused",
  } as Record<string, string>,

  statusNote: {
    learning: "Gathering enough results to optimize reliably.",
    launching: "Setting up your ads — this takes a minute.",
    paused: "Paused. Nothing is being spent.",
    in_review: "Submitted — we'll email you when your ads are approved.",
  } as Record<string, string>,

  product: {
    funnelTitle: "Funnel — last 7 days",
    activityTitle: "What the engine did",
    why: "why",
    pause: "Pause",
    resume: "Resume",
    adjust: "Adjust goal & budget",
    spent: "spent",
    running: "running",
    netShort: "net",
    buys: (n: number): string => `${n} ${n === 1 ? "buy" : "buys"}`,
    leads: (n: number): string => `${n} ${n === 1 ? "enquiry" : "enquiries"}`,
    showsOn: "Shows on",
    perDay: "Per day",
    goal: "Goal",
    save: "Save",
    cancel: "Cancel",
    empty: "Nothing here yet. The engine will narrate what it does as it works.",
  },

  funnelStage: {
    ViewContent: "Views",
    AddToCart: "Add to cart",
    InitiateCheckout: "Checkout started",
    Purchase: "Purchases",
    Lead: "Enquiries",
    CompleteRegistration: "Sign-ups",
    Install: "Installs",
  } as Record<string, string>,

  goals: {
    best: "We'll choose the best",
    more_sales: "More sales",
    more_enquiries: "More enquiries",
    more_bookings: "More bookings",
    more_app_installs: "More app installs",
    more_website_visits: "More website visits",
  } as Record<string, string>,

  activity: {
    title: "Activity",
    empty: "Nothing yet. As the engine works, every move it makes shows up here.",
    filterAll: "Everything",
    filterBudget: "Budget",
    filterCreative: "Ads",
    filterStatus: "Status",
    filterCheck: "Checks",
    predicted: "Expected",
    actual: "What happened",
    proposed: "Proposed (not applied)",
    blocked: "Held back by your limits",
  },

  settings: {
    title: "Settings",
    connections: "Connected accounts",
    connectionOk: "Connected",
    connectionProblem: "Needs reconnecting",
    notConnected: "Not connected",
    reconnect: "Reconnect",
    connect: "Connect",
    tracking: "Results tracking",
    trackingHint: "How reliably your sites tell us what's working.",
    trackingReady: "Reporting well",
    trackingPartial: "Partial — some results can't be tied to their ads",
    trackingPoor: "Weak — connect your site so we can see what's working",
    guardrails: "Spending limits",
    guardrailsHint: "Hard limits the engine can never cross.",
    globalCap: "Daily limit across everything",
    perProductCap: "Daily limit per product",
    maxStep: "Biggest single change",
    killSwitch: "Stop everything",
    killSwitchHint: "Halts all spending and activity immediately. You can turn it back on any time.",
    killSwitchOn: "Stopped — nothing is being spent",
    killSwitchOff: "Running normally",
    brandKit: "Brand kit",
    brandLogo: "Logo address",
    brandColor: "Main color",
    brandFont: "Font",
    brandTone: "Tone in one line",
    autonomy: "Autonomy",
    autonomyHint:
      "Each product starts careful and switches to automatic budget decisions once it has enough reliable results.",
    autonomyOn: "Automatic",
    autonomyWaiting: "Building up data",
    signoffQueue: "Waiting for your approval",
    signoffApprove: "Approve",
    signoffEmpty: "Nothing waiting for approval.",
    save: "Save",
    saved: "Saved",
  },

  platformNames: {
    meta: "Instagram & Facebook",
    google: "Google",
    tiktok: "TikTok",
  } as Record<string, string>,

  common: {
    loading: "Loading…",
    currency: "AED",
  },
};
