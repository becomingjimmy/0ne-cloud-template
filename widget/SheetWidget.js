// ============================================
// SheetWidget v2.0.0
// 0ne Cloud Personal Finance Widget for iOS
// https://github.com/jimmyfuentes/SheetWidget
// ============================================

// ===========================================
// CONFIGURATION - Edit these values
// ===========================================

/**
 * 0ne Cloud API endpoint and auth token
 * The widget fetches KPIs from your 0ne Cloud instance.
 *
 * To get your API key:
 *   1. Set WIDGET_API_KEY in your Vercel environment variables
 *   2. Paste the same value here as API_KEY
 *   3. Both values MUST match or the widget returns 401
 */
const API_URL = "https://app.project0ne.ai/api/widget/metrics";
const API_KEY = "YOUR_WIDGET_API_KEY_HERE"; // Set in Vercel env as WIDGET_API_KEY

/**
 * Widget styling (optional customization)
 */
const STYLE = {
  // Colors (use hex codes)
  backgroundColor: "#1a1a1a",
  labelColor: "#ffffff",
  labelOpacity: 0.7,
  valueColor: "#4ade80",  // Green - change to "#ffffff" for white

  // Fonts
  labelFontSize: 12,
  valueFontSize: 16,
  titleFontSize: 14,

  // Lock screen specific (smaller)
  lockScreen: {
    labelFontSize: 10,
    valueFontSize: 12,
  },

  // Home screen title
  title: "💰 Personal Finance",
  showTitle: true,
};

// ===========================================
// SCRIPT - Edit below for advanced customization
// ===========================================

/**
 * Fetches metrics from 0ne Cloud API
 */
async function fetchMetrics() {
  try {
    const req = new Request(API_URL);
    req.headers = {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    };
    req.timeoutInterval = 15;

    const response = await req.loadJSON();

    if (response.error) {
      console.error(`API error: ${response.error}`);
      return [{ label: "Error", value: response.error }];
    }

    return response.metrics || [];
  } catch (error) {
    console.error(`Failed to fetch metrics: ${error}`);
    return [
      { label: "Cash On Hand", value: "ERR" },
      { label: "Burn Rate", value: "ERR" },
      { label: "Runway (Days)", value: "ERR" },
      { label: "Runway (Months)", value: "ERR" },
    ];
  }
}

/**
 * Determines if running on lock screen
 */
function isLockScreenWidget() {
  return config.widgetFamily === "accessoryRectangular" ||
         config.widgetFamily === "accessoryCircular" ||
         config.widgetFamily === "accessoryInline";
}

/**
 * Creates the widget UI
 */
function createWidget(metrics) {
  const widget = new ListWidget();
  widget.backgroundColor = new Color(STYLE.backgroundColor);

  const lockScreen = isLockScreenWidget();

  if (lockScreen) {
    // Lock screen: compact layout, no title
    createLockScreenLayout(widget, metrics);
  } else {
    // Home screen: spacious layout with optional title
    createHomeScreenLayout(widget, metrics);
  }

  return widget;
}

/**
 * Lock screen widget layout
 * Optimized for small rectangular space
 */
function createLockScreenLayout(widget, metrics) {
  const fontSize = STYLE.lockScreen;

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];

    const stack = widget.addStack();
    stack.layoutHorizontally();
    stack.centerAlignContent();

    // Label (left side)
    const labelText = stack.addText(metric.label);
    labelText.font = Font.mediumSystemFont(fontSize.labelFontSize);
    labelText.textColor = Color.white();
    labelText.textOpacity = STYLE.labelOpacity;
    labelText.lineLimit = 1;

    stack.addSpacer();

    // Value (right side)
    const valueText = stack.addText(String(metric.value));
    valueText.font = Font.boldSystemFont(fontSize.valueFontSize);
    valueText.textColor = Color.white();
    valueText.lineLimit = 1;

    // Add spacing between rows (except last)
    if (i < metrics.length - 1) {
      widget.addSpacer(2);
    }
  }
}

/**
 * Home screen widget layout
 * More spacious with optional title
 */
function createHomeScreenLayout(widget, metrics) {
  // Optional title
  if (STYLE.showTitle && STYLE.title) {
    const title = widget.addText(STYLE.title);
    title.font = Font.boldSystemFont(STYLE.titleFontSize);
    title.textColor = Color.white();
    widget.addSpacer(8);
  }

  for (let i = 0; i < metrics.length; i++) {
    const metric = metrics[i];

    const stack = widget.addStack();
    stack.layoutHorizontally();
    stack.centerAlignContent();

    // Label (left side)
    const labelText = stack.addText(metric.label);
    labelText.font = Font.systemFont(STYLE.labelFontSize);
    labelText.textColor = new Color(STYLE.labelColor);
    labelText.textOpacity = STYLE.labelOpacity;
    labelText.lineLimit = 1;

    stack.addSpacer();

    // Value (right side, colored)
    const valueText = stack.addText(String(metric.value));
    valueText.font = Font.boldSystemFont(STYLE.valueFontSize);
    valueText.textColor = new Color(STYLE.valueColor);
    valueText.lineLimit = 1;

    // Add spacing between rows (except last)
    if (i < metrics.length - 1) {
      widget.addSpacer(4);
    }
  }
}

// ===========================================
// MAIN EXECUTION
// ===========================================

async function main() {
  // Fetch metrics from 0ne Cloud
  const metrics = await fetchMetrics();

  // Create the widget
  const widget = createWidget(metrics);

  // Set or preview the widget
  if (config.runsInWidget) {
    Script.setWidget(widget);
  } else {
    // Running in app - show preview
    widget.presentMedium();
  }

  Script.complete();
}

// Run!
await main();
