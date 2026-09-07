# Usalk Helper Setup

Etsy ve Shopify için yerel ürün, SEO ve mockup yönetimi. Bu depo temiz kurulum
kodunu içerir; başka kullanıcının mağaza bağlantılarını, anahtarlarını, veritabanını,
fiyat profillerini veya mockup görsellerini içermez.

## Windows kurulumu

1. Node.js 24 veya daha yeni bir sürümü kurun.
2. Bu depoyu **Code → Download ZIP** ile indirip normal bir klasöre çıkarın veya:

   ```sh
   git clone https://github.com/UsalK/usalk-helper-setup.git
   cd usalk-helper-setup
   ```

3. `install.bat` dosyasını çalıştırın. Bağımlılıklar kurulur; eksik yerel dosyalar
   oluşturulur. Mevcut veriler sıfırlanmaz.
4. `run_hidden.vbs` ile uygulamayı başlatın. Arayüz: `http://localhost:5173`.
5. Kurulum Sihirbazı'nda kendi Etsy uygulama bilgilerinizi ve mağazanızı bağlayın.
   OAuth dönüş adresi kendi Etsy uygulamanızdaki kayıtla eşleşmelidir. Adımlar elle
   geçilebilir; eksik satış bilgilerini ürün yayınlamadan önce tamamlayın.

Kapatmak için `run_stop.vbs` kullanın. Başlatma sorunu varsa `logs/` klasörünü inceleyin.

Terminalden çalıştırmak için iki ayrı terminalde, sırasıyla `backend` içinde
`npm start`, `frontend` içinde `npm run dev` çalıştırabilirsiniz.

## AI seçimi

Genel Ayarlar → Aktif AI Modeli:

- **AI Agent (Masaüstü):** İçeriği kendi masaüstü agentınız üretir. OpenRouter anahtarı
  gerekmez; agent uygulaması kendiliğinden açılmaz. “Agent talimatını kopyala” ile
  bu bilgisayardaki rehber yolunu agentınıza verin.
- **Bir model:** Seçili modele OpenRouter üzerinden istek gönderilir; kendi
  OpenRouter anahtarınızı yapılandırın.

Tam pipeline: [agent-help.md](agent-help.md).

## Veriler nerede?

| Yerel yol | İçerik |
| --- | --- |
| `backend/db/database.db` | Mağazalar, ürünler, ayarlar, fiyatlar, şablon tanımları |
| `backend/.env` | API anahtarları ve bağlantı yapılandırması |
| `storage/` | Eserler, şablon arka planları, mockuplar, çıktılar |
| `backend/db/local-state/` | Yerel şablon/fiyat JSON çıktıları |
| `backend/db/agent-seo/` | Agent istekleri ve sonuçları |

Bu yollar Git dışında tutulur. İlk açılış sadece eksikleri oluşturur. Hazır oran
profillerinin fiyatları boştur; kendi fiyatlarınızı, kargo profilinizi ve mockup
şablonlarınızı hazırlayın. Varsayılan öneri seçenekleri kişisel mağaza fiyatı değildir.

## Eski kurulumdan geçiş

Eski klasörü silmeyin. Çalışan işlemleri bitirip uygulamayı kapatın ve tam yedek alın.
Yeni repoyu ayrı klasöre indirin; **ilk açılıştan önce** kendi `backend/.env`,
`backend/db/database.db` (varsa yardımcı `-wal` / `-shm` dosyalarıyla birlikte),
`storage/`, varsa `backend/db/local-state/` ve `backend/db/agent-seo/` verilerinizi
aynı göreli konumlara kopyalayın. `backend/db/` klasörünü bütünüyle kopyalamayın;
içindeki yeni `db.js` ve `schema.sql` kod dosyaları korunmalıdır.

Eski `backend/config/templates_seed.json` ve `profiles_seed.json` dosyalarını
ayrıca yedekleyin. Yeni uygulama bunları otomatik olarak veritabanına uygulamaz.
Geçiş sonrası mağaza, fiyat ve örnek mockupları kontrol edin; eski kurulumu ve
yedeği doğrulama bitene kadar saklayın. İki kurulumu aynı anda çalıştırmayın.

## Sonraki güncellemeler

Uygulamayı kapatıp kişisel dosyalarınızı yedekleyin. Git ile kurduysanız kodu
`git pull --ff-only` ile güncelleyin. Yerel kod değişiklikleri çatışırsa zorla
üzerine yazmayın. Ardından `install.bat` çalıştırıp uygulamayı açın.

ZIP ile kurduysanız yeni kodu ayrı yere çıkarın, yukarıdaki kişisel yolları
koruyarak aktarın. Uygulama klasörünü tümden silmek veya `git clean -fdx`
çalıştırmak kişisel verileri korumaz. Tek tık otomatik güncelleyici henüz yoktur.

Ayrıntılar: [Yerel veri ve güncelleme](md/YEREL-VERI-VE-GUNCELLEME.md).

## Docker

Önce proje kökünde, **yalnızca dosya yoksa**, boş ayar örneğini oluşturun:

```powershell
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
docker compose up -d --build
```

Veritabanı, storage ve `.env` bilgisayardaki dosyalara bağlanır. Durdurmak için
`docker compose down` kullanılır. Yeni Docker sürümünü uygularken `--build` kullanın.
Docker içindeki dosya seçici masaüstünüzde dosya penceresi açamaz; görselleri web
arayüzünden yükleyin veya bağlanmış storage içindeki konteyner yollarını kullanın.

## Doğrulama

```sh
node --experimental-test-module-mocks --test backend/scripts/agentSeo.test.mjs backend/scripts/agentSeo.integration.test.mjs backend/scripts/seoModelRouting.test.mjs backend/scripts/localData.test.mjs
npm --prefix frontend run build
```

Uygulama yerel kullanım içindir. API portunu doğrudan internete açmayın.
