import axios from 'axios';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import db, { getActiveShop } from '../db/db.js';
import { Jimp } from 'jimp';
import { v4 as uuidv4 } from 'uuid';
import { AGENT_MODEL, requestAgentSEO } from './AgentSEOService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/* ------------------------------------------------------------------ */
/* Sanatçı/marka adı politikası                                        */
/* ------------------------------------------------------------------ */
/*
 * İki katman var, çünkü "sanatçı adı" tek bir risk sınıfı değil:
 *
 *  - blocked: telifi süren sanatçılar, adını aktif koruyan mirasçılar ve
 *    tescilli markalar. Her alandan silinir.
 *
 *  - publicDomain: ölümü 1950 öncesi sanatçılar. Bunları silmek net SEO
 *    kaybıydı — "Klimt" aranan bir terim ve eser gerçekten o tarzda.
 *    Ad korunur; sadece title/tags içinde "X Style" biçimine çevrilir.
 *
 * "X Style" ekinin sebebi: kamu malı olmak eseri çoğaltma hakkı verir ama
 * çıplak sanatçı adı, eser o sanatçıya ait değilken Etsy'de yanıltıcı etiket
 * sayılabiliyor. "Klimt Style" tanımlayıcı, "Gustav Klimt" sahiplik iddiası.
 * visual_style ve description'da bu risk yok, orada ad olduğu gibi kalır.
 */
const policyPath = join(__dirname, '../config/artistPolicy.json');
let blockedPatterns = [];
let publicDomainPatterns = [];

try {
  if (fs.existsSync(policyPath)) {
    const parsed = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    blockedPatterns = (parsed.blocked || []).map(item => ({
      pattern: new RegExp(item.pattern, 'gi'),
      replacement: item.replacement
    }));
    publicDomainPatterns = (parsed.publicDomain || []).map(item => ({
      pattern: new RegExp(item.pattern, 'gi'),
      canonical: item.canonical,
      style: item.style
    }));
  } else {
    console.error(`[ArtistPolicy] Config bulunamadı: ${policyPath} — sanatçı filtresi DEVRE DIŞI.`);
  }
} catch (err) {
  console.error('[ArtistPolicy] Config okunamadı, sanatçı filtresi DEVRE DIŞI:', err.message);
}

/*
 * Prompt'ta modele örnek olarak verilecek kamu malı sanatçı adları.
 * Config'de her sanatçı iki kez geçiyor (tam ad + soyad kalıbı); listede ikisi de
 * görünürse model "Vincent Van Gogh, Van Gogh" gibi anlamsız bir tekrar okuyor.
 * Başka bir adın içinde geçen kısa formlar eleniyor, tam adlar kalıyor.
 */
const PUBLIC_DOMAIN_NAMES = (() => {
  const all = [...new Set(publicDomainPatterns.map(p => p.canonical).filter(Boolean))];
  return all.filter(name => !all.some(other => other !== name && other.includes(name)));
})();

// Kamu malı ad zaten "Style"/"Inspired" ile nitelenmişse ikinci kez eklemeyiz.
const ALREADY_QUALIFIED = /^\s*(style|styled|inspired|inspiration|esque|era|period)\b/i;

/*
 * Modelin tarzı hiç yazmamasının sebebi sanitizeText değil, prompt'taki tek
 * satırlık "Do not mention specific artist/brand names" emriydi: model bunu
 * "sanatçıyla ilişkilendirilebilecek hiçbir şey yazma" diye okuyup akım adını
 * da atlıyordu. Artık izin verilen ile yasak olan ayrı ayrı söyleniyor.
 * sanitizeText yine de son savunma hattı olarak duruyor — prompt'a güvenmiyoruz.
 */
export const ARTIST_POLICY_PROMPT = `

ARTIST & STYLE NAMING (read carefully, this is not a blanket ban):
- You MUST name the art movement, period or technique the artwork is actually painted in. A missing or vague style is a failure.
- You MAY name a PUBLIC-DOMAIN artist (died before 1950) when the piece genuinely echoes their style${PUBLIC_DOMAIN_NAMES.length ? ` — e.g. ${PUBLIC_DOMAIN_NAMES.slice(0, 12).join(', ')}` : ''}. In title and tags phrase it as "<Artist> Style" or "<Artist> Inspired"; never claim the piece IS by them.
- You MUST NOT name any artist who died after 1950 or is still living (Picasso, Dali, Warhol, Lichtenstein, Basquiat, Kusama, Banksy, Rothko, Kahlo, O'Keeffe, Hopper, Chagall, Magritte). Name their movement instead — "Cubist", "Surrealist", "Pop Art".
- You MUST NOT name any brand, franchise or character (Disney, Marvel, Ghibli, Pokemon, Nike, Gucci).

DEPICTED SUBJECT IS NOT STYLE — the rules above are about whose STYLE the piece imitates. If the artwork PICTURES a recognisable public-domain person (a historical figure, a mythological character, or a public-domain painter's own face, e.g. a Van Gogh self-portrait restyled as a mosaic), you MUST name that person in depicted_subject, in the title, in the tags and in the description. Saying "a legendary master", "iconic painter", "artist portrait" or "famous figure" instead of the actual name throws away the single highest-value keyword on the listing. Naming who is pictured is a descriptive fact, not a claim of authorship, so the "<Artist> Style" phrasing does NOT apply here — write "Van Gogh Portrait", not "Van Gogh Style Portrait".`;

/*
 * Sanatçı/marka politikası bu üç riski kapsamıyordu ve 2026'da üçü de gerçekleşti:
 * 09.05 "Mexico City 1968" (Counterfeit Goods), 08.06 "Vintage Tokyo Travel Poster"
 * (IP Policy), 31.08 "Persian Pottery Still Life" (Seller Policy). Üçünde de itiraz
 * hakkı verilmedi, yani düzeltme şansı yok — tek savunma üretim anında engellemek.
 *
 * artistPolicy.json'daki blocked listesi bu kelimeleri son anda yine siliyor, ama
 * regex "Mexico City 1968" gibi şehir+yıl kombinasyonunu yakalayamaz; onu sadece
 * model anlayabilir. İki katman bu yüzden birbirinin yedeği değil, tamamlayıcısı.
 */
export const LISTING_COMPLIANCE_PROMPT = `

MARKETPLACE COMPLIANCE (this shop lost three listings to the rules below, with no right of appeal — treat them as hard limits, not preferences):

1) RESTRICTED ORIGINS. Never write Persian, Iran, Iranian, Isfahan, Tabriz, Kashan, Cuba, Cuban, Havana, Syria, Syrian, Damascus, Crimea, North Korea or Pyongyang in any field. Automated origin screening reads these as a physical import from a sanctioned country and removes the listing even when the item is obviously a painting. Name the visual language instead: Moorish, Ottoman, Andalusian, Arabesque, Islamic Geometric, Middle Eastern, Levantine, Tropical Retro.

2) REAL NAMED EVENTS. Never name an actual competition, games, tournament, exposition or festival, and never pair a real city with a specific year in a way that identifies one real event ("Mexico City 1968", "Munich 1972"). Olympics, Olympiad, Grand Prix, Formula 1, World Cup, Super Bowl, Wimbledon, Tour de France and World's Fair are protected marks and their organisers run active takedown programmes. Write the generic activity: Retro Athletics Poster, Vintage Motorsport Art, Retro Football Illustration. A decade or an era is safe ("1960s", "Mid-Century"); a specific event year attached to a host city is not.

3) TRANSPORT & TRAVEL BRANDS. Vintage travel posters are the highest-risk category in this shop. Never name an airline, railway, cruise line, hotel chain or tourism board (Pan Am, TWA, BOAC, Japan Airlines, Orient Express, Cunard, Michelin). A city, country or landmark on its own is fine — "Tokyo Travel Poster" is safe, "JAL Tokyo Poster" is not.

4) THE DEPICTED OBJECT IS NOT THE PRODUCT. What is sold is always a printed artwork; the pot, lamp or rug inside the image is only subject matter. Never let a title or tag read as an offer of that object: "persian pottery", "antique ceramic vase" and "vintage brass lamp" all describe a collectible for sale and get classified as one. Keep every phrase anchored to the depiction — "ceramic vase artwork", "pottery still life art", "brass lamp illustration". Never call the depicted object antique, authentic, genuine, original, handmade or an artifact.`;

