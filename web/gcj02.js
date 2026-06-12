/**
 * WGS84 转 GCJ-02 坐标转换算法（火星坐标系）
 * 用于将浏览器 GPS 定位坐标转换为高德地图坐标系
 * 
 * 高德地图、腾讯地图使用 GCJ-02 坐标系
 * 浏览器 Geolocation API 返回 WGS84 坐标系
 * 必须转换后才能正确在高德地图上显示位置
 */

// 定义一些常量
var x_PI = 3.14159265358979324 * 3000.0 / 180.0;
var PI = 3.1415926535897932384626;
var a = 6378245.0; // 长半轴
var ee = 0.00669342162296594323; // 偏心率平方

/**
 * 判断是否在中国境内
 * @param {number} lng 经度
 * @param {number} lat 纬度
 * @returns {boolean} 是否在中国境内
 */
function isInChina(lng, lat) {
  // 中国境内大致范围：纬度 0.8293 ~ 55.8271，经度 72.004 ~ 137.8347
  return lat > 0.8293 && lat < 55.8271 && lng > 72.004 && lng < 137.8347;
}

/**
 * 转换纬度
 * @param {number} x 经度
 * @param {number} y 纬度
 * @returns {number} 转换后的纬度偏移量
 */
function transformLat(x, y) {
  var ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

/**
 * 转换经度
 * @param {number} x 经度
 * @param {number} y 纬度
 * @returns {number} 转换后的经度偏移量
 */
function transformLng(x, y) {
  var ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
  return ret;
}

/**
 * WGS84 转 GCJ-02
 * @param {number} lng WGS84 经度
 * @param {number} lat WGS84 纬度
 * @returns {Array} [GCJ02经度, GCJ02纬度]
 */
function wgs84ToGcj02(lng, lat) {
  // 如果不在中国境内，不进行转换
  if (!isInChina(lng, lat)) {
    return [lng, lat];
  }
  
  var dLat = transformLat(lng - 105.0, lat - 35.0);
  var dLng = transformLng(lng - 105.0, lat - 35.0);
  var radLat = lat / 180.0 * PI;
  var magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  var sqrtMagic = Math.sqrt(magic);
  
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  
  var mgLat = lat + dLat;
  var mgLng = lng + dLng;
  
  return [mgLng, mgLat];
}

/**
 * GCJ-02 转 WGS84（逆向转换，用于导出坐标）
 * @param {number} lng GCJ02 经度
 * @param {number} lat GCJ02 纬度
 * @returns {Array} [WGS84经度, WGS84纬度]
 */
function gcj02ToWgs84(lng, lat) {
  if (!isInChina(lng, lat)) {
    return [lng, lat];
  }
  
  var dLat = transformLat(lng - 105.0, lat - 35.0);
  var dLng = transformLng(lng - 105.0, lat - 35.0);
  var radLat = lat / 180.0 * PI;
  var magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  var sqrtMagic = Math.sqrt(magic);
  
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  
  var mgLat = lat + dLat;
  var mgLng = lng + dLng;
  
  // 逆向计算
  return [lng * 2 - mgLng, lat * 2 - mgLat];
}

/**
 * 计算两点之间的距离（米）
 * @param {number} lng1 点1经度
 * @param {number} lat1 点1纬度
 * @param {number} lng2 点2经度
 * @param {number} lat2 点2纬度
 * @returns {number} 距离（米）
 */
function getDistance(lng1, lat1, lng2, lat2) {
  var radLat1 = lat1 * PI / 180.0;
  var radLat2 = lat2 * PI / 180.0;
  var a = radLat1 - radLat2;
  var b = lng1 * PI / 180.0 - lng2 * PI / 180.0;
  
  var s = 2 * Math.asin(Math.sqrt(
    Math.pow(Math.sin(a / 2), 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(b / 2), 2)
  ));
  
  s = s * a; // 地球半径 6378245.0 米
  s = Math.round(s * 10000) / 10000;
  
  return s;
}

// 导出函数（兼容 CommonJS 和浏览器全局）
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wgs84ToGcj02: wgs84ToGcj02,
    gcj02ToWgs84: gcj02ToWgs84,
    getDistance: getDistance,
    isInChina: isInChina
  };
}