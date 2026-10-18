(function () {
  'use strict';

  // Konfirmasi untuk tombol berbahaya
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
  });

  // Tutup sidebar saat klik di luar (mobile)
  document.addEventListener('click', function (e) {
    var sb = document.getElementById('sidebar');
    if (sb && sb.classList.contains('open') && !sb.contains(e.target) && !e.target.closest('.menu-btn')) sb.classList.remove('open');
  });

  // Textarea tumbuh otomatis
  function autosize(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  document.querySelectorAll('.list-editor textarea, textarea[data-autosize]').forEach(autosize);
  document.addEventListener('input', function (e) {
    if (e.target.matches('.list-editor textarea, textarea[data-autosize]')) autosize(e.target);
  });

  // Editor daftar TP / LM
  function renumber(list) {
    var prefix = list.getAttribute('data-list').toUpperCase();
    list.querySelectorAll('.row .idx').forEach(function (s, i) { s.textContent = prefix + (i + 1); });
  }
  document.addEventListener('click', function (e) {
    var add = e.target.closest('[data-add]');
    if (add) {
      var key = add.getAttribute('data-add');
      var list = document.querySelector('[data-list="' + key + '"]');
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="idx"></span><input type="hidden" name="' + key + '_id" value=""><textarea name="' + key + '" rows="1"></textarea><button type="button" class="btn btn-sm btn-ghost" data-remove title="Hapus">✕</button>';
      list.appendChild(row);
      renumber(list);
      row.querySelector('textarea').focus();
    }
    var rm = e.target.closest('[data-remove]');
    if (rm) {
      var l = rm.closest('[data-list]');
      rm.closest('.row').remove();
      renumber(l);
    }
  });

  // Peringatan perubahan belum disimpan
  var dirty = false;
  document.querySelectorAll('form[data-track], #nilai-form').forEach(function (f) {
    f.addEventListener('input', function () { dirty = true; });
    f.addEventListener('submit', function () { dirty = false; });
  });
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ===== Lembar nilai (spreadsheet) =====
  var sheet = document.querySelector('table.sheet');
  if (sheet) {
    var inputs = function (row) { return Array.prototype.slice.call(row.querySelectorAll('input:not([type=hidden]), select.level')); };
    sheet.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!el.matches('input, select.level')) return;
      var td = el.closest('td'); var tr = el.closest('tr');
      var col = Array.prototype.indexOf.call(tr.children, td);
      var move = null;
      if (e.key === 'Enter' || e.key === 'ArrowDown') move = [1, 0];
      else if (e.key === 'ArrowUp') move = [-1, 0];
      else if (e.key === 'ArrowRight' && (el.tagName === 'SELECT' || el.selectionStart === el.value.length)) move = [0, 1];
      else if (e.key === 'ArrowLeft' && (el.tagName === 'SELECT' || el.selectionStart === 0)) move = [0, -1];
      if (!move) return;
      if (el.tagName === 'SELECT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return; // biarkan pilihan select
      e.preventDefault();
      if (move[0]) {
        var target = tr;
        do { target = move[0] > 0 ? target.nextElementSibling : target.previousElementSibling; } while (target && !target.children[col]);
        var nextEl = target && target.children[col] && target.children[col].querySelector('input, select');
        if (nextEl) { nextEl.focus(); if (nextEl.select) nextEl.select(); }
      } else {
        var list = inputs(tr); var i = list.indexOf(el) + move[1];
        if (list[i]) { list[i].focus(); if (list[i].select) list[i].select(); }
      }
    });

    // Tempel blok nilai dari Excel / Google Sheets
    sheet.addEventListener('paste', function (e) {
      var el = e.target;
      if (!el.matches('input[data-kind]')) return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.trim())) return;
      e.preventDefault();
      var lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      var tr = el.closest('tr');
      var startCol = inputs(tr).indexOf(el);
      lines.forEach(function (line) {
        if (!tr) return;
        var cells = line.split('\t');
        var list = inputs(tr);
        cells.forEach(function (v, j) { var t = list[startCol + j]; if (t && t.matches('input[data-kind]')) t.value = v.trim().replace(',', '.'); });
        recalc(tr);
        tr = tr.nextElementSibling;
      });
      dirty = true;
    });
  }

  // Perhitungan langsung (mengikuti rumus server)
  var cfgEl = document.getElementById('calc-settings');
  var cfg = cfgEl ? JSON.parse(cfgEl.textContent) : null;
  var form = document.getElementById('nilai-form');
  var kktp = form ? Number(form.getAttribute('data-kktp')) : 0;

  function val(input) {
    var s = String(input.value).trim().replace(',', '.');
    if (s === '') return null;
    var n = Number(s);
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
  }
  function avg(arr) { var a = arr.filter(function (x) { return x !== null; }); return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function fmt(n) { return n === null ? '' : (Math.round(n * 10) / 10).toLocaleString('id-ID', { maximumFractionDigits: 1 }); }
  function predikat(n) {
    var list = cfg.predikat.slice().sort(function (a, b) { return b.min - a.min; });
    for (var i = 0; i < list.length; i++) if (n >= list[i].min) return list[i];
    return list[list.length - 1];
  }
  function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function kalimat(subjek, frasa, tp) {
    var t = frasa + ' ' + lcFirst(String(tp).trim().replace(/[.\s]+$/, '')) + '.';
    return subjek ? subjek + ' ' + t : t.charAt(0).toUpperCase() + t.slice(1);
  }

  function recalc(tr) {
    if (!cfg || !tr.dataset.student) return;
    var f = []; var s = []; var as = []; var tps = [];
    tr.querySelectorAll('input[data-kind]').forEach(function (inp) {
      var v = val(inp);
      inp.classList.toggle('low', v !== null && v < kktp);
      if (inp.dataset.kind === 'f') { f.push(v); tps.push({ id: Number(inp.dataset.tp), nilai: v }); }
      else if (inp.dataset.kind === 's') s.push(v);
      else as.push(v);
    });
    var F = avg(f); var S = avg(s); var AS = avg(as);
    var total = 0; var bagi = 0;
    if (F !== null) { total += cfg.bobot.f * F; bagi += cfg.bobot.f; }
    if (S !== null) { total += cfg.bobot.s * S; bagi += cfg.bobot.s; }
    if (AS !== null) { total += cfg.bobot.as * AS; bagi += cfg.bobot.as; }
    var NA = bagi ? Math.round(total / bagi + 1e-9) : null;
    var out = function (k) { return tr.querySelector('[data-out="' + k + '"]'); };
    out('f').textContent = fmt(F); out('s').textContent = fmt(S); out('as').textContent = fmt(AS);
    out('na').textContent = NA === null ? '' : NA;
    out('pred').textContent = NA === null ? '' : predikat(NA).label;
    var hi = null; var lo = null;
    tps.forEach(function (t) { if (t.nilai === null) return; if (!hi || t.nilai > hi.nilai) hi = t; if (!lo || t.nilai < lo.nilai) lo = t; });
    var desc = '';
    if (hi) {
      var tpText = function (id) { var x = cfg.tp.filter(function (t) { return t.id === id; })[0]; return x ? x.deskripsi : ''; };
      var subjek = cfg.desk_nama === '1' ? tr.dataset.panggilan : '';
      var pakaiPred = cfg.desk_mode !== 'sederhana';
      desc = kalimat(subjek, pakaiPred ? predikat(hi.nilai).kalimat : cfg.kalimat_tinggi, tpText(hi.id));
      if (lo && lo.id !== hi.id) desc += ' ' + kalimat(subjek, pakaiPred ? predikat(lo.nilai).kalimat : cfg.kalimat_rendah, tpText(lo.id));
    }
    out('desk').textContent = desc;
  }

  if (form && cfg) {
    form.addEventListener('input', function (e) { var tr = e.target.closest('tr'); if (tr) recalc(tr); });
    form.querySelectorAll('tbody tr').forEach(recalc);
  }

  // Pewarnaan level P5
  document.querySelectorAll('select.level').forEach(function (s) {
    var paint = function () { s.className = 'level lvl-' + (s.value || '0'); };
    s.addEventListener('change', paint); paint();
  });

  // Isi kolom massal (mis. semua siswa sama)
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fill]');
    if (!b) return;
    var src = document.querySelector(b.getAttribute('data-fill'));
    var sel = b.getAttribute('data-target');
    document.querySelectorAll(sel).forEach(function (el) {
      if (b.hasAttribute('data-only-empty') && el.value) return;
      el.value = src.value; el.dispatchEvent(new Event('change'));
    });
    dirty = true;
  });
})();