// Modelin "yok" demesinin tüm biçimleri; boş konu alanını isim sanmamak için.
const EMPTY_SUBJECT = /^(none|no|n\/a|na|null|nil|unknown|generic|anonymous|unnamed|invented|fictional|not applicable)\.?$/i;

/**
 * depicted_subject alanını güvenli bir isme çevirir.
 *
 * Telifli bir isim gelirse alan tamamen düşürülür: blocked kuralı "Frida Kahlo"yu
 * "Mexican Folk Surrealist"e çevirir ve bu, bir tarz terimi olarak doğru ama
 * "resmedilen kişi" olarak saçmadır — başlığa "Mexican Folk Surrealist Portrait"
 * yazmaktansa alanı hiç kullanmamak daha iyi.
 */
function resolveDepictedSubject(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim().replace(/^["']|["']$/g, '');
  if (!trimmed || EMPTY_SUBJECT.test(trimmed)) return '';

  let afterBlocked = trimmed;
  for (const { pattern, replacement } of blockedPatterns) {
    afterBlocked = afterBlocked.replace(pattern, replacement);
  }
  if (afterBlocked !== trimmed) {
    console.warn(`[Depicted Subject] "${trimmed}" telifli/markalı — alan düşürüldü.`);
    return '';
  }

  return sanitizeText(trimmed, 'visual_style');
}

/**
 * Metin, resmedilen konuyu zaten anıyor mu?
 *
 * Düz string araması yetmiyor: konu "Vincent Van Gogh" iken model başlığa
 * "Van Gogh Portrait" yazmış olabilir. Tam ad aranırsa eşleşmez ve başlığa
 * ikinci kez enjekte edilir — hem yer israfı hem de Etsy'nin kelime tekrarı
 * kuralının ihlali. O yüzden ismin kısa formları da kabul ediliyor.
 */
function mentionsDepictedSubject(text, subject, canonicals) {
  const lower = text.toLowerCase();
  if (lower.includes(subject.toLowerCase())) return true;
  for (const name of canonicals) {
    if (lower.includes(name.toLowerCase())) return true;
  }
  return false;
}

/** Metinde geçen kamu malı sanatçıların canonical adları. */
function publicDomainCanonicalsIn(text) {
  const found = new Set();
  if (!text) return found;
  for (const { pattern, canonical } of publicDomainPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) found.add(canonical);
    pattern.lastIndex = 0;
  }
  return found;
}

/** visual_style alanı sansürsüz — tek kuralı somut olmak. İki prompt da bunu kullanır. */
const VISUAL_STYLE_SPEC = "1 to 3 CONCRETE art style tags. This field is NOT censored and must never be vague: name the movement, period or technique the artwork is genuinely painted in, e.g. 'Vienna Secession', 'Art Nouveau', 'Post-Impressionist', 'Ukiyo-e', 'Bauhaus', 'De Stijl', 'Art Deco', 'Mid-Century Modern', 'Gold Leaf Mosaic', 'Baroque Chiaroscuro', 'Byzantine Mosaic'. Vague answers like 'Modern', 'Beautiful', 'Colorful', 'Wall Art', 'Painting', 'Artistic' are FAILURES. If the piece clearly echoes a public-domain artist you may name them here directly (e.g. 'Gustav Klimt'). Never return an empty list.";

/**
 * Alan tipine göre sanatçı/marka adı temizliği.
 *
 * @param {string} text
 * @param {'title'|'tags'|'description'|'visual_style'|'attribute'} field
 *        visual_style ve description kamu malı adları olduğu gibi bırakır;
 *        title ve tags "X Style" biçimine çevirir. blocked her alanda silinir.
 */
/**
 * Etsy tag'lerinde virgül kullanilamaz: API'ye tag listesi virgulle birlestirilmis
 * tek bir string olarak gidiyor, dolayisiyla tag icindeki virgul ayirici sayilir.
 * Virgulu bosluga cevirip bosluklari sadelestiriyoruz ki ifade bozulmadan kalsin.
 */
export function stripTagCommas(tag) {
  if (typeof tag !== 'string') return '';
  return tag.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sanitizeText(text, field = 'title', opts = {}) {
  if (typeof text !== 'string') return '';
  let sanitized = text;

  // 1) Telifli/markalı adlar: her alanda koşulsuz değiştirilir.
  for (const { pattern, replacement } of blockedPatterns) {
    sanitized = sanitized.replace(pattern, replacement);
  }

  // 2) Kamu malı adlar: korunur, sadece biçimi alana göre ayarlanır.
  //    opts.keepBare, eserin KONUSU olan isimleri taşır. Bir Van Gogh
  //    otoportresinde "Van Gogh Style Portrait" yanlış olur — eser onun tarzını
  //    taklit etmiyor, doğrudan onu resmediyor. O isimde "Style" eki atlanır.
  const bareByField = field === 'visual_style' || field === 'description';
  const bareNames = opts.keepBare instanceof Set ? opts.keepBare : null;

  for (const { pattern, canonical } of publicDomainPatterns) {
    sanitized = sanitized.replace(pattern, (match, offset, full) => {
      if (bareByField || bareNames?.has(canonical)) return canonical;
      const rest = full.slice(offset + match.length);
      return ALREADY_QUALIFIED.test(rest) ? canonical : `${canonical} Style`;
    });
  }

  // Etsy tag'leri form-encoded gövdede virgülle ayrılarak gönderiliyor, yani
  // tag'in İÇİNDEKİ bir virgül Etsy tarafında tag'i ikiye böler: 13 tag 14 olur
  // ve istek "tags_too_many" ile reddedilir. Konu adı birden fazla figür
  // taşıdığında ("Jesus Christ, Lazarus") tam da bu oluyordu.
  if (field === 'tags') {
    sanitized = stripTagCommas(sanitized);
  }

  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (field !== 'tags') {
    sanitized = sanitized.replace(/,\s*,/g, ',').replace(/\s*,\s*/g, ', ');
  }
  return sanitized;
}

// Etsy'nin tag limiti 20 karakter ve model bunu güvenilir tutturamaz: LLM token
// görür, harf saymaz — "max 20 characters" modelin yapısal olarak doğrulayamadığı
// bir kısıt. Gözlenen ihlaller 21-23 karakter, yani anlam hatası değil kelime
// fazlası. Uzun tag'i atıp yerine generic bir tag koymak net SEO kaybı: "wall art"
// gibi terimler Etsy'nin en rekabetçi kelimeleri ve yeni bir listing orada hiç
// sıralanmaz. O yüzden atmak yerine en değersiz kelimeyi düşürüp ifadeyi kurtarıyoruz.
const TAG_FILLER_WORDS = new Set(['and', 'the', 'for', 'with', 'of', 'a', 'an', 'in', 'on', 'to', '&']);

// Düşürüldüğünde en az arama niyeti kaybettiren kelimeler; en generic olan başta.
// Bunun dışındaki her kelime "ayırt edici" sayılır ve asla feda edilmez.
const TAG_LOW_VALUE_WORDS = ['print', 'poster', 'artwork', 'piece', 'decor', 'design', 'style', 'art', 'wall'];

// Bileşik terimlerde generic kelime aslında generic değildir: "art deco"daki
// "art"ı atmak tag'i mahveder. Anahtar generic kelime, değer ise onu kurtaran
// ardıllar.
const TAG_COMPOUND_HEADS = { art: ['deco', 'nouveau'] };

// Bir kelimenin atılma önceliği. Düşük = önce atılır, Infinity = dokunulmaz.
function tagWordDropRank(words, i) {
  const word = words[i].toLowerCase();
  const next = (words[i + 1] || '').toLowerCase();
  if (TAG_COMPOUND_HEADS[word]?.includes(next)) return Infinity;
  const rank = TAG_LOW_VALUE_WORDS.indexOf(word);
  return rank === -1 ? Infinity : rank;
}

// 20 karakteri aşan bir tag'i kelime sınırında kısaltır. Kurtarılamıyorsa null.
export function shortenTag(tag) {
  if (typeof tag !== 'string') return null;
  // Enjekte edilen tag'ler (set/konu adi) sanitizeText'ten gecmiyor; virgul
  // temizligi burada da yapiliyor ki tek bir cikis noktasi acikta kalmasin.
  let words = stripTagCommas(tag).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  if (words.join(' ').length <= 20) return words.join(' ');

  // 1) Bağlaç/edat düşür: "blue and beige wall art" -> "blue beige wall art"
  const withoutFiller = words.filter(w => !TAG_FILLER_WORDS.has(w.toLowerCase()));
  if (withoutFiller.length >= 2) {
    words = withoutFiller;
    if (words.join(' ').length <= 20) return words.join(' ');
  }

  // 2) Kelime düşürme sırası:
  //    a) generic kelimeler — önce sondaki OLMAYANLAR ("calming wall sculpture"
  //       -> "calming sculpture"), çünkü son kelime ifadeyi bir isim tamlaması
  //       olarak ayakta tutuyor;
  //    b) sadece o da yoksa sondaki generic kelime ("serene meditation decor"
  //       -> "serene meditation");
  //    c) hiç generic yoksa en soldaki niteleyici ("gifts meditation lovers"
  //       -> "meditation lovers"), çünkü İngilizcede taşıyıcı isim sonda durur.
  while (words.length > 2) {
    let dropIndex = -1;
    let bestRank = Infinity;
    for (let i = 0; i < words.length - 1; i++) {
      const rank = tagWordDropRank(words, i);
      if (rank < bestRank) {
        bestRank = rank;
        dropIndex = i;
      }
    }
    if (dropIndex === -1 && tagWordDropRank(words, words.length - 1) !== Infinity) {
      dropIndex = words.length - 1;
    }
    if (dropIndex === -1) dropIndex = 0;

    words.splice(dropIndex, 1);
    if (words.join(' ').length <= 20) return words.join(' ');
  }

  // İki kelimeye inip hâlâ uzunsa gerçekten kurtarılamaz. Yarım kelime bırakan
  // bir kırpma (substring) tag'i tamamen anlamsız yaptığı için tercih edilmiyor.
  return null;
}

// Slot açığında sabit generic havuz yerine ürünün KENDİ nitelikleriyle tag üretir.
// Bu alanlar zaten aynı AI çağrısında dönüyor, yani ek maliyeti yok; üstelik her
// listing farklı tag alır, mağaza içi anahtar kelime yamyamlığı da azalır.
export function buildContextualFallbacks({ primaryColor, secondaryColor, subject, rooms = [], visualStyles = [] }) {
  const out = [];
  const add = (...parts) => {
    const tag = parts.filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, ' ').trim();
    const words = tag.split(' ');
    if (tag.length < 8 || tag.length > 20 || words.length < 2) return;
    // "art deco wall art" gibi kelimesi tekrar eden birleşimler elenir.
    if (new Set(words).size !== words.length) return;
    out.push(tag);
  };

  // room "living room decor" gibi kuyruklu gelebiliyor; çekirdeği alıyoruz ki
  // "living room decor wall art" gibi saçma birleşimler oluşmasın.
  const roomCores = rooms
    .map(r => String(r).toLowerCase().replace(/\s*(wall\s*)?(decor|art|print)$/, '').trim())
    .filter(Boolean);
  const styles = visualStyles.map(s => String(s).toLowerCase().trim()).filter(Boolean);

  add(primaryColor, subject, 'art');
  add(primaryColor, 'wall decor');
  add(secondaryColor, primaryColor, 'art');
  for (const room of roomCores) {
    add(room, 'wall art');
    add(room, primaryColor, 'art');
    add(room, subject, 'art');
  }
  for (const style of styles) {
    add(style, 'wall art');
    add(style, subject);
    add(style, primaryColor, 'art');
  }
  add(subject, 'wall decor');
  add(secondaryColor, 'wall decor');

  return [...new Set(out)];
}

/* ------------------------------------------------------------------ */
/* Çok panelli (Set of 2/3) listing'ler için SEO yardımcıları           */
/* ------------------------------------------------------------------ */

// Panel sayısının sanat dünyasındaki karşılığı; alıcılar bunu da aratıyor.
const SET_WORD = { 2: 'diptych', 3: 'triptych' };

/** Başlığa eklenecek set öbeği: "Set Of 2 Wall Art". */
export function setTitlePhrase(panelCount) {
  return `Set Of ${panelCount} Wall Art`;
}

/** Başlıkta zaten set sinyali var mı? */
export function hasSetSignal(text, panelCount) {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const word = SET_WORD[panelCount];
  return t.includes(`set of ${panelCount}`)
    || t.includes(`${panelCount} piece`)
    || t.includes(`${panelCount} panel`)
    || Boolean(word && t.includes(word));
}

/**
 * Set niyetli tag havuzu — hepsi Etsy'nin 20 karakter sınırının altında.
 * Sıra önem sırasıdır: ilk sıradakiler arama hacmi en yüksek olanlar.
 */
export function buildSetTags(panelCount) {
  const word = SET_WORD[panelCount];
  return [
    `set of ${panelCount} wall art`,
    `${panelCount} piece wall art`,
    word ? `${word} wall art` : `${panelCount} panel wall art`,
    `${panelCount} panel wall art`
  ].filter(t => t.length <= 20);
}

/**
 * Açıklamaya her set listing'inde eklenen olgusal not.
 * Ölçünün panel başına, fiyatın tüm setin olduğu bilgisi mağazanın standart
 * boilerplate'inde yok ve AI'a "ölçüden bahsetme" dendiği için o da yazmaz —
 * oysa yanlış anlaşılması doğrudan iade sebebi.
 */
export function setDescriptionNote(panelCount) {
  const all = panelCount === 2 ? 'both panels' : `all ${panelCount} panels`;
  return `Please note: this is a set of ${panelCount} separate panels made to hang side by side. `
    + `The size you choose applies to each panel, and the price covers ${all}.`;
}

/** Etsy istemine eklenen set talimatı. */
function buildSetInstruction({ panelCount, panelRatio }) {
  const word = SET_WORD[panelCount];
  const tagExamples = buildSetTags(panelCount).slice(0, 3).map(t => `"${t}"`).join(', ');
  return `

SET LISTING — READ BEFORE WRITING ANYTHING:
This listing sells a SET OF ${panelCount} separate panels that hang side by side, not one single piece. The image you are shown is the COMPLETE set laid out side by side; it is split down the middle into ${panelCount} panels of ${panelRatio} each. Treat it as one artwork spread across ${panelCount} panels.
- TITLE: keep your primary subject keyword as the FIRST phrase, then make the SECOND phrase a set phrase such as "${setTitlePhrase(panelCount)}"${word ? ` or "${word.charAt(0).toUpperCase() + word.slice(1)} Wall Art"` : ''}. Buyers search this explicitly and a set listing without it is invisible to them.
- TAGS: EXACTLY 3 of your tags must target set intent — no more, the remaining slots belong to subject, mood, colour, room and recipient. Use these three: ${tagExamples}. They still count against the 20-character limit.
- DESCRIPTION: make it unmistakable that this is a ${panelCount}-piece set meant to hang together, and describe how the composition flows across the panels. Do NOT mention material, framing, printing or shipping.`;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Provider-specific way of asking for "as little reasoning as possible".
//
// Üç lehçe var, çünkü modellerin düşünmeyi kapatma kabiliyeti farklı:
//
// 1. OpenAI reasoning modelleri (gpt-5, o1/o3/o4): düşünme kapatılamaz.
//    `{ enabled: false }` göndermek çağrıyı düşürür (500). En düşük efor
//    bütçesi verilir.
//
// 2. Gemini 3 ve üzeri: Google eski `thinkingBudget` yerine `thinkingLevel`
//    kullanıyor ve VARSAYILAN "high". `enabled: false` bu ailede kabul
//    edilmiyor — üstelik hata da vermiyor, sessizce yok sayılıp model
//    tam güçte düşünmeye devam ediyor (ölçüldü: gemini-3.7-flash tek
//    çağrıda 2081 çıktı tokenının 1683'ünü düşünmeye harcadı, gerçek JSON
//    yalnızca 398 tokendı). OpenRouter'ın `effort` değeri Google'ın
//    thinkingLevel'ına birebir eşlendiği için `minimal` gönderiyoruz.
//    `none` göndermek denenmemeli: zorunlu düşünen modeller onu reddediyor.
//
// 3. Diğerleri (Gemini 2.5 dahil, ki thinkingBudget: 0 destekler): sert
//    kapatma anahtarı çalışır. Düşünme desteği olmayan modeller alanı
//    yok sayar.
//
// `exclude: true` her durumda düşünme metnini yanıttan çıkarır; atacağımız
// tokenları taşımak için para ödemeyiz.
function buildReasoningConfig(model) {
  const m = (model || '').toLowerCase();

  const isOpenAiReasoner = m.startsWith('openai/') && (m.includes('gpt-5') || m.includes('o1') || m.includes('o3') || m.includes('o4'));
  if (isOpenAiReasoner) return { effort: 'minimal', exclude: true };

  // gemini-3, gemini-3.5, gemini-3.7 ... ve sonraki ana sürümler
  const geminiMajor = m.startsWith('google/') ? Number(m.match(/gemini-(\d+)/)?.[1]) : NaN;
  if (Number.isFinite(geminiMajor) && geminiMajor >= 3) return { effort: 'minimal', exclude: true };

  return { enabled: false, exclude: true };
}

// Helper to retry temporary errors (429 rate limit or timeouts)
async function withRetry(fn, retries = 2, delayMs = 2000) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err.response?.status === 429 || err.code === 'ECONNABORTED' || err.message?.includes('timeout');
      if (!isRetryable || i === retries) throw err;
      console.warn(`[Retry ${i + 1}/${retries}] Temporary error encountered (${err.message}). Retrying in ${delayMs * (i + 1)}ms...`);
      await new Promise(r => setTimeout(r, delayMs * (i + 1))); // exponential backoff
    }
  }
}

