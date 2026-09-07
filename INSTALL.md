# Usalk Helper — Kurulum ve eski sürümden geçiş

Bu rehber Windows içindir. Yeni kullanıcıysanız **1. bölümü**, hâlihazırda
Usalk Helper kullanıyorsanız **2. bölümü** uygulayın.

İndirme: https://github.com/UsalK/usalk-helper-setup

## 1. Yeni kullanıcılar: ilk kurulum

1. Bilgisayarınıza **Node.js 24 veya daha yeni bir sürümünü** kurun. Node.js
   kurulumundan sonra açık terminal pencerelerini kapatıp yeniden açın.
2. GitHub'da **Code → Download ZIP** seçeneğiyle indirin ve ZIP'i normal bir
   klasöre çıkarın. Dosyaları ZIP'in içinden çalıştırmayın.
3. Çıkardığınız proje klasöründeki **`install.bat`** dosyasına çift tıklayın.
   İnternet bağlantısı gerekir. Kurulum tamamlandı mesajını bekleyin; hata varsa
   hata mesajını çözmeden devam etmeyin.
4. **`run_hidden.vbs`** dosyasına çift tıklayın. Uygulama arka planda başlar ve
   tarayıcı açılır. Açılmazsa `http://localhost:5173` adresini ziyaret edin.
5. Kurulum Sihirbazı'nda kendi Etsy uygulama bilgilerinizi ve mağaza bağlantınızı
   tanımlayın. Etsy dönüş adresi, Etsy uygulamanızdaki kayıtla eşleşmelidir.
   Sihirbazda adımları tek tek veya **Hepsini atla** ile geçebilirsiniz; bu işlem
   eksik bağlantıları ve satış ayarlarını tamamlamaz.
6. Satış için kendi fiyatlarınızı, kargo/hazırlık profillerinizi ve mockup
   şablonlarınızı hazırlayın. Mağazanın statik açıklamasını ve bölümlerini kontrol edin.

Genel Ayarlar → Aktif AI Modeli altında **AI Agent (Masaüstü)** seçilirse OpenRouter
anahtarı gerekmez. Bir model seçilirse kendi OpenRouter anahtarınız gerekir.
Model seçimini kaydedin. Masaüstü agentını ayrıca çalıştırmanız gerekir.

İlk açılışta eksik veritabanı, yerel dosyalar ve klasörler oluşturulur. Başka bir
kullanıcının mağazası, anahtarları veya kişisel mockupları otomatik yüklenmez.

## 2. Mevcut kullanıcılar: verileri koruyarak yeni repoya geçiş

**Yeni ZIP'i eski proje klasörünün üzerine topluca çıkarmayın.** İlk geçişte
ayrı bir klasör kullanın; eski ve yeni kod dosyalarını karıştırmayın.

### A. Eski kurulumu kapatın ve yedekleyin

1. Devam eden yükleme, mockup ve agent işlerinin bitmesini bekleyin.
2. Eski klasördeki **`run_stop.vbs`** ile uygulamayı durdurun. Terminalden
   başlattıysanız ilgili backend ve frontend süreçlerini kapatın.
   Tarayıcı sekmesini kapatmak tek başına uygulamayı durdurmaz.
3. Eski proje klasörünün **tamamını** başka bir konuma kopyalayarak yedekleyin.
   Dosya kilitliyse veya kopyalama hatası olursa devam etmeyin. Veritabanı kopyalanırken
   uygulama kapalı kalmalıdır.

### B. Yeni klasörü hazırlayın ve kişisel dosyaları taşıyın

1. Yeni repoyu indirin ve **ayrı, boş bir klasöre** çıkarın.
2. **Henüz `install.bat` veya başlatıcıyı çalıştırmadan**, aşağıdaki dosyaları
   eski klasörden yenideki aynı göreli konumlara **kopyalayın**. Orijinalleri silmeyin.

| Eski klasörden kopyalanacak yol | İçerik |
| --- | --- |
| `backend/.env` | API anahtarları ve bağlantı ayarları |
| `backend/db/database.db` | Mağazalar, ürünler, ayarlar, fiyatlar, şablon tanımları |
| `backend/db/database.db-wal` ve `backend/db/database.db-shm` — varsa | Aynı veritabanına ait yardımcı dosyalar |
| `storage/` klasörünün tamamı | Orijinal görseller, şablon arka planları, mockuplar ve çıktılar |
| `backend/db/local-state/` — varsa | Yerel şablon/fiyat çıktıları ve eski dosya arşivleri |
| `backend/db/agent-seo/` — varsa | Agent istekleri ve sonuçları |

**`backend/db/` klasörünü bütünüyle kopyalamayın.** Yeni sürümdeki `db.js` ve
`schema.sql` kod dosyaları korunmalıdır. Eski `node_modules`, `frontend/dist`,
başlatıcılar veya `.git` klasörünü yeni kurulumun üzerine kopyalamayın.

