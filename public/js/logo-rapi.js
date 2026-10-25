// Logo piagam: latar putih di sekeliling logo dibuat transparan (hanya yang tersambung ke tepi gambar,
// sehingga warna putih di dalam logo tetap), lalu tepi kosong dipangkas agar kedua logo tampak sama besar.
document.querySelectorAll('.piagam-kop img.logo-img').forEach(function (img) {
  var rapikan = function () {
    try {
      var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var data = x.getImageData(0, 0, c.width, c.height); var d = data.data;
      var W = c.width, H = c.height, putih = function (k) { return d[k + 3] < 16 || (d[k] > 235 && d[k + 1] > 235 && d[k + 2] > 235); };
      var lihat = new Uint8Array(W * H), antre = [];
      for (var t = 0; t < W; t++) { antre.push(t, (H - 1) * W + t); }
      for (var u = 0; u < H; u++) { antre.push(u * W, u * W + W - 1); }
      while (antre.length) {
        var p = antre.pop(); if (lihat[p]) continue; lihat[p] = 1;
        if (!putih(p * 4)) continue;
        d[p * 4 + 3] = 0;
        var px = p % W, py = (p - px) / W;
        if (px > 0) antre.push(p - 1); if (px < W - 1) antre.push(p + 1); if (py > 0) antre.push(p - W); if (py < H - 1) antre.push(p + W);
      }
      x.putImageData(data, 0, 0);
      var minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (var y = 0; y < c.height; y++) for (var i = 0; i < c.width; i++) {
        var k = (y * c.width + i) * 4;
        if (d[k + 3] > 16 && !(d[k] > 242 && d[k + 1] > 242 && d[k + 2] > 242)) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      if (maxX < 0) return;
      var o = document.createElement('canvas'); o.width = maxX - minX + 1; o.height = maxY - minY + 1;
      o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
      img.src = o.toDataURL('image/png');
    } catch (e) { /* biarkan logo apa adanya */ }
  };
  if (img.complete && img.naturalWidth) rapikan(); else img.addEventListener('load', rapikan, { once: true });
});
