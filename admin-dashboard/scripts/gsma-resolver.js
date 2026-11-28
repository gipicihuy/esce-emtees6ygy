const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://m.gsmarena.com';
const ROOT = process.env.FIREBASE_ROOT || 'https://cihuy-a-default-rtdb.asia-southeast1.firebasedatabase.app';
const AUTH = process.env.FIREBASE_AUTH_HEADER || 'Basic YWRtaW46YWRtaW4=';
const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const INDEX_FILE = path.join(__dirname, '..', 'data', 'gsma-index.json');
const CHECK_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_DETAILS = Number(process.env.GSMA_MAX_DETAILS || 1200);
const MODEL_OVERRIDES = {
  I2218: {
    name: 'vivo iQOO Z9 (China)',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/vivo-iqoo-z9-cn.jpg',
    url: BASE + '/vivo_iqoo_z9_%28china%29-ampp-12959.php',
    models: ['V2361A'],
    chipset: 'Qualcomm SM7550-AB Snapdragon 7 Gen 3 (4 nm)'
  },
  V2131: {
    name: 'vivo Y21t',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/vivo-y21s.jpg',
    url: BASE + '/vivo_y21t-11294.php',
    models: ['V2131', 'V2135'],
    chipset: 'Qualcomm SM6225 Snapdragon 680 4G (6 nm)'
  },
  TECNOLI7: {
    name: 'Tecno Pova 6',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/tecno-pova-6.jpg',
    url: BASE + '/tecno_pova_6-12910.php',
    models: ['LI7'],
    chipset: 'Mediatek Helio G99 Ultimate (6 nm)'
  },
  CPH2591: {
    name: 'Oppo A18',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/oppo-a38.jpg',
    url: BASE + '/oppo_a18-12591.php',
    models: ['CPH2591'],
    chipset: 'Mediatek MT6769 Helio G85 (12 nm)'
  },
  X6873: {
    name: 'Infinix GT 30 Pro',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/infinix-gt30-pro.jpg',
    url: BASE + '/infinix_gt_30_pro_5g-13889.php',
    models: ['X6873'],
    chipset: 'Mediatek Dimensity 8350 Ultimate (4 nm)'
  },
  CPH2895: {
    name: 'Oppo A6c',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/oppo-a6c-global.jpg',
    url: BASE + '/oppo_a6c-14418.php',
    models: ['CPH2895'],
    chipset: 'Unisoc T7250 (12 nm)'
  },
  X682B: {
    name: 'Infinix Hot 10',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/infinix-hot10.jpg',
    url: BASE + '/infinix_hot_10-10452.php',
    models: ['X682B', 'X682C'],
    chipset: 'Mediatek MT6769V/CB Helio G70 (12 nm)'
  },
  X6858: {
    name: 'Infinix Note 50 4G',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/infinix-note50.jpg',
    url: BASE + '/infinix_note_50_4g-13705.php',
    models: ['X6858'],
    chipset: 'Mediatek Helio G100 Ultimate (6 nm)'
  },
  SMA235F: {
    name: 'Samsung Galaxy A23',
    image: 'https://fdn2.gsmarena.com/vv/bigpic/samsung-galaxy-a23.jpg',
    url: BASE + '/samsung_galaxy_a23-11373.php',
    models: ['SM-A235F', 'SM-A235F/DS', 'SM-A235F/DSN', 'SM-A235M', 'SM-A235M/DS', 'SM-A235N'],
    chipset: 'Qualcomm SM6225 Snapdragon 680 4G (6 nm)'
  }
};

