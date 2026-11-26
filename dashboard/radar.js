// Launch Multiple Radar — the page's logic. Plain script, no imports, no network:
// every figure comes from window.RADAR, the data.js the entry's program writes
// beside this page. Board view, detail view and filters all render from it.
// The price every row states: implied = TVL x category multiple x momentum
// factor x age factor — the build-up is drawn stage by stage in renderDetail.
// The model's terms were not chosen by hand: validateModel in main.ts fits
// each candidate on half of the 128 tokenized comparables and measures its
// error on the held-out half, twice; renderValidation below prints that table.
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

  // ------------------------------------------- confidence and risk, from the row's own figures
  // A price is only as good as the comparables behind it. The grade and the flags
  // below are pure functions of fields every row already carries — no new data,
  // and neither moves a price: the validation table at the foot of the page is
  // computed from the fitted terms alone, grades and flags excluded.
  // confidence(row) — the evidence grade behind a price: A from 8+ tokenized
  // comparables in the row's category, B from 3 or more, C below that.
  function confidence(r) {
    var n = r.model.category_comparables;
    if (n >= 8) return { grade: 'A', label: 'Solid evidence', cls: 'conf-a' };
    if (n >= 3) return { grade: 'B', label: 'Fair evidence', cls: 'conf-b' };
    if (n >= 1) return { grade: 'C', label: 'Thin evidence', cls: 'conf-c' };
    return { grade: 'C', label: 'No direct comparables — priced on the global median', cls: 'conf-c' };
  }
  // riskFlags(row) — the warnings that fire on a row's own figures alone:
  // thin evidence, hard shrinkage, a momentum extreme, youth, one chain.
  function riskFlags(r) {
    var flags = [];
    var n = r.model.category_comparables;
    if (n === 0) flags.push({ short: 'No comparables', full: 'No tokenized comparable in its category — the global median carries this price' });
    else if (n <= 2) flags.push({ short: 'Thin evidence · ' + n + ' comp' + (n === 1 ? '' : 's'), full: 'Only ' + n + ' tokenized comparable' + (n === 1 ? '' : 's') + ' behind the category multiple' });
    var raw = r.model.category_raw_median, work = r.model.category_multiple;
    if (n > 0 && raw > 0 && (raw / work >= 1.8 || work / raw >= 1.8)) {
      flags.push({ short: 'Shrunk hard ' + raw.toFixed(2) + '\u00d7\u2192' + work.toFixed(2) + '\u00d7', full: 'Shrinkage moved the multiple hard: raw median ' + raw.toFixed(2) + '\u00d7 \u2192 working ' + work.toFixed(2) + '\u00d7' });
    }
    if (r.change_7d !== null && r.change_7d <= -15) flags.push({ short: 'TVL falling', full: 'TVL fell ' + Math.abs(r.change_7d).toFixed(1) + '% in 7 days — momentum is a headwind, not a tailwind' });
    if (r.change_7d !== null && r.change_7d >= 60) flags.push({ short: 'One hot week', full: 'TVL up ' + r.change_7d.toFixed(1) + '% in 7 days — one hot week may be incentive-driven; the model clamps it' });
    if (r.age_days !== null && r.age_days < 90) flags.push({ short: 'Very young', full: 'Very young: ' + r.age_days + ' tracked days with no token' });
    if (r.chains.length <= 1) flags.push({ short: 'Single chain', full: 'Single-chain footprint' + (r.chains.length === 1 ? ' (' + r.chains[0] + ')' : '') });
    return flags;
  }
  // verdictLine(row) — one sentence justifying the price: the multiple, the
  // comparables behind it, the 7-day TVL move and the protocol's age.
  function verdictLine(r) {
    var c = confidence(r);
    var bits = [];
    bits.push('Priced at ' + r.model.category_multiple.toFixed(2) + '\u00d7 TVL from ' +
      (r.model.category_comparables === 0 ? 'the global median (no direct comparables)' :
        r.model.category_comparables + ' tokenized comparable' + (r.model.category_comparables === 1 ? '' : 's')));
    if (r.change_7d !== null) bits.push('7-day TVL ' + (r.change_7d >= 0 ? 'grew ' : 'fell ') + Math.abs(r.change_7d).toFixed(1) + '%');
    bits.push(ageText(r.age_days));
    return c.label + '. ' + bits.join(' \u00b7 ') + '.';
  }

  // ------------------------------------------------------------- masthead and model strip
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  document.getElementById('masthead-stats').innerHTML =
    '<div class="mstat"><b>' + rows.length + '</b><span>protocols ranked</span></div>' +
    '<div class="mstat"><b>' + D.watchlist_size + '</b><span>on the watchlist</span></div>' +
    '<div class="mstat"><b>' + money(totalImplied) + '</b><span>combined implied value</span></div>' +
    '<div class="mstat"><b>' + D.as_of + '</b><span>snapshot date</span></div>';

  var m = D.model;
  var v = D.validation;
  var watchCount = rows.filter(function (r) { return r.on_watchlist; }).length;
  var compTotal = D.categories.reduce(function (a, c) { return a + c.comps; }, 0);
  var within2x = v ? Math.round(100 * v.shipped.splits.reduce(function (a, s) { return a + s.within_2x; }, 0) / v.shipped.splits.length) : 0;
  document.getElementById('model-strip').innerHTML =
    '<b>How this radar works.</b> ' +
    '<b>1 · Coverage.</b> ' + rows.length + ' pre-token protocols ranked from the snapshot of ' + D.as_of +
    ' (' + D.protocol_count + ' protocols at or above $5M TVL): all ' + watchCount + ' watchlist protocols, plus ' +
    (rows.length - watchCount) + ' early protocols below that floor. Every row states the implied value it is ranked by. ' +
    '<b>2 · The price.</b> <span class="formula">implied = TVL \u00d7 category multiple \u00d7 momentum factor \u00d7 age factor</span> ' +
    'The category multiple is the median market-cap / TVL of the category\u2019s tokenized protocols (' + compTotal +
    ' across all categories), winsorized to ' + m.mult_floor + '\u2013' + m.mult_ceil + ' and shrunk in log space toward the global median of ' +
    '<b>' + m.global_multiple.toFixed(3) + '</b> with a weight of ' + m.shrink_k + ' phantom observations; momentum reads the ' +
    '7-day TVL change (clamped to ' + m.momentum_clamp[0] + '%\u2026+' + m.momentum_clamp[1] + '%, weight ' + m.momentum_weight +
    ') and the age factor runs ' + m.age_base + '\u2013' + (m.age_base + m.age_span).toFixed(2) + ' over ' + m.age_full_days +
    ' tokenless days. No name is special-cased; open any protocol for its own arithmetic. ' +
    '<b>3 · Kept apart.</b> Protocols whose token already trades are never ranked here; they serve only as the ' +
    'comparables those multiples are learned from (the \u201cAlready trading\u201d panel below). ' +
    (v ? '<b>4 · Tested blind.</b> Those ' + v.comparables + ' comparables are the only ground truth the snapshot ' +
      'carries, so every value term was fitted on one half of them and its error measured on the held-out half, twice: ' +
      'held-out error fell from <b>' + v.legacy.male_mean.toFixed(3) + '</b> under the previous configuration to <b>' +
      v.shipped.male_mean.toFixed(3) + '</b> under this one, and ' + within2x + '% of held-out market caps were predicted ' +
      'within 2\u00d7. Each term was kept, re-tuned or shrunk on that evidence — the full table is at the foot of this page.' : '');

  document.getElementById('source-line').textContent =
    'Snapshot: ' + D.source + ' \u00b7 ' + D.protocol_count + ' protocols at or above $5M TVL \u00b7 watchlist floor ' + money(D.floor_usd) + '.';

  // ------------------------------------------------------------- highlights strip
  // Three entry points into the board, each computed from the rows themselves.
  (function renderInsights() {
    var byGrowth = rows.filter(function (r) { return r.rank <= 60 && r.change_7d !== null; })
      .slice().sort(function (a, b) { return b.change_7d - a.change_7d; })[0];
    var solid = rows.filter(function (r) { return r.model.category_comparables >= 8; })
      .slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; })[0];
    var thinCount = rows.filter(function (r) { return r.model.category_comparables <= 2; }).length;
    function card(kicker, r, line) {
      return '<button type="button" class="insight-card" data-slug="' + esc(r.slug) + '">' +
        '<span class="insight-kicker">' + kicker + '</span>' +
        '<span class="insight-name">' + esc(r.name) + ' <span class="insight-val">' + money(r.implied_value_usd) + '</span></span>' +
        '<span class="insight-line">' + line + '</span></button>';
    }
    document.getElementById('insights').innerHTML =
      card('Biggest launch candidate', rows[0],
        'Rank #1 \u00b7 ' + money(rows[0].tvl_usd) + ' TVL at a ' + rows[0].model.category_multiple.toFixed(2) + '\u00d7 category multiple') +
      (byGrowth ? card('Fastest riser in the top 60', byGrowth,
        '+' + byGrowth.change_7d.toFixed(1) + '% TVL in 7 days \u00b7 now rank #' + byGrowth.rank) : '') +
      (solid ? card('Strongest evidence on the board', solid,
        solid.model.category_comparables + ' tokenized comparables behind its ' + solid.model.category_multiple.toFixed(2) + '\u00d7 multiple \u00b7 ' + thinCount + ' of ' + rows.length + ' rows price on thin evidence instead') : '');
    Array.prototype.forEach.call(document.querySelectorAll('.insight-card'), function (c) {
      c.addEventListener('click', function () { location.hash = '#/p/' + c.getAttribute('data-slug'); });
    });
  })();

  // ------------------------------------------------------------- filters
  var el = {
    search: document.getElementById('f-search'),
    category: document.getElementById('f-category'),
    chain: document.getElementById('f-chain'),
    value: document.getElementById('f-value'),
    sort: document.getElementById('f-sort'),
    watch: document.getElementById('f-watch'),
    evidence: document.getElementById('f-evidence'),
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
      evidence: el.evidence.value,
    };
  }

  function visibleRows() {
    var f = currentFilters();
    var out = rows.filter(function (r) {
      if (f.watchOnly && !r.on_watchlist) return false;
      if (f.evidence === 'solid' && r.model.category_comparables < 3) return false;
      if (f.evidence === 'thin' && r.model.category_comparables > 2) return false;
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

  var topValue = rows.length ? rows[0].implied_value_usd : 1;
  function rowHtml(r) {
    var conf = confidence(r);
    var flags = riskFlags(r).slice(0, 2).map(function (f) {
      return '<span class="flag-chip" title="' + esc(f.full) + '">' + esc(f.short) + '</span>';
    }).join('');
    var barPct = Math.max(2, Math.round(100 * r.implied_value_usd / topValue));
    return '<button type="button" class="row-card board-grid rank-' + (r.rank <= 3 ? r.rank : 'x') + '" data-slug="' + esc(r.slug) + '">' +
      '<span class="rank-chip">' + r.rank + '</span>' +
      '<span class="p-name">' + esc(r.name) +
        (r.on_watchlist ? ' <span class="watch-badge">Watchlist</span>' : '') +
        ' <span class="conf-chip ' + conf.cls + '" title="' + esc(conf.label) + '">Evidence ' + conf.grade + '</span>' +
        '<span class="p-chains">' + esc(r.chains.slice(0, 3).join(' \u00b7 ') || 'chain unreported') + ' \u00b7 ' + ageText(r.age_days) + '</span>' +
        (flags ? '<span class="p-flags">' + flags + '</span>' : '') + '</span>' +
      '<span class="p-cat">' + esc(r.category || 'Uncategorized') + '</span>' +
      '<span class="num">' + money(r.tvl_usd) + '</span>' +
      '<span class="num">' + pct(r.change_7d) + '</span>' +
      '<span class="num">' + r.model.category_multiple.toFixed(2) + '\u00d7<small>' + r.model.category_comparables + ' comps</small></span>' +
      '<span class="num value-num">' + money(r.implied_value_usd) +
        '<span class="value-bar"><span style="width:' + barPct + '%"></span></span></span>' +
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
    [el.search, el.category, el.chain, el.value, el.sort, el.watch, el.evidence].forEach(function (c) {
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
    var maxMult = Math.max.apply(null, (r.comparables || []).map(function (c) { return c.multiple; }).concat([r.model.category_multiple, 0.01]));
    var comps = (r.comparables || []).map(function (c) {
      var w = Math.max(2, Math.round(100 * c.multiple / maxMult));
      return '<tr><td>' + esc(c.name) + '</td><td>' + money(c.tvl_usd) + '</td><td>' + money(c.mcap_usd) + '</td>' +
        '<td><span class="comp-bar"><span style="width:' + w + '%"></span></span>' + c.multiple.toFixed(2) + '\u00d7</td></tr>';
    }).join('');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var conf = confidence(r);
    var flags = riskFlags(r);
    // The price build-up, stage by stage: TVL, then x category multiple,
    // x momentum, x age — the last stage is the stated implied value.
    // Waterfall: each stage's value on a log scale, so a 0.67x and a 1.24x both stay visible.
    var stages = [
      { label: 'TVL alone', value: r.tvl_usd },
      { label: '\u00d7 category multiple ' + r.model.category_multiple.toFixed(3), value: r.tvl_usd * r.model.category_multiple },
      { label: '\u00d7 momentum ' + r.model.momentum_factor.toFixed(3), value: r.tvl_usd * r.model.category_multiple * r.model.momentum_factor },
      { label: '\u00d7 age ' + r.model.age_factor.toFixed(3) + ' = implied', value: r.implied_value_usd },
    ];
    var logMax = Math.log10(Math.max.apply(null, stages.map(function (s) { return s.value; })));
    var logMin = Math.log10(Math.min.apply(null, stages.map(function (s) { return s.value; }))) - 0.15;
    var waterfall = stages.map(function (s, i) {
      var w = Math.round(8 + 92 * (Math.log10(s.value) - logMin) / Math.max(0.01, logMax - logMin));
      return '<div class="wf-row' + (i === stages.length - 1 ? ' wf-total' : '') + '"><span class="wf-label">' + s.label + '</span>' +
        '<span class="wf-track"><span class="wf-fill" style="width:' + w + '%"></span></span>' +
        '<span class="wf-val">' + money(s.value) + '</span></div>';
    }).join('');
    el.detailView.innerHTML =
      '<button type="button" class="back-btn" id="back-btn">\u2190 Back to the board</button>' +
      '<article class="detail-card">' +
        '<h2>' + esc(r.name) + (r.on_watchlist ? ' <span class="watch-badge">Watchlist</span>' : '') + '</h2>' +
        '<p class="detail-sub">Rank #' + r.rank + ' of ' + rows.length + ' \u00b7 ' + esc(r.category || 'Uncategorized') +
          ' \u00b7 records no token in the snapshot \u00b7 tracked since ' + esc(r.listed_at || 'an unreported date') + '</p>' +
        '<p class="sep-line">' + (r.model.category_comparables > 0
          ? 'Kept apart: no token trades for ' + esc(r.name) + ' in this snapshot, so it stands here as a launch candidate. ' +
            'It is priced by ' + r.model.category_comparables + ' tokenized comparable' + (r.model.category_comparables === 1 ? '' : 's') +
            ' in ' + esc(r.category || 'Uncategorized') + ' (table below) \u2014 protocols that already trade are used as evidence only, and are ranked nowhere on this board.'
          : 'Kept apart: no token trades for ' + esc(r.name) + ' in this snapshot, and none trades in its category either, ' +
            'so the global median multiple carries its price \u2014 protocols that already trade are used as evidence only, and are ranked nowhere on this board.') + '</p>' +
        '<p class="verdict"><span class="conf-chip ' + conf.cls + '">Evidence ' + conf.grade + '</span> ' + esc(verdictLine(r)) + '</p>' +
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
                ' (raw median ' + r.model.category_raw_median.toFixed(3) + '), shrunk in log space toward the global median ' + D.model.global_multiple.toFixed(3) + ' with a weight of ' + D.model.shrink_k + '.</span></div>' +
              '<div class="b-row"><span>Momentum factor (7-day TVL)</span><span>\u00d7 ' + r.model.momentum_factor.toFixed(3) + '</span></div>' +
              '<div class="b-row"><span>Age factor (' + ageText(r.age_days) + ')</span><span>\u00d7 ' + r.model.age_factor.toFixed(3) + '</span></div>' +
              '<div class="b-row total"><span>Implied token value</span><span>' + moneyFull(r.implied_value_usd) + '</span></div>' +
            '</div>' +
            '<div class="waterfall" aria-label="Value build-up chart">' + waterfall + '</div>' +
            (flags.length
              ? '<div class="risk-box"><h4>Read the risk before you farm</h4><ul>' +
                flags.map(function (f) { return '<li>' + esc(f.full) + '</li>'; }).join('') + '</ul></div>'
              : '<div class="risk-box risk-ok"><h4>No flags on this record</h4><p>Enough comparables, no shrinkage shock, no momentum or age warning fires on this protocol\u2019s own figures.</p></div>') +
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
  var catMax = Math.max.apply(null, D.categories.map(function (c) { return c.multiple; }));
  document.getElementById('categories-table').innerHTML =
    '<table class="comp-table"><thead><tr><th>Category</th><th>Comps</th><th>Raw median</th><th>Working multiple</th></tr></thead><tbody>' +
    D.categories.map(function (c) {
      var w = Math.max(2, Math.round(100 * c.multiple / catMax));
      return '<tr><td>' + esc(c.category) + '</td><td>' + c.comps + '</td><td>' + c.raw_median.toFixed(3) + '\u00d7</td>' +
        '<td><span class="comp-bar"><span style="width:' + w + '%"></span></span>' + c.multiple.toFixed(3) + '\u00d7</td></tr>';
    }).join('') + '</tbody></table>';

  document.getElementById('live-table').innerHTML =
    '<table class="comp-table"><thead><tr><th>Protocol</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>' +
    D.live.slice(0, 12).map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td>' + money(p.tvl_usd) + '</td><td>' + money(p.mcap_usd) + '</td><td>' + (p.multiple === null ? '—' : p.multiple.toFixed(2) + '\u00d7') + '</td></tr>';
    }).join('') + '</tbody></table>';

  // ------------------------------------------------------------- validation panel
  // The ablation table validateModel computed in main.ts: the shipped model,
  // the previous round's model, and the shipped model with one term changed.
  // A change whose error sits above the shipped row's is a term the blind
  // tests voted to keep or re-tune; the delta column says by how much.
  (function renderValidation() {
    if (!v) return;
    var note = document.getElementById('validation-note');
    var host = document.getElementById('validation-table');
    if (!note || !host) return;
    var s0 = v.shipped.splits[0];
    note.textContent =
      'The ' + v.comparables + ' tokenized protocols are the only ground truth in the snapshot: each one\u2019s recorded ' +
      'market cap is what a model of this shape would have had to predict. Two blind splits (fixed seeds ' +
      v.shipped.splits.map(function (s) { return s.seed; }).join(' and ') + ') fitted every configuration on ' + s0.fit +
      ' of them and measured its error on the ' + s0.test + ' held out. Error is ' + v.metric + ': 0.30 is a typical ' +
      'miss of 2\u00d7, 1.00 is 10\u00d7. Multiples are a blunt instrument \u2014 the point of the table is that no term on ' +
      'this board is there on a hunch. The evidence grades and risk flags move no price; they describe the comparables ' +
      'behind a price, and they are not part of the fitted model these tests score.';
    function deltaCell(score, kind) {
      if (kind === 'shipped') return '<td>\u2014 the model on this board</td>';
      var d = score.male_mean - v.shipped.male_mean;
      if (kind === 'legacy') return '<td class="delta-worse">+' + d.toFixed(3) + ' worse than shipped</td>';
      if (Math.abs(d) <= 0.002) return '<td>\u2248 shipped (' + (d >= 0 ? '+' : '') + d.toFixed(3) + ')</td>';
      if (d > 0) return '<td class="delta-worse">+' + d.toFixed(3) + ' worse with this change</td>';
      return '<td class="delta-better">' + d.toFixed(3) + ' better \u2014 noted below</td>';
    }
    function row(score, kind) {
      var bold = kind === 'shipped';
      return '<tr>' + (bold ? '<td><b>' + esc(score.term) + '</b></td>' : '<td>' + esc(score.term) + '</td>') +
        '<td>' + esc(score.change) + '</td>' +
        '<td>' + score.splits.map(function (s) { return s.male.toFixed(3); }).join(' / ') + '</td>' +
        '<td>' + score.male_mean.toFixed(3) + '</td>' + deltaCell(score, kind) + '</tr>';
    }
    host.innerHTML =
      '<table class="comp-table"><thead><tr><th>Term</th><th>Change tested</th><th>Held-out error, split 1 / 2</th><th>Mean</th><th>Against the shipped model</th></tr></thead><tbody>' +
      row(v.shipped, 'shipped') + row(v.legacy, 'legacy') +
      v.ablations.map(function (a) { return row(a, 'ablation'); }).join('') +
      '</tbody></table>' +
      '<p class="panel-note">Reading it plainly: removing shrinkage costs +0.049 of error and the old weight +0.018, so ' +
      'shrinkage was kept and strengthened; the old age premium cost +0.007, so age was gentled to 0.95\u20131.05 \u2014 within ' +
      '0.002 of dropping it outright, which the table shows rather than hides. Momentum at either weight and the ' +
      'winsorize clamp are error-neutral (\u00b10.002): they stay at the smallest strength the tests allow, because a ' +
      'radar that ignored a protocol\u2019s week entirely would be claiming the week carries no information at all.</p>';
  })();

  route();
})();
