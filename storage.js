/* =====================================================
 storage.js —— 数据访问层（存储抽象）
 铁旅 · 中国高铁模拟旅程

 【为什么】存档 / 排行 / 用户数据统一走这一层。游戏代码不直接碰
  localStorage 或远端数据库，这样未来接 Supabase 只改下面 BACKEND
  一个开关 + 补全 SupabaseAdapter，游戏逻辑零改动。

 【基础（现在生效）】LocalStorageAdapter —— 零依赖、本机可用、匿名设备存档。
 【扩展（预留）】SupabaseAdapter    —— Auth / 云同步 / 全服排行，返回占位值，
   接入真实项目时补全（表结构见 supabase/schema.sql）。
===================================================== */
'use strict';
window.DB = (function () {
  // ⚙ 后端开关：'local'（默认）| 'supabase'（预留，接入真实库时改为这个并填好下面适配器）
  var BACKEND = 'local';

  var SAVE_KEY = 'railJourneySave_v1'; // 个人存档键（与旧版一致，便于无感迁移）
  var PROFILE_KEY = 'rail_device_uid'; // 匿名设备档案 ID

  /* ---------- 匿名档案 ID：本地即设备 ID；Supabase 模式可替换为账号 ID ---------- */
  function getProfileId() {
    try {
      var id = localStorage.getItem(PROFILE_KEY);
      if (!id) {
        id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem(PROFILE_KEY, id);
      }
      return id;
    } catch (e) { return 'dev_' + Math.random().toString(36).slice(2, 10); }
  }
  function getProfile() {
    return { id: getProfileId(), displayName: null, photoUrl: null };
  }

  /* ================== 适配器 A：LocalStorage（当前默认） ================== */
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
    getRanking: function (scope) { return null; }, // 本机模式没有全服排行
    submitRanking: function (entry) {},            // 本机模式不提交
    getUserCount: function () { return 0; },
    getProfile: getProfile
  };

  /* ================== 适配器 B：Supabase（预留，接入时补全） ==================
      接入步骤：1) storage.js 顶部 BACKEND 改为 'supabase'
               2) 在下方填入项目 URL / anon key（或用环境变量注入）
               3) 到 Supabase 控制台执行 supabase/schema.sql 建表
      约定：对外保持同步门面（内存缓存读、异步落库写），游戏层调用方式不变。 */
  var supabase = {
    load: function () { /* TODO: 从 profiles.cloud_save 拉取当前用户存档 */ return null; },
    save: function (d) { /* TODO: upsert 到 profiles.cloud_save */ return false; },
    clear: function () { /* TODO: 清空云端存档 */ },
    getRanking: function (scope) { /* TODO: SELECT * FROM rankings WHERE scope=? */ return null; },
    submitRanking: function (entry) { /* TODO: upsert rankings / 更新 getUserCount */ },
    getUserCount: function () { /* TODO: SELECT count(*) FROM profiles */ return 0; },
    getProfile: function () { /* TODO: supabase.auth.getUser() + profiles 表 */ return getProfile(); }
  };

  var backend = BACKEND === 'supabase' ? supabase : local;

  return {
    backendName: BACKEND,
    saveKey: SAVE_KEY,
    getProfileId: getProfileId,
    /* ---- 统一接口：游戏层只调这些，不区分后端 ---- */
    loadSave:      function () { return backend.load(); },
    saveSave:      function (d) { return backend.save(d); },
    clearSave:     function () { return backend.clear(); },
    getProfile:    function () { return backend.getProfile(); },
    getRanking:    function (scope) { return backend.getRanking(scope); },
    submitRanking: function (entry) { return backend.submitRanking(entry); },
    getUserCount:  function () { return backend.getUserCount(); }
  };
})();