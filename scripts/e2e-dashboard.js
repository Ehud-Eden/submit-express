const { chromium } = require('C:\\Users\\hp\\AppData\\Roaming\\npm\\node_modules\\n8n\\node_modules\\playwright');

const ORIGIN = 'http://127.0.0.1:8321';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(ORIGIN + '/03-duke-university/', { waitUntil: 'networkidle' });

  const progress = await page.locator('.se-progress').count();
  const bar = await page.locator('.se-progress-fill').count();
  const tasks = await page.locator('.task-list-item').count();
  const checked = await page.locator('.task-list-item input[type="checkbox"]:checked').count();
  const statusSel = await page.locator('select[data-se-status]').count();

  const firstBox = page.locator('.task-list-item input[type="checkbox"]').first();
  const before = await firstBox.isChecked();
  await firstBox.check({ force: true });
  await page.waitForTimeout(100);
  const checkedAfter = await page.locator('.task-list-item input[type="checkbox"]:checked').count();

  const pctBeforeReload = await page.locator('.se-progress-count').textContent();
  await page.reload({ waitUntil: 'networkidle' });
  const persisted = await page.locator('.task-list-item input[type="checkbox"]').first().isChecked();
  const pctAfterReload = await page.locator('.se-progress-count').textContent();

  await page.goto(ORIGIN + '/dashboard/', { waitUntil: 'networkidle' });
  const dash = await page.locator('#se-dash').count();
  const dashCount = await page.locator('.se-dash-count').textContent();

  await page.goto(ORIGIN + '/', { waitUntil: 'networkidle' });
  const homeCheck = await page.locator('.se-progress').count();

  console.log(JSON.stringify({
    duke: {
      progressHeader: progress === 1,
      progressBar: bar === 1,
      tasks,
      checkedBefore: checked,
      checkedAfter,
      persisted,
      pctBeforeReload,
      pctAfterReload,
      statusSelect: statusSel === 1,
    },
    dashboard: { rendered: dash === 1, dashCount },
    home: { progressHeader: homeCheck === 1 },
    jsErrors: errors,
  }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });