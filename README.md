# CSNuvio - Nuvio Eklenti & Katalog Deposu (v1.0.15)

**CSNuvio**, [CloudStream GSRepo](https://github.com/csprofesor/gsrepo) eklentilerinin [Nuvio](https://nuvio.app) video oynatıcısı ve eklenti ekosistemi için JavaScript (QuickJS) çalışma ortamına uyarlanmış resmi eklenti deposudur.

Türkiye'nin popüler film, dizi, anime ve belgesel platformlarından içerik akışlarını (HLS/m3u8 ve MP4) Nuvio üzerinde **1.2 ~ 2.2 saniye arasında ışık hızında** ve **1080p yüksek kalitede** oynatmayı sağlar.

---

## 🔗 Nuvio'ya Depo ve Katalog Ekleme

Nuvio uygulamasında eklenti deposu (Repository) olarak aşağıdaki **Manifest URL** bağlantılarını ekleyebilirsiniz:

### 📌 Ana Manifest URL:
```text
https://raw.githubusercontent.com/csprofesor/csnuvio/main/manifest.json
```

### 🌐 CDN Alternatif URL (İSS / DNS Kısıtlamaları İçin):
```text
https://cdn.jsdelivr.net/gh/csprofesor/csnuvio@main/manifest.json
```

---

## 📱 Kurulum ve Kullanım Adımları

1. **Nuvio** uygulamasını açın.
2. **Ayarlar (Settings)** > **Depolar (Repositories / Scrapers)** bölümüne gidin.
3. **Depo Ekle (Add Repository)** butonuna tıklayın.
4. Yukarıdaki **Manifest URL** bağlantısını yapıştırıp kaydedin.
5. **Sonuç:**
   * **28 Adet Oynatıcı Eklentisi** otomatik yüklenir.
   * **Ana Sayfa / Keşfet (Discover)** sekmesinde 500+'den fazla görsel afişli dizi, film ve anime kataloğu otomatik dizilir.
   * Ekranı aşağı kaydırdıkça (Infinite Scroll) binlerce film ve dizi dinamik olarak yüklenmeye devam eder.

---

## 🎨 Ana Sayfa Katalog Akışları (Keşfet)

Depo eklentilerimiz Nuvio Ana Sayfası için görsel afişli ve kategorize edilmiş 3 ana katalog sunar:

* 🔥 **Nuvio Trend Filmler Kataloğu:** *HDFilmCehennemi, SelçukFlix, FullHDFilm, FilmKovası, JetFilmizle, KültFilmler*
* 📺 **Nuvio Popüler Diziler Kataloğu:** *Dizilla, DiziPal, DiziGom, DiziKorea, DiziMom, DiziMag*
* 🌸 **Nuvio Popüler Animeler Kataloğu:** *AnimeciX, Anizm*

---

## 📺 Desteklenen Sağlayıcılar (28 Adet)

| # | Sağlayıcı | ID | Tür | Formatlar | Dil / Çözünürlük |
|---|---|---|---|---|---|
| 1 | **HDFilmCehennemi** | `csnuvio-hdfilmcehennemi` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 2 | **SelçukFlix** | `csnuvio-selcukflix` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 3 | **SetFilmİzle** | `csnuvio-setfilmizle` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 4 | **JetFilmizle** | `csnuvio-jetfilmizle` | Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 5 | **FilmModu** | `csnuvio-filmmodu` | Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 6 | **FilmMakinesi** | `csnuvio-filmmakinesi` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 7 | **FilmKovası** | `csnuvio-filmkovasi` | Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 8 | **FullHDFilm** | `csnuvio-fullhdfilm` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 9 | **KültFilmler** | `csnuvio-kultfilmler` | Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 10 | **SinemaCX** | `csnuvio-sinemacx` | Film | M3U8, MP4 | TR (1080p Dublaj) |
| 11 | **SinemaTV** | `csnuvio-sinematv` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj) |
| 12 | **Dizilla** | `csnuvio-dizilla` | Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 13 | **DiziPal** | `csnuvio-dizipal` | Dizi, Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 14 | **DiziGom** | `csnuvio-dizigom` | Dizi, Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 15 | **DiziMom** | `csnuvio-dizimom` | Dizi, Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 16 | **DiziMag** | `csnuvio-dizimag` | Dizi, Film | M3U8, MP4 | TR (1080p Altyazı) |
| 17 | **DiziKorea** | `csnuvio-dizikorea` | Asya / Dizi | M3U8, MP4 | TR (1080p Altyazı) |
| 18 | **AnimeciX** | `csnuvio-animecix` | Anime (Dizi & Film) | M3U8, MP4 | TR (480p/720p/1080p) |
| 19 | **Anizm** | `csnuvio-anizm` | Anime (Dizi & Film) | M3U8, MP4 | TR (1080p Altyazı) |
| 20 | **TavsiyeFilmİzle** | `csnuvio-tavsiyefilmizle` | Film | M3U8, MP4 | TR (1080p Dublaj) |
| 21 | **HintFilmİzle** | `csnuvio-hintfilmizle` | Hint / Film | M3U8, MP4 | TR (1080p Altyazı) |
| 22 | **DDizi** | `csnuvio-ddizi` | Dizi | M3U8, MP4 | TR (720p) |
| 23 | **YabancıDizi** | `csnuvio-yabancidizi` | Dizi, Film | M3U8, MP4 | TR (1080p Altyazı) |
| 24 | **SezonlukDizi** | `csnuvio-sezonlukdizi` | Dizi | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 25 | **DiziBox** | `csnuvio-dizibox` | Dizi | M3U8, MP4 | TR (1080p Altyazı) |
| 26 | **Webteİzle** | `csnuvio-webteizle` | Film | M3U8, MP4 | TR (1080p Dublaj/Altyazı) |
| 27 | **SineWix** | `csnuvio-sinewix` | Film, Dizi | M3U8, MP4 | TR (1080p Dublaj) |
| 28 | **Watch2Movies** | `csnuvio-watch2movies` | Film, Dizi | M3U8, MP4 | EN (1080p) |

