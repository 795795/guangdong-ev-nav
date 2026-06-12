/*
 * 广东新能源导航 · 前端主脚本（经后端代理访问高德接口）
 * 说明：所有对高德地图 API 的访问通过后端代理 server.py 转发
 *       前端不暴露任何 API key，彻底隐藏 AK，避免盗刷。
 */
'use strict';

/* =========================================================================
 * 全局状态
 * ======================================================================== */
var map = null;
var markerClusterer = null;
var trafficLayer = null;
var satelliteLayer = null;
var userMarker = null;
var radiusCircle = null;

var myPos = null;
var myAddress = '';
var destSearchPos = null;
var destSearchName = '';
var currentKeyword = '停车场';
var currentPOIs = [];
var currentPOI = null;
var searchMode = 'nearby';
var searchRadiusNearby = 2000;
var searchRadiusDest = 5000;
var searchCenterPos = null;
var searchCenterRadius = 2000;

var routeStart = null; var routeStartName = '';
var routeEnd   = null; var routeEndName   = '';
var routeWaypoints = [];
var routeMode = 'driving';
var routeResults = [];
var routePolylines = [];
var routeStartMarkers = [];
var routeSelectedIdx = 0;

var naviOverlayEl = null;
var naviMap = null;
var naviPolyline = null;
var naviInterval = null;
var naviStepIdx = 0;
var naviSteps = [];
var naviTotalDist = 0;
var naviTotalTime = 0;
var naviRemainDist = 0;
var naviRemainTime = 0;
var voiceOn = true;

var preferences = {
  dark: false, autoZoom: true, showPark: true, showCharge: true,
  onlyFreePark: false, onlyFreeCharge: false, routeStrategy: 0,
  sortBy: 'distance', voiceOn: true
};
var favorites = [];
var searchHistory = [];
var offlineCache = null;
var autoRefreshTimer = null;
var networkOnline = navigator.onLine;

/* =========================================================================
 * 工具函数
 * ======================================================================== */
function $(id){ return document.getElementById(id); }

