# Şablon Stüdyosu — devir notu

7 Eylül 2026 oturumunun özeti: yapılanlar, yarım kalanlar ve bir sonraki
oturumun koddan **çıkaramayacağı** bilgiler.

İlgili commit'ler: `253db25` (tanıma motoru) · `dba332d` (editör düzeni) ·
`b13ac5b` (önizleme inceleme modu) · `16b4caf` (küçük şablon büyütme)

---

## 1. Tamamlandı: mockup çıktısında minimum kısa kenar

7 Eylül devam oturumunda kullanıcı önceki küçültme kararını değiştirdi:
**Büyük şablonlar küçülmeyecek. Kısa kenar en az 2000 px olacak.**
Şablon dosyası yüklenirken orijinal boyutunda saklanır; mockup çağrıldığında
çıktı tuvali büyütülür ve eser bu çözünürlükte yerleştirilir. Etsy yükleme
yolu oluşan JPEG'i ayrıca boyutlandırmadan gönderir.

Backend (`backend/services/MockupRenderer.js`) ve Ürün Paneli
(`frontend/src/pages/BulkUpload.jsx`) bu kuralla hizalandı; düz, perspektif
ve statik şablonlar kapsanıyor. Shopify kullanıcının isteğiyle ertelendi,
ileride kaldırılacak.

- 1024×1024 → 2000×2000
- 1024×3072 → 2000×6000 (uzun kenar sınırı yok)
- 600×600 → 2000×2000 (2×/4× büyütme sınırı yok)
- 3000×3000 → 3000×3000

Yeni ayar: `mockup_min_short_edge_px`, varsayılan ve alt sınır 2000.
Eski `mockup_max_output_px` / `mockup_max_upscale` kayıtları artık okunmaz;
koordinat veya şablon dosyası migration'ı gerekmez. Ürün Paneli JPEG
kalitesini de mevcut `mockup_jpeg_quality` ayarından okur.

Boyut hesabı `backend/services/mockupOutput.js` ve
`frontend/src/utils/mockupOutput.js` içinde; birlikte güncellenmeli.
Perspektif eser ön-ölçeklemesi de yeni çıktı boyutunu esas alıyor.

Doğrulama (proje kökünden):
`node --experimental-test-module-mocks backend/scripts/mockupOutputTest.mjs`
Backend JPEG boyutları, orijinal dosyanın korunması, yerleşim, perspektif
kaynak çözünürlüğü ve Ürün Paneli'nin düz/statik üretim kodu kontrol edilir.
Frontend `npm run build` başarılı. Backend değişiklikten sonra yeniden başlatıldı.

> Not: backend `node server.js` ile çalışıyor, otomatik yenilemiyor.
> Backend değişikliklerinden sonra yeniden başlatmak gerekiyor.

---

## 2. Yeniden keşfedilmesin diye: doğrulanmış gerçekler

### Geometri çözünürlükten bağımsız — migration asla gerekmiyor
`placement` ve `corners` **0-1 normalize** saklanıyor. Çerçeve kalınlığı ve
gölge px cinsinden ama renderer bunları `scaleFactor = W / config.editorWidth`
ile ölçekliyor. `y7` şablonu 1000px ve 2000px'te render edilip aynı ölçeğe
getirildi: ortalama fark 1.14/255, çerçevede kayma yok. Yani çıktı
çözünürlüğü serbestçe değiştirilebilir.

### Şablonları diskte upscale edip saklamak KÖTÜ fikir
Kullanıcı önerdi, ölçüldü, reddedildi. t8 (1024px) üzerinde, ikisi de aynı
2000×2000 çıktıyı üretirken:

| | 1024 sakla, render'da büyüt | 2000 sakla, render'da 1:1 |
|---|---|---|
| Disk | 714 KB | 3964 KB (5.5x) |
| Decode (önbellek ıskası) | 10.3 ms | 38.8 ms (3.8x) |
| Render (ürün başına) | 83.6 ms | 84.4 ms |
| 260 MP önbelleğe sığan şablon | 247 | 65 |