const http = axios.create({
  baseURL: BASE,
  family: 4,
  timeout: 30000,
  headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' }
});
const firebase = axios.create({
  baseURL: ROOT,
  timeout: 20000,
  headers: { 'Authorization': AUTH }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalize = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const brandKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

let staticIndex = null;
let brands = null;
let brandsAt = 0;
const inflight = new Map();

async function getHtml(target, attempt = 0) {
  try {
    const response = await http.get(target);
    const html = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    if (/GSMArena Turnstile check|cf-turnstile/.test(html)) throw new Error('GSMArena meminta verifikasi');
    return html;
  } catch (error) {
    const status = error.response?.status;
    if (attempt < 2 && (status >= 500 || status === 429 || error.code === 'ECONNABORTED')) {
      await sleep(800 * (attempt + 1));
      return getHtml(target, attempt + 1);
    }
    throw error;
  }
}

async function firebasePatch(target, body) {
  await firebase.patch(target + '.json', body);
}

function loadIndex() {
  if (staticIndex) return staticIndex;
  try {
    staticIndex = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (error) {
    staticIndex = {};
  }
  return staticIndex;
}

async function loadBrands() {
  if (brands && Date.now() - brandsAt < 7 * 24 * 60 * 60 * 1000) return brands;
  const $ = cheerio.load(await getHtml('/makers.php3'));
  const found = {};
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const match = href.match(/^([a-z0-9_&]+)-phones-(\d+)\.php$/i);
    const name = $(element).text().trim();
    if (!match || !name) return;
    found[brandKey(name)] = { name, slug: match[1], id: match[2] };
  });
  if (!Object.keys(found).length) throw new Error('Daftar merek GSMArena kosong');
  brands = found;
  brandsAt = Date.now();
  return brands;
}

function resolveBrand(maker) {
  const all = brands || {};
  const key = brandKey(maker);
  if (all[key]) return all[key];
  for (const [brandId, brand] of Object.entries(all)) {
    if (key && (brandId.includes(key) || key.includes(brandId))) return brand;
  }
  return null;
}

function parsePhoneLinks(html) {
  const $ = cheerio.load(html);
  const links = [];
  $('#list-brands a[href], .list-brands a[href]').each((_, element) => {
    const href = $(element).attr('href') || '';
    const label = $(element).text().trim();
    if (!label || !/-\d+\.php$/i.test(href)) return;
    if (/-phones-|php3|compare|news|review/i.test(href)) return;
    links.push({ label, href });
  });
  return links;
}

async function getPhoneLinks(brand) {
  const mainHtml = await getHtml('/' + brand.slug + '-phones-' + brand.id + '.php');
  const links = parsePhoneLinks(mainHtml);
  const $ = cheerio.load(mainHtml);
  let lastPage = 1;
  const pagePattern = new RegExp(brand.slug + '-phones-f-' + brand.id + '-0-p(\\d+)\\.php', 'i');
  $('a[href]').each((_, element) => {
    const match = ($(element).attr('href') || '').match(pagePattern);
    if (match) lastPage = Math.max(lastPage, Number(match[1]));
  });

  for (let page = 2; page <= lastPage; page++) {
    await sleep(120);
    const html = await getHtml('/' + brand.slug + '-phones-f-' + brand.id + '-0-p' + page + '.php');
    links.push(...parsePhoneLinks(html));
  }

  const seenUrls = new Set();
  return links.filter(link => {
    const url = new URL(link.href, BASE).href;
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    link.url = url;
    return true;
  });
}

async function fetchPhone(link) {
  const html = await getHtml(link.url);
  const $ = cheerio.load(html);
  const name = $('h1').first().text().trim() || link.label;
  let image = $('.specs-cp-pic-rating img').attr('src')
    || $('img[src*="/vv/bigpic/"]').first().attr('src')
    || $('img[src*="/vv/pics/"]').first().attr('src')
    || null;
  if (image && image.startsWith('//')) image = 'https:' + image;
  else if (image && image.startsWith('/')) image = BASE + image;

  const models = $('[data-spec="models"]').first().text()
    .split(/[,;/|\n]+/)
    .map(part => part.trim())
    .filter(Boolean);

  const chipset = $('[data-spec="chipset"]').first().text().trim().replace(/\s+/g, ' ') || null;

  return { name, image, url: link.url, models, chipset };
}

async function fillChipset(phone) {
  if (!phone || !phone.url || phone.chipset) return phone;
  try {
    const detail = await fetchPhone({ label: phone.name, url: phone.url });
    return detail.chipset ? Object.assign({}, phone, { chipset: detail.chipset }) : phone;
  } catch (error) {
    return phone;
  }
}

function matchScore(phone, query) {
  if (phone.models.some(model => normalize(model) === query)) return 4;
  if (normalize(phone.name).endsWith(query)) return 3;
  if (query.length >= 4 && phone.models.some(model => normalize(model).includes(query))) return 2;
  if (query.length >= 4 && normalize(phone.name).includes(query)) return 1;
  return 0;
}

async function deepResolve(model, maker) {
  const query = normalize(model);
  await loadBrands();
  const brand = resolveBrand(maker);
  if (!brand || !query) return null;

  const links = await getPhoneLinks(brand);
  let best = null;
  let checked = 0;
  for (const link of links) {
    if (checked >= MAX_DETAILS) break;
    await sleep(120);
    const phone = await fetchPhone(link);
    checked++;
    const score = matchScore(phone, query);
    if (score >= 3) return phone;
    if (score && !best) best = phone;
  }
  return best;
}

function normalizeResult(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    found: entry.found !== false,
    name: entry.name || null,
    image: entry.image || null,
    url: entry.url || null,
    models: Array.isArray(entry.models) ? entry.models : [],
    chipset: entry.chipset || null
  };
}

