/* =====================================================
 storage.js —— 数据访问层（存储抽象）
 铁旅 · 中国高铁模拟旅程

 【架构】游戏代码只调统一接口（saveSave/loadSave/clearSave/...），
 不直接碰 localStorage 或 Supabase。本次已切换为 Supabase 后端。

 【Supabase 模式】匿名登录 + 云端存档同步：
   - 页面加载后 init() 自动匿名登录，拉取云端存档填充内存缓存
   - 游戏层仍同步读写（读内存缓存、写后异步推云端），游戏逻辑零改动
   - 首次登录会把本地已有存档自动迁移上云
   - SDK 未加载 / 登录失败 / 断网 → 自动降级回本地存储，游戏不受影响

 【数据隔离】多应用共用一套 Supabase 账号：所有业务数据带 app_id
 字段（本应用 = 'train_journey'），互不串（见 supabase/schema.sql）。
===================================================== */
'use strict';
window.DB = (function () {
  /* ⚙ Supabase 配置（Publishable Key 可公开，前提是 RLS 已开启） */
  var SUPABASE_URL = 'https://agogyjmnuvsihdlxlkgp.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_uEpd3WOEjLlg5YE1E39Ddg_MwTMUw4v';
  var APP_ID = 'train_journey';

  var SAVE_KEY = 'railJourneySave_v1'; // 本地存档键（兼容旧版本，用于迁移/降级）
  var PROFILE_KEY = 'rail_device_uid'; // 匿名设备档案 ID（降级本地模式用）

  /* ---------- 运行时状态 ---------- */
  var activeBackend = 'local'; // 实际生效后端：'local' | 'supabase'（init 后确定）
  var client = null;           // Supabase 客户端
  var authUser = null;         // 当前登录用户（匿名或正式）
  var memSave = null;          // 云端存档内存缓存（同步读来源）

  /* ---------- 匿名设备 ID（仅本地/降级模式使用） ---------- */
  function getDeviceId() {
    try {
      var id = localStorage.getItem(PROFILE_KEY);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(PROFILE_KEY, id);
      }
      return id;
    } catch (e) { return 'dev_' + Math.random().toString(36).slice(2, 10); }
  }
  function getProfileId() {
    if (activeBackend === 'supabase' && authUser) return authUser.id;
    return getDeviceId();
  }
  function getProfile() {
    return {
      id: getProfileId(),
      displayName: (authUser && authUser.user_metadata && authUser.user_metadata.full_name) ? authUser.user_metadata.full_name : null,
      photoUrl: null
    };
  }

  /* ================== 适配器 A：LocalStorage（降级/迁移源） ================== */
  var local = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(SAVE_KEY)); }
      catch (e) { return null; }
    },
    save: function (d) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); return true; }
      catch (e) { console.warn('save failed', e); return false; }
    },
    clear: function () { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
    getRanking: function () { return null; },
    submitRanking: function () {},
    loadRanking: function (scope, cb) { if (cb) cb(); },
    getUserCount: function () { return 0; },
    getProfile: getProfile
  };

  /* ================== 适配器 B：Supabase（当前生效） ================== */
  function pushCloud(d) {
    if (!client || !authUser) return;
    client.from('profiles')
      .upsert({ id: authUser.id, cloud_save: d, updated_at: new Date().toISOString() })
      .then(function (res) { if (res.error) console.warn('[DB] cloud save fail', res.error); });
  }
  function clearCloud() {
    if (!client || !authUser) return;
    client.from('profiles')
      .update({ cloud_save: null, updated_at: new Date().toISOString() })
      .eq('id', authUser.id)
      .then(function (res) { if (res.error) console.warn('[DB] cloud clear fail', res.error); });
  }
  var supabaseAdapter = {
    load: function () { return memSave; },
    save: function (d) {
      memSave = JSON.parse(JSON.stringify(d)); // 深拷贝进内存缓存
      if (!authUser) local.save(d);            // 尚未登录成功：先落本地，登录后首迁上云
      else pushCloud(d);                       // 异步推云端（游戏层无需等待）
      return true;
    },
    clear: function () {
      memSave = null;
      local.clear();
      if (authUser) clearCloud();
    },
    getRanking: function (scope) { return getRanking(scope); },        // 同步读缓存（无缓存返回 null → 游戏用本地模拟数据兜底）
    submitRanking: function (entry) { submitRanking(entry); },         // 异步 upsert 到 rankings（带 30s 节流防刷）
    loadRanking: function (scope, cb) { loadRanking(scope, cb); },     // 异步拉真实全服榜 → 写缓存 → 回调重渲染
    getUserCount: function () { return 0; },
    getProfile: getProfile
  };

  /* ---------- 排行榜：真实全服（rankings 表） ---------- */
  var rankCache = {};      // scope -> { list, at, loading }
  var lastSubmitAt = 0;    // 防刷：最短提交间隔

  function submitRanking(entry) {
    if (!client || !authUser || !entry) return;
    var now = Date.now();
    if (now - lastSubmitAt < 30000) return; // 30s 节流，防刷
    lastSubmitAt = now;
    var rows = [
      { scope: 'nation', metric: 'stations', value: entry.stations || 0 },
      { scope: 'nation', metric: 'lines',    value: entry.lines || 0 },
      { scope: 'nation', metric: 'provs',    value: entry.provs || 0 },
      { scope: 'nation', metric: 'km',       value: entry.km || 0 }
    ].map(function (r) {
      r.app_id = APP_ID;
      r.profile_id = authUser.id;
      r.updated_at = new Date().toISOString();
      return r;
    });
    client.from('rankings')
      .upsert(rows, { onConflict: 'app_id,profile_id,scope,metric' })
      .then(function (res) { if (res.error) console.warn('[DB] submitRanking fail', res.error); });
  }

  function loadRanking(scope, cb) {
    if (scope !== 'nation' || !client || !authUser || !window.supabase) { if (cb) cb(); return; }
    var now = Date.now();
    var c = rankCache[scope];
    // 正在加载或 60s 内已加载 → 直接返回（防止 renderRank 反复触发造成循环）
    if (c && (c.loading || now - c.at < 60000)) { if (cb) cb(); return; }
    rankCache[scope] = { loading: true, at: now, list: null };
    client.from('rankings')
      .select('profile_id, metric, value')
      .eq('app_id', APP_ID)
      .eq('scope', scope)
      .order('value', { ascending: false })
      .limit(200)
      .then(function (res) {
        if (res.error) throw res.error;
        var rows = res.data || [];
        var map = {};
        rows.forEach(function (r) {
          var k = r.profile_id;
          if (!map[k]) map[k] = { id: k, stations: 0, lines: 0, provs: 0, km: 0 };
          map[k][r.metric] = r.value || 0;
        });
        var list = Object.keys(map).map(function (k) {
          var m = map[k];
          return {
            nick: '车友#' + k.slice(0, 6), // RLS 限制读不到他人昵称，用账号短 ID 展示
            vis: m.stations, done: m.lines, prov: m.provs, km: m.km,
            me: k === authUser.id
          };
        }).sort(function (a, b) { return b.vis - a.vis; }).slice(0, 20);
        rankCache[scope] = { loading: false, at: Date.now(), list: list };
        if (cb) cb();
      })
      .catch(function (e) {
        console.warn('[DB] loadRanking fail', e);
        rankCache[scope] = { loading: false, at: Date.now(), list: null };
        if (cb) cb();
      });
  }

  function getRanking(scope) {
    if (scope !== 'nation') return null;
    var c = rankCache[scope];
    return (c && c.list) ? c.list : null;
  }

  function getBackend() { return activeBackend === 'supabase' ? supabaseAdapter : local; }

  /* ---------- 初始化：匿名登录 + 云端存档同步（失败自动降级本地） ---------- */
  function init(cb) {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      activeBackend = 'local'; if (cb) cb(false); return; // SDK 未加载（如离线/被墙）
    }
    try { client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); }
    catch (e) { activeBackend = 'local'; if (cb) cb(false); return; }

    client.auth.signInAnonymously()
      .then(function (res) {
        if (res.error) throw res.error;
        authUser = res.data.user;
        activeBackend = 'supabase';
        return client.from('profiles').select('cloud_save').eq('id', authUser.id).maybeSingle();
      })
      .then(function (d) {
        var cloud = (d && d.data && d.data.cloud_save) ? d.data.cloud_save : null;
        var localSave = local.load();
        if (cloud) { memSave = cloud; }
        else if (localSave) { memSave = localSave; pushCloud(localSave); } // 首次迁移本地存档上云
        else { memSave = null; }
        if (cb) cb(!!(cloud || localSave));
      })
      .catch(function (e) {
        console.warn('[DB] supabase init failed, fallback to local:', e);
        activeBackend = 'local';
        if (cb) cb(false);
      });
  }

  /* ---------- 账号：查询当前登录状态 / 绑定邮箱升级正式账号 ---------- */
  function getUser() {
    if (!authUser) return null;
    return {
      id: authUser.id,
      email: authUser.email || null,
      isAnonymous: !!(authUser.is_anonymous ||
        (authUser.app_metadata && authUser.app_metadata.provider === 'anonymous'))
    };
  }
  function linkEmail(email, password) {
    if (!client) return Promise.reject(new Error('未连接到云端服务'));
    return client.auth.linkIdentity({ provider: 'email', options: { email: email, password: password } })
      .then(function (res) {
        if (res.error) throw res.error;
        if (res.data && res.data.user) authUser = res.data.user; // 绑定后 id 不变，云端存档不丢
        return { ok: true };
      });
  }

  /* ---------- 统一对外接口 ---------- */
  return {
    get backendName() { return activeBackend; }, // 实时当前后端：'local' | 'supabase'
    appId: APP_ID,
    init: init,
    getProfileId: getProfileId,
    loadSave:      function () { return getBackend().load(); },
    saveSave:      function (d) { return getBackend().save(d); },
    clearSave:     function () { return getBackend().clear(); },
    getProfile:    function () { return getBackend().getProfile(); },
    getUser:       function () { return getUser(); },
    linkEmail:     function (email, password) { return linkEmail(email, password); },
    getRanking:    function (scope) { return getBackend().getRanking(scope); },
    submitRanking: function (entry) { return getBackend().submitRanking(entry); },
    loadRanking:   function (scope, cb) { return getBackend().loadRanking(scope, cb); },
    getUserCount:  function () { return getBackend().getUserCount(); }
  };
})();