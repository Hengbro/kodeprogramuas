// Halaman cetak (rapor, piagam, dll.) berukuran kertas A4. Di layar sempit (HP orang tua) halaman diperkecil
// agar seluruh lebarnya terlihat tanpa geser ke samping. Saat dicetak, ukuran asli dipakai kembali.
(function () {
  function pas() {
    var hal = document.querySelectorAll('.page');
    if (!hal.length) return;
    hal.forEach(function (p) { p.style.zoom = ''; });
    var lebar = 0;
    hal.forEach(function (p) { lebar = Math.max(lebar, p.offsetWidth); });
    var ruang = document.documentElement.clientWidth - 12;
    if (!lebar || lebar <= ruang) return;
    var skala = Math.max(0.3, ruang / lebar);
    hal.forEach(function (p) { p.style.zoom = String(skala); });
  }
  function asli() { document.querySelectorAll('.page').forEach(function (p) { p.style.zoom = ''; }); }
  window.addEventListener('load', pas);
  window.addEventListener('resize', pas);
  window.addEventListener('beforeprint', asli);
  window.addEventListener('afterprint', pas);
  if (window.matchMedia) {
    var mq = window.matchMedia('print');
    if (mq.addEventListener) mq.addEventListener('change', function (e) { if (e.matches) asli(); else pas(); });
  }
  pas();
})();