`database.db` ile yardımcı dosyaları aynı kapatılmış kurulumdan alın; farklı
yedeklere ait dosyaları birleştirmeyin. İsteğe bağlı klasörler eski kurulumda yoksa
oluşturmanız gerekmez. Yeni uygulama eksikleri oluşturur.

Eski `backend/config/templates_seed.json` ve `profiles_seed.json` dosyalarını da
yedeğinizde saklayın. Yeni sürüm bu dosyaları otomatik içeri aktarmaz; normal geçişte
şablon ve fiyatların asıl kaynağı taşınan veritabanıdır. Yalnızca JSON dosyalarına
sahipseniz ve veritabanınız yoksa bu adımlar tam veri kurtarma sağlamaz.

### C. Kurun, açın ve kontrol edin

1. Node.js 24 veya daha yeni sürümün kurulu olduğundan emin olun.
2. **Yeni klasörde** `install.bat` çalıştırın. Bu işlem bağımlılıkları kurar ve
   eksik yerel dosyaları oluşturur; mevcut verileri sıfırlamaz.
3. Yeni klasördeki **`run_hidden.vbs`** ile uygulamayı açın.
4. Mağazaları, seçili mağazayı, fiyatları, kargo ayarlarını, açıklamayı ve birkaç
   şablon/mockupu kontrol edin. Yeni klasöre göre değişmesi gereken kullanıcıya
   özel dış dosya yolları varsa ilgili ayardan düzeltin. Yeni bilgisayara geçişte
   hosts/Node.js gibi bilgisayara özgü kurulum adımlarını ayrıca tamamlayın.
5. Her şey doğruysa masaüstü kısayolunuzu **yeni klasördeki `run_hidden.vbs`**
   dosyasına yönlendirin; durdurma kısayolunu da yeni `run_stop.vbs` dosyasına bağlayın.
   Eski kısayol kendiliğinden yeni sürüme geçmez.

Kontroller bitene kadar eski klasörü ve yedeği saklayın. **İki kurulumu aynı anda
çalıştırmayın.** Veriler eksik görünüyorsa yeni ürün yüklemeyin; yeni uygulamayı
kapatıp dosyaları doğru konuma kopyaladığınızı kontrol edin.

## 3. Günlük kullanım: hangi dosya ne işe yarıyor?

| Dosya | İşlev |
| --- | --- |
| **`install.bat`** | İlk kurulumda ve güncelleme sonrasında çalıştırılır. Her açılışta gerekmez. |
| **`run_hidden.vbs`** | Uygulamayı açar. Masaüstü kısayolu buna bağlanır. |
| **`run_stop.vbs`** | Uygulamayı durdurur. |
| `install.ps1` | `install.bat` tarafından kullanılan yardımcı dosya; silmeyin. |
| `start_hidden.ps1` | Başlatıcının kullandığı yardımcı dosya; silmeyin. |
| `stop_hidden.ps1` | Durdurucunun kullandığı yardımcı dosya; silmeyin. |

Eski `run_tray.vbs`, `start_tray.ps1` ve `start-docker.bat` başlatıcıları bu pakette
yer almaz. Docker kullanımı için [README'deki Docker bölümüne](README.md#docker) bakın.

## 4. Bu repoyu kullanmaya başladıktan sonraki güncellemeler

1. İşleri tamamlayın, uygulamayı kapatın ve kişisel dosyalarınızın yedeğini alın.
2. Bu repoyu Git ile klonladıysanız proje klasöründe `git pull --ff-only` çalıştırın.
   Yerel kod değişiklikleri nedeniyle hata alırsanız zorla üzerine yazmayın.
3. ZIP ile kurduysanız yeni sürümü ayrı klasöre çıkarıp 2. bölümdeki veri taşıma
   adımlarını uygulayın.
4. Güncel klasörde `install.bat`, ardından `run_hidden.vbs` çalıştırın ve kontrol edin.

Kişisel dosyalar Git dışında tutulur. Bu, proje klasörünü silmenin güvenli olduğu
anlamına gelmez. Yerel verileri de silebilen `git clean -fdx` gibi komutları kullanmayın.
Otomatik tek tık güncelleme sistemi henüz yoktur.

## 5. Sorun olursa

- Kurulum hatası: `install.bat` penceresindeki hata mesajını kontrol edin.
- Uygulama açılmıyor: `logs/backend.err.log`, `logs/frontend.err.log` ve
  `logs/hidden.log` dosyalarını inceleyin. Başka bir kurulumun çalışmadığını kontrol edin.
- Boş mağaza/veriler: yeni klasördeki veritabanı ve `storage/` konumlarını kontrol edin;
  boş veritabanını eski yedeğinizin üzerine kopyalamayın.
- Agent talimatı: yeni konumda “Agent talimatını kopyala” düğmesini yeniden kullanın;
  eski prompt eski klasör yolunu içeriyor olabilir.

Detaylı veri düzeni: [Yerel veri ve güncelleme](md/YEREL-VERI-VE-GUNCELLEME.md).
