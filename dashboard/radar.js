// Launch Multiple Radar — the page's logic. Plain script, no imports, no network:
// every figure comes from window.RADAR, the data.js the entry's program writes
// beside this page. Board view, detail view and filters all render from it.
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) return;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // ------------------------------------------------------------- formatting
  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function pct(n) {
    if (n === null || n === undefined) return '<span class="flat">n/a</span>';
    var cls = n > 0.05 ? 'up' : n < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function ageText(days) {
    if (days === null || days === undefined) return 'age unreported';
    if (days < 90) return days + ' days old';
    if (days < 730) return Math.round(days / 30.4) + ' months old';
    return (days / 365.25).toFixed(1) + ' years old';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------- masthead and model strip
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  document.getElementById('masthead-stats').innerHTML =
    '<div class="mstat"><b>' + rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="mstat"><b>' + D.watchlist_size + '</b><span>on the watchlist</span></div>' +
    '<div class="mstat"><b>' + money(totalImplied) + '</b><span>combined implied value</span></div>' +
    '<div class="mstat"><b>' + D.as_of + '</b><span>snapshot date</span></div>';

  var m = D.model;
  document.getElementById('model-strip').innerHTML =
    '<b>How a price is made.</b> For each category, take the tokenized protocols in this snapshot and their ' +
    'market-cap / TVL multiples; the category\u2019s working multiple is its median, shrunk toward the global median of ' +
    '<b>' + m.global_multiple.toFixed(3) + '</b> with a weight of ' + m.shrink_k + ' phantom observations. Then ' +
    '<span class="formula">implied = TVL \u00d7 category multiple \u00d7 momentum factor \u00d7 age factor</span> ' +
    'where momentum reads the 7-day TVL change (clamped to ' + m.momentum_clamp[0] + '%\u2026+' + m.momentum_clamp[1] +
    '%, weight ' + m.momentum_weight + ') and the age factor runs ' + m.age_base + '\u2013' + (m.age_base + m.age_span).toFixed(2) +
    ' over ' + m.age_full_days + ' tokenless days. No name is special-cased; open any protocol for its own arithmetic.';

  document.getElementById('source-line').textContent =
    'Snapshot: ' + D.source + ' \u00b7 ' + D.protocol_count + ' protocols at or above $5M TVL \u00b7 watchlist floor ' + money(D.floor_usd) + '.';

  // ------------------------------------------------------------- filters
  var el = {
    search: document.getElementById('f-search'),
    category: document.getElementById('f-category'),
    chain: document.getElementById('f-chain'),
    value: document.getElementById('f-value'),
    sort: document.getElementById('f-sort'),
    watch: document.getElementById('f-watch'),
    count: document.getElementById('result-count'),
    board: document.getElementById('board-rows'),
    empty: document.getElementById('empty-note'),
    boardView: document.getElementById('board-view'),
    detailView: document.getElementById('detail-view'),
  };

  function fillSelect(select, values, anyLabel) {
    select.innerHTML = '<option value="">' + anyLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var categories = [];
  var chains = [];
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorized';
    if (categories.indexOf(c) < 0) categories.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
  });
  categories.sort(); chains.sort();
  fillSelect(el.category, categories, 'All categories');
  fillSelect(el.chain, chains, 'All chains');

  function currentFilters() {
    return {
      q: el.search.value.trim().toLowerCase(),
      category: el.category.value,
      chain: el.chain.value,
      minValue: el.value.value === '' ? 0 : Number(el.value.value),
      sort: el.sort.value,
      watchOnly: el.watch.checked,
    };
  }

  function visibleRows() {
    var f = currentFilters();
    var out = rows.filter(function (r) {
      if (f.watchOnly && !r.on_watchlist) return false;
      if (f.category && (r.category || 'Uncategorized') !== f.category) return false;
      if (f.chain && r.chains.indexOf(f.chain) < 0) return false;
      if (f.minValue && r.implied_value_usd < f.minValue) return false;
      if (f.q && (r.name.toLowerCase().indexOf(f.q) < 0 && r.slug.indexOf(f.q) < 0)) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d || -1e9) - (a.change_7d || -1e9); },
      age: function (a, b) { return (b.age_days || -1) - (a.age_days || -1); },
      multiple: function (a, b) { return b.model.category_multiple - a.model.category_multiple; },
    };
    out.sort(by[f.sort] || by.rank);
    return out;
  }

  function rowHtml(r) {
    return '<button type="button" class="row-card board-grid" data-slug="' + esc(r.slug) + '">' +
      '<span class="rank-chip">' + r.rank + '</span>' +
      '<span class="p-name">' + esc(r.name) +
        (r.on_watchlist ? ' <span class="watch-badge">Watchlist</span>' : '') +
        '<span class="p-chains">' + esc(r.chains.slice(0, 3).join(' \u00b7 ') || 'chain unreported') + ' \u00b7 ' + ageText(r.age_days) + '</span></span>' +
      '<span class="p-cat">' + esc(r.category || 'Uncategorized') + '</span>' +
      '<span class="num">' + money(r.tvl_usd) + '</span>' +
      '<span class="num">' + pct(r.change_7d) + '</span>' +
      '<span class="num">' + r.model.category_multiple.toFixed(2) + '\u00d7<small>' + r.model.category_comparables + ' comps</small></span>' +
      '<span class="num value-num">' + money(r.implied_value_usd) + '</span>' +
      '</button>';
  }

  function renderBoard() {
    var vis = visibleRows();
    el.board.innerHTML = vis.map(rowHtml).join('');
    el.empty.hidden = vis.length > 0;
    el.count.textContent = 'Showing ' + vis.length + ' of ' + rows.length + ' protocols';
    Array.prototype.forEach.call(el.board.querySelectorAll('.row-card'), function (card) {
      card.addEventListener('click', function () { location.hash = '#/p/' + card.getAttribute('data-slug'); });
    });
  }

  ['input', 'change'].forEach(function (evt) {
    [el.search, el.category, el.chain, el.value, el.sort, el.watch].forEach(function (c) {
      c.addEventListener(evt, renderBoard);
    });
  });

  // ------------------------------------------------------------- routing
  function route() {
    var hash = location.hash || '#/';
    var match = hash.match(/^#\/p\/(.+)$/);
    if (match && bySlug[decodeURIComponent(match[1])]) {
      renderDetail(bySlug[decodeURIComponent(match[1])]);
      el.boardView.hidden = true;
      el.detailView.hidden = false;
      window.scrollTo(0, 0);
    } else {
      el.detailView.hidden = true;
      el.boardView.hidden = false;
      renderBoard();
    }
  }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------- detail view
  function renderDetail(r) {
    var comps = (r.comparables || []).map(function (c) {
      return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.tvl_usd) + '</td><td>' + money(c.mcap_usd) + '</td><td>' + c.multiple.toFixed(2) + '\u00d7</td></tr>';
    }).join('');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    el.detailView.innerHTML =
      '<button type="button" class="back-btn" id="back-btn">\u2190 Back to the board</button>' +
      '<article class="detail-card">' +
        '<h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="watch-badge">Watchlist</span>' : '') + '</h2>' +
        '<p class="detail-sub">Rank #' + r.rank + ' of ' + rows.length + ' \u00b7 ' + esc(r.category || 'Uncategorized') +
          ' \u00b7 records no token in the snapshot \u00b7 tracked since ' + esc(r.listed_at || 'an unreported date') + '</p>' +
        '<div class="stat-grid">' +
          '<div><span>Total value locked</span><b>' + moneyFull(r.tvl_usd) + '</b></div>' +
          '<div><span>Implied token value</span><b>' + moneyFull(r.implied_value_usd) + '</b></div>' +
          '<div><span>7-day TVL change</span><b>' + (r.change_7d === null ? 'unreported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>' +
          '<div><span>Chains</span><b>' + esc(r.chains.join(', ') || 'unreported') + '</b></div>' +
        '</div>' +
        '<div class="detail-cols">' +
          '<div>' +
            '<h3>How the implied value is built</h3>' +
            '<div class="breakdown">' +
              '<div class="b-row"><span>Total value locked</span><span>' + moneyFull(r.tvl_usd) + '</span></div>' +
              '<div class="b-row"><span>Category multiple \u2014 ' + esc(r.category || 'Uncategorized') + '</span><span>\u00d7 ' + r.model.category_multiple.toFixed(3) + '</span></div>' +
              '<div class="b-row"><span class="b-note">Median of ' + r.model.category_comparables + ' tokenized comparable' + (r.model.category_comparables === 1 ? '' : 's') +
                ' (raw median ' + r.model.category_raw_median.toFixed(3) + '), shrunk toward the global median ' + D.model.global_multiple.toFixed(3) + '.</span></div>' +
              '<div class="b-row"><span>Momentum factor (7-day TVL)</span><span>\u00d7 ' + r.model.momentum_factor.toFixed(3) + '</span></div>' +
              '<div class="b-row"><span>Age factor (' + ageText(r.age_days) + ')</span><span>\u00d7 ' + r.model.age_factor.toFixed(3) + '</span></div>' +
              '<div class="b-row total"><span>Implied token value</span><span>' + moneyFull(r.implied_value_usd) + '</span></div>' +
            '</div>' +
            '<h3 style="margin-top:18px">The comparables behind the multiple</h3>' +
            (comps
              ? '<table class="comp-table"><thead><tr><th>Tokenized protocol</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>' + comps + '</tbody></table>'
              : '<p class="b-note">No protocol in this category has a token trading in the snapshot, so the global median multiple carries the price.</p>') +
          '</div>' +
          '<div>' +
            '<h3>The farm plan</h3>' +
            '<ol class="farm-list">' + steps + '</ol>' +
          '</div>' +
        '</div>' +
      '</article>';
    document.getElementById('back-btn').addEventListener('click', function () { location.hash = '#/'; });
  }

  // ------------------------------------------------------------- evidence panels
  document.getElementById('categories-table').innerHTML =
    '<table class="comp-table"><thead><tr><th>Category</th><th>Comps</th><th>Raw median</th><th>Working multiple</th></tr></thead><tbody>' +
    D.categories.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td>' + c.comps + '</td><td>' + c.raw_median.toFixed(3) + '\u00d7</td><td>' + c.multiple.toFixed(3) + '\u00d7</td></tr>';
    }).join('') + '</tbody></table>';

  document.getElementById('live-table').innerHTML =
    '<table class="comp-table"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>' +
    D.live.slice(0, 12).map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td>' + (p.multiple === null ? '—' : p.multiple.toFixed(2) + '\u00d7') + '</td></tr>';
    }).join('') + '</tbody></table>';

  route();
})();
