# CSNuvio

**CSNuvio**, [CloudStream GSRepo](https://github.com/csprofesor/gsrepo) eklentilerinin [Nuvio](https://nuvio.app) video oynatıcısı ve eklenti ekosistemi için JavaScript (QuickJS) çalışma ortamına uyarlanmış resmi eklenti deposudur.

Türkiye'nin popüler film, dizi, anime ve belgesel platformlarından içerik akışlarını (HLS/m3u8 ve MP4) Nuvio üzerinde sorunsuz ve yüksek kalitede oynatmayı sağlar.

---

## 🚀 Nuvio'ya Ekleme

Nuvio uygulamasında eklenti deposu (Repository) olarak aşağıdaki Manifest URL'sini ekleyebilirsiniz:

```text
https://raw.githubusercontent.com/csprofesor/csnuvio/main/manifest.json
```

### Kurulum Adımları:
1. **Nuvio** uygulamasını açın.
2. **Ayarlar (Settings)** > **Eklentiler (Plugins / Scrapers)** veya **Depo Ekle (Add Repository)** bölümüne gidin.
3. Yukarıdaki **Manifest URL** bağlantısını yapıştırıp kaydedin.
4. Listeden dilediğiniz sağlayıcıları tek tek veya topluca etkinleştirin.

---

## 📺 Desteklenen Sağlayıcılar (29 Adet)

Depo içerisinde **29 adet** aktif Türkçe ve yabancı içerik sağlayıcısı bulunmaktadır:

| # | Sağlayıcı | ID | Tür | Formatlar | Dil |
|---|---|---|---|---|---|
| 1 | **DiziMom** | `csnuvio-dizimom` | Dizi, Film | M3U8, MP4 | TR |
| 2 | **DiziPal** | `csnuvio-dizipal` | Dizi, Film | M3U8, MP4 | TR |
| 3 | **HDFilmCehennemi** | `csnuvio-hdfilmcehennemi` | Film, Dizi | M3U8, MP4 | TR |
| 4 | **FilmModu** | `csnuvio-filmmodu` | Film | M3U8, MP4 | TR |
| 5 | **FilmMakinesi** | `csnuvio-filmmakinesi` | Film, Dizi | M3U8, MP4 | TR |
| 6 | **FilmKovası** | `csnuvio-filmkovasi` | Film | M3U8, MP4 | TR |
| 7 | **SetFilmİzle** | `csnuvio-setfilmizle` | Film, Dizi | M3U8, MP4 | TR |
| 8 | **FullHDFilm** | `csnuvio-fullhdfilm` | Film, Dizi | M3U8, MP4 | TR |
| 9 | **JetFilmizle** | `csnuvio-jetfilmizle` | Film | M3U8, MP4 | TR |
| 10 | **Webteİzle** | `csnuvio-webteizle` | Film | M3U8, MP4 | TR |
| 11 | **KültFilmler** | `csnuvio-kultfilmler` | Film | M3U8, MP4 | TR |
| 12 | **TavsiyeFilmİzle** | `csnuvio-tavsiyefilmizle` | Film | M3U8, MP4 | TR |
| 13 | **SinemaCX** | `csnuvio-sinemacx` | Film | M3U8, MP4 | TR |
| 14 | **HintFilmİzle** | `csnuvio-hintfilmizle` | Hint / Film | M3U8, MP4 | TR |
| 15 | **DiziBox** | `csnuvio-dizibox` | Dizi | M3U8, MP4 | TR |
| 16 | **Dizilla** | `csnuvio-dizilla` | Dizi | M3U8, MP4 | TR |
| 17 | **DiziGom** | `csnuvio-dizigom` | Dizi, Film | M3U8, MP4 | TR |
| 18 | **SezonlukDizi** | `csnuvio-sezonlukdizi` | Dizi | M3U8, MP4 | TR |
| 19 | **YabancıDizi** | `csnuvio-yabancidizi` | Dizi, Film | M3U8, MP4 | TR |
| 20 | **DDizi** | `csnuvio-ddizi` | Dizi | M3U8, MP4 | TR |
| 21 | **DiziKorea** | `csnuvio-dizikorea` | Asya / Dizi & Film | M3U8, MP4 | TR |
| 22 | **DiziMag** | `csnuvio-dizimag` | Dizi, Film | M3U8, MP4 | TR |
| 23 | **SelçukFlix** | `csnuvio-selcukflix` | Film, Dizi | M3U8, MP4 | TR |
| 24 | **SineWix** | `csnuvio-sinewix` | Film, Dizi | M3U8, MP4 | TR |
| 25 | **SinemaTV** | `csnuvio-sinematv` | Film, Dizi | M3U8, MP4 | TR |
| 26 | **AnimeciX** | `csnuvio-animecix` | Anime (Dizi & Film) | M3U8, MP4 | TR |
| 27 | **Anizm** | `csnuvio-anizm` | Anime (Dizi & Film) | M3U8, MP4 | TR |
| 28 | **BelgeselX** | `csnuvio-belgeselx` | Belgesel (Dizi & Film) | M3U8, MP4 | TR |
| 29 | **Watch2Movies** | `csnuvio-watch2movies` | Film, Dizi | M3U8, MP4 | EN / TR |

---

## 🛠️ Teknik Özellikler ve Mimari

* **QuickJS Uyumluluğu**: Tüm sağlayıcılar Nuvio'nun yerel QuickJS motorunda sorunsuz çalışacak şekilde tasarlanmıştır (bağımsız, sıfır harici paket bağımlılığı, CommonJS standardı).
* **Akıllı TMDB Entegrasyonu**: TMDB meta verileri (Türkçe ve orijinal başlıklar, yapım yılı, sezon ve bölüm bilgileri) üzerinden çok dilli akıllı başlık araması ve Levenshtein mesafe algoritmasıyla yüksek doğruluklu eşleştirme yapılır.
* **Otomatik Alan Adı Fallback (Yedek Alan Adları)**: Türkiye'de sıkça alan adı değişen siteler için dinamik ve çoklu alan adı tarama zinciri bulunur.
* **Gelişmiş Oynatıcı Çözücüleri**:
  * **DiziPal**: WebCrypto (PBKDF2 + AES-256-CBC) şifre çözümü.
  * **DiziMom**: `data-pv` ve Pilavyer `window.__PLAYER__` akış ayrıştırıcı.
  * **HDFilmCehennemi**: Rapidrame, VidRame, CloseLoad, Vidmoly ve HLS master playlist çözümlemeleri.
  * **AnimeciX & Anizm**: API & özel embed oynatıcı çözücüleri.

---

## 📂 Proje Yapısı

```text
csnuvio/
├── manifest.json       # Nuvio eklenti kataloğu (Sürüm 1.0.5, 29 sağlayıcı)
├── providers/          # QuickJS uyumlu scraper betikleri
│   ├── animecix.js
│   ├── anizm.js
│   ├── dizimom.js
│   ├── dizipal.js
│   ├── hdfilmcehennemi.js
│   └── ... (29 sağlayıcı)
└── README.md           # Dokümantasyon
```

---

## ⚖️ Yasal Uyarı / Disclaimer

Bu depoda yer alan betikler yalnızca açık web üzerindeki içerik indeksleme ve bağlantı ayrıştırma mantıklarını içerir. Bu depo hiçbir sunucuda ses, video veya medya dosyası barındırmaz. Telif hakları ilgili içerik sahiplerine ve platformlara aittir. Yalnızca eğitim ve araştırma amaçlı geliştirilmiştir.