function candidateQueries(model) {
  const text = String(model ?? '').trim();
  const parts = text.split(/\s+/);
  return [normalize(text), normalize(parts[parts.length - 1])].filter(Boolean);
}

async function resolveModel(model, maker) {
  const override = MODEL_OVERRIDES[normalize(model)];
  if (override) return normalizeResult(Object.assign({}, override, { found: true }));
  const queries = candidateQueries(model);
  const query = queries[0];
  if (!query) return { found: false, name: null, image: null, url: null, models: [], chipset: null };
  if (inflight.has(query)) return inflight.get(query);

  const job = (async () => {
    const index = loadIndex();
    let phone = null;
    for (const candidate of queries) {
      phone = normalizeResult(index[candidate]);
      if (phone && phone.name) break;
    }
    if (phone && phone.name && !phone.chipset) phone = await fillChipset(phone);
    if (!phone || !phone.name) {
      for (const candidate of queries) {
        if (candidate.length < 2) continue;
        const deep = await deepResolve(candidate, maker);
        if (!deep || !deep.name) continue;
        if (matchScore(deep, candidate) >= 3) { phone = deep; break; }
        if (!phone) phone = deep;
      }
    }
    return phone && phone.name
      ? Object.assign({}, phone, { found: true })
      : { found: false, name: null, image: null, url: null, models: [], chipset: null };
  })();

  inflight.set(query, job);
  try {
    return await job;
  } finally {
    inflight.delete(query);
  }
}

async function resolveDevice(record) {
  const model = String(record.model ?? '').trim();
  const maker = String(record.manufacturer ?? '').trim();
  const code = String(record.code ?? '').trim();
  const result = await resolveModel(model, maker);
  if (!code) return result;

  if (result.found) {
    await firebasePatch('/devices/' + code, {
      gsmaName: result.name,
      gsmaImage: result.image,
      gsmaUrl: result.url,
      gsmaModels: result.models,
      gsmaChipset: result.chipset,
      gsmaResolvedAt: Date.now(),
      gsmaCheckedAt: Date.now(),
      gsmaMissing: false
    });
  } else {
    await firebasePatch('/devices/' + code, { gsmaCheckedAt: Date.now(), gsmaMissing: true });
  }
  return result;
}

module.exports = { resolveDevice, resolveModel, normalize, CHECK_TTL };