Sebep: upscale ayrı bir geçiş değil. Tuval zaten 2000×2000 olmak zorunda,
`drawImage` 4M hedef piksel yazıyor; kaynağın 1024 mü 2000 mi olduğu bu
maliyeti değiştirmiyor. Pahalı işler (JPEG encode, warp) iki senaryoda aynı.
Ön-upscale ise `MockupRenderer.js`'teki LRU önbelleği kırıyor — o önbellek
zaten "SSD'yi %100'e kilitleyen" decode sorunu için yazılmıştı.

### Şablonların bir kısmı bomboş duvar — tanıma orada çalışamaz
`dd150`, `dd250`, `thumbLARGE1` gibi şablonlarda çerçeve/tuval yok; kullanıcı
duvarda keyfi bir dikdörtgen seçmiş. Dedektör bunlarda kasıtlı olarak hiçbir
aday üretmiyor ve arayüz "alan bulunamadı" deyip ortalanmış bir başlangıç
dörtgeni bırakıyor. **Bu bir hata değil.**

### Bazı kayıtlı koordinatlar dedektörden daha kötü
`y5`, `yy12`, `yy7` gibi şablonlarda kayıtlı alan eserin dışına taşıyor,
dedektör daha doğru buluyor. Doğruluk ölçerken "yer gerçeği" diye kayıtlı
config'e körü körüne güvenme.

---

## 3. Test araçları (repoda, `backend/` içinden çalıştır)

```bash
node scripts/mockupDetectTest.mjs 200          # 101 gerçek şablona karşı sayısal ölçüm
node scripts/mockupDetectTest.mjs 20 "" --v    # eleme sebepleriyle ayrıntılı
node scripts/mockupDetectContact.mjs           # görsel kontak sayfası (contact.png)
```

Kontak sayfasında: yeşil = kayıtlı alan, turuncu = 1. aday, mavi = diğer
adaylar. `LIMIT` ve `OFFSET` ortam değişkenleriyle örneklem değişir.

**Mevcut skor:** 101 benzersiz şablonda %74 kullanılabilir ilk aday (ortalama
köşe hatası < 0.06), %7 aday üretilmiyor (boş duvar), ortalama ~150 ms.
Bir değişiklikten sonra bu sayı düşerse geriye gidilmiş demektir.

---

## 4. Yapılmadı — sıradaki fikirler

**Tanıma motoru** (`frontend/src/utils/mockupDetect.js`)
- Çok panelli set şablonlarında paneller ayrı ayrı tanınıp `slots`'a
  dağıtılabilir. Motor zaten birden fazla aday döndürüyor; eksik olan,
  adayları sol/sağ panel olarak eşleştiren mantık.
- Kalan hataların çoğu "iç çerçeve mi dış çerçeve mi" farkı (0.03-0.09).
  İç/dış iki varyantı ayrı aday olarak sunmak kullanıcıya tek tıkla seçim
  verirdi.
- Tanıma ana iş parçacığında çalışıyor (~150 ms, `tick()` ile bölünmüş).
  Web Worker'a taşınabilir ama şu an gerek yok.

**Editör**
- Şablon **düzenleme** akışı yok, yalnızca oluşturma. Kayıtlı bir şablonun
  köşelerini düzeltmek için silip yeniden yüklemek gerekiyor.
- Düz modda tuvalin ortasına tıklamak paneli taşıyor, bu yüzden orada
  yakınlaştırma tıklaması çalışmıyor (perspektifte sorun yok). Bilinçli
  tercih: düzenleme kazanıyor.

**Bilinen tuhaflık**
- `frontend/src/utils/homography.js` ve `backend/services/homography.js` ayrı
  dosyalar; `panels.js` yorumunda da belirtildiği gibi ikisi birlikte
  güncellenmeli.
