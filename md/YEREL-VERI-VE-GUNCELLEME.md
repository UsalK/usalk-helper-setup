# Yerel veri ve güncelleme

Uygulama kodu GitHub'dan güncellenir. Kullanıcının verileri kendi bilgisayarında
kalır. Mevcut `backend/db/database.db` ve `storage/` konumları değiştirilmemiştir.

## İlk açılışta oluşturulanlar

Sunucu başlarken eksik klasörler, `backend/.env`, veritabanı tabloları ve başlangıç
oran profilleri oluşturulur. Mevcut dosyalar ve kayıtlar korunur. Başlangıç
profilleri boş fiyat listeleri içerir; kullanıcı kendi fiyatlarını tanımlar.
Mağaza bağlantıları, anahtarlar, kişisel mockuplar ve başka kullanıcının ürünleri
başlangıç verisi olarak dağıtılmaz. `.env.example` yalnızca boş alan örnekleri içerir.

İsteğe bağlı elle oluşturma komutu (proje kökünden):

```sh
node backend/scripts/init-local-data.mjs
```

Bu komut sıfırlama veya yedekten dönme işlemi değildir. Normal sunucu açılışı da
aynı başlangıç işlemini yapar. Bağımlılıklar önceden kurulmuş olmalıdır.

## Kişisel dosyalar

| Yol | İçerik |
| --- | --- |
| `backend/db/database.db` ve varsa `-wal`, `-shm` yardımcıları | Asıl mağaza, ayar, ürün, şablon ve fiyat kayıtları |
| `backend/.env` | Yerel bağlantı bilgileri ve API anahtarları |
| `storage/` | Yüklenen eserler, şablon arka planları, mockuplar ve çıktılar |
| `backend/db/local-state/` | Yerel şablon/fiyat JSON çıktıları ve eski dosyaların kopyaları |
| `backend/db/agent-seo/` | Masaüstü agentı iş kuyruğu |
| `backups/`, `logs/`, `backend/scratch/` | Yerel yedekler, günlükler ve çalışma dosyaları |

Bu yollar Git dışında tutulur. `.gitignore` korumasını `git add -f` ile aşmayın.
`backend/db/db.js` ve `schema.sql` kişisel dosya değildir; uygulama koduyla güncellenir.
Kişisel dosyalar Docker imajına da dahil edilmemelidir; kalıcı yerel bağlamaları koruyun.

## Şablon ve fiyat kayıtları

Asıl kaynak veritabanıdır. Eskiden `backend/config/templates_seed.json` ve
`profiles_seed.json` dosyalarına yazılıp açılışta tekrar içeri alınan kişisel veriler,
artık `backend/db/local-state/templates.json` ve `profiles.json` altında dışa aktarılır.
Şablon/fiyat düzenlemeleri yerel çıktıları günceller; bunlar otomatik geri yüklenmez.
Böylece eski çıktı dosyası bir fiyatı ezmez veya silinen şablonu geri getirmez.
Bu JSON çıktıları tam veritabanı yedeğinin yerine geçmez.

Eski `config/*_seed.json` dosyaları mevcutsa ilk açılışta
`backend/db/local-state/legacy/` altına eksik olan kopyaları alınır. Orijinaller
silinmez, mevcut arşivler ezilmez. Bu dosyalardan otomatik mağaza/şablon içeri
aktarma yapılmaz. Yalnızca eski JSON dosyalarına sahip olup veritabanını kaybetmiş
kullanıcıların kontrollü, elle kurtarma yapması gerekir.

## Hâlihazırda kullananlar için ilk geçiş

1. Devam eden işlemleri tamamlayın, uygulamayı kapatın ve mevcut proje klasörünün
   tam yedeğini alın. Çalışan veritabanını sıradan dosya kopyasıyla yedeklemeyin.
2. Yeni kodu ayrı klasöre indirin. Mevcut klasörü silmeden kod dosyalarını
   güncelleyin; yukarıdaki kişisel yolları koruyun. Eski iki seed JSON dosyasını
   da bu ilk geçişte yedekleyin. Git güncellemesinde izlenmesi kaldırılan dosyalar
   diskte silinebileceği için bu yedek adımını atlamayın.
3. Yeni bağımlılık kilit dosyaları varsa backend/frontend içinde `npm ci` çalıştırın.
4. Normal başlatıcıyla uygulamayı açın. Yerel dosyalar yoksa oluşturulur;
   mevcut veritabanı yeniden oluşturulmaz, şema için gereken kod çalışır.
5. Mağaza bağlantıları, fiyatlar ve birkaç mockupu kontrol edin. Kontrol bitene
   kadar geçiş öncesi yedeği saklayın.

Bu değişiklik tek tık güncelleyici değildir; elle güncellemede kod ve kişisel
dosyaları ayıran altyapıdır. Uygulama klasörünü tamamen silip yeniden klonlamak
yerel verileri korumaz. `git clean -fdx` gibi yok sayılan dosyaları da silen
işlemleri kullanmayın.

## GitHub'a yayınlama

Kişisel seed dosyaları ve tespit edilen yerel raporlar Git takibinden çıkarılır;
diskte kalırlar. Bundan sonraki commit'lerde kod, boş ayar örneği ve genel başlangıç
oranları yer alır. Sırf `.gitignore` eklemek önceden izlenen dosyaları korumaz.

Bu düzenleme **önceki Git commit'lerinden veya GitHub geçmişinden veri silmez**.
Önceki sürümlerde yayımlanmış kişisel dosyalar geçmişte kalabilir; geçmiş temizliği
ayrı ve kullanıcılarla koordineli bir işlemdir. Bu değişiklik kendiliğinden commit,
push, Git geçmişi yeniden yazma veya mevcut kullanıcıların bilgisayarlarını güncelleme yapmaz.
