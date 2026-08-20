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
    getRanking: function () { return null; },  // 排行榜查询为异步，暂回退本地模拟数据
    submitRanking: function () { /* TODO: 接入 rankings 表（app_id=APP_ID, auth.uid()） */ },
    getUserCount: function () { return 0; },
    getProfile: getProfile
  };

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
    getRanking:    function (scope) { return getBackend().getRanking(scope); },
    submitRanking: function (entry) { return getBackend().submitRanking(entry); },
    getUserCount:  function () { return getBackend().getUserCount(); }
  };
})();