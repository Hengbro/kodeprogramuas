// logo dengan tepi kosong (mis. Tut Wuri Handayani) dipangkas agar kedua logo tampak sama besar
document.querySelectorAll('.piagam-kop img.logo-img').forEach(function (img) {
  var rapikan = function () {
    try {
      var c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      var x = c.getContext('2d'); x.drawImage(img, 0, 0);
      var d = x.getImageData(0, 0, c.width, c.height).data; var minX = c.width, minY = c.height, maxX = -1, maxY = -1;
      for (var y = 0; y < c.height; y++) for (var i = 0; i < c.width; i++) {
        var k = (y * c.width + i) * 4;
        if (d[k + 3] > 16 && !(d[k] > 242 && d[k + 1] > 242 && d[k + 2] > 242)) { if (i < minX) minX = i; if (i > maxX) maxX = i; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
      if (maxX < 0 || (maxX - minX + 1) * (maxY - minY + 1) > c.width * c.height * 0.97) return;
      var o = document.createElement('canvas'); o.width = maxX - minX + 1; o.height = maxY - minY + 1;
      o.getContext('2d').drawImage(c, minX, minY, o.width, o.height, 0, 0, o.width, o.height);
      img.src = o.toDataURL('image/png');
    } catch (e) { /* biarkan logo apa adanya */ }
  };
  if (img.complete && img.naturalWidth) rapikan(); else img.addEventListener('load', rapikan, { once: true });
});
