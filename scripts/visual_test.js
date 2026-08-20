// 视觉验证脚本：用 puppeteer-core 模拟点击进入行程，截取行程中画面
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Users/wade/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1680, height: 1000 }
  });
  const page = await browser.newPage();
  const url = 'file:///C:/Users/wade/OneDrive/claw/workbuddy/train-journey/index.html';
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 500));

  // 选 北京南 → 上海虹桥，购票 G1 二等座
  await page.evaluate(() => {
    selFrom = '北京南'; selTo = '上海虹桥'; selTrain = 'G1'; selSeat = '二等座';
    buyTicket('京沪高速线', 'G1', '北京南', '上海虹桥', '二等座');
  });
  await new Promise(r => setTimeout(r, 400));

  // 行驶到中段（约 650km 处）—— 设 speedMul=16，tick 让其到中间
  await page.evaluate(() => {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    setSpeed(16);
    tick(4.5); // 4.5s * 16x * 8 = 576 km 推进
  });
  await new Promise(r => setTimeout(r, 200));

  await page.screenshot({ path: 'C:/Users/wade/OneDrive/claw/workbuddy/train-journey/shots/trip.png', fullPage: false });
  console.log('trip.png OK');

  // 第二张：夜间风景（强制 isNight）
  await page.evaluate(() => {
    if (TRIP) {
      // 强制 curMin 进入夜间（19:00+）让 scenery 走 night 风格
      TRIP.curMin = 21 * 60 + 30;  // 21:30
    }
    renderScenery(); renderTripInfo();
  });
  await new Promise(r => setTimeout(r, 200));
  await page.screenshot({ path: 'C:/Users/wade/OneDrive/claw/workbuddy/train-journey/shots/trip_night.png', fullPage: false });
  console.log('trip_night.png OK');

  // 第三张：成就页
  await page.evaluate(() => {
    closeTrip(); renderAll(); switchTab('ach');
  });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: 'C:/Users/wade/OneDrive/claw/workbuddy/train-journey/shots/ach.png', fullPage: false });
  console.log('ach.png OK');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
