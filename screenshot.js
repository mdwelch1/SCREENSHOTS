#!/usr/bin/env node

/**
 * Amazon screenshot automation runner.
 *
 * Requires:
 *   npm i playwright
 *
 * Usage:
 *   node screenshot.js
 *   OUTPUT_DIR=/tmp/screens node screenshot.js
 */

const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const RUN_DATE = new Date().toISOString().slice(0, 10);
const START_TS = new Date().toISOString();
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.resolve(process.cwd(), "amazon-screenshots");
const EXTRA_WAIT_MS = 5000;
const MAX_RETRIES = 3;
const STEP_TIMEOUT_MS = 60000;

const MARKETPLACES = [
  { code: "UK", domain: "amazon.co.uk", defaultLanguage: "en" },
  { code: "DE", domain: "amazon.de", defaultLanguage: "de" },
  { code: "FR", domain: "amazon.fr", defaultLanguage: "fr" },
  { code: "ES", domain: "amazon.es", defaultLanguage: "es" },
  { code: "IT", domain: "amazon.it", defaultLanguage: "it" },
  { code: "BE", domain: "amazon.com.be", defaultLanguage: "nl" },
  { code: "NL", domain: "amazon.nl", defaultLanguage: "nl" },
  { code: "SE", domain: "amazon.se", defaultLanguage: "sv" },
  { code: "PL", domain: "amazon.pl", defaultLanguage: "pl" },
  { code: "IE", domain: "amazon.ie", defaultLanguage: "en" },
];

const PAGE_TYPES = [
  { slug: "home", folder: "homepage", path: "/" },
  { slug: "event", folder: "event", path: "/springdealdays" },
];

const VIEWPORTS = [
  {
    name: "desktop",
    width: 1920,
    height: 1080,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  },
  {
    name: "mobile",
    width: 393,
    height: 852,
    userAgent: devices["iPhone 14 Pro"].userAgent,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: devices["iPhone 14 Pro"].deviceScaleFactor,
  },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toLanguageCode(raw, fallback = "en") {
  if (!raw || typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return fallback;
  const first = normalized.split(/[-_]/)[0];
  return first || fallback;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function fileName({ market, language, pageType, device, resolution }) {
  return `amazon_${market.toLowerCase()}_${language}_${pageType}_${device}_${resolution}_${RUN_DATE}.png`;
}

async function clickIfVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (await locator.isVisible({ timeout: 1500 })) {
        await locator.click({ timeout: 2000 });
        return true;
      }
    } catch {
      // ignore and continue trying alternatives
    }
  }
  return false;
}

async function dismissBlockingPopups(page) {
  const selectors = [
    "#sp-cc-accept",
    "input#sp-cc-accept",
    "button#sp-cc-accept",
    "button:has-text('Accept Cookies')",
    "button:has-text('Accept all')",
    "button:has-text('Akzeptieren')",
    "button:has-text('Tout accepter')",
    "button:has-text('Aceptar')",
    "button:has-text('Accetta')",
    "button:has-text('Acceptera')",
    "button:has-text('Accepteren')",
    "button:has-text('Zaakceptuj')",
    "button:has-text('Continue shopping')",
    "button:has-text('Not now')",
  ];

  await clickIfVisible(page, selectors);

  // Best-effort close for modal close buttons.
  await clickIfVisible(page, [
    "button[aria-label='Close']",
    "button[aria-label='Schließen']",
    "button[aria-label='Fermer']",
    "button[aria-label='Cerrar']",
  ]);
}

async function waitForPageLoaded(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: STEP_TIMEOUT_MS }).catch(() => {});
  await wait(EXTRA_WAIT_MS);
}

async function autoScroll(page, requireDealGrid = false) {
  let previousHeight = -1;
  let stablePasses = 0;

  for (let i = 0; i < 40; i += 1) {
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.mouse.wheel(0, 900);
    await wait(450);

    if (requireDealGrid) {
      await page.evaluate(() => {
        const possibleCards = Array.from(
          document.querySelectorAll(
            "[data-asin], .DealGridItem-module__card_*, .dealContainer, .octopus-pc-card"
          )
        );
        if (possibleCards.length) {
          possibleCards[possibleCards.length - 1].scrollIntoView({ behavior: "instant", block: "end" });
        }
      });
      await wait(300);
    }

    if (currentHeight === previousHeight) {
      stablePasses += 1;
      if (stablePasses >= 3) break;
    } else {
      stablePasses = 0;
      previousHeight = currentHeight;
    }
  }

  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await wait(500);
}

async function isLikelyBlankPage(page, pageTypeSlug) {
  const result = await page.evaluate((type) => {
    const body = document.body;
    const htmlText = (body?.innerText || "").trim();
    const hasText = htmlText.length > 200;
    const images = document.querySelectorAll("img").length;
    const hasHero = Boolean(
      document.querySelector("#gw-layout, #desktop-hero, .a-carousel, .hero, [data-csa-c-slot-id]")
    );

    const dealCards = document.querySelectorAll("[data-asin], .DealGridItem-module__card_*, .dealContainer").length;
    const looksBlank = !hasText || images < 3;

    if (type === "event") {
      return looksBlank || dealCards < 4;
    }
    return looksBlank && !hasHero;
  }, pageTypeSlug);

  return Boolean(result);
}