function escapeHtml(s){
  if(s === null || s === undefined || s === '') return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;')
    .replace(/\//g,'&#x2F;');
}

function formatDistance(m){
  if(m == null || isNaN(m)) return '--';
  if(m < 1000) return Math.round(m) + ' 米';
  return (m/1000).toFixed(1).replace(/\.?0+$/,'') + ' 公里';
}
function formatTime(sec){
  if(sec == null || isNaN(sec)) return '--';
  if(sec < 60) return Math.round(sec) + ' 秒';
  if(sec < 3600) return Math.round(sec/60) + ' 分钟';
  var h = Math.floor(sec/3600), m = Math.round((sec%3600)/60);
  return h + ' 小时 ' + m + ' 分钟';
}

function parseLngLatStr(s){
  if(!s) return null;
  var arr = String(s).split(',');
  if(arr.length < 2) return null;
  var lng = parseFloat(arr[0]), lat = parseFloat(arr[1]);
  if(isNaN(lng) || isNaN(lat)) return null;
  return [lng, lat];
}

function haversine(p1, p2){
  if(!p1 || !p2) return 0;
  var R = 6371000;
  var rad = function(x){ return x * Math.PI / 180; };
  var dLat = rad(p2[1]-p1[1]);
  var dLng = rad(p2[0]-p1[0]);
  var a = Math.sin(dLat/2)*Math.sin(dLat/2)
        + Math.cos(rad(p1[1]))*Math.cos(rad(p2[1]))
        * Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*R*Math.asin(Math.sqrt(a));
}

function saveLS(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
function loadLS(k, def){
  try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : def; }
  catch(e){ return def; }
}
function debounceFn(fn, wait){
  var t = null;
  return function(){
    var ctx = this, args = arguments;
    if(t) clearTimeout(t);
    t = setTimeout(function(){ fn.apply(ctx, args); }, wait || 300);
  };
}
function throttle(fn, wait){
  var last = 0, t = null;
  return function(){
    var ctx = this, args = arguments, now = Date.now();
    if(now - last >= (wait||300)){ last = now; fn.apply(ctx, args); }
    else if(!t){ t = setTimeout(function(){ last=Date.now(); fn.apply(ctx,args); t=null; }, wait||300); }
  };
}

function toast(msg, dur){
  var t = $('toast'); if(!t) return;
  t.textContent = String(msg);
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(function(){ t.classList.remove('show'); }, dur || 2000);
}

function showLoading(txt){
  var el = $('loadingOverlay'); if(!el) return;
  var t = $('loadingText'); if(t) t.textContent = txt || '加载中...';
  el.classList.add('show');
}
function hideLoading(){ var el = $('loadingOverlay'); if(el) el.classList.remove('show'); }

function speak(text){
  if(!voiceOn || !text) return;
  try {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = 1.0;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch(e){ /* 不支持时静默失败 */ }
}

/* =========================================================================
 * 统一经后端代理请求高德 REST API
 * ======================================================================== */
function amapFetch(alias, params){
  var base = '/amap/' + alias;
  var qs = '';
  if(params){
    var parts = [];
    for(var k in params){
      if(params[k] === undefined || params[k] === null || params[k] === '') continue;
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
    if(parts.length) qs = '?' + parts.join('&');
  }
  return fetch(base + qs, { method: 'GET', headers: { 'Accept': 'application/json' } })
    .then(function(r){ return r.json(); })
    .then(function(j){
      if(!j) throw new Error('代理无响应');
      if(String(j.status) !== '1') throw new Error(j.info || j.msg || '高德接口异常');
      return j;
    });
}

/* =========================================================================
 * 地图初始化
 * ======================================================================== */
function initMap(){
  if(!window.AMap){ toast('地图库未就绪'); return; }
  try {
    map = new AMap.Map('map', {
      zoom: 14,
      center: myPos || [113.2644, 23.1291],
      viewMode: '2D',
      mapStyle: preferences.dark ? 'amap://styles/dark' : 'amap://styles/normal',
      showLabel: true,
      resizeEnable: true,
      pitch: 0
    });
  } catch(e){ toast('地图初始化失败'); return; }
  try { trafficLayer = new AMap.TileLayer.Traffic({ autoRefresh: true, interval: 300 }); } catch(e){}
  try { satelliteLayer = new AMap.TileLayer.Satellite(); } catch(e){}
  try { new AMap.ToolBar({ position: 'RB' }); } catch(e){}
  try {
    var geo = new AMap.Geolocation({
      enableHighAccuracy: true, timeout: 10000, buttonPosition: 'RB',
      showButton: true, panToLocation: true, zoomToAccuracy: true
    });
    map.addControl(geo);
    geo.getCurrentPosition(function(status, result){
      if(status === 'complete' && result.position){
        myPos = [result.position.lng, result.position.lat];
        myAddress = result.formattedAddress || '';
        if(userMarker){ try { map.remove(userMarker); } catch(e){} }
        userMarker = new AMap.Marker({
          position: myPos, map: map,
          content: '<div style="width:22px;height:22px;background:#1677ff;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.3);"></div>'
        });
        map.setCenter(myPos);
        searchNearby('停车场');
      } else {
        myPos = [113.2644, 23.1291];
        toast('定位未授权，已使用默认位置');
        searchNearby('停车场');
      }
    });
  } catch(e){
    myPos = [113.2644, 23.1291];
    searchNearby('停车场');
  }

  map.on('rightclick', onMapLongPress);
  map.on('longpress', onMapLongPress);

  window.addEventListener('online',  function(){
    networkOnline = true;
    $('offlineBanner') && $('offlineBanner').classList.remove('show','persistent');
    if(searchMode === 'nearby') searchNearby(currentKeyword); else searchPOIByName(currentKeyword);
  });
  window.addEventListener('offline', function(){
    networkOnline = false;
    var b = $('offlineBanner'); if(b){ b.textContent = '📡 网络已断开，显示上次缓存数据'; b.classList.add('show','persistent'); }
  });

  startAutoRefresh();
}

var lastLongpressPos = null;
function onMapLongPress(e){
  var lng = e.lnglat.lng, lat = e.lnglat.lat;
  lastLongpressPos = [lng, lat];
  showLongpressMenu(lng, lat);
}
function showLongpressMenu(lng, lat){
  var menu = $('longpressMenu'); if(!menu) return;
  menu.style.left = '50%';
  menu.style.top  = '50%';
  menu.classList.add('show');
}
function hideLongpressMenu(){ var m = $('longpressMenu'); if(m) m.classList.remove('show'); }

function handleLongpressItem(action){
  if(!lastLongpressPos) return;
  var pos = lastLongpressPos;
  var name = '途经点 ' + pos[0].toFixed(4) + ',' + pos[1].toFixed(4);
  amapFetch('regeo', { location: pos[0] + ',' + pos[1], extensions: 'base', radius: 200 })
    .then(function(j){
      if(j && j.regeocode && j.regeocode.formatted_address) name = String(j.regeocode.formatted_address).substring(0, 20);
    }).catch(function(){})
    .then(function(){
      if(action === 'set-start'){
        routeStart = pos; routeStartName = name; toast('已设为起点：' + name);
      } else if(action === 'set-end'){
        routeEnd = pos; routeEndName = name; toast('已设为终点：' + name);
      } else if(action === 'add-waypoint'){
        routeWaypoints.push({ name: name, lngLat: pos });
        toast('已添加途经点（共' + routeWaypoints.length + '个）');
      } else if(action === 'search-around'){
        destSearchPos = pos; destSearchName = name;
        searchMode = 'dest'; searchPOIByName(currentKeyword);
      }
      renderRouteInputs();
    });
  hideLongpressMenu();
}

/* =========================================================================
 * 搜索联想（拼音 + 错别字纠错 + 防抖）
 * ======================================================================== */
function handleSearchInput(){
  var val = ($('searchInput') || {}).value || '';
  if(!val){ renderSuggestions([], ''); return; }
  suggestDebounced(val);
}

function fetchSuggestDebounced(kw){
  amapFetch('suggest', { keyword: kw, city: '全国', location: (myPos||destSearchPos||[]).join(',') })
    .then(function(j){
      var list = (j && j.tips) || [];
      var filtered = list.filter(function(it){ return it && it.location && it.location !== ''; });
      renderSuggestions(filtered, kw);
    })
    .catch(function(){
      var corrected = fuzzyMatchPinyin(kw);
      if(corrected && corrected !== kw){
        amapFetch('suggest', { keyword: corrected, city: '全国' })
          .then(function(j2){ renderSuggestions((j2 && j2.tips) || [], kw); })
          .catch(function(){ renderSuggestions([], kw); });
      } else {
        renderSuggestions([], kw);
      }
    });
}
var suggestDebounced = debounceFn(fetchSuggestDebounced, 300);

function fuzzyMatchPinyin(kw){
  if(!kw) return kw;
  var map = {
    'tianqiaoqichezhan':'天桥汽车站', 'guangzhou':'广州', 'beijing':'北京',
    'shanghai':'上海', 'shenzhen':'深圳', 'tingchechang':'停车场',
    'chongdianzhuang':'充电桩', '停厂场':'停车场', '充点电':'充电站', '充电装':'充电桩'
  };
  var low = String(kw).replace(/\s+/g,'').toLowerCase();
  if(map[low]) return map[low];
  return null;
}

function renderSuggestions(list, kw){
  var box = $('suggestionsBox'); if(!box) return;
  if(!list || list.length === 0){
    box.innerHTML = '<div style="padding:18px;color:#999;text-align:center;">无匹配结果，请尝试其他关键词</div>';
    box.classList.add('show');
    return;
  }
  var html = '';
  for(var i = 0; i < Math.min(list.length, 10); i++){
    var it = list[i];
    var name = escapeHtml(it.name || '');
    var addr = escapeHtml((it.district || '') + ' ' + (it.address || ''));
    html += '<div class="sug-item" data-idx="'+i+'" data-lnglat="'+escapeHtml(it.location)+'" data-name="'+name+'">'
          +  '<div class="sug-title">'+name+'</div><div class="sug-sub">'+addr+'</div></div>';
  }
  box.innerHTML = html;
  box.classList.add('show');
  var items = box.querySelectorAll('.sug-item');
  for(var j = 0; j < items.length; j++){
    (function(el){
      el.addEventListener('click', function(){
        var pos = parseLngLatStr(el.getAttribute('data-lnglat'));
        var nm = el.getAttribute('data-name') || '';
        ($('searchInput') || {}).value = nm;
        box.classList.remove('show');
        addToHistory(nm);
        if(pos) searchPOIByName(nm, pos);
        else searchPOIByName(nm);
      });
    })(items[j]);
  }
}

function addToHistory(name){
  if(!name) return;
  searchHistory = searchHistory.filter(function(x){ return x !== name; });
  searchHistory.unshift(name);
  if(searchHistory.length > 10) searchHistory = searchHistory.slice(0, 10);
  saveLS('search_history', searchHistory);
}
function clearHistory(){
  searchHistory = []; saveLS('search_history', []);
  var box = $('suggestionsBox');
  if(box) box.innerHTML = '<div style="padding:18px;color:#999;text-align:center;">历史记录已清空</div>';
}

/* =========================================================================
 * 关键词搜索（地址名）
 * ======================================================================== */
function searchPOIByName(kw, pos){
  currentKeyword = kw || currentKeyword;
  searchMode = 'dest';
  showLoading('搜索 ' + String(currentKeyword) + ' ...');
  clearMarkers();

  var center = pos || destSearchPos || myPos || [113.2644, 23.1291];
  searchCenterPos = center;
  searchCenterRadius = searchRadiusDest;

  if(!networkOnline){
    hideLoading();
    if(offlineCache && offlineCache.pois){
      currentPOIs = offlineCache.pois;
      renderPOIPanel(offlineCache.pois, offlineCache.kw);
      renderMapMarkers(offlineCache.pois);
      drawRadiusCircle(offlineCache.center, offlineCache.radius);
      var b = $('offlineBanner'); if(b){ b.textContent='📡 网络已断开，显示上次缓存数据'; b.classList.add('show','persistent'); }
    } else { toast('断网且无缓存，请联网后重试'); }
    return;
  } else { var b = $('offlineBanner'); if(b) b.classList.remove('show','persistent'); }

  amapFetch('around', {
    keywords: currentKeyword,
    location: center[0]+','+center[1],
    radius: searchRadiusDest, extensions: 'all', offset: 1,
    page_size: 30, sort: 'distance'
  }).then(function(j){
    hideLoading();
    var pois = (j && j.pois) || [];
    if(pois.length === 0){
      currentPOIs = []; renderPOIPanel([], currentKeyword); renderMapMarkers([]);
      toast('附近没有搜索结果，可扩大半径'); return;
    }
    var processed = processPOIs(pois, center);
    currentPOIs = processed;
    offlineCache = { pois: processed, kw: currentKeyword, center: center, radius: searchRadiusDest, ts: Date.now() };
    saveLS('offline_cache', offlineCache);
    renderPOIPanel(processed, currentKeyword);
    renderMapMarkers(processed);
    drawRadiusCircle(center, searchRadiusDest);
  }).catch(function(err){
    hideLoading();
    toast('搜索失败：' + (err.message || '网络异常'));
  });
}

/* =========================================================================
 * 附近搜索（当前位置）
 * ======================================================================== */
function searchNearby(kw){
  if(!map){ toast('地图未就绪'); return; }
  currentKeyword = kw || '停车场';
  searchMode = 'nearby';
  showLoading('正在搜索附近的' + currentKeyword + ' ...');
  clearMarkers();

  var searchPos = myPos || destSearchPos || [113.2644, 23.1291];
  searchCenterPos = searchPos;
  searchCenterRadius = searchRadiusNearby;

  if(!networkOnline){
    hideLoading();
    if(offlineCache && offlineCache.pois){
      currentPOIs = offlineCache.pois;
      renderPOIPanel(offlineCache.pois, offlineCache.kw);
      renderMapMarkers(offlineCache.pois);
      drawRadiusCircle(offlineCache.center, offlineCache.radius);
      var b = $('offlineBanner'); if(b){ b.textContent='📡 网络已断开，显示上次缓存数据'; b.classList.add('show','persistent'); }
    } else { toast('暂无缓存，请联网后重试'); }
    return;
  } else { var b = $('offlineBanner'); if(b) b.classList.remove('show','persistent'); }

  amapFetch('around', {
    keywords: currentKeyword,
    location: searchPos[0]+','+searchPos[1],
    radius: searchRadiusNearby, extensions: 'all', offset: 1,
    page_size: 30, sort: 'distance'
  }).then(function(j){
    hideLoading();
    var pois = (j && j.pois) || [];
    if(pois.length === 0){
      currentPOIs = []; renderPOIPanel([], currentKeyword); renderMapMarkers([]);
      toast('附近没有 ' + currentKeyword + '，可尝试扩大搜索半径'); return;
    }
    var processed = processPOIs(pois, searchPos);
    currentPOIs = processed;
    offlineCache = { pois: processed, kw: currentKeyword, center: searchPos, radius: searchRadiusNearby, ts: Date.now() };
    saveLS('offline_cache', offlineCache);
    renderPOIPanel(processed, currentKeyword);
    renderMapMarkers(processed);
    drawRadiusCircle(searchPos, searchRadiusNearby);
  }).catch(function(err){
    hideLoading();
    toast('搜索失败：' + (err.message || '网络异常'));
  });
}

/* =========================================================================
 * POI 扩展字段处理（停车场类型 / 封顶价 / 免费时长 / 营业时间 / 充电桩服务费）
 * ======================================================================== */
function processPOIs(raw, center){
  if(!raw || raw.length === 0) return [];
  var out = [];
  for(var i = 0; i < raw.length; i++){
    var p = raw[i];
    var pos = parseLngLatStr(p.location);
    if(!pos) continue;
    var isParking = /停车|车位/.test(p.name + ' ' + (p.type || ''));
    var isCharging = /充电|换电/.test(p.name + ' ' + (p.type || ''));
    if(!isParking && !isCharging){
      isParking = currentKeyword === '停车场';
      isCharging = currentKeyword === '充电桩';
    }
    var dist = p.distance ? parseFloat(p.distance) : haversine(center, pos);
    var poi = {
      id: p.id || ('p' + i),
      name: p.name || '未命名',
      address: p.address || p.pname || '',
      lngLat: pos, isParking: isParking, isCharging: isCharging,
      distance: dist, tel: p.tel || '', rating: parseFloat(p.rating || 0),
      openTime: (p.biz_ext && p.biz_ext.open_time) || p.opn_hrs || p.biz_hours || '营业时间不详'
    };

    if(isParking){
      var info = {
        parkType: '室内', capPrice: null, freeMins: null, status: 'green', statusText: '车位充足'
      };
      if(/路面|路边|路内/.test(poi.address + p.name)) info.parkType = '路面';
      if(/地下/.test(poi.address + p.name)) info.parkType = '地下';
      if(p.biz_ext){
        if(p.biz_ext.cost) info.capPrice = p.biz_ext.cost;
        if(p.biz_ext.parking_lot) info.totalSpots = p.biz_ext.parking_lot;
      }
      // 简单根据 rating 推断车位紧张度（green 充足 / yellow 较少 / red 满位）
      var r = poi.rating;
      if(r > 4.0){ info.status = 'green'; info.statusText = '车位充足'; }
      else if(r > 3.0){ info.status = 'yellow'; info.statusText = '车位较少'; }
      else { info.status = 'red'; info.statusText = '车位紧张'; }
      poi.parkingInfo = info;
      poi.exitLocation = pos;
    }

    if(isCharging){
      var ci = {
        power: '标准功率', fee: '', totalPiles: 0, freePiles: 0,
        pay: '扫码支付', open24h: false, status: 'green', statusText: '空闲充足'
      };
      if(p.biz_ext && p.biz_ext.cost) ci.fee = p.biz_ext.cost;
      var nameStr = p.name || '';
      var m = /(\d+)\s*个?桩/.exec(nameStr);
      if(m) ci.totalPiles = parseInt(m[1], 10);
      else if(p.biz_ext && p.biz_ext.parking_lot) ci.totalPiles = parseInt(p.biz_ext.parking_lot, 10);
      ci.freePiles = Math.max(0, Math.round((ci.totalPiles || 5) * (r/5)));
      var r = poi.rating;
      if(ci.freePiles === 0){ ci.status = 'red'; ci.statusText = '暂无空闲桩'; }
      else if(ci.freePiles < 3){ ci.status = 'yellow'; ci.statusText = '空闲较少'; }
      else { ci.status = 'green'; ci.statusText = '空闲充足'; }
      ci.open24h = /24|全天|全天营业/.test(nameStr + ' ' + (poi.openTime||''));
      poi.chargingInfo = ci;
    }
    out.push(poi);
  }
  return out;
}

/* =========================================================================
 * 地图点位渲染（分类显隐 + 仅空闲筛选 + 聚合）
 * ======================================================================== */
function renderMapMarkers(pois){
  try { if(markerClusterer){ markerClusterer.setMap(null); markerClusterer = null; } } catch(e){}
  try { if(map){ map.clearMap(); } } catch(e){}
  if(!map || !pois || pois.length === 0) return;

  var filtered = [];
  for(var i = 0; i < pois.length; i++){
    var p = pois[i];
    if(p.isParking && !preferences.showPark) continue;
    if(p.isCharging && !preferences.showCharge) continue;
    if(p.isParking && preferences.onlyFreePark && p.parkingInfo && p.parkingInfo.status !== 'green') continue;
    if(p.isCharging && preferences.onlyFreeCharge && p.chargingInfo && p.chargingInfo.status !== 'green') continue;
    filtered.push(p);
  }
  var mkrs = [];
  for(var j = 0; j < filtered.length; j++){
    var po = filtered[j];
    var color = po.isCharging ? '#fa8c16' : (po.isParking ? '#1677ff' : '#52c41a');
    var iconText = po.isCharging ? '⚡' : (po.isParking ? 'P' : '📍');
    try {
      var m = new AMap.Marker({
        position: po.lngLat, map: map, offset: new AMap.Pixel(-14, -28),
        content: '<div style="background:'+color+';color:#fff;width:30px;height:34px;border-radius:8px 8px 8px 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid #fff;"><span style="transform:rotate(45deg);">'+iconText+'</span></div>',
        title: po.name, extData: po
      });
      (function(poi, mkr){
        mkr.on('click', function(){ showPOIDetail(poi); highlightCard(poi.name); });
      })(po, m);
      mkrs.push(m);
    } catch(e){}
  }
  if(mkrs.length > 3 && window.AMap && AMap.MarkerClusterer){
    try {
      markerClusterer = new AMap.MarkerClusterer(map, mkrs, {
        gridSize: 60, maxZoom: 17, averageCenter: true,
        renderClusterMarker: function(ctx){
          var count = ctx.cluster.getMarkerCount();
          var size = count > 30 ? 58 : (count > 10 ? 48 : 40);
          var el = document.createElement('div');
          el.style.cssText = 'width:'+size+'px;height:'+size+'px;background:linear-gradient(135deg,#1677ff,#0958d9);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;box-shadow:0 2px 10px rgba(22,119,255,0.4);border:3px solid #fff;cursor:pointer;';
          el.textContent = count;
          ctx.marker.setContent(el);
        }
      });
    } catch(e){}
  }
  try { map.setFitView && map.setFitView(mkrs); } catch(e){}
}

function clearMarkers(){
  try { if(markerClusterer){ markerClusterer.setMap(null); markerClusterer = null; } } catch(e){}
  try { if(map){ map.clearMap(); } } catch(e){}
  if(radiusCircle){ try { radiusCircle.setMap(null); } catch(e){} radiusCircle = null; }
}

function drawRadiusCircle(center, radius){
  if(!map || !center) return;
  try {
    if(radiusCircle){ radiusCircle.setMap(null); }
    radiusCircle = new AMap.Circle({
      center: center, radius: radius,
      strokeColor: '#1677ff', strokeWeight: 2, strokeOpacity: 0.75,
      strokeStyle: 'dashed', fillColor: '#1677ff', fillOpacity: 0.06
    });
    radiusCircle.setMap(map);
  } catch(e){}
}

/* =========================================================================
 * 结果列表 + 筛选标签
 * ======================================================================== */
function renderPOIPanel(pois, kw){
  var box = $('panelContent'); if(!box) return;
  var header = '<div class="poi-header"><div class="poi-title">「' + escapeHtml(kw||'搜索') + '」共 ' + (pois ? pois.length : 0) + ' 个结果</div><div class="poi-actions"><button class="btn btn-sm" id="btnExpandRadius">扩大半径</button></div></div>';
  if(!pois || pois.length === 0){
    box.innerHTML = header + '<div style="padding:40px 16px;text-align:center;color:#999;">附近没有搜索结果，可尝试调整半径或关键字</div>';
    return;
  }
  var html = header;
  html += '<div id="filterTagsBar" class="filter-tags-bar"></div>';
  html += '<div class="poi-list">';
  for(var i = 0; i < pois.length; i++){
    var p = pois[i];
    var isPark = p.isParking, isCharge = p.isCharging;
    var tagColor = isCharge ? 'tag-orange' : 'tag-blue';
    var statusTag = '';
    if(isPark && p.parkingInfo){
      statusTag = '<span class="poi-tag tag-'+p.parkingInfo.status+'">'+escapeHtml(p.parkingInfo.statusText||'')+'</span>';
    } else if(isCharge && p.chargingInfo){
      statusTag = '<span class="poi-tag tag-'+p.chargingInfo.status+'">空闲 '+p.chargingInfo.freePiles+'</span>';
    }
    html += '<div class="poi-card" data-idx="'+i+'" data-name="'+escapeHtml(p.name)+'">'
          +  '<div class="poi-main">'
          +    '<div class="poi-name">'+escapeHtml(p.name)+'</div>'
          +    '<div class="poi-tags">'+statusTag
          +      '<span class="poi-tag '+tagColor+'">'+(isCharge?'充电站':'停车场')+'</span>'
          +      '<span class="poi-tag tag-gray">'+formatDistance(p.distance)+'</span>'
          +    '</div>'
          +    '<div class="poi-addr">'+escapeHtml(p.address)+'</div>'
          +  '</div>'
          +  '<div class="poi-actions-col">'
          +    '<button class="btn btn-primary" onclick="window.navTo && window.navTo('+i+')">导航</button>'
          +    '<button class="btn btn-outline" onclick="window.setAsRouteEnd && window.setAsRouteEnd('+i+')">加入路线</button>'
          +  '</div>'
          +  '</div>';
  }
  html += '</div>';
  box.innerHTML = html;
  updateFilterTagsBar();
  var cards = box.querySelectorAll('.poi-card');
  for(var k = 0; k < cards.length; k++){
    (function(el, idx){
      el.addEventListener('click', function(e){
        if(e.target && e.target.tagName === 'BUTTON') return;
        showPOIByIdx(idx);
      });
    })(cards[k], k);
  }
  var exp = $('btnExpandRadius'); if(exp){ exp.addEventListener('click', expandSearchRadius); }
}

function updateFilterTagsBar(){
  var el = $('filterTagsBar'); if(!el) return;
  var tags = [];
  if(preferences.onlyFreePark) tags.push({label:'仅空闲车位', key:'onlyFreePark'});
  if(preferences.onlyFreeCharge) tags.push({label:'仅空闲充电桩', key:'onlyFreeCharge'});
  if(preferences.sortBy !== 'distance') tags.push({label:'排序:' + (preferences.sortBy === 'price' ? '价格优先' : '空闲优先'), key:'sort'});
  if(tags.length === 0){ el.innerHTML = ''; return; }
  var html = '';
  for(var i = 0; i < tags.length; i++){
    html += '<span class="ft-chip" data-key="'+tags[i].key+'">'+tags[i].label+' <b>×</b></span>';
  }
  html += '<span class="ft-chip ft-clear" data-key="all">清空全部</span>';
  el.innerHTML = html;
  var chips = el.querySelectorAll('.ft-chip');
  for(var j = 0; j < chips.length; j++){
    (function(c){
      c.addEventListener('click', function(){
        var k = c.getAttribute('data-key');
        if(k === 'onlyFreePark') preferences.onlyFreePark = false;
        else if(k === 'onlyFreeCharge') preferences.onlyFreeCharge = false;
        else if(k === 'sort') preferences.sortBy = 'distance';
        else if(k === 'all'){ preferences.onlyFreePark = preferences.onlyFreeCharge = false; preferences.sortBy = 'distance'; }
        saveLS('preferences', preferences);
        renderPOIPanel(currentPOIs, currentKeyword);
        renderMapMarkers(currentPOIs);
      });
    })(chips[j]);
  }
}

function showPOIByIdx(idx){ if(currentPOIs && currentPOIs[idx]) showPOIDetail(currentPOIs[idx]); }

function highlightCard(name){
  var list = document.querySelectorAll('.poi-card');
  for(var i = 0; i < list.length; i++){
    if(list[i].getAttribute('data-name') === name){
      list[i].classList.add('hl');
      try { list[i].scrollIntoView({ behavior:'smooth', block:'nearest' }); } catch(e){}
      setTimeout(function(el){ el.classList.remove('hl'); }.bind(null, list[i]), 1800);
      break;
    }
  }
}

/* =========================================================================
 * 快捷路由：当前点 → POI
 * ======================================================================== */
function navTo(idx){
  var p = currentPOIs[idx]; if(!p) return;
  routeStart = myPos || searchCenterPos || p.lngLat;
  routeStartName = '我的位置';
  routeEnd = p.exitLocation || p.lngLat;
  routeEndName = p.name;
  routeWaypoints = [];
  renderRouteInputs();
  searchRoute();
  showRoutePanel();
}
function setAsRouteEnd(idx){
  var p = currentPOIs[idx]; if(!p) return;
  routeEnd = p.exitLocation || p.lngLat;
  routeEndName = p.name;
  if(!routeStart){ routeStart = myPos || searchCenterPos; routeStartName = '我的位置'; }
  renderRouteInputs();
  searchRoute();
  showRoutePanel();
}

/* =========================================================================
 * POI 详情弹窗（展示扩展字段）
 * ======================================================================== */
function showPOIDetail(poi){
  currentPOI = poi;
  var box = $('detailBody'); if(!box) return;
  var html = '<div class="detail-title">'+escapeHtml(poi.name)+'</div>';
  html += '<div class="detail-addr">📍 '+escapeHtml(poi.address)+' · '+formatDistance(poi.distance)+'</div>';
  if(poi.isParking && poi.parkingInfo){
    var pi = poi.parkingInfo;
    html += '<div class="detail-section">'
      + '<div class="detail-row"><span class="dr-label">类型</span><span>'+escapeHtml(pi.parkType||'--')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">单日封顶</span><span>'+(pi.capPrice?escapeHtml(pi.capPrice)+'元':'--')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">免费时长</span><span>'+(pi.freeMins?escapeHtml(pi.freeMins)+' 分钟':'--')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">营业时间</span><span>'+escapeHtml(poi.openTime||'--')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">车位状态</span><span><span class="poi-tag tag-'+pi.status+'">'+escapeHtml(pi.statusText||'--')+'</span></span></div>'
      + '</div>';
  }
  if(poi.isCharging && poi.chargingInfo){
    var ci = poi.chargingInfo;
    html += '<div class="detail-section">'
      + '<div class="detail-row"><span class="dr-label">电价/服务费</span><span>'+escapeHtml(ci.fee||'--')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">充电功率</span><span>'+escapeHtml(ci.power||'标准功率')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">总桩数</span><span>'+(ci.totalPiles||0)+' 个</span></div>'
      + '<div class="detail-row"><span class="dr-label">空闲桩数</span><span><span class="poi-tag tag-'+ci.status+'">空闲 '+ci.freePiles+'</span></span></div>'
      + '<div class="detail-row"><span class="dr-label">支付方式</span><span>'+escapeHtml(ci.pay||'扫码支付')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">24 小时营业</span><span>'+(ci.open24h?'是':'否')+'</span></div>'
      + '<div class="detail-row"><span class="dr-label">营业状态</span><span>'+escapeHtml(poi.openTime||'营业时间不详')+'</span></div>'
      + '</div>';
  }
  if(poi.tel){
    html += '<div class="detail-section"><div class="detail-row"><span class="dr-label">联系电话</span><span>'+escapeHtml(poi.tel)+'</span></div></div>';
  }
  html += '<div class="detail-actions">'
    + '<button class="btn btn-primary" onclick="window.navFromDetail && window.navFromDetail()">🚗 导航到这里</button>'
    + '<button class="btn btn-outline" onclick="window.addToRouteFromDetail && window.addToRouteFromDetail()">加入路线</button>'
    + '<button class="btn btn-outline" onclick="window.sharePOI && window.sharePOI()">分享</button>'
    + '</div>';
  box.innerHTML = html;
  $('detailOverlay').classList.add('show');
  try { map && poi.lngLat && map.setCenter(poi.lngLat); } catch(e){}
}

function navFromDetail(){
  if(!currentPOI) return;
  routeStart = myPos || searchCenterPos || currentPOI.lngLat;
  routeStartName = '我的位置';
  routeEnd = currentPOI.exitLocation || currentPOI.lngLat;
  routeEndName = currentPOI.name;
  routeWaypoints = [];
  renderRouteInputs();
  searchRoute();
  showRoutePanel();
}
function addToRouteFromDetail(){
  if(!currentPOI) return;
  routeEnd = currentPOI.exitLocation || currentPOI.lngLat;
  routeEndName = currentPOI.name;
  if(!routeStart){ routeStart = myPos || searchCenterPos; routeStartName = '我的位置'; }
  renderRouteInputs();
  searchRoute();
  showRoutePanel();
}
function sharePOI(){
  if(!currentPOI) return;
  var txt = currentPOI.name + ' | ' + currentPOI.address + ' | 坐标 ' + currentPOI.lngLat.join(',');
  try { navigator.clipboard.writeText(txt).then(function(){ toast('已复制到剪贴板'); }).catch(function(){ toast(txt); }); }
  catch(e){ toast(txt); }
}

/* =========================================================================
 * 排序 & 快捷筛选（空闲车位/空闲充电桩）
 * ======================================================================== */
function sortPOIs(by){
  preferences.sortBy = by || 'distance';
  saveLS('preferences', preferences);
  if(!currentPOIs || currentPOIs.length === 0) return;
  var sorted = currentPOIs.slice();
  if(by === 'price'){
    sorted.sort(function(a,b){
      var pa = (a.chargingInfo && a.chargingInfo.fee) ? parseFloat(a.chargingInfo.fee) : 999;
      var pb = (b.chargingInfo && b.chargingInfo.fee) ? parseFloat(b.chargingInfo.fee) : 999;
      return pa - pb;
    });
  } else if(by === 'free'){
    sorted.sort(function(a,b){
      var fa = a.parkingInfo ? (a.parkingInfo.status === 'green' ? 2 : (a.parkingInfo.status === 'yellow' ? 1 : 0)) : 0;
      var fb = b.parkingInfo ? (b.parkingInfo.status === 'green' ? 2 : (b.parkingInfo.status === 'yellow' ? 1 : 0)) : 0;
      return fb - fa;
    });
  } else {
    sorted.sort(function(a,b){ return (a.distance||0) - (b.distance||0); });
  }
  currentPOIs = sorted;
  renderPOIPanel(sorted, currentKeyword);
  renderMapMarkers(sorted);
}

function toggleOnlyFreeParking(){
  preferences.onlyFreePark = !preferences.onlyFreePark;
  saveLS('preferences', preferences);
  toast(preferences.onlyFreePark ? '已筛选：仅空闲车位' : '已取消车位筛选');
  if(currentPOIs.length){ renderPOIPanel(currentPOIs, currentKeyword); renderMapMarkers(currentPOIs); }
}
function toggleOnlyFreeCharging(){
  preferences.onlyFreeCharge = !preferences.onlyFreeCharge;
  saveLS('preferences', preferences);
  toast(preferences.onlyFreeCharge ? '已筛选：仅空闲充电桩' : '已取消充电桩筛选');
  if(currentPOIs.length){ renderPOIPanel(currentPOIs, currentKeyword); renderMapMarkers(currentPOIs); }
}
function expandSearchRadius(){
  if(searchMode === 'nearby'){
    searchRadiusNearby = Math.min(searchRadiusNearby + 2000, 25000);
    searchNearby(currentKeyword);
    toast('半径扩展为 ' + (searchRadiusNearby/1000).toFixed(1) + ' 公里');
  } else {
    searchRadiusDest = Math.min(searchRadiusDest + 2000, 25000);
    searchPOIByName(currentKeyword);
    toast('半径扩展为 ' + (searchRadiusDest/1000).toFixed(1) + ' 公里');
  }
}

/* =========================================================================
 * 路线规划（支持途经点）
 * ======================================================================== */
function renderRouteInputs(){
  // 兼容 span / input：优先 textContent，其次 value
  var setText = function(id, txt){
    var el = document.getElementById(id); if(!el) return;
    if(el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.value = txt || '';
    else el.textContent = txt || '';
  };
  setText('routeStartText', routeStartName || '选择起点');
  setText('routeEndText',   routeEndName   || '选择终点');
  var wpBox = $('routeWaypointsBox'); if(!wpBox) return;
  if(!routeWaypoints || routeWaypoints.length === 0){ wpBox.innerHTML = ''; return; }
  var html = '';
  for(var i = 0; i < routeWaypoints.length; i++){
    html += '<div class="wp-item"><span class="wp-num">途经点'+(i+1)+'</span><span class="wp-name">'+escapeHtml(routeWaypoints[i].name)+'</span>'
          + '<button class="btn btn-sm" onclick="window.removeWaypoint && window.removeWaypoint('+i+')">移除</button>';
    if(i > 0) html += '<button class="btn btn-sm" onclick="window.moveWaypoint && window.moveWaypoint('+i+',-1)">上移</button>';
    if(i < routeWaypoints.length-1) html += '<button class="btn btn-sm" onclick="window.moveWaypoint && window.moveWaypoint('+i+',1)">下移</button>';
    html += '</div>';
  }
  wpBox.innerHTML = html;
}
function removeWaypoint(i){
  routeWaypoints.splice(i, 1); renderRouteInputs();
  if(routeStart && routeEnd) searchRoute();
}
function moveWaypoint(i, dir){
  var j = i + dir; if(j < 0 || j >= routeWaypoints.length) return;
  var t = routeWaypoints[i]; routeWaypoints[i] = routeWaypoints[j]; routeWaypoints[j] = t;
  renderRouteInputs();
  if(routeStart && routeEnd) searchRoute();
}

function showRoutePanel(){
  var rp = $('routePanel'); if(rp) rp.classList.add('show');
}
function showMain(){
  var rp = $('routePanel'); if(rp) rp.classList.remove('show');
}

function swapStartEnd(){
  var tmp = routeStart; routeStart = routeEnd; routeEnd = tmp;
  var n = routeStartName; routeStartName = routeEndName; routeEndName = n;
  renderRouteInputs();
  if(routeStart && routeEnd) searchRoute();
}

function geocodeForRoute(which, text){
  if(!text) return;
  amapFetch('geo', { address: text, city: '全国' }).then(function(j){
    var loc = (j && j.geocodes && j.geocodes[0] && j.geocodes[0].location);
    var pos = parseLngLatStr(loc);
    if(pos){
      if(which === 'start'){ routeStart = pos; routeStartName = text; }
      else { routeEnd = pos; routeEndName = text; }
      renderRouteInputs();
      if(routeStart && routeEnd) searchRoute();
    } else toast('未能解析该地址');
  }).catch(function(){ toast('地址解析失败'); });
}

function searchRoute(){
  if(!routeStart || !routeEnd){ toast('请先设置起点和终点'); return; }
  showLoading('正在规划路线...');
  for(var r = 0; r < routePolylines.length; r++){ try { routePolylines[r].setMap(null); } catch(e){} }
  routePolylines = [];
  try { for(var mm=0; mm<routeStartMarkers.length; mm++) map.remove(routeStartMarkers[mm]); } catch(e){}
  routeStartMarkers = [];

  var alias = routeMode === 'walking' ? 'walking' : (routeMode === 'riding' ? 'riding' : 'driving');
  var params = {
    origin: routeStart[0]+','+routeStart[1],
    destination: routeEnd[0]+','+routeEnd[1],
    strategy: preferences.routeStrategy || 0,
    extensions: 'base'
  };
  if(routeWaypoints && routeWaypoints.length){
    params.waypoints = routeWaypoints.map(function(w){ return w.lngLat[0]+','+w.lngLat[1]; }).join(';');
  }
  amapFetch(alias, params).then(function(j){
    hideLoading();
    var routes;
    if(j && j.route && j.route.paths && j.route.paths.length){ routes = j.route.paths; }
    else if(j && j.data && j.data.paths && j.data.paths.length){ routes = j.data.paths; }
    else routes = [];
    if(routes.length === 0){ toast('未获取到可用路线'); return; }
    routeResults = routes;
    for(var i = 0; i < routes.length; i++){
      var path = parseRoutePath(routes[i].polyline);
      var color = i === 0 ? '#1677ff' : (i === 1 ? '#fa8c16' : '#52c41a');
      try {
        var poly = new AMap.Polyline({
          path: path, strokeColor: color,
          strokeWeight: i === 0 ? 7 : 5,
          strokeOpacity: i === 0 ? 0.95 : 0.55,
          strokeStyle: i === 0 ? 'solid' : 'dashed',
          lineJoin: 'round', showDir: true
        });
        poly.setMap(map);
        routePolylines.push(poly);
      } catch(e){}
    }
    try {
      routeStartMarkers.push(new AMap.Marker({
        position: routeStart, map: map,
        content: '<div style="width:32px;height:32px;background:#52c41a;color:#fff;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;">起</div>'
      }));
      routeStartMarkers.push(new AMap.Marker({
        position: routeEnd, map: map,
        content: '<div style="width:32px;height:32px;background:#f5222d;color:#fff;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;">终</div>'
      }));
      for(var w = 0; w < routeWaypoints.length; w++){
        routeStartMarkers.push(new AMap.Marker({
          position: routeWaypoints[w].lngLat, map: map,
          content: '<div style="width:28px;height:28px;background:#fa8c16;color:#fff;border-radius:50%;border:2px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;">'+(w+1)+'</div>'
        }));
      }
    } catch(e){}
    try { map.setFitView(routeStartMarkers.concat([])); } catch(e){}
    renderRouteList(routes);
    selectRoute(0);
  }).catch(function(err){
    hideLoading(); toast('路线规划失败：' + (err.message || err));
  });
}

function parseRoutePath(polylineStr){
  if(!polylineStr) return [];
  var arr = String(polylineStr).split(';');
  var path = [];
  for(var i = 0; i < arr.length; i++){
    var parts = arr[i].split(',');
    if(parts.length >= 2){
      var lng = parseFloat(parts[0]), lat = parseFloat(parts[1]);
      if(!isNaN(lng) && !isNaN(lat)) path.push([lng, lat]);
    }
  }
  return path;
}

function clearRoute(){
  for(var i = 0; i < routePolylines.length; i++){ try { routePolylines[i].setMap(null); } catch(e){} }
  routePolylines = [];
  try { for(var mm = 0; mm < routeStartMarkers.length; mm++) map.remove(routeStartMarkers[mm]); } catch(e){}
  routeStartMarkers = [];
  routeResults = [];
  var rl = $('routeList'); if(rl) rl.innerHTML = '';
}

function renderRouteList(routes){
  var box = $('routeList'); if(!box) return;
  var html = '';
  for(var i = 0; i < routes.length; i++){
    var r = routes[i];
    html += '<div class="route-card" data-idx="'+i+'">'
      + '<div class="route-head"><b>方案 '+(i+1)+'</b>'
      + '<span class="poi-tag tag-blue">'+formatDistance(r.distance)+'</span>'
      + '<span class="poi-tag tag-gray">'+formatTime(r.duration)+'</span>'
      + (r.traffic_lights !== undefined ? '<span class="poi-tag tag-orange">🚦 '+r.traffic_lights+' 个</span>' : '')
      + '</div>'
      + '<div class="route-sub">'
      + (r.tolls ? '过路费 '+r.tolls+' 元 · ' : '')
      + (r.strategy ? escapeHtml(r.strategy) : '推荐路线')
      + '</div>'
      + '<button class="btn btn-primary" onclick="window.startNavi && window.startNavi('+i+')">开始导航</button>'
      + '</div>';
  }
  box.innerHTML = html;
  var cards = box.querySelectorAll('.route-card');
  for(var k = 0; k < cards.length; k++){
    (function(el, idx){ el.addEventListener('click', function(){ selectRoute(idx); }); })(cards[k], k);
  }
}

function selectRoute(idx){
  routeSelectedIdx = idx;
  for(var i = 0; i < routePolylines.length; i++){
    try {
      routePolylines[i].setOptions({
        strokeWeight: i === idx ? 7 : 5,
        strokeOpacity: i === idx ? 0.95 : 0.55,
        strokeStyle: i === idx ? 'solid' : 'dashed',
        zIndex: i === idx ? 50 : 10
      });
    } catch(e){}
  }
  var cards = document.querySelectorAll('.route-card');
  for(var j = 0; j < cards.length; j++){
    cards[j].classList.toggle('selected', parseInt(cards[j].getAttribute('data-idx'), 10) === idx);
  }
}

/* =========================================================================
 * 定时刷新（5 分钟一次）
 * ======================================================================== */
function startAutoRefresh(){
  if(autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(function(){
    if(document.visibilityState === 'hidden') return;
    if(!networkOnline) return;
    if(searchMode === 'nearby') searchNearby(currentKeyword);
    else searchPOIByName(currentKeyword);
  }, 5 * 60 * 1000);
}
function stopAutoRefresh(){
  if(autoRefreshTimer){ clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

/* =========================================================================
 * 图层切换 / 深色模式
 * ======================================================================== */
function toggleTraffic(){
  if(!map || !trafficLayer) return;
  if(trafficLayer.getMap()){ trafficLayer.setMap(null); toast('已关闭路况图层'); }
  else { trafficLayer.setMap(map); toast('已开启路况图层（绿畅通/黄缓行/红拥堵）'); }
}
function toggleSatellite(){
  if(!map || !satelliteLayer) return;
  if(satelliteLayer.getMap()){ satelliteLayer.setMap(null); toast('已切换到标准地图'); }
  else { satelliteLayer.setMap(map); toast('已切换到卫星地图'); }
}
function toggleDarkMode(){
  preferences.dark = !preferences.dark;
  saveLS('preferences', preferences);
  document.body.classList.toggle('dark', preferences.dark);
  if(map){ try { map.setMapStyle(preferences.dark ? 'amap://styles/dark' : 'amap://styles/normal'); } catch(e){} }
}
function toggleParkMarkers(){
  preferences.showPark = !preferences.showPark; saveLS('preferences', preferences);
  if(currentPOIs.length) renderMapMarkers(currentPOIs);
  toast(preferences.showPark ? '已显示停车场点位' : '已隐藏停车场点位');
}
function toggleChargeMarkers(){
  preferences.showCharge = !preferences.showCharge; saveLS('preferences', preferences);
  if(currentPOIs.length) renderMapMarkers(currentPOIs);
  toast(preferences.showCharge ? '已显示充电桩点位' : '已隐藏充电桩点位');
}
function toggleVoicePref(){
  preferences.voiceOn = !preferences.voiceOn; saveLS('preferences', preferences);
  voiceOn = preferences.voiceOn;
  toast(voiceOn ? '语音播报已开启' : '语音播报已关闭');
}

/* =========================================================================
 * 移动端键盘处理
 * ======================================================================== */
function initKeyboardListener(){
  var inputs = document.querySelectorAll('input, textarea');
  for(var i = 0; i < inputs.length; i++){
    inputs[i].addEventListener('focus', function(){ document.body.classList.add('kb-open'); });
    inputs[i].addEventListener('blur',  function(){ document.body.classList.remove('kb-open'); });
  }
}

/* =========================================================================
 * 收藏与偏好面板
 * ======================================================================== */
function showFavoritesPanel(){
  var html = '';
  if(!favorites || favorites.length === 0){
    html = '<div style="padding:40px 16px;text-align:center;color:#999;">还没有收藏的地点</div>';
  } else {
    for(var i = 0; i < favorites.length; i++){
      var f = favorites[i];
      html += '<div class="poi-card"><div class="poi-main">'
           +  '<div class="poi-name">'+escapeHtml(f.name)+'</div>'
           +  '<div class="poi-addr">'+escapeHtml(f.address)+'</div></div>'
           +  '<div class="poi-actions-col">'
           +    '<button class="btn btn-primary" onclick="window.navigateToFav && window.navigateToFav('+i+')">导航</button>'
           +    '<button class="btn btn-outline" onclick="window.removeFav && window.removeFav('+i+')">移除</button>'
           +  '</div></div>';
    }
  }
  $('sidePanel').classList.add('show');
  $('sidePanelTitle').textContent = '我的收藏（'+favorites.length+'）';
  $('sidePanelContent').innerHTML = html;
}
function removeFav(i){
  favorites.splice(i, 1); saveLS('favorites', favorites); showFavoritesPanel();
}
function navigateToFav(i){
  var f = favorites[i]; if(!f || !f.lngLat) return;
  routeStart = myPos || f.lngLat; routeStartName = '我的位置';
  routeEnd = f.lngLat; routeEndName = f.name; routeWaypoints = [];
  renderRouteInputs(); searchRoute(); showRoutePanel();
}

function showPreferencesPanel(){
  $('sidePanel').classList.add('show');
  $('sidePanelTitle').textContent = '偏好设置';
  var stratMap = {0:'推荐路线',1:'躲避拥堵',2:'不走高速',3:'高速优先',4:'费用优先'};
  var sortMap = {distance:'距离优先', price:'价格优先', free:'空闲优先'};
  var html = '<div class="pref-section">'
    + '<div class="pref-row"><span>深色模式</span><button class="btn" onclick="window.toggleDarkMode && window.toggleDarkMode()">'+(preferences.dark?'已开启':'未开启')+'</button></div>'
    + '<div class="pref-row"><span>语音播报</span><button class="btn" onclick="window.toggleVoicePref && window.toggleVoicePref()">'+(preferences.voiceOn?'已开启':'未开启')+'</button></div>'
    + '<div class="pref-row"><span>路线偏好</span><button class="btn" onclick="window.cycleRoute && window.cycleRoute()">'+(stratMap[preferences.routeStrategy]||'推荐路线')+'</button></div>'
    + '<div class="pref-row"><span>排序方式</span><button class="btn" onclick="window.cycleSort && window.cycleSort()">'+(sortMap[preferences.sortBy]||'距离优先')+'</button></div>'
    + '<div class="pref-row"><span>停车场点位</span><button class="btn" onclick="window.toggleParkMarkers && window.toggleParkMarkers()">'+(preferences.showPark?'已显示':'已隐藏')+'</button></div>'
    + '<div class="pref-row"><span>充电桩点位</span><button class="btn" onclick="window.toggleChargeMarkers && window.toggleChargeMarkers()">'+(preferences.showCharge?'已显示':'已隐藏')+'</button></div>'
    + '<div class="pref-row"><span>搜索历史</span><button class="btn" onclick="window.showHistoryDialog && window.showHistoryDialog()">查看</button></div>'
    + '</div>';
  $('sidePanelContent').innerHTML = html;
}
function cycleRoute(){
  preferences.routeStrategy = (preferences.routeStrategy + 1) % 5;
  saveLS('preferences', preferences); showPreferencesPanel();
}
function cycleSort(){
  var arr = ['distance','price','free'];
  var cur = arr.indexOf(preferences.sortBy);
  preferences.sortBy = arr[(cur+1) % arr.length];
  saveLS('preferences', preferences); showPreferencesPanel();
  if(currentPOIs.length) sortPOIs(preferences.sortBy);
}
function showHistoryDialog(){
  var html = '';
  if(!searchHistory || searchHistory.length === 0){
    html = '<div style="padding:24px;color:#999;text-align:center;">暂无搜索历史</div>';
  } else {
    html = '<div>';
    for(var i = 0; i < searchHistory.length; i++){
      var nm = String(searchHistory[i]).replace(/'/g,'');
      html += '<div class="poi-card" onclick="window.searchPOIByName && window.searchPOIByName(\''+nm+'\'); document.getElementById(\'sidePanel\').classList.remove(\'show\');">'
            +  '<div class="poi-main"><div class="poi-name">'+escapeHtml(searchHistory[i])+'</div></div></div>';
    }
    html += '<button class="btn btn-outline" style="margin:12px 16px;" onclick="window.clearHistory && window.clearHistory(); document.getElementById(\'sidePanel\').classList.remove(\'show\');">清空历史</button></div>';
  }
  $('sidePanelTitle').textContent = '搜索历史';
  $('sidePanelContent').innerHTML = html;
}

/* =========================================================================
 * 导航面板（可视化简易导航）
 * ======================================================================== */
function startNavi(routeIdx){
  var idx = routeIdx || routeSelectedIdx || 0;
  var r = routeResults[idx]; if(!r){ toast('请先规划路线'); return; }
  naviOverlayEl = $('naviOverlay');
  naviOverlayEl.classList.add('show');
  try {
    if(naviMap){ try { naviMap.destroy(); } catch(e){} naviMap = null; }
    naviMap = new AMap.Map('naviMap', {
      zoom: 16, center: routeStart, viewMode: '2D',
      showLabel: true, resizeEnable: true,
      mapStyle: preferences.dark ? 'amap://styles/dark' : 'amap://styles/normal'
    });
    var path = parseRoutePath(r.polyline);
    naviPolyline = new AMap.Polyline({
      path: path, map: naviMap, strokeColor: '#1677ff',
      strokeWeight: 8, strokeOpacity: 0.95, showDir: true, lineJoin: 'round'
    });
    new AMap.Marker({
      position: routeStart, map: naviMap,
      content: '<div style="width:32px;height:32px;background:#52c41a;color:#fff;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;">起</div>'
    });
    new AMap.Marker({
      position: routeEnd, map: naviMap,
      content: '<div style="width:32px;height:32px;background:#f5222d;color:#fff;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-weight:700;">终</div>'
    });
  } catch(e){}
  naviTotalDist = parseFloat(r.distance) || 0;
  naviTotalTime = parseFloat(r.duration) || 0;
  naviRemainDist = naviTotalDist; naviRemainTime = naviTotalTime;
  naviStepIdx = 0;
  naviSteps = (r.steps && r.steps.length) ? r.steps : [{ instruction: '出发，沿路线行驶至终点', distance: naviTotalDist, duration: naviTotalTime }];
  updateNaviDisplay();
  if(naviInterval) clearInterval(naviInterval);
  naviInterval = setInterval(function(){
    if(naviRemainTime <= 0){ clearInterval(naviInterval); speak('已到达目的地附近'); toast('已到达目的地附近'); return; }
    naviRemainTime = Math.max(0, naviRemainTime - 60);
    var ratio = naviTotalTime > 0 ? naviRemainTime / naviTotalTime : 0;
    naviRemainDist = naviTotalDist * ratio;
    updateNaviDisplay();
  }, 5000);
  speak('已为您规划路线，预计行驶 '+formatDistance(naviTotalDist)+'，大约 '+formatTime(naviTotalTime));
}
function updateNaviDisplay(){
  var s = naviSteps[Math.min(naviStepIdx, naviSteps.length-1)] || {};
  $('naviInstruction').textContent = s.instruction ? String(s.instruction).substring(0, 40) : '按路线行驶';
  $('naviDistanceNext').textContent = formatDistance(s.distance || naviRemainDist) + ' 后继续';
  $('naviRemain').textContent = formatDistance(naviRemainDist);
  $('naviTime').textContent = formatTime(naviRemainTime);
  var eta = new Date(Date.now() + naviRemainTime * 1000);
  $('naviETA').textContent = String(eta.getHours()).padStart(2,'0') + ':' + String(eta.getMinutes()).padStart(2,'0');
}
function exitNavi(){
  if(naviInterval){ clearInterval(naviInterval); naviInterval = null; }
  if(naviMap){ try { naviMap.destroy(); } catch(e){} naviMap = null; }
  if(naviOverlayEl) naviOverlayEl.classList.remove('show');
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch(e){}
}

/* =========================================================================
 * 事件绑定
 * ======================================================================== */
function bindEvents(){
  var si = $('searchInput');
  if(si){
    si.addEventListener('input', handleSearchInput);
    si.addEventListener('focus', handleSearchInput);
  }
  var sb = $('searchBtn');
  if(sb) sb.addEventListener('click', function(){
    var kw = (si ? si.value : '').trim();
    if(!kw){ toast('请输入关键字'); return; }
    addToHistory(kw); searchMode = 'dest'; searchPOIByName(kw);
    $('suggestionsBox').classList.remove('show');
  });
  var sc = $('searchClear');
  if(sc) sc.addEventListener('click', function(){ if(si){ si.value=''; handleSearchInput(); } });

  var quickBtns = document.querySelectorAll('[data-quick]');
  for(var i = 0; i < quickBtns.length; i++){
    (function(b){
      b.addEventListener('click', function(){ searchNearby(b.getAttribute('data-quick')); });
    })(quickBtns[i]);
  }
  var fp = $('toggleParkBtn'); if(fp) fp.addEventListener('click', toggleParkMarkers);
  var fc = $('toggleChargeBtn'); if(fc) fc.addEventListener('click', toggleChargeMarkers);
  var traf = $('trafficBtn'); if(traf) traf.addEventListener('click', toggleTraffic);
  var sat = $('layerBtn'); if(sat) sat.addEventListener('click', toggleSatellite);
  var loc = $('locateBtn');
  if(loc) loc.addEventListener('click', function(){
    if(myPos){ try { map.setZoomAndCenter(15, myPos); } catch(e){} toast('已回到当前位置'); }
    else toast('尚未获得定位');
  });
  var fav = $('favBtn'); if(fav) fav.addEventListener('click', showFavoritesPanel);
  var pref = $('prefBtn'); if(pref) pref.addEventListener('click', showPreferencesPanel);

  var rs = $('routeSwapBtn'); if(rs) rs.addEventListener('click', swapStartEnd);
  var rc = $('routeClearBtn'); if(rc) rc.addEventListener('click', function(){ clearRoute(); toast('已清除路线'); });
  var rsrc = $('routeSearchBtn');
  if(rsrc) rsrc.addEventListener('click', function(){
    if(!routeStart && routeStartName){ geocodeForRoute('start', routeStartName); }
    if(!routeEnd && routeEndName){ geocodeForRoute('end', routeEndName); }
    if(routeStart && routeEnd) searchRoute(); else toast('请补全起点与终点');
  });
  var rst = $('routeStartText');
  if(rst) rst.addEventListener('change', function(){ geocodeForRoute('start', this.value.trim()); });
  var ret2 = $('routeEndText');
  if(ret2) ret2.addEventListener('change', function(){ geocodeForRoute('end', this.value.trim()); });

  var stratEls = document.querySelectorAll('[data-strategy]');
  for(var j = 0; j < stratEls.length; j++){
    (function(el){
      el.addEventListener('click', function(){
        var val = parseInt(el.getAttribute('data-strategy'), 10);
        preferences.routeStrategy = val; saveLS('preferences', preferences);
        for(var k = 0; k < stratEls.length; k++){
          stratEls[k].classList.toggle('active', parseInt(stratEls[k].getAttribute('data-strategy'),10) === val);
        }
        if(routeStart && routeEnd) searchRoute();
      });
    })(stratEls[j]);
  }
  var modeEls = document.querySelectorAll('[data-mode]');
  for(var m = 0; m < modeEls.length; m++){
    (function(el){
      el.addEventListener('click', function(){
        routeMode = el.getAttribute('data-mode');
        for(var k = 0; k < modeEls.length; k++){
          modeEls[k].classList.toggle('active', modeEls[k].getAttribute('data-mode') === routeMode);
        }
        if(routeStart && routeEnd) searchRoute();
      });
    })(modeEls[m]);
  }

  var lpItems = document.querySelectorAll('[data-lp-action]');
  for(var a = 0; a < lpItems.length; a++){
    (function(el){ el.addEventListener('click', function(){ handleLongpressItem(el.getAttribute('data-lp-action')); }); })(lpItems[a]);
  }
  var dc = $('detailClose'); if(dc) dc.addEventListener('click', function(){ $('detailOverlay').classList.remove('show'); });
  var neb = $('naviExitBtn'); if(neb) neb.addEventListener('click', exitNavi);
  var nvb = $('naviVoiceBtn'); if(nvb) nvb.addEventListener('click', function(){ voiceOn = !voiceOn; toast(voiceOn?'语音播报已开启':'语音播报已关闭'); });
  var nfb = $('naviFullBtn'); if(nfb) nfb.addEventListener('click', function(){ toast('全屏导航中'); });

  var sp = $('sidePanel');
  var spc = $('sidePanelClose');
  if(spc) spc.addEventListener('click', function(){ sp && sp.classList.remove('show'); });

  document.addEventListener('click', function(e){
    var box = $('suggestionsBox'); if(!box) return;
    if(!box.contains(e.target) && e.target !== si) box.classList.remove('show');
  });

  var rpClose = document.querySelector('#routePanel .panel-close');
  if(rpClose) rpClose.addEventListener('click', function(){ var rp = $('routePanel'); if(rp) rp.classList.remove('show'); });

  // 权限引导：若用户明确拒绝定位则显示
  if(navigator.permissions && navigator.permissions.query){
    try {
      navigator.permissions.query({ name: 'geolocation' }).then(function(p){
        if(p.state === 'denied'){
          var guide = $('permissionGuide'); if(guide) guide.classList.add('show');
        }
      }).catch(function(){});
    } catch(e){}
  }

  initKeyboardListener();
}

function showPermissionGuide(){ var g = $('permissionGuide'); if(g) g.classList.add('show'); }

/* =========================================================================
 * 启动
 * ======================================================================== */
function init(){
  preferences = loadLS('preferences', preferences);
  favorites = loadLS('favorites', []);
  searchHistory = loadLS('search_history', []);
  offlineCache = loadLS('offline_cache', null);
  voiceOn = preferences.voiceOn;
  if(preferences.dark) document.body.classList.add('dark');
  if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) document.body.classList.add('mobile');

  if(window.AMap){ initMap(); }
  else {
    // 通过后端代理动态获取 JS API URL（保证 key 不暴露在前端源码）
    var loadMapScript = function(){
      fetch('/amap/loader').then(function(r){ return r.text(); }).then(function(scriptUrl){
        if(scriptUrl && scriptUrl.indexOf('http') === 0){
          var s = document.createElement('script'); s.src = scriptUrl;
          s.onload = function(){ initMap(); };
          s.onerror = function(){ toast('地图库加载失败，请检查网络或联系管理员'); };
          document.head.appendChild(s);
        } else {
          throw new Error('proxy-returns-empty');
        }
      }).catch(function(){
        // 代理不可用时的降级提示（不直接内置 key，保护 AK）
        toast('地图库代理不可用，定位与搜索功能受限');
      });
    };
    loadMapScript();
  }
  bindEvents();
}

// 页面卸载清理
window.addEventListener('beforeunload', function(){
  stopAutoRefresh();
  if(naviInterval) clearInterval(naviInterval);
  try { if(naviMap) naviMap.destroy(); } catch(e){}
});

// 暴露到 window，兼容模板内联 onclick
window.navTo = navTo;
window.setAsRouteEnd = setAsRouteEnd;
window.navFromDetail = navFromDetail;
window.addToRouteFromDetail = addToRouteFromDetail;
window.sharePOI = sharePOI;
window.removeWaypoint = removeWaypoint;
window.moveWaypoint = moveWaypoint;
window.toggleDarkMode = toggleDarkMode;
window.toggleVoicePref = toggleVoicePref;
window.cycleRoute = cycleRoute;
window.cycleSort = cycleSort;
window.toggleParkMarkers = toggleParkMarkers;
window.toggleChargeMarkers = toggleChargeMarkers;
window.showHistoryDialog = showHistoryDialog;
window.clearHistory = clearHistory;
window.removeFav = removeFav;
window.navigateToFav = navigateToFav;
window.showPOIByIdx = showPOIByIdx;
window.searchPOIByName = searchPOIByName;
window.searchNearby = searchNearby;
window.expandSearchRadius = expandSearchRadius;
window.toggleOnlyFreeParking = toggleOnlyFreeParking;
window.toggleOnlyFreeCharging = toggleOnlyFreeCharging;
window.startNavi = startNavi;
window.exitNavi = exitNavi;
window.showMain = showMain;

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