---

## ⚡ Gelişmiş Teknik Özellikler ve Mimari

* **%100 QuickJS Uyumluluğu**: Node.js bağımlılıkları (`Buffer`, `require("crypto")`, `URLSearchParams`) kaldırılmış, Nuvio'nun yerel QuickJS motorunda çökmeden çalışan saf JavaScript polyfill'leri enjekte edilmiştir.
* **Katı Üst Hız Sınırı (2.2s Hard Cap)**: `Promise.race` mimarisiyle hiçbir yavaş eklenti Nuvio ekranında yükleme simgesini 2.2 saniyeden fazla bekletemez.
* **Gelişmiş Oynatıcı & Şifre Çözücüler**:
  * **SetFilmİzle**: `SetPlay` XOR & `X-Sp` jeton hesabı ile doğrudan HLS Master Playlist çekimi.
  * **HDFilmCehennemi**: `data-rm-k` WebCrypto AES/PBKDF2 ve Pichive çözümü.
  * **SelçukFlix & Dizilla**: `9bYMCNQiWsXIYFWYAu7EkdsSbmGBTyUI` AES-256-CBC çözümü.
  * **JetFilmizle**: `jetplayer` POST & `videopark` worker API çözümü.

---

## 📂 Proje Yapısı

```text
csnuvio/
├── manifest.json       # Nuvio eklenti deposu ve katalog tanımı (Sürüm 1.0.15)
├── providers/          # QuickJS uyumlu scraper betikleri (28 Sağlayıcı)
│   ├── animecix.js
│   ├── anizm.js
│   ├── dizilla.js
│   ├── hdfilmcehennemi.js
│   ├── jetfilmizle.js
│   ├── selcukflix.js
│   └── ...
└── README.md           # Dokümantasyon
```

---

## ⚖️ Yasal Uyarı / Disclaimer

Bu depoda yer alan betikler yalnızca açık web üzerindeki içerik indeksleme ve bağlantı ayrıştırma mantıklarını içerir. Bu depo hiçbir sunucuda ses, video veya medya dosyası barındırmaz. Yalnızca eğitim ve araştırma amaçlı geliştirilmiştir.