async function collectAvailableLanguages(page, fallback) {
  const detected = await page.evaluate((fb) => {
    const links = Array.from(document.querySelectorAll("#icp-nav-flyout a, #icp-language-settings a, a[href*='language='], a[href*='lang=']"));
    const langs = new Set();

    for (const a of links) {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").trim();
      const fromHref = href.match(/(?:language|lang)=([a-zA-Z_-]+)/i)?.[1];
      const fromLang = a.getAttribute("lang") || "";
      const fromHreflang = a.getAttribute("hreflang") || "";
      const candidate = fromHref || fromLang || fromHreflang || text;
      if (candidate) langs.add(candidate);
    }

    if (!langs.size) langs.add(fb);
    return Array.from(langs);
  }, fallback);

  const cleaned = [...new Set(detected.map((v) => toLanguageCode(v, fallback)))].filter(Boolean);
  return cleaned.length ? cleaned : [fallback];
}

async function switchLanguage(page, language) {
  const switched = await page.evaluate((lang) => {
    const candidates = Array.from(
      document.querySelectorAll("#icp-nav-flyout a, #icp-language-settings a, a[href*='language='], a[href*='lang=']")
    );

    const direct = candidates.find((a) => {
      const href = a.getAttribute("href") || "";
      const text = (a.textContent || "").toLowerCase();
      const token = lang.toLowerCase();
      return href.toLowerCase().includes(`language=${token}`) || href.toLowerCase().includes(`lang=${token}`) || text.includes(token);
    });

    if (direct) {
      direct.click();
      return true;
    }
    return false;
  }, language);

  if (switched) {
    await page.waitForLoadState("domcontentloaded", { timeout: STEP_TIMEOUT_MS }).catch(() => {});
    await wait(1200);
  }
}

async function captureOne(page, cfg) {
  const {
    domain,
    marketCode,
    language,
    pageType,
    device,
    outDir,
    metadata,
  } = cfg;

  let retries = 0;
  let success = false;
  let finalUrl = "";
  let errorMessage = null;

  while (retries < MAX_RETRIES && !success) {
    try {
      const targetUrl = `https://${domain}${pageType.path}`;
      await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
      await dismissBlockingPopups(page);
      await switchLanguage(page, language);
      await waitForPageLoaded(page);
      await autoScroll(page, pageType.slug === "event");

      if (await isLikelyBlankPage(page, pageType.slug)) {
        retries += 1;
        await page.reload({ waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT_MS });
        await waitForPageLoaded(page);
        continue;
      }

      finalUrl = page.url();
      const resolution = `${device.width}x${device.height}`;
      const screenshotName = fileName({
        market: marketCode,
        language,
        pageType: pageType.slug,
        device: device.name,
        resolution,
      });

      const targetDir = path.join(outDir, marketCode, pageType.folder);
      await ensureDir(targetDir);
      const targetFile = path.join(targetDir, screenshotName);

      await page.screenshot({
        path: targetFile,
        fullPage: true,
        animations: "disabled",
      });

      metadata.push({
        url: finalUrl,
        marketplace: marketCode,
        language,
        pageType: pageType.folder,
        device: device.name,
        viewport: resolution,
        timestamp: new Date().toISOString(),
        success: true,
        blankPageRetries: retries,
        file: targetFile,
      });

      success = true;
    } catch (error) {
      retries += 1;
      errorMessage = error?.message || String(error);
      if (retries >= MAX_RETRIES) {
        metadata.push({
          url: finalUrl || `https://${domain}${pageType.path}`,
          marketplace: marketCode,
          language,
          pageType: pageType.folder,
          device: device.name,
          viewport: `${device.width}x${device.height}`,
          timestamp: new Date().toISOString(),
          success: false,
          blankPageRetries: retries,
          error: errorMessage,
        });
      }
    }
  }
}

async function main() {
  await ensureDir(OUTPUT_DIR);
  const metadata = [];
  const logLines = [`Run started: ${START_TS}`];

  const browser = await chromium.launch({ headless: true });

  try {
    for (const device of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        userAgent: device.userAgent,
        isMobile: Boolean(device.isMobile),
        hasTouch: Boolean(device.hasTouch),
        deviceScaleFactor: device.deviceScaleFactor || 1,
        locale: "en-US",
      });

      for (const market of MARKETPLACES) {
        const discoveryPage = await context.newPage();
        await discoveryPage.goto(`https://${market.domain}/`, {
          waitUntil: "domcontentloaded",
          timeout: STEP_TIMEOUT_MS,
        });
        await dismissBlockingPopups(discoveryPage);
        await waitForPageLoaded(discoveryPage);

        const languages = await collectAvailableLanguages(discoveryPage, market.defaultLanguage);
        logLines.push(`${market.code} [${device.name}] languages => ${languages.join(",")}`);
        await discoveryPage.close();

        for (const language of languages) {
          for (const pageType of PAGE_TYPES) {
            const page = await context.newPage();
            logLines.push(`Capturing ${market.code}/${language}/${pageType.slug}/${device.name}`);

            await captureOne(page, {
              domain: market.domain,
              marketCode: market.code,
              language,
              pageType,
              device,
              outDir: OUTPUT_DIR,
              metadata,
            });

            await page.close();
          }
        }
      }

      await context.close();
    }
  } finally {
    await browser.close();
  }

  const metadataPath = path.join(OUTPUT_DIR, "metadata.json");
  const logPath = path.join(OUTPUT_DIR, "execution.log");

  await fs.writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  await fs.writeFile(logPath, `${logLines.join("\n")}\n`, "utf8");

  console.log(`Done. Wrote ${metadata.length} metadata rows to ${metadataPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
