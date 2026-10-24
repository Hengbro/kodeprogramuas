(function () {
  'use strict';

  // Konfirmasi untuk tombol berbahaya
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.getAttribute('data-confirm'))) e.preventDefault();
  });

  // Tab / mapel yang aktif selalu terlihat walau barisnya perlu digeser (layar HP)
  document.querySelectorAll('.tabs a.active, .mapel-chips .chip.active').forEach(function (a) {
    var bar = a.parentNode;
    if (bar.scrollWidth > bar.clientWidth) bar.scrollLeft = a.offsetLeft - bar.offsetLeft - 16;
  });

  // Tombol "Acak": isi kata sandi acak yang kuat, tampilkan, dan salin ke clipboard
  var HURUF = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  function sandiAcak(n) {
    var buf = new Uint32Array(n || 12);
    for (;;) {
      window.crypto.getRandomValues(buf);
      var s = Array.prototype.map.call(buf, function (x) { return HURUF[x % HURUF.length]; }).join('');
      if (/[A-Z]/.test(s) && /[a-z]/.test(s) && /[2-9]/.test(s)) return s;
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-sandi-acak]');
    if (!b) return;
    var sel = b.getAttribute('data-sandi-acak');
    var inputs = sel ? Array.prototype.slice.call(document.querySelectorAll(sel)) : [b.parentNode.querySelector('input')];
    var s = sandiAcak(12);
    inputs.forEach(function (inp) {
      inp.type = 'text';
      inp.value = s;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    inputs[0].focus(); inputs[0].select();
    var tandai = function (teks) { b.textContent = teks; setTimeout(function () { b.textContent = 'Acak'; }, 2000); };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(s).then(function () { tandai('Disalin ✓'); }, function () { tandai('Catat!'); });
    else tandai('Catat!');
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

  // ===== Editor lingkup materi berisi TP =====
  var tpEd = document.querySelector('[data-tp-editor]');
  if (tpEd) {
    var tpTpl = document.querySelector('template[data-tp-template]').innerHTML;
    var lmTpl = document.querySelector('template[data-lm-template]').innerHTML;
    var noneBlock = tpEd.querySelector('.lm-none');
    var baru = 0;
    var refresh = function () {
      var blocks = Array.prototype.slice.call(tpEd.querySelectorAll('.lm-block:not(.lm-none)'));
      var opsi = blocks.map(function (b, i) {
        var nama = b.querySelector('.lm-row textarea').value.trim();
        return { key: b.getAttribute('data-key'), label: 'LM' + (i + 1) + (nama ? ' – ' + nama.slice(0, 24) : '') };
      });
      opsi.push({ key: '', label: 'Tanpa LM' });
      blocks.forEach(function (b, i) { b.querySelector('.lm-idx').textContent = 'LM' + (i + 1); });
      var n = 0;
      tpEd.querySelectorAll('.lm-block:not(.lm-none) .tp-row, .lm-none .tp-row').forEach(function (r) {
        n += 1;
        r.querySelector('.idx').textContent = 'TP' + n;
        var key = r.closest('.lm-block').getAttribute('data-key');
        r.querySelector('input[name=tp_lm]').value = key;
        var s = r.querySelector('.tp-move');
        s.innerHTML = opsi.map(function (o) { return '<option value="' + o.key + '"' + (o.key === key ? ' selected' : '') + '></option>'; }).join('');
        Array.prototype.forEach.call(s.options, function (op, j) { op.textContent = opsi[j].label; });
      });
    };
    // urutan TP di formulir = urutan tampil (LM1, LM2, …, lalu tanpa LM)
    tpEd.appendChild(noneBlock);
    tpEd.addEventListener('click', function (e) {
      var add = e.target.closest('[data-tp-add]');
      if (add) {
        var block = add.closest('.lm-block');
        var wrap = document.createElement('div');
        wrap.innerHTML = tpTpl.replace(/__KEY__/g, block.getAttribute('data-key'));
        block.querySelector('.tp-list').appendChild(wrap.firstElementChild);
        refresh(); dirty = true;
        block.querySelector('.tp-list .tp-row:last-child textarea').focus();
      }
      var rmTp = e.target.closest('[data-tp-remove]');
      if (rmTp) { rmTp.closest('.tp-row').remove(); refresh(); dirty = true; }
      var rmLm = e.target.closest('[data-lm-remove]');
      if (rmLm) {
        var b = rmLm.closest('.lm-block');
        b.querySelectorAll('.tp-row').forEach(function (r) { noneBlock.querySelector('.tp-list').appendChild(r); });
        b.remove(); refresh(); dirty = true;
      }
    });
    document.querySelector('[data-lm-add]').addEventListener('click', function () {
      baru += 1;
      var wrap = document.createElement('div');
      wrap.innerHTML = lmTpl.replace(/__KEY__/g, 'baru' + baru + '_' + Date.now());
      var block = wrap.firstElementChild;
      tpEd.insertBefore(block, noneBlock);
      refresh(); dirty = true;
      block.querySelector('textarea').focus();
    });
    tpEd.addEventListener('change', function (e) {
      if (!e.target.matches('.tp-move')) return;
      var row = e.target.closest('.tp-row');
      var target = e.target.value ? tpEd.querySelector('.lm-block[data-key="' + e.target.value + '"]') : noneBlock;
      if (target) target.querySelector('.tp-list').appendChild(row);
      refresh(); dirty = true;
    });
    tpEd.addEventListener('input', function (e) { if (e.target.matches('.lm-row textarea')) refresh(); });
    tpEd.addEventListener('input', function (e) { if (e.target.matches('textarea')) { e.target.style.height = 'auto'; e.target.style.height = (e.target.scrollHeight + 2) + 'px'; } });
    tpEd.querySelectorAll('textarea').forEach(function (x) { x.style.height = 'auto'; x.style.height = (x.scrollHeight + 2) + 'px'; });
    refresh();
  }

  // ===== Lembar isian seperti Excel (nilai, siswa, absensi, dll.) =====
  function sel(el) { return el.matches('input:not([type=hidden]):not([type=checkbox]), select, textarea'); }
  function cellsOf(row) { return Array.prototype.slice.call(row.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea')).filter(function (x) { return !x.closest('details:not([open])'); }); }

  // Tambah baris kosong (lembar dengan <template data-row-template>)
  function addRows(table, count) {
    var tpl = table.parentNode.querySelector('template[data-row-template]');
    var counter = table.closest('form').querySelector('[data-row-count]');
    if (!tpl || !counter) return;
    var tbody = table.tBodies[0];
    for (var k = 0; k < count; k++) {
      var i = Number(counter.value);
      var wrap = document.createElement('tbody');
      wrap.innerHTML = tpl.innerHTML.replace(/__I__/g, String(i)).replace(/__NO__/g, String(tbody.rows.length + 1));
      tbody.appendChild(wrap.firstElementChild);
      counter.value = i + 1;
    }
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-add-rows]');
    if (!b) return;
    var table = b.closest('form').querySelector('table[data-rows]');
    var before = table.tBodies[0].rows.length;
    addRows(table, Number(b.getAttribute('data-add-rows')) || 1);
    var first = table.tBodies[0].rows[before] && cellsOf(table.tBodies[0].rows[before])[0];
    if (first) first.focus();
  });

  function setCell(el, v) {
    if (el.tagName === 'SELECT') {
      var low = v.toLowerCase();
      var opt = Array.prototype.filter.call(el.options, function (o) { return o.value.toLowerCase() === low || o.text.trim().toLowerCase() === low; })[0] ||
        Array.prototype.filter.call(el.options, function (o) { return low && (o.value.toLowerCase().indexOf(low) === 0 || o.text.trim().toLowerCase().indexOf(low) === 0); })[0];
      if (opt) el.value = opt.value;
    } else {
      el.value = el.matches('input[data-kind], input[inputmode=decimal], input[inputmode=numeric]') ? v.replace(',', '.') : v;
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  document.querySelectorAll('table.sheet').forEach(function (sheet) {
    sheet.addEventListener('keydown', function (e) {
      var el = e.target;
      if (!sel(el) || el.tagName === 'TEXTAREA') return;
      var td = el.closest('td'); var tr = el.closest('tr');
      var col = Array.prototype.indexOf.call(tr.children, td);
      var move = null;
      var caretEnd = el.tagName === 'SELECT' || el.selectionStart == null || el.selectionStart === el.value.length;
      var caretStart = el.tagName === 'SELECT' || el.selectionStart == null || el.selectionStart === 0;
      if (e.key === 'Enter' || e.key === 'ArrowDown') move = [1, 0];
      else if (e.key === 'ArrowUp') move = [-1, 0];
      else if (e.key === 'ArrowRight' && caretEnd) move = [0, 1];
      else if (e.key === 'ArrowLeft' && caretStart) move = [0, -1];
      if (!move) return;
      if (el.tagName === 'SELECT' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return; // biarkan pilihan select
      e.preventDefault();
      if (move[0]) {
        var target = tr;
        do { target = move[0] > 0 ? target.nextElementSibling : target.previousElementSibling; } while (target && !target.children[col]);
        if (!target && move[0] > 0 && sheet.hasAttribute('data-rows')) { addRows(sheet, 1); target = tr.nextElementSibling; }
        var nextEl = target && target.children[col] && target.children[col].querySelector('input:not([type=hidden]), select, textarea');
        if (nextEl) { nextEl.focus(); if (nextEl.select) nextEl.select(); }
      } else {
        var list = cellsOf(tr); var i = list.indexOf(el) + move[1];
        if (list[i]) { list[i].focus(); if (list[i].select) list[i].select(); }
      }
    });

    // Tempel blok data dari Excel / Google Sheets (baris & kolom)
    sheet.addEventListener('paste', function (e) {
      var el = e.target;
      if (!sel(el) || el.tagName === 'TEXTAREA') return;
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!/[\t\n]/.test(text.replace(/\r?\n$/, ''))) return;
      e.preventDefault();
      var lines = text.replace(/\r/g, '').replace(/\n$/, '').split('\n');
      var tr = el.closest('tr');
      var startCol = cellsOf(tr).indexOf(el);
      lines.forEach(function (line) {
        if (!tr && sheet.hasAttribute('data-rows')) { addRows(sheet, 1); tr = sheet.tBodies[0].lastElementChild; }
        if (!tr) return;
        var list = cellsOf(tr);
        line.split('\t').forEach(function (v, j) { var t = list[startCol + j]; if (t) setCell(t, v.trim()); });
        if (typeof recalc === 'function') recalc(tr);
        tr = tr.nextElementSibling;
      });
      dirty = true;
      if (typeof simpanDraf === 'function') simpanDraf(false);
    });
  });

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
  // ===== Jangan sampai isian hilang saat koneksi putus =====
  var store = null;
  try { store = window.localStorage; store.getItem('x'); } catch (err) { store = null; }
  var KUNCI = 'draf:' + location.pathname + location.search;
  var draftForms = Array.prototype.slice.call(document.querySelectorAll('form[data-track]:not([data-no-draft]), #nilai-form'));

  function ambilIsian(f) {
    var out = {};
    Array.prototype.forEach.call(f.elements, function (el, i) {
      if (!el.name || el.name === '_csrf' || el.type === 'password' || el.type === 'file' || el.type === 'submit' || el.type === 'button') return;
      out[i + ':' + el.name] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    });
    return out;
  }
  function pasangIsian(f, isi) {
    Array.prototype.forEach.call(f.elements, function (el, i) {
      var k = i + ':' + el.name;
      if (!(k in isi)) return;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = isi[k]; else el.value = isi[k];
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  function simpanDraf(terkirim) {
    if (!store || !draftForms.length) return;
    try { store.setItem(KUNCI, JSON.stringify({ t: Date.now(), terkirim: !!terkirim, isi: draftForms.map(ambilIsian), baris: draftForms.map(function (f) { var c = f.querySelector('[data-row-count]'); return c ? Number(c.value) : 0; }) })); } catch (err) { /* penyimpanan penuh */ }
  }

  if (store) {
    // berhasil disimpan → buang draf yang sudah terkirim
    if (document.querySelector('.alert-success')) {
      try {
        Object.keys(store).forEach(function (k) {
          if (k.indexOf('draf:') !== 0) return;
          var d = JSON.parse(store.getItem(k) || '{}');
          if (d.terkirim) store.removeItem(k);
        });
      } catch (err) { /* abaikan */ }
    }
    var draf = null;
    try { draf = JSON.parse(store.getItem(KUNCI) || 'null'); } catch (err) { draf = null; }
    if (draf && draftForms.length && Date.now() - draf.t < 30 * 24 * 3600 * 1000) {
      var bar = document.createElement('div');
      bar.className = 'alert alert-error';
      bar.innerHTML = 'Ada isian di halaman ini yang <b>belum tersimpan</b> (' + new Date(draf.t).toLocaleString('id-ID') + '). ' +
        '<button type="button" class="btn btn-sm btn-primary" data-draf="pulihkan">Pulihkan isian</button> ' +
        '<button type="button" class="btn btn-sm btn-ghost" data-draf="buang">Buang</button>';
      draftForms[0].parentNode.insertBefore(bar, draftForms[0]);
      bar.addEventListener('click', function (e) {
        var b = e.target.closest('[data-draf]');
        if (!b) return;
        if (b.getAttribute('data-draf') === 'pulihkan') {
          draftForms.forEach(function (f, i) {
            var c = f.querySelector('[data-row-count]');
            var tbl = f.querySelector('table[data-rows]');
            if (c && tbl && draf.baris && draf.baris[i] > Number(c.value)) addRows(tbl, draf.baris[i] - Number(c.value));
            if (draf.isi[i]) pasangIsian(f, draf.isi[i]);
          });
          dirty = true;
          bar.className = 'alert alert-success';
          bar.textContent = 'Isian dipulihkan. Periksa lalu klik Simpan.';
        } else {
          try { store.removeItem(KUNCI); } catch (err) { /* abaikan */ }
          bar.remove();
        }
      });
    }
    var tunda = null;
    draftForms.forEach(function (f) {
      f.addEventListener('input', function () { clearTimeout(tunda); tunda = setTimeout(function () { simpanDraf(false); }, 800); });
      f.addEventListener('change', function () { clearTimeout(tunda); tunda = setTimeout(function () { simpanDraf(false); }, 800); });
    });
  }

  // Konfirmasi bila ada siswa yang dicentang untuk dihapus di lembar massal
  document.addEventListener('submit', function (e) {
    var n = e.target.querySelectorAll('input[name^="hapus__"]:checked').length;
    if (!n || e.target.getAttribute('data-hapus-ok') === String(n)) return;
    if (!window.confirm(n + ' siswa yang dicentang akan dihapus beserta seluruh nilainya. Lanjutkan?')) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    e.target.setAttribute('data-hapus-ok', String(n));
  }, true);

  // Sebelum mengirim, pastikan server bisa dihubungi; bila tidak, isian tetap di layar
  var sudahDicek = false;
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if ((f.getAttribute('method') || 'get').toLowerCase() !== 'post' || f.target || !window.fetch || !f.requestSubmit) return;
    if (draftForms.indexOf(f) >= 0) simpanDraf(true);
    if (sudahDicek) { sudahDicek = false; return; }
    e.preventDefault();
    var submitter = e.submitter || null;
    var btns = f.querySelectorAll('button, input[type=submit]');
    var ctrl = window.AbortController ? new AbortController() : null;
    var waktu = setTimeout(function () { if (ctrl) ctrl.abort(); }, 10000);
    fetch('/sehat', { cache: 'no-store', credentials: 'same-origin', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { if (!r.ok) throw new Error('status ' + r.status); })
      .then(function () {
        clearTimeout(waktu);
        sudahDicek = true;
        dirty = false;
        f.requestSubmit(submitter && submitter.form === f ? submitter : undefined);
      })
      .catch(function () {
        clearTimeout(waktu);
        var old = document.getElementById('putus-koneksi');
        if (old) old.remove();
        var msg = document.createElement('div');
        msg.id = 'putus-koneksi';
        msg.className = 'alert alert-error';
        msg.style.cssText = 'position:fixed;left:16px;right:16px;bottom:16px;z-index:999;box-shadow:0 6px 24px rgba(0,0,0,.2)';
        msg.innerHTML = '<b>Koneksi ke server terputus.</b> Data belum tersimpan, tetapi isian Anda masih aman di halaman ini. ' +
          'Jangan tutup halaman; tunggu sebentar lalu klik Simpan lagi.';
        document.body.appendChild(msg);
        setTimeout(function () { msg.remove(); }, 15000);
        Array.prototype.forEach.call(btns, function (b) { b.disabled = false; });
        if (draftForms.indexOf(f) >= 0) dirty = true;
      });
  });
})();
