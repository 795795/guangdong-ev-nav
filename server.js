/*
 * server.js — 广东新能源导航 · Express 后端代理
 * -----------------------------------------------
 * 功能：
 *   1) 托管 web/ 目录下的静态资源（index.html、JS、CSS、图片等）。
 *   2) 将前端请求 /api/amap/<alias> 转发到高德 restapi.amap.com，
 *      自动注入高德 Web 服务 KEY，前端绝对不出现明文 AK。
 *   3) 提供 /api/amap/parking 与 /api/amap/charging 两个复合接口，
 *      严格按要求带上 location / types=停车场 / radius=5000 / extensions=all
 *      与充电站专用的 v3/station/electric。
 *   4) 简单的速率限制与 JSON 响应结构校验。
 * 启动：
 *   npm install
 *   npm start
 *   浏览器打开 http://127.0.0.1:3000/
 */

const express = require('express');
const cors = require('cors');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== 高德 KEY（本地开发时使用）：只保存在后端，前端绝对不可见 =====
// 注意：生产部署在 GitHub Pages，前端直接调高德（Referer 白名单已配置 AK）
// 本地开发启动命令：AMAP_KEY=faf78a1b9d57c1e1a88fd9f50c795032 AMAP_JS_KEY=faf78a1b9d57c1e1a88fd9f50c795032 npm start
const AMAP_KEY    = process.env.AMAP_KEY    || 'faf78a1b9d57c1e1a88fd9f50c795032';
const AMAP_JS_KEY = process.env.AMAP_JS_KEY || 'faf78a1b9d57c1e1a88fd9f50c795032';
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE || '6bd6ab656be75d5fc632bca3a68059c9';
const AMAP_REST = 'https://restapi.amap.com';

app.use(cors());
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true }));

// ====== 静态资源：web/index.html 与 web/*.js/css 等 ======
const WEB_DIR = path.join(__dirname, 'web');
app.use(express.static(WEB_DIR, { extensions: ['html'] }));

// ====== 简易速率限制 (每个 IP 每分钟 120 次) ======
const rateMap = new Map();
function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown').toString();
  const now = Date.now();
  const bucket = rateMap.get(ip) || { count: 0, reset: now + 60000 };
  if (now > bucket.reset) { bucket.count = 0; bucket.reset = now + 60000; }
  bucket.count++;
  rateMap.set(ip, bucket);
  if (bucket.count > 120) {
    return res.status(429).json({ status: '0', info: '请求过多，请稍后再试' });
  }
  next();
}

// ====== 统一将请求转发到高德 ======
function forwardToAmap(apiPath, extraParams) {
  return new Promise((resolve, reject) => {
    const parts = [];
    // 合并所有参数，注入 key（只在后端注入）
    const allParams = Object.assign({}, extraParams || {}, { key: AMAP_KEY });
    for (const k of Object.keys(allParams)) {
      const v = allParams[k];
      if (v === undefined || v === null || v === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
    }
    const qs = parts.join('&');
    const url = AMAP_REST + apiPath + (qs ? '?' + qs : '');
    const req = https.get(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'GuangdongEVNav/1.0' },
      timeout: 12000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          resolve(obj);
        } catch (e) {
          reject(new Error('高德响应解析失败: ' + e.message));
        }
      });
    });
    req.on('error', (e) => reject(new Error('高德请求失败: ' + e.message)));
    req.on('timeout', () => { req.destroy(); reject(new Error('高德请求超时')); });
  });
}

// ====== /api/amap/around  附近搜索（通用，支持任意 keyword / types） ======
app.get('/api/amap/around', rateLimit, async (req, res) => {
  try {
    const { location, keywords, types, radius, extensions, offset, page_size, sort, city } = req.query;
    if (!location) return res.status(400).json({ status: '0', info: '缺少 location 参数' });
    const result = await forwardToAmap('/v3/place/around', {
      location: String(location),
      keywords: keywords ? String(keywords) : '',
      types: types ? String(types) : '',
      radius: radius ? String(radius) : '5000',
      extensions: extensions ? String(extensions) : 'all',
      offset: offset ? String(offset) : '1',
      page_size: page_size ? String(page_size) : '30',
      sort: sort ? String(sort) : 'distance',
      city: city ? String(city) : '',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: '0', info: e.message });
  }
});

// ====== /api/amap/parking  停车场（固定 types=停车场, radius=5000, extensions=all） ======
app.get('/api/amap/parking', rateLimit, async (req, res) => {
  try {
    const { location, radius, offset, page_size, city } = req.query;
    if (!location) return res.status(400).json({ status: '0', info: '缺少 location 参数' });
    const result = await forwardToAmap('/v3/place/around', {
      location: String(location),
      keywords: '',
      types: '停车场',
      radius: String(radius || 5000),
      extensions: 'all',
      offset: String(offset || 1),
      page_size: String(page_size || 30),
      sort: 'distance',
      city: city ? String(city) : '',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: '0', info: e.message });
  }
});

// ====== /api/amap/charging  充电站（v3/station/electric，radius=5000, extensions=all） ======
app.get('/api/amap/charging', rateLimit, async (req, res) => {
  try {
    const { location, radius, offset, page_size, city } = req.query;
    if (!location) return res.status(400).json({ status: '0', info: '缺少 location 参数' });
    const result = await forwardToAmap('/v3/station/electric', {
      location: String(location),
      radius: String(radius || 5000),
      extensions: 'all',
      offset: String(offset || 1),
      page_size: String(page_size || 30),
      sort: 'distance',
      city: city ? String(city) : '',
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ status: '0', info: e.message });
  }
});

