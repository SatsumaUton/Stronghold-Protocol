// 玩家反馈板前端（matchmaker/public/feedback.html）。
//
// 鉴权全交给既有的账号体系：`/api/auth/me` 说当前是谁、什么角色；发帖时服务端自己取账号名做署名，
// 前端不传 author。所有用户文本都用 textContent 写入，不走 innerHTML，避免 XSS。
(function () {
  'use strict';

  var CATEGORY_LABEL = { bug: 'Bug 反馈', gameplay: '玩法建议', ui: '界面与体验', other: '其他' };
  var STATUS_LABEL = { unassigned: '未分配', unplanned: '无计划', planned: '已计划', updated: '已更新' };
  var PAGE = 20;

  var state = { status: 'all', category: 'all', q: '', items: [], next: null, me: null, loading: false };

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('list'), moreEl = $('more'), moreBtn = $('loadMore');
  var tabsEl = $('tabs'), catEl = $('category'), searchEl = $('search');
  var whoEl = $('who'), toastEl = $('toast');

  // ── 工具 ────────────────────────────────────────────────────────────────

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }

  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms), now = Date.now(), diff = now - ms;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 86400e3) return Math.floor(diff / 3600e3) + ' 小时前';
    if (diff < 7 * 86400e3) return Math.floor(diff / 86400e3) + ' 天前';
    var p = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  var toastTimer = null;
  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast is-show' + (isErr ? ' is-err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
  }

  /**
   * 统一 fetch：返回 { status, data }；网络错误抛异常。
   *
   * ★ 2026-11-02 修复：这里必须加 `/mm` 前缀。
   *   本页由 matchmaker 在 `/mm/feedback.html` 提供，nginx 的 `location ^~ /mm/` 会把
   *   `/mm/xxx` 重写成 `/xxx` 再转给 :3090；而 `location /` 把其它路径全转给**游戏节点**。
   *   以前这里直接 `fetch(path)` → 请求打到游戏节点 → `/api/auth/me` 和
   *   `/api/feedback/items` 都是 404（落到 SPA 的回退页），于是反馈板永远显示
   *   「未登录（可以浏览，发帖需登录）」和「加载失败 / 请稍后重试。」。
   *   `account-title.js` 的 api() 一直是 `fetch('/mm' + path)`，这里漏了同样的前缀。
   */
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    // ★ 2026-11-02 修复（第二处）：补上 Authorization: Bearer。
    //   account.cjs 的鉴权是「Cookie 优先，被浏览器拦截时退回 Authorization: Bearer <sid>」
    //   （见其 L395-399）。account-title.js 一直两份都发（localStorage 'mm.sid'），
    //   所以游戏页面能靠 Bearer 保持登录；而这里以前只发 Cookie，一旦 sp_sid 没带上
    //   （隐私模式、跨设备、被拦截），反馈板就一律 401 —— 表现为「游戏里明明登录了，
    //   反馈板却说未登录」。补上后与 account-title.js 行为一致。
    try {
      var sid = localStorage.getItem('mm.sid');
      if (sid) init.headers['authorization'] = 'Bearer ' + sid;
    } catch (e) { /* 隐私模式：没有 localStorage 就只靠 Cookie */ }
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch('/mm' + path, init).then(function (r) {
      if (r.status === 204) return { status: 204, data: null };
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        return { status: r.status, data: data };
      });
    });
  }

  // ── 登录状态 ────────────────────────────────────────────────────────────

  function loadMe() {
    return api('/api/auth/me').then(function (r) {
      state.me = (r.status === 200 && r.data && r.data.user) ? r.data.user : null;
      renderWho();
    }).catch(function () { state.me = null; renderWho(); });
  }

  function renderWho() {
    whoEl.textContent = '';
    if (state.me) {
      whoEl.appendChild(document.createTextNode('已登录：'));
      whoEl.appendChild(el('b', null, state.me.name || state.me.displayName || '博士'));
      if (state.me.role && state.me.role !== 'player') {
        var r = el('span', 'role', state.me.role === 'owner' ? ' 服主' : ' 管理员');
        whoEl.appendChild(r);
      }
    } else {
      whoEl.appendChild(document.createTextNode('未登录（可以浏览，发帖需登录）'));
    }
  }

  var isAdmin = function () { return !!(state.me && state.me.role && state.me.role !== 'player'); };

  // ── 列表 ────────────────────────────────────────────────────────────────

  function query(reset) {
    var qs = [];
    if (state.status && state.status !== 'all') qs.push('status=' + encodeURIComponent(state.status));
    if (state.category && state.category !== 'all') qs.push('category=' + encodeURIComponent(state.category));
    if (state.q) qs.push('q=' + encodeURIComponent(state.q));
    if (!reset && state.next) qs.push('before=' + state.next);
    qs.push('limit=' + PAGE);
    return '/api/feedback/items?' + qs.join('&');
  }

  function load(reset) {
    if (state.loading) return;
    state.loading = true;
    if (reset) {
      state.items = [];
      state.next = null;
      listEl.textContent = '';
      listEl.appendChild(el('div', 'state', '加载中…'));
    }
    moreBtn.disabled = true;
    api(query(reset)).then(function (r) {
      state.loading = false;
      moreBtn.disabled = false;
      if (r.status !== 200) {
        listEl.textContent = '';
        var box = el('div', 'state state--err');
        box.appendChild(el('b', null, r.status === 400 ? '筛选条件不合法' : '加载失败'));
        box.appendChild(el('div', null, '请稍后重试。'));
        listEl.appendChild(box);
        return;
      }
      var data = r.data || {};
      var items = Array.isArray(data.items) ? data.items : [];
      state.items = reset ? items : state.items.concat(items);
      state.next = data.next == null ? null : data.next;
      renderCounts(data.counts || {});
      renderList();
    }).catch(function () {
      state.loading = false;
      moreBtn.disabled = false;
      listEl.textContent = '';
      var box = el('div', 'state state--err');
      box.appendChild(el('b', null, '网络错误'));
      box.appendChild(el('div', null, '请检查网络后重试。'));
      listEl.appendChild(box);
    });
  }

  function renderCounts(counts) {
    Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-count]'), function (n) {
      var k = n.getAttribute('data-count');
      var v = counts[k] == null ? 0 : counts[k];
      n.textContent = v > 0 ? String(v) : '';
    });
  }

  function renderList() {
    listEl.textContent = '';
    if (!state.items.length) {
      var box = el('div', 'state');
      box.appendChild(el('b', null, '还没有反馈'));
      box.appendChild(el('div', null, '点右上角「发帖」写下你遇到的问题或建议。'));
      listEl.appendChild(box);
      moreEl.hidden = true;
      return;
    }
    state.items.forEach(function (it) { listEl.appendChild(card(it)); });
    moreEl.hidden = !state.next;
  }

  /** 一条反馈的卡片。 */
  function card(it) {
    var c = el('div', 'card' + (it.hidden ? ' is-hidden' : ''));

    var top = el('div', 'card__top');
    top.appendChild(el('span', 'badge badge--' + it.category, CATEGORY_LABEL[it.category] || it.category));
    top.appendChild(el('span', 'badge badge--' + it.status, STATUS_LABEL[it.status] || it.status));
    if (it.hidden) top.appendChild(el('span', 'badge badge--unplanned', '已隐藏'));
    top.appendChild(el('h2', 'card__title', it.title));
    c.appendChild(top);

    var body = el('p', 'card__body is-clamped', it.body);
    c.appendChild(body);
    if (it.body && it.body.length > 260) {
      var more = el('button', 'btn btn--ghost btn--sm card__more', '展开全文');
      more.type = 'button';
      more.addEventListener('click', function () {
        var clamped = body.classList.toggle('is-clamped');
        more.textContent = clamped ? '展开全文' : '收起';
      });
      c.appendChild(more);
    }

    if (it.reply) {
      var rep = el('div', 'reply');
      rep.appendChild(el('div', 'reply__who', '服主回复' + (it.replyAt ? ' · ' + fmtTime(it.replyAt) : '')));
      rep.appendChild(el('div', 'reply__body', it.reply));
      c.appendChild(rep);
    }

    var meta = el('div', 'card__meta');
    meta.appendChild(el('span', null, it.author ? it.author : '匿名'));
    var t = el('span', 'dot', fmtTime(it.createdAt));
    meta.appendChild(t);
    if (it.client) meta.appendChild(el('span', 'dot', it.client));
    if (it.mine) meta.appendChild(el('span', null, '· 我发的'));
    c.appendChild(meta);

    if (isAdmin()) c.appendChild(adminBox(it));
    return c;
  }

  /** 服主工具：改状态 / 回复 / 隐藏 / 删除。 */
  function adminBox(it) {
    var box = el('div', 'adminbox');

    var row1 = el('div', 'adminbox__row');
    row1.appendChild(el('label', null, '状态'));
    var sel = el('select');
    Object.keys(STATUS_LABEL).forEach(function (k) {
      var o = el('option', null, STATUS_LABEL[k]);
      o.value = k;
      if (k === it.status) o.selected = true;
      sel.appendChild(o);
    });
    row1.appendChild(sel);

    var hideBtn = el('button', 'btn btn--ghost btn--sm', it.hidden ? '取消隐藏' : '隐藏');
    hideBtn.type = 'button';
    var delBtn = el('button', 'btn btn--danger btn--sm', '删除');
    delBtn.type = 'button';
    row1.appendChild(hideBtn);
    row1.appendChild(delBtn);
    box.appendChild(row1);

    var ta = el('textarea');
    ta.placeholder = '服主回复（留空并保存 = 清除回复）';
    ta.maxLength = 2000;
    ta.value = it.reply || '';
    box.appendChild(ta);

    var row2 = el('div', 'adminbox__row');
    var saveBtn = el('button', 'btn btn--primary btn--sm', '保存');
    saveBtn.type = 'button';
    row2.appendChild(saveBtn);
    box.appendChild(row2);

    function busy(on) { saveBtn.disabled = hideBtn.disabled = delBtn.disabled = sel.disabled = on; }

    saveBtn.addEventListener('click', function () {
      busy(true);
      api('/api/feedback/items/' + it.id + '/admin', { method: 'POST', body: { status: sel.value, reply: ta.value } })
        .then(function (r) {
          busy(false);
          if (r.status === 200 && r.data && r.data.item) {
            replaceItem(r.data.item);
            toast('已保存');
          } else toast(errText(r), true);
        }).catch(function () { busy(false); toast('网络错误', true); });
    });

    hideBtn.addEventListener('click', function () {
      busy(true);
      api('/api/feedback/items/' + it.id + '/admin', { method: 'POST', body: { hidden: !it.hidden } })
        .then(function (r) {
          busy(false);
          if (r.status === 200 && r.data && r.data.item) {
            replaceItem(r.data.item);
            toast(r.data.item.hidden ? '已隐藏' : '已取消隐藏');
          } else toast(errText(r), true);
        }).catch(function () { busy(false); toast('网络错误', true); });
    });

    delBtn.addEventListener('click', function () {
      if (!confirm('确定删除这条反馈？此操作不可撤销。')) return;
      busy(true);
      api('/api/feedback/items/' + it.id, { method: 'DELETE' }).then(function (r) {
        busy(false);
        if (r.status === 204) {
          state.items = state.items.filter(function (x) { return x.id !== it.id; });
          renderList();
          toast('已删除');
        } else toast(errText(r), true);
      }).catch(function () { busy(false); toast('网络错误', true); });
    });

    return box;
  }

  /** 就地更新一条（保持滚动位置）。 */
  function replaceItem(item) {
    for (var i = 0; i < state.items.length; i++) {
      if (state.items[i].id === item.id) { state.items[i] = item; break; }
    }
    renderList();
  }

  function errText(r) {
    var e = r && r.data && r.data.error;
    if (e === 'OWNER') return '没有管理权限';
    if (e === 'LOGIN_REQUIRED') return '请先登录';
    if (e === 'RATE_LIMITED') {
      var s = r.data.retryAfter || 0;
      return '提交太频繁，请 ' + (s >= 60 ? Math.ceil(s / 60) + ' 分钟' : s + ' 秒') + '后再试';
    }
    if (e === 'DUPLICATE') return '已经有人提过同样的问题了';
    if (e === 'INVALID') return '内容不合规（' + ((r.data && r.data.field) || '字段') + '）';
    if (e === 'ORIGIN') return '来源校验失败，请刷新页面重试';
    if (e === 'TOO_LARGE') return '内容太长了';
    return '操作失败' + (e ? '（' + e + '）' : '');
  }

  // ── 筛选交互 ────────────────────────────────────────────────────────────

  tabsEl.addEventListener('click', function (e) {
    var b = e.target.closest('[data-status]');
    if (!b) return;
    state.status = b.getAttribute('data-status');
    Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-status]'), function (x) {
      x.setAttribute('aria-selected', x === b ? 'true' : 'false');
    });
    load(true);
  });

  catEl.addEventListener('change', function () { state.category = catEl.value; load(true); });

  var searchTimer = null;
  searchEl.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      state.q = searchEl.value.trim();
      load(true);
    }, 320);
  });

  moreBtn.addEventListener('click', function () { load(false); });

  // ── 发帖 ────────────────────────────────────────────────────────────────

  var modal = $('modal'), form = $('form'), formErr = $('formErr'), submitBtn = $('submit');

  function openModal() {
    if (!state.me) {
      toast('发帖需要先登录账号', true);
      setTimeout(function () { location.href = '/'; }, 900);
      return;
    }
    formErr.textContent = '';
    modal.classList.add('is-open');
    $('f-title').focus();
  }

  function closeModal() { modal.classList.remove('is-open'); }

  $('compose').addEventListener('click', openModal);
  modal.addEventListener('click', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-close')) closeModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  function bindCounter(inputId, counterId, max) {
    var input = $(inputId), counter = $(counterId);
    function upd() {
      var n = Array.from(input.value).length;
      counter.textContent = n + ' / ' + max;
      counter.classList.toggle('is-over', n > max);
    }
    input.addEventListener('input', upd);
    upd();
  }
  bindCounter('f-title', 'c-title', 80);
  bindCounter('f-body', 'c-body', 4000);

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    formErr.textContent = '';
    var category = $('f-category').value;
    var title = $('f-title').value.trim();
    var body = $('f-body').value.trim();
    if (Array.from(title).length < 2) { formErr.textContent = '标题至少 2 个字'; return; }
    if (Array.from(body).length < 5) { formErr.textContent = '正文至少 5 个字'; return; }
    var client = '';
    try {
      client = [navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform,
        navigator.userAgent].filter(Boolean).join(' / ').slice(0, 160);
    } catch (err) { client = ''; }
    submitBtn.disabled = true;
    api('/api/feedback/items', { method: 'POST', body: { category: category, title: title, body: body, client: client } })
      .then(function (r) {
        submitBtn.disabled = false;
        if (r.status === 201) {
          closeModal();
          form.reset();
          $('c-title').textContent = '0 / 80';
          $('c-body').textContent = '0 / 4000';
          toast('已提交，谢谢反馈！');
          state.status = 'all';
          Array.prototype.forEach.call(tabsEl.querySelectorAll('[data-status]'), function (x) {
            x.setAttribute('aria-selected', x.getAttribute('data-status') === 'all' ? 'true' : 'false');
          });
          load(true);
          return;
        }
        if (r.status === 401) {
          formErr.textContent = '登录已失效，请刷新页面重新登录';
          return;
        }
        formErr.textContent = errText(r);
      })
      .catch(function () { submitBtn.disabled = false; formErr.textContent = '网络错误，请重试'; });
  });

  // ── 启动 ────────────────────────────────────────────────────────────────

  loadMe().then(function () { load(true); });
})();
