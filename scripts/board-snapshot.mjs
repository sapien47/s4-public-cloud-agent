// Opens the GR/IR board without a visible browser and saves a picture of it (for slides, the README or
// a backup if the tenant is down on demo day). Reads SAP only.
// Run: node --env-file=.env scripts/board-snapshot.mjs [tag]   ->  logs/board-<time>.png
import { chromium } from "playwright-core";
import path from "node:path";
import { openBoard, boardUrl } from "../src/board.mjs";
import { projectRoot } from "../src/proof.mjs";

process.env.APPROVAL_NO_BROWSER = "1";
await openBoard({ tag: process.argv[2] });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(boardUrl());
await page.locator(".card").first().waitFor({ timeout: 90000 });
await page.waitForTimeout(3000); // proof thumbnails
const file = path.join(projectRoot, "logs", `board-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}.png`);
await page.screenshot({ path: file, fullPage: true });
await browser.close();
console.log(`Saved ${path.relative(projectRoot, file)}`);
process.exit(0);