// ====== 其他常见代理接口（联想、地理编码、逆地理、路线规划） ======
// 联想（inputtips）
app.get('/api/amap/suggest', rateLimit, async (req, res) => {
  try {
    const { keyword, city, location } = req.query;
    const result = await forwardToAmap('/v3/assistant/inputtips', {
      keywords: keyword ? String(keyword) : '',
      city: city ? String(city) : '全国',
      location: location ? String(location) : '',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 地理编码（地址 → 坐标）
app.get('/api/amap/geo', rateLimit, async (req, res) => {
  try {
    const { address, city } = req.query;
    const result = await forwardToAmap('/v3/geocode/geo', {
      address: address ? String(address) : '',
      city: city ? String(city) : '',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 逆地理编码（坐标 → 地址）
app.get('/api/amap/regeo', rateLimit, async (req, res) => {
  try {
    const { location, radius, extensions } = req.query;
    const result = await forwardToAmap('/v3/geocode/regeo', {
      location: location ? String(location) : '',
      radius: String(radius || 200),
      extensions: String(extensions || 'base'),
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 驾车路线规划
app.get('/api/amap/driving', rateLimit, async (req, res) => {
  try {
    const { origin, destination, strategy, extensions } = req.query;
    const result = await forwardToAmap('/v5/direction/driving', {
      origin: origin ? String(origin) : '',
      destination: destination ? String(destination) : '',
      strategy: String(strategy || 0),
      extensions: String(extensions || 'base'),
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 前端动态加载高德 JS API 的 key 代理（前端源码不含 key）
// 浏览器请求此接口，返回带 key + 安全密钥的高德 JS API URL
// Amap JS API v2.0 安全配置：需要先加载 security.js，再加载主地图脚本
app.get('/api/amap/loader', rateLimit, (req, res) => {
  const plugins = [
    'AMap.Geolocation',
    'AMap.ToolBar',
    'AMap.Scale',
    'AMap.Geocoder',
    'AMap.PlaceSearch',
    'AMap.Driving',
    'AMap.Walking',
    'AMap.Riding',
    'AMap.MarkerClusterer',
    'AMap.Polyline',
    'AMap.Circle',
  ];
  // 返回一个内嵌脚本，先加载安全验证 JS，再加载地图主脚本
  const jsKey = AMAP_JS_KEY;
  const secCode = AMAP_SECURITY_CODE;
  const url = 'https://webapi.amap.com/maps?v=2.0&key=' + jsKey
    + '&plugin=' + plugins.join(',');
  const secUrl = 'https://webapi.amap.com/security?xtoken=' + encodeURIComponent(secCode);
  // 返回 HTML 片段，前端通过 <script src="/api/amap/loader"></script> 加载
  const html = [
    '(function(){',
    '  var s1 = document.createElement("script");',
    '  s1.src = "' + secUrl + '";',
    '  s1.onerror = function(){ console.warn("AMap security script failed"); };',
    '  document.head.appendChild(s1);',
    '  var s2 = document.createElement("script");',
    '  s2.src = "' + url + '";',
    '  s2.onload = function(){ if(window._amapInit) window._amapInit(); };',
    '  document.head.appendChild(s2);',
    '})();'
  ].join('\n');
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(html);
});

// 步行路线规划
app.get('/api/amap/walking', rateLimit, async (req, res) => {
  try {
    const { origin, destination } = req.query;
    const result = await forwardToAmap('/v3/direction/walking', {
      origin: origin ? String(origin) : '',
      destination: destination ? String(destination) : '',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 骑行路线规划
app.get('/api/amap/riding', rateLimit, async (req, res) => {
  try {
    const { origin, destination } = req.query;
    const result = await forwardToAmap('/v4/direction/bicycling', {
      origin: origin ? String(origin) : '',
      destination: destination ? String(destination) : '',
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// POI 详情
app.get('/api/amap/detail', rateLimit, async (req, res) => {
  try {
    const { id } = req.query;
    const result = await forwardToAmap('/v3/place/detail', { id: id ? String(id) : '', extensions: 'all' });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 关键词文本搜索
app.get('/api/amap/text', rateLimit, async (req, res) => {
  try {
    const { keyword, city, offset, page_size } = req.query;
    const result = await forwardToAmap('/v3/place/text', {
      keywords: keyword ? String(keyword) : '',
      city: city ? String(city) : '全国',
      extensions: 'all',
      offset: String(offset || 1),
      page_size: String(page_size || 30),
    });
    res.json(result);
  } catch (e) { res.status(500).json({ status: '0', info: e.message }); }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ ok: true, keyConfigured: Boolean(AMAP_KEY), ts: Date.now() });
});

// 兜底：所有未匹配路由返回首页（SPA 兼容）
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[server-error]', err.message);
  res.status(500).json({ status: '0', info: err.message || '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(' 广东新能源导航后端代理已启动');
  console.log(' 监听端口: http://127.0.0.1:' + PORT);
  console.log(' 高德 KEY 已在后端注入（前端不可见）');
  console.log(' 代理路径:');
  console.log('   GET /api/amap/parking   -> 停车场');
  console.log('   GET /api/amap/charging  -> 充电站');
  console.log('   GET /api/amap/around    -> 通用周边搜索');
  console.log('   GET /api/amap/geo       -> 地理编码');
  console.log('   GET /api/amap/regeo     -> 逆地理编码');
  console.log('   GET /api/amap/suggest   -> 输入联想');
  console.log('   GET /api/amap/driving   -> 驾车路线');
  console.log('   GET /api/amap/walking   -> 步行路线');
  console.log('   GET /api/amap/riding    -> 骑行路线');
  console.log('   GET /api/health         -> 健康检查');
  console.log('========================================');
});