/**
 * @param {Array<{shop_section_id, title}>} sections Verilirse AI, görsele en uygun
 *   mağaza bölümünü bu listeden seçer ve sonuçta shop_section_id döner.
 */
export async function generateSEO(imagePath, targetMarket = "US/UK", shopStyle = "vintage poster, art deco", shopId = null, platform = "etsy", sections = null, setInfo = null, agentOptions = {}) {
  const targetShopId = shopId || getActiveShop().shop_id;

  // 1. Read selected AI model from DB (default to openai/gpt-5-mini).
  // Chosen after a head-to-head on identical artwork: with reasoning suppressed
  // it matched the cheapest option on price ($0.00086 avg), was the fastest
  // (~1.8s), and was the only model to fill all 13 tag slots with genuine
  // long-tail phrases on every run.
  let selectedModel = "openai/gpt-5-mini";
  const validModels = ["qwen/qwen3.7-flash", "qwen/qwen3.7-plus", "qwen/qwen3-vl-32b-instruct", "openai/gpt-5-mini", "google/gemini-2.5-flash", "google/gemini-3.5-flash", "google/gemini-3.5-flash-lite", "google/gemini-3.7-flash", "google/gemini-3.8-flash"];
  try {
    const stmt = db.prepare('SELECT value FROM settings WHERE shop_id = ? AND key = ?');
    const setting = stmt.get(targetShopId, 'nvidia_model');
    if (setting) {
      const parsedModel = JSON.parse(setting.value);
      if (parsedModel && (parsedModel === AGENT_MODEL || validModels.includes(parsedModel))) {
        selectedModel = parsedModel;
      }
    }
  } catch (err) {
    console.error("Error reading ai model from db:", err);
  }

  // A named model must use OpenRouter; never silently switch provider or model.
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  if (selectedModel !== AGENT_MODEL && (!openRouterKey || openRouterKey.startsWith('nvapi-'))) {
    throw new Error('Seçili model için geçerli bir OPENROUTER_API_KEY gerekli. AI Agent veya başka sağlayıcıya otomatik geçiş yapılmaz.');
  }

  // Optimize and resize image using Jimp (down to 768px for token efficiency)
  let dataUrl = null;
  if (selectedModel !== AGENT_MODEL) {
    const imageBuffer = fs.readFileSync(imagePath);
    const image = await Jimp.read(imageBuffer);
    if (image.width > 768) image.resize({ w: 768 });
    const isPng = imagePath.toLowerCase().endsWith('.png');
    const isWebp = imagePath.toLowerCase().endsWith('.webp');
    const mimeType = isPng ? 'image/png' : (isWebp ? 'image/webp' : 'image/jpeg');
    dataUrl = await image.getBase64(mimeType);
  }

  // Mağaza bölümü otomatik seçimi: bölüm listesi verilirse şemaya bir alan
  // eklenir ve AI görsele en uygun bölümü BU listeden seçer. Serbest metin
  // üretmemesi için isimlerin birebir kopyalanması şart koşulur.
  // Çok panelli profillerde SEO metni tekli ürün gibi yazılırsa hem "set of 2"
  // aramalarının tamamı kaçırılır hem de görselde iki panel görünüp metinde tek
  // parçadan bahsedilmesi iade sebebi olur.
  const setPanels = setInfo && Number(setInfo.panelCount) > 1 ? Number(setInfo.panelCount) : 0;
  const setInstruction = (setPanels && platform !== 'shopify')
    ? buildSetInstruction({ panelCount: setPanels, panelRatio: setInfo.panelRatio || '' })
    : '';

  const usableSections = Array.isArray(sections)
    ? sections.filter(s => s && s.title && s.shop_section_id)
    : [];

  const sectionSchemaLine = usableSections.length > 0
    ? ',\n  "shop_section": "EXACTLY one name copied verbatim from the allowed list below"'
    : '';

  const sectionInstruction = usableSections.length > 0
    ? `\n\nSHOP SECTION SELECTION:
Pick the single best-fitting section for this artwork from this list. Copy the name EXACTLY as written, character for character. Do not invent new names, do not translate, do not abbreviate. If nothing fits well, pick the closest general one.
Allowed sections:
${usableSections.map(s => `- ${s.title}`).join('\n')}`
    : '';

  // Shortened and token-efficient system prompt
  const systemPrompt = platform === 'shopify'
    ? `You are a Shopify E-commerce copywriter. Analyze the artwork image and generate a short, clean, premium product title (max 50 characters, 4-6 words) and search-optimized product metadata in JSON format. Do not use keyword stuffing. Always identify the artwork's art movement or technique explicitly in visual_style.`
    : `You are an Etsy SEO expert. Analyze the artwork image and return a JSON object with optimized listing metadata. Always identify the artwork's art movement or technique explicitly. Public-domain artists may be referenced as a style; living artists and brands may not. Sanctioned-country names, real named events and transport brands are forbidden in every field — the MARKETPLACE COMPLIANCE rules override every SEO instruction. Return ONLY a single JSON object without markdown formatting.`;

  const promptText = platform === 'shopify'
    ? `Please analyze the attached image and generate Shopify metadata.
Shop Style: ${shopStyle}
Product Type: Canvas / Poster

Format your response as a single, valid JSON object matching this schema:
{
  "title": "string (clean, premium title, maximum 50 characters, 4 to 6 words, no keyword stuffing)",
  "tags": ["5 to 10 relevant search tags"],
  "description_hook": "string (engaging product description snippet, max 160 characters)",
  "depicted_subject": "WHO or WHAT is pictured, when it is a recognisable PUBLIC-DOMAIN person, historical figure, mythological character or landmark — e.g. 'Vincent Van Gogh', 'Cleopatra', 'Medusa', 'Eiffel Tower'. This is about the SUBJECT of the artwork, never about its style. Return an empty string if the figure is anonymous, generic or invented. Never guess.",
  "visual_style": ["${VISUAL_STYLE_SPEC}"],
  "occasion": [],
  "holiday": [],
  "room": ["rooms where this art fits best"]
}
${ARTIST_POLICY_PROMPT}${LISTING_COMPLIANCE_PROMPT}
CRITICAL: Return ONLY the JSON object. Do not include markdown code block formatting (like \`\`\`json).`
    : `Analyze the image of this wall art and return Etsy metadata JSON.
CONTEXT ONLY (never quote or paraphrase this line in your output): the item is a physical canvas artwork shipped to the buyer, never a digital download, printable or file. Use this only to avoid digital-product wording.
Shop Style: ${shopStyle}
Target Market: ${targetMarket}

Schema:
{
  "title": "Traditional Etsy keyword title: comma-separated keyword phrases, 90-140 characters in total — aim for 120-135, never exceed 140. Write 5 to 8 phrases, each 2-4 words and each a real phrase a buyer would type into search. The FIRST phrase is the primary keyword and must say what the item is (e.g. 'Sculpted Face Wall Art'); order the rest by search value — subject, style, colour, room, recipient/occasion. Separate phrases ONLY with commas: no dashes, pipes or slashes anywhere in the title. Use Title Case for every significant word. Do not repeat a phrase, and no single word may appear more than twice in the whole title. Must end on a complete phrase, never cut off mid-phrase. NO generic gift terms. NEVER state the framing or mounting option (no 'Framed', 'Stretched', 'Rolled', 'Ready to Hang') — the buyer chooses that at checkout and a wrong promise causes returns.",
  "tags": ["Exactly 24 multi-word phrases. THREE words is the sweet spot, two is the absolute minimum, four is the hard maximum. Aim for 15-20 characters and USE that space: a tag must read like a complete phrase a buyer types into the search bar, never a stub. 'calm wall', 'spa decor', 'boho wall' are FAILURES — 'calm meditation art', 'spa reception decor', 'boho bedroom art' are correct. If you cannot hit the range exactly, err LONG rather than short; an over-long tag is fixable, a vague short one is worthless. Avoid vague two-word fillers like 'old poster' or 'nature view' — every tag must be something a real buyer would type. NEVER use the word 'digital'. NEVER use material, print or mounting terms ('canvas', 'stretched canvas', 'archival', 'aged paper texture'). DO NOT repeat words from the title. Each tag must target a DIFFERENT search intent (subject, mood, colour, room, style, recipient, occasion)."],
  "description": "2-3 sentences. What the artwork depicts, the mood it creates, and who it suits. Primary keyword in first 40 chars. In English. NEVER mention material, canvas, framing, printing, sizing, quality claims or shipping — the shop appends its own standard section covering all of that, so repeating it wastes the description's most valuable opening. Write about the IMAGE, not the product spec.",
  "depicted_subject": "WHO or WHAT is pictured, when it is a recognisable PUBLIC-DOMAIN person, historical figure, mythological character or landmark — e.g. 'Vincent Van Gogh', 'Cleopatra', 'Medusa', 'Eiffel Tower'. This is about the SUBJECT of the artwork, never about its style. Return an empty string if the figure is anonymous, generic or invented. Never guess.",
  "visual_style": ["${VISUAL_STYLE_SPEC}"],
  "occasion": ["occasion tags if applicable"],
  "holiday": ["holiday tags if applicable"],
  "room": ["room tags where this art fits best"],
  "primary_color": "single dominant colour of the artwork, plain English (e.g. green, blue, beige)",
  "secondary_color": "second most prominent colour, plain English",
  "orientation": "one of: vertical, horizontal, square",
  "subject": "one of: landscape, seascape, botanical, abstract, architecture, animal, figure, still life"${sectionSchemaLine}
}${sectionInstruction}${setInstruction}${ARTIST_POLICY_PROMPT}${LISTING_COMPLIANCE_PROMPT}
CRITICAL: Return ONLY raw JSON without markdown blocks.`;

  // AI Agent runs locally; named models go only to the selected OpenRouter model.
  const queueToTry = [];

  if (selectedModel !== AGENT_MODEL) {
    queueToTry.push({
      url: OPENROUTER_URL,
      model: selectedModel,
      key: openRouterKey,
      isOpenRouter: true
    });
  }

  let finalResponse = null;
  let successModel = null;
  let lastError = null;
  let reasoningSuppressed = false;

  if (selectedModel === AGENT_MODEL) {
    const result = await requestAgentSEO({
      imagePath, shopId: targetShopId, platform, targetMarket, shopStyle,
      systemPrompt, promptText, sections: usableSections, setInfo
    }, agentOptions);
    finalResponse = { choices: [{ message: { content: JSON.stringify(result) } }] };
    successModel = AGENT_MODEL;
  }

  for (const attempt of queueToTry) {
    const payload = {
      model: attempt.model,
      max_tokens: 4096,
      temperature: 0.40, // Rule-heavy structured task: lower temp for schema/rule compliance
      top_p: 1.00,
      stream: false
    };

    // Reasoning suppressed for ALL OpenRouter models. This task is rule-based, not
    // exploratory: reasoning tokens are billed as output and inflate cost ~9x
    // (observed: GPT-5 Mini 3064 output tokens vs ~300 of actual JSON).
    //
    // Two dialects are needed. OpenAI reasoning models reject `enabled: false`
    // outright (500) because reasoning cannot be switched off for them — the
    // lowest they accept is a minimal effort budget. Everyone else takes the
    // hard off switch. Models with no reasoning support ignore the field.
    if (attempt.isOpenRouter) {
      payload.reasoning = buildReasoningConfig(attempt.model);
    }

    payload.messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: [
          { type: "text", text: promptText },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ];

    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Authorization": `Bearer ${attempt.key}`
    };

    try {
      console.log(`Attempting AI generation with model=${attempt.model} via ${attempt.url.includes("openrouter") ? "OpenRouter" : "Nvidia"}...`);
      // Wrapped in exponential backoff retry handler
      const res = await withRetry(() => axios.post(attempt.url, payload, { headers, timeout: 45000 }));
      finalResponse = res.data;
      successModel = attempt.model;
      reasoningSuppressed = Boolean(payload.reasoning);
      break;
    } catch (err) {
      // The `reasoning` field is the most likely thing to be rejected: support
      // varies per model and per upstream provider, and a bad value surfaces as
      // a 400 or a 500. Rather than losing the whole model over it, drop the
      // field once and try again — a pricier call still beats no call.
      const status = err.response?.status;
      const reasoningMayBeCulprit = payload.reasoning && (status === 400 || status === 404 || status >= 500);

      if (reasoningMayBeCulprit) {
        console.warn(`Model=${attempt.model} rejected the reasoning config (HTTP ${status}). Retrying once without it — this call will cost more.`);
        const { reasoning, ...payloadNoReasoning } = payload;
        try {
          const res = await withRetry(() => axios.post(attempt.url, payloadNoReasoning, { headers, timeout: 45000 }));
          finalResponse = res.data;
          successModel = attempt.model;
          reasoningSuppressed = false;
          break;
        } catch (retryErr) {
          lastError = retryErr;
          console.warn(`Attempt failed with model=${attempt.model} (no-reasoning retry): ${retryErr.message}`);
          continue;
        }
      }

      lastError = err;
      console.warn(`Attempt failed with model=${attempt.model}: ${err.message}`);
    }
  }

  if (!finalResponse) {
    console.error("AI generation failed with all models and keys.");
    throw lastError || new Error("All AI generation attempts failed");
  }

  console.log(`AI generation succeeded using model=${successModel}`);

  const MODEL_PRICING = {
    "qwen/qwen3.7-flash": { input: 0.15 / 1000000, output: 0.60 / 1000000 },
    "qwen/qwen3.7-plus": { input: 0.32 / 1000000, output: 1.28 / 1000000 },
    "qwen/qwen3-vl-32b-instruct": { input: 0.20 / 1000000, output: 0.60 / 1000000 },
    "openai/gpt-5-mini": { input: 0.25 / 1000000, output: 1.00 / 1000000 },
    "google/gemini-2.5-flash": { input: 0.075 / 1000000, output: 0.30 / 1000000 },
    "google/gemini-3.5-flash": { input: 0.10 / 1000000, output: 0.40 / 1000000 },
    "google/gemini-3.5-flash-lite": { input: 0.075 / 1000000, output: 0.30 / 1000000 },
    "google/gemini-3.7-flash": { input: 0.10 / 1000000, output: 0.40 / 1000000 },
    "google/gemini-3.8-flash": { input: 0.75 / 1000000, output: 3.75 / 1000000 },
    "moonshotai/kimi-k2.6": { input: 1.00 / 1000000, output: 1.00 / 1000000 },
    "minimaxai/minimax-m3": { input: 0.18 / 1000000, output: 0.18 / 1000000 },
    "nvidia/nemotron-nano-12b-v2-vl": { input: 0.07 / 1000000, output: 0.07 / 1000000 },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { input: 0.15 / 1000000, output: 0.15 / 1000000 }
  };

  // Düşünme tokenları completion_tokens içinde faturalanır ama ayrıca burada
  // raporlanır. reasoningSuppressed yalnızca "kapatmayı istedik mi" bilgisini
  // tutar; bir sağlayıcı isteği sessizce yok sayabilir (HTTP 200 döner, o
  // yüzden yukarıdaki yeniden deneme mekanizması da devreye girmez). Ölçülen
  // tek gerçek kanıt budur.
  const reasoningTokens =
    finalResponse.usage?.completion_tokens_details?.reasoning_tokens ??
    finalResponse.usage?.reasoning_tokens ??
    0;

  if (reasoningSuppressed && reasoningTokens > 0) {
    console.warn(
      `[AI] UYARI: model=${successModel} düşünmeyi kapatma isteğini yok saydı — ` +
      `${reasoningTokens} düşünme tokenı faturalandı (toplam çıktı: ${finalResponse.usage?.completion_tokens}). ` +
      `Bu modelin farklı bir reasoning parametresi bekliyor olabilir.`
    );
  }

  // Token usage logging into DB
  if (finalResponse.usage) {
    try {
      const usageId = uuidv4();
      const pricing = MODEL_PRICING[successModel] || { input: 0.50 / 1000000, output: 0.50 / 1000000 };
      const promptCost = (finalResponse.usage.prompt_tokens || 0) * pricing.input;
      const completionCost = (finalResponse.usage.completion_tokens || 0) * pricing.output;
      const totalCost = promptCost + completionCost;

      const insertUsage = db.prepare(`
        INSERT INTO ai_usage (id, shop_id, model, prompt_tokens, completion_tokens, total_tokens, cost, reasoning_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertUsage.run(
        usageId,
        targetShopId,
        successModel,
        finalResponse.usage.prompt_tokens || 0,
        finalResponse.usage.completion_tokens || 0,
        finalResponse.usage.total_tokens || 0,
        totalCost,
        reasoningTokens
      );
      console.log(`[AI Usage Logged] Model: ${successModel}, Total Tokens: ${finalResponse.usage.total_tokens}, Reasoning: ${reasoningTokens}, Cost: $${totalCost.toFixed(6)}`);
    } catch (dbLogErr) {
      console.warn("Failed to log AI token usage into database:", dbLogErr.message);
    }
  }

  let assistantMsg = finalResponse?.choices?.[0]?.message || {};
  let rawContent = assistantMsg.content ?? assistantMsg.reasoning_content ?? assistantMsg.reasoning ?? '';
  let textResponse = (typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent)).trim();

  // JSON Parsing & Single Self-Correction Retry Flow
  let parsed = null;
  const parseJsonStr = (text) => {
    let cleaned = text;
    const firstCurly = cleaned.indexOf('{');
    const lastCurly = cleaned.lastIndexOf('}');
    if (firstCurly !== -1 && lastCurly !== -1 && lastCurly > firstCurly) {
      cleaned = cleaned.substring(firstCurly, lastCurly + 1);
    } else {
      if (cleaned.startsWith("```json")) {
        cleaned = cleaned.replace(/^```json/, "").replace(/```$/, "").trim();
      } else if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```/, "").replace(/```$/, "").trim();
      }
    }
    return JSON.parse(cleaned);
  };

  try {
    parsed = parseJsonStr(textResponse);
  } catch (parseErr) {
    console.warn("Initial JSON parsing failed. Attempting self-correction retry with success model...");
    // Retrieve key used for successful attempt
    const successKeyToUse = queueToTry.find(q => q.model === successModel)?.key;
    const targetUrl = queueToTry.find(q => q.model === successModel)?.url || "https://openrouter.ai/api/v1/chat/completions";

    if (successKeyToUse) {
      try {
        const retryMessages = [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: promptText },
              { type: "image_url", image_url: { url: dataUrl } }
            ]
          },
          {
            role: "assistant",
            content: textResponse,
            ...(assistantMsg.reasoning_details ? { reasoning_details: assistantMsg.reasoning_details } : {})
          },
          {
            role: "user",
            content: "Your response was not valid JSON. Please return ONLY a valid, parsable JSON object according to the requested schema. No conversational text, no formatting marks."
          }
        ];

        const retryPayload = {
          model: successModel,
          max_tokens: 4096,
          temperature: 0.20, // Low temperature for schema correctness
          top_p: 1.00,
          messages: retryMessages,
          stream: false
        };

        // Keep reasoning suppressed on the correction pass too, but only if the
        // model accepted the config on the first call — otherwise we would
        // reproduce the very error we just worked around.
        if (targetUrl.includes("openrouter") && reasoningSuppressed) {
          retryPayload.reasoning = buildReasoningConfig(successModel);
        }

        const retryHeaders = {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${successKeyToUse}`
        };

        const retryRes = await withRetry(() => axios.post(targetUrl, retryPayload, { headers: retryHeaders, timeout: 30000 }));
        const retryMsg = retryRes?.data?.choices?.[0]?.message || {};
        let retryRaw = retryMsg.content ?? retryMsg.reasoning_content ?? retryMsg.reasoning ?? '';
        const retryText = (typeof retryRaw === 'string' ? retryRaw : JSON.stringify(retryRaw)).trim();
        parsed = parseJsonStr(retryText);
        console.log("Self-correction retry parsed successfully!");
      } catch (retryErr) {
        console.error("Self-correction JSON retry failed:", retryErr.message);
        throw new Error("API did not return valid JSON or serialization failed. Original response: " + textResponse);
      }
    } else {
      throw parseErr;
    }
  }

  // Sanitize title
  // Eserin KONUSU olan kamu malı figür (bir Van Gogh otoportresindeki Van Gogh gibi).
  // Tarz atfından önce çözülmeli: bu isim title ve tag'lerde "Style" eki almamalı,
  // çünkü eser onun tarzını taklit etmiyor, doğrudan onu resmediyor.
  const depictedSubject = resolveDepictedSubject(parsed.depicted_subject);
  const depictedBareNames = publicDomainCanonicalsIn(depictedSubject);

  let title = parsed.title ? String(parsed.title) : '';
  title = sanitizeText(title, 'title', { keepBare: depictedBareNames });

  // Model konuyu tanıyıp adını başlığa yazmayı atlarsa ("artist portrait", "legendary
  // master") listing'in en değerli anahtar kelimesi kaybolur. Set öbeğiyle aynı mantık:
  // ikinci öbek olarak enjekte edilir, aşağıdaki 140 karakter kırpması taşmayı halleder.
  if (depictedSubject && !mentionsDepictedSubject(title, depictedSubject, depictedBareNames)) {
    const isPortrait = /figure|portrait|face|head/i.test(`${parsed.subject || ''} ${title}`);
    const phrase = `${depictedSubject} ${isPortrait ? 'Portrait' : 'Art'}`;
    const phrases = title.split(',').map(ph => ph.trim()).filter(Boolean);
    phrases.splice(Math.min(1, phrases.length), 0, phrase);
    title = phrases.join(', ');
    console.warn(`[Depicted Subject] Başlıkta "${depictedSubject}" yoktu, "${phrase}" öbeği eklendi.`);
  }

  // Set listing'lerinde başlıkta set öbeği pazarlık konusu değil: model unutmuşsa
  // ikinci öbek olarak eklenir (birinci öbek ana konu anahtar kelimesi kalır).
  // Aşağıdaki 140 karakter kırpması taşma olursa son öbeği düşürerek halleder.
  if (setPanels && !hasSetSignal(title, setPanels)) {
    const phrases = title.split(',').map(ph => ph.trim()).filter(Boolean);
    phrases.splice(Math.min(1, phrases.length), 0, setTitlePhrase(setPanels));
    title = phrases.join(', ');
    console.warn(`[Set SEO] Başlıkta set ifadesi yoktu, "${setTitlePhrase(setPanels)}" ikinci öbek olarak eklendi.`);
  }

  // Geleneksel Etsy başlık formatı: virgülle ayrılmış anahtar kelime öbekleri,
  // hedef 90-140 karakter. Etsy'nin sert tavanı 140 ve fazlası kesiliyor; alt
  // sınırın altındaysa arama yüzeyi kullanılmadan kalıyor.
  if (title.length > 140) {
    // Virgül sınırında kes ki başlık yarım bir öbekle bitmesin — kesik bir
    // anahtar kelime ("Meditation Ro") hiçbir aramada eşleşmez.
    const phrases = title.split(',').map(p => p.trim()).filter(Boolean);
    let rebuilt = '';
    for (const phrase of phrases) {
      const candidate = rebuilt ? `${rebuilt}, ${phrase}` : phrase;
      if (candidate.length > 140) break;
      rebuilt = candidate;
    }
    console.warn(`[Title Sanity] Title was ${title.length} chars (over Etsy's 140 limit). Trimmed to ${rebuilt.length || 140} on a comma boundary.`);
    title = rebuilt || title.substring(0, 140).trim();
  }

  title = title.replace(/[,\s–—|-]+$/, '').trim();

  // Kısa başlık kodda onarılamaz (uydurma kelime eklemek SEO'yu bozar), ama
  // sessizce geçmesin: 90'ın altı, kullanılmayan arama yüzeyi demek.
  if (title.length < 90) {
    console.warn(`[Title Sanity] Title is only ${title.length} chars — under the 90-char target, leaving search surface unused.`);
  }

  // Sanitize description
  let description = parsed.description || parsed.description_hook || '';
  description = sanitizeText(String(description), 'description');
  if (description.length > 5000) {
    description = description.substring(0, 5000).trim();
  }

  // Ölçünün panel başına, fiyatın tüm seti kapsadığı bilgisi her set
  // listing'inde bulunmalı: AI'ın yaratıcı metni bunu kapsamıyor.
  if (setPanels) {
    description = `${description} ${setDescriptionNote(setPanels)}`.trim();
    if (!hasSetSignal(description, setPanels)) {
      console.warn('[Set SEO] AI açıklaması set olduğunu belirtmemişti; olgusal not tek başına taşıyor.');
    }
  }

  let descriptionHook = parsed.description_hook || parsed.description || '';
  descriptionHook = sanitizeText(String(descriptionHook), 'description');
  if (descriptionHook.length > 160) {
    descriptionHook = descriptionHook.substring(0, 160).trim();
  }

  // Sanitize tags
  let rawTags = Array.isArray(parsed.tags) ? parsed.tags : [];
  let processedTags = [];
  const seenTags = new Set();
  let repairedTagCount = 0;

  for (let tag of rawTags) {
    if (typeof tag !== 'string') continue;
    let cleanTag = sanitizeText(tag, 'tags', { keepBare: depictedBareNames }).trim();
    if (!cleanTag) continue;
    
    // REPAIR tags over Etsy's 20-char limit instead of dropping them. Gözlenen
    // ihlaller 21-23 karakter — bir kelime fazlası. Atılan her tag'in yerini
    // generic bir tag alıyordu ki bu SEO'da düpedüz kayıp.
    if (cleanTag.length > 20) {
      const shortened = shortenTag(cleanTag);
      if (!shortened) {
        console.log(`[Tags Sanity] Dropping tag "${cleanTag}" — cannot be shortened under 20 characters without losing meaning.`);
        continue;
      }
      console.log(`[Tags Sanity] Shortened "${cleanTag}" (${cleanTag.length}) -> "${shortened}" (${shortened.length}).`);
      cleanTag = shortened;
      repairedTagCount++;
    }
    
    // EXCLUDE tags containing the forbidden word "digital"
    if (cleanTag.toLowerCase().includes('digital')) {
      console.log(`[Tags Sanity] Excluding tag "${cleanTag}" because it contains the forbidden word "digital".`);
      continue;
    }
    
    const lowerKey = cleanTag.toLowerCase();
    if (!seenTags.has(lowerKey)) {
      seenTags.add(lowerKey);
      processedTags.push(cleanTag);
    }
  }

  // Etsy attributes: buyers filter search by colour/orientation, and a listing
  // that leaves these empty is excluded from those filtered results entirely,
  // even when the words appear in the title. Bunlar açık kalan tag slotlarını
  // doldurmakta da kullanıldığı için tag finalizasyonundan ÖNCE çıkarılıyor.
  const cleanAttr = (val, allowed = null) => {
    if (typeof val !== 'string') return null;
    const v = sanitizeText(val, 'attribute').trim().toLowerCase();
    if (!v) return null;
    if (allowed && !allowed.includes(v)) return null;
    return v;
  };

  const primaryColor = cleanAttr(parsed.primary_color);
  const secondaryColor = cleanAttr(parsed.secondary_color);
  const orientation = cleanAttr(parsed.orientation, ['vertical', 'horizontal', 'square']);
  const subject = cleanAttr(parsed.subject, [
    'landscape', 'seascape', 'botanical', 'abstract',
    'architecture', 'animal', 'figure', 'still life'
  ]);

  const visualStyle = Array.isArray(parsed.visual_style)
    ? parsed.visual_style.map(v => sanitizeText(v, 'visual_style').trim()).filter(Boolean).slice(0, 3)
    : [];
  const occasion = Array.isArray(parsed.occasion)
    ? parsed.occasion.map(o => sanitizeText(o, 'tags').trim()).filter(Boolean)
    : [];
  const holiday = Array.isArray(parsed.holiday)
    ? parsed.holiday.map(h => sanitizeText(h, 'tags').trim()).filter(Boolean)
    : [];
  const room = Array.isArray(parsed.room)
    ? parsed.room.map(r => sanitizeText(r, 'tags').trim()).filter(Boolean)
    : [];

  // Elemeyi kaç AI tag'i geçti? Kısaltılanlar da sayılır — kısaltılmış bir
  // long-tail ifade hâlâ gerçek bir arama terimi. 24 isteniyor ki eleme sonrası
  // 13 slot dolduran hiç generic kalmasın.
  const aiTagCount = processedTags.length;

  // Set tag'leri slot kesiminden önce başa alınır ki 13'lük listede kesin yer
  // bulsunlar. Model zaten yazdıysa tekrar eklenmez.
  let injectedSetTags = 0;
  if (setPanels) {
    // 3'ten fazla set tag'i slot israfı: hepsi aynı niyeti hedefliyor.
    const setTags = processedTags.filter(t => hasSetSignal(t, setPanels));
    if (setTags.length > 3) {
      const dropped = setTags.slice(3);
      dropped.forEach(t => seenTags.delete(t.toLowerCase()));
      processedTags = processedTags.filter(t => !dropped.includes(t));
      console.warn(`[Set SEO] ${setTags.length} set tag'i fazlaydı, ${dropped.length} tanesi çıkarıldı: ${dropped.join(', ')}`);
    }

    const alreadySet = Math.min(setTags.length, 3);
    const missing = buildSetTags(setPanels)
      .filter(t => !seenTags.has(t.toLowerCase()))
      .slice(0, Math.max(0, 3 - alreadySet));

    missing.forEach(t => seenTags.add(t.toLowerCase()));
    processedTags = [...missing, ...processedTags];
    injectedSetTags = missing.length;

    if (injectedSetTags) {
      console.warn(`[Set SEO] ${alreadySet} set tag'i AI'dan geldi, ${injectedSetTags} tanesi eklendi: ${missing.join(', ')}`);
    }
  }

  // Resmedilen figürün adı, o listing'in en yüksek hacimli arama terimi: "van gogh"
  // aramasıyla "painter tribute" aramasının hacmi kıyaslanamaz. Model adı başlığa
  // yazıp tag'lere yazmayı atlayabiliyor, o yüzden set tag'leriyle aynı mantıkla
  // slot kesiminden önce başa alınıyor. 20 karakteri aşarsa kısaltılıyor.
  if (depictedSubject && !processedTags.some(t => mentionsDepictedSubject(t, depictedSubject, depictedBareNames))) {
    const shortName = [...depictedBareNames].sort((a, b) => a.length - b.length)[0] || depictedSubject;
    const candidate = shortenTag(`${shortName} wall art`.toLowerCase());
    if (candidate && !seenTags.has(candidate.toLowerCase())) {
      seenTags.add(candidate.toLowerCase());
      processedTags = [candidate, ...processedTags];
      console.warn(`[Depicted Subject] Tag'lerde "${depictedSubject}" yoktu, "${candidate}" eklendi.`);
    }
  }

  // Açık kalan slotlar iki aşamada dolar: önce ürünün kendi niteliklerinden
  // türetilen bağlamsal tag'ler, ancak onlar da yetmezse sabit generic havuz.
  // Generic terimler en son çare çünkü ürünü tarif etmiyorlar ve Etsy'nin en
  // rekabetçi kelimeleri olduğu için yeni bir listing'e trafik getirmiyorlar.
  const contextualFallbacks = buildContextualFallbacks({
    primaryColor,
    secondaryColor,
    subject,
    rooms: room,
    visualStyles: visualStyle
  });

  const genericFallbacks = [
    "wall art", "home decor", "poster print", "art print",
    "room decor", "gift idea", "interior design", "wall decor",
    "vintage wall art", "modern wall art", "chic wall decor",
    "living room art", "bedroom wall art"
  ];

  const fillTagsFrom = (pool) => {
    let used = 0;
    for (const fbTag of pool) {
      if (processedTags.length >= 13) break;
      const lowerKey = fbTag.toLowerCase();
      if (seenTags.has(lowerKey)) continue;
      seenTags.add(lowerKey);
      processedTags.push(fbTag);
      used++;
    }
    return used;
  };

  const contextualTagsUsed = fillTagsFrom(contextualFallbacks);
  const genericTagsUsed = fillTagsFrom(genericFallbacks);

  if (contextualTagsUsed || genericTagsUsed) {
    console.warn(`[Tags Sanity] Only ${aiTagCount}/13 usable AI tags. Filled ${contextualTagsUsed} slot(s) from product attributes, ${genericTagsUsed} from the generic pool.`);
  }

  processedTags = processedTags.slice(0, 13);

  // Karakter bütçesi ölçümü. Her tag'in 20 karakterlik hakkı var ve kullanılmayan
  // her karakter kaybedilmiş arama yüzeyi: "boho wall" (9) gibi stub'lar, uzun
  // tag'lerin atılması kadar sessiz bir kayıp — ama loglanmazsa fark edilmiyor.
  // Sağlıklı aralık ~15-18 ortalama; 12'nin altı modelin fazla kısalttığı anlamına gelir.
  const avgTagLength = processedTags.length
    ? processedTags.reduce((sum, t) => sum + t.length, 0) / processedTags.length
    : 0;
  console.log(`[Tags Sanity] ${processedTags.length} tags — ${Math.min(aiTagCount, 13)} from AI (${repairedTagCount} repaired), ${contextualTagsUsed} contextual, ${genericTagsUsed} generic. Avg length ${avgTagLength.toFixed(1)}/20 chars.`);

  // AI'ın seçtiği bölümü gerçek section ID'sine eşle.
  // Tam eşleşme olmazsa büyük/küçük harf ve boşluk toleranslı arama yapılır;
  // yine bulunamazsa bölüm atanmaz (uydurulmuş isim kabul edilmez).
  let chosenSection = null;
  if (usableSections.length > 0 && parsed.shop_section) {
    const want = String(parsed.shop_section).trim().toLowerCase();
    chosenSection =
      usableSections.find(s => s.title.trim().toLowerCase() === want) ||
      usableSections.find(s => s.title.trim().toLowerCase().replace(/\s+/g, '') === want.replace(/\s+/g, '')) ||
      null;

    if (!chosenSection) {
      console.warn(`[AI Section] "${parsed.shop_section}" mağaza bölümleriyle eşleşmedi, bölüm atanmadı.`);
    } else {
      console.log(`[AI Section] Seçilen bölüm: ${chosenSection.title}`);
    }
  }

  return {
    title,
    tags: processedTags,
    description,
    description_hook: descriptionHook,
    depicted_subject: depictedSubject,
    visual_style: visualStyle,
    occasion,
    holiday,
    room,
    primary_color: primaryColor,
    secondary_color: secondaryColor,
    orientation,
    subject,
    shop_section_id: chosenSection ? chosenSection.shop_section_id : null,
    shop_section_title: chosenSection ? chosenSection.title : null,
    _meta: {
      model: successModel,
      fallbackUsed: selectedModel !== AGENT_MODEL && successModel !== queueToTry[0]?.model,
      reasoningSuppressed,          // kapatmayı istedik mi
      reasoningTokens,              // gerçekten düşündü mü (>0 ise istek yok sayılmış)
      aiTagCount,
      repairedTagCount,
      contextualTagsUsed,
      genericTagsUsed,
      avgTagLength: Number(avgTagLength.toFixed(1)),
      fallbackTagsUsed: contextualTagsUsed + genericTagsUsed
    }
  };
}
