# Zuglak Studio 2.1

Privát, helyben futó, magyar nyelvű otthontervező a saját helyiségeinkhez (négy szoba, építészeti tervrajz alapján): centiméter-pontos 2D szerkesztő, valódi 3D nézet ugyanabból a tervből, anyagkönyvtár, berendezési változatok és bemutató minőségű exportok. Internetkapcsolat, fiók vagy szerver nem kell (csak az opcionális AI tervezőhöz).

## Indítás

1. Csomagold ki a projektet teljes egészében.
2. Windows alatt indítsd az `INDITAS_WINDOWS.bat` fájlt (Python 3 szükséges) – a böngésző magától megnyílik.
3. Ha nem nyílik meg, nyisd meg kézzel: <http://localhost:8765>

Alternatíva a projekt mappájából: `python -m http.server 8765` (vagy `npm start`).

Fontos: a fájlt **ne** dupla kattintással (`file://`) nyisd meg – a 3D modul miatt helyi webszerver kell. Ajánlott böngésző: friss Chrome vagy Edge.

## Gyors használat

| Feladat | Hogyan |
| --- | --- |
| Helyiség és változat váltása | Felső sáv: *Helyiség* / *Berendezési változat* |
| Bútor hozzáadása | Bal oldali katalógus: kattintás (a nézet közepére kerül) vagy **húzás** a tervre |
| Mozgatás, forgatás, átméretezés | Húzás · forgató fogantyú (15°-os lépés, Shift: szabad) · sarokpontok (csak általános bútornál) |
| Pontos elhelyezés | Jobb panel: középpont X/Y, forgatás, *Falhoz tolás*, *Falhoz forgatás*, faltávolságok mind a 4 oldalon |
| Anyagok | Jobb panel (kijelölt bútor) vagy *Anyagok* fül: padló, falszín, konyhafront, munkalap |
| 2D ↔ 3D | Felül középen, vagy `1` / `2` billentyű. A 3D-ben a bútor húzással mozgatható. |
| 3D kamerák | Madártávlat · Perspektíva (a kamera felőli falak automatikusan levágódnak) · ortografikus felülnézet |
| Változatok | *Változatok* fül: másolat, üres, átnevezés, törlés, pillanatkép mentése és visszaállítása, két változat összevetése |
| Export | *Exportálás*: 2D PNG, 2D PDF (A4/A3), 3D kép; méretek, bútorlista, címblokk és háttér választható |
| Bemutató | *Bemutató* gomb vagy `P` – minden szerkesztőelem eltűnik; `Esc`: kilépés |
| AI tervező | *AI* fül: írd le, kinek és mire készül a szoba – az AI szerkeszthető berendezési változatot készít (lásd lent) |

Gyorsbillentyűk: `V` kijelölés · `H` / szóköz mozgatás · `M` mérés · `R` forgatás 90° · nyilak 1 cm, `Shift` + nyilak 10 cm · `Ctrl+D` másolat · `Del` törlés · `Ctrl+Z` / `Ctrl+Y` visszavonás / újra · `0` teljes nézet · `Alt` húzás közben: illesztés nélkül.

## A négy alaprajz – pontosság

Mind a négy helyiség az építészeti tervrajzok alapján készült (`assets/tervrajz-*.png`). A tervrajzon feliratozott falak megerősítettek; a csak a rajzról lemért szakaszok „≈ becsült” jelölést kapnak. A tervrajz háttérként a falak alá kapcsolható (Rétegek → Eredeti rajz alatta).

| Helyiség | Tervrajz | Fő méretek | Terv szerinti terület |
| --- | --- | --- | --- |
| Lányszoba – SZOBA III. | `tervrajz-szoba-1.png` | 4,56 × 6,00 m, lépcsőház- és kéménykiugrás, 2 ablak, ajtó | 18,27 m² (számolt: 18,81) |
| Konyha-étkező-nappali | `tervrajz-nappali.png` | 5,98 m széles, 4,41 + 0,43 + 2,70 m, faláttörés pillérrel, kandalló, ablak, 2 teraszajtó | 43,59 m² (a faláttörés nélkül) |
| SZOBA II. | `tervrajz-szoba-1-2.png` | 4,56 × 2,94 m, két 33 cm-es pillér, ablak, ajtó | 12,98 m² (pontosan egyezik) |
| SZOBA I. | `tervrajz-szoba-1-2.png` | 5,98 × 2,70 m, két erkélyajtó, ajtó | 16,15 m² (pontosan egyezik) |

Megjegyzések:

- **Lányszoba:** minden falnál látható a kézi felmérés értéke is (pl. felső fal: terv 250, mért 220), egy kattintással alkalmazható. Az eltérést valószínűleg a tetőtéri belső falburkolat okozza.
- **Nappali:** a bal felső, 1,00 m széles sáv a kapott tervrajz-kivágáson kívül esik, ezért 1,125 m mélységgel becsült. A teraszajtók és a konyhai ablak magassága a kivágásból nem olvasható (becsült). A kandalló magassága becsült (110 cm).
- A régi, rajzról vett vázlatgeometriák a korábbi mentésekben megmaradnak, és a *Helyiség* fülön visszaválaszthatók.

A *Helyiség* fülön minden falnál látszik a terv szerinti (és ahol van, a kézzel mért) érték; a *Szerkezet szerkesztése* után beírható a helyszínen mért hossz is. A falak, ajtók és ablakok alapesetben védettek a véletlen módosítás ellen.

További szabályok:

- A falvastagság (alapból 12 cm) és a belmagasság (260 cm) becsült, csak megjelenítési érték. A falvastagság kifelé rajzolódik, a belső, bútorozható méretek nem változnak.
- Az IKEA-termékek a termékoldal szerinti, ellenőrzött külső méretekkel szerepelnek (2026-10-15), és alapból nem méretezhetők át. Az általános bútorok **tipikus tervezési méretek**, nem termékadatok – a kártyán és a tulajdonságpanelen is így jelölve. A 3D modellek illusztrációk: a befoglaló méretük pontos, a formájuk nem termékspecifikus.
- Ismeretlen IKEA-terméknél a méreteket kézzel kell megadni; a program nem talál ki hiányzó adatot (a meg nem adott magasságot sem).
- A párbeszédablakok a *Mégse* gombbal vagy `Esc`-kel mindig bezárhatók, akkor is, ha egy mező hiányos; az `Enter` jóváhagy. Az Exportálás és az Összevetés ablak a háttérre kattintva is bezárul.
- Az ütközés-, faláthaladás-, ajtónyitás- és közlekedésisáv-jelzések tájékoztatóak, nem tiltják a szándékos átfedést (pl. szőnyeg, asztal alá tolt szék).

Vásárlás vagy kivitelezés előtt minden méretet a helyszínen is ellenőrizni kell.

## AI tervező (Anthropic Claude)

Az *AI* fülön leírhatod, kinek és mire készül a helyiség (pl. „Ez a szoba három kislánynak készül, kell 3 ágy, tanulósarok és sok tárhely”). Az AI a valós alaprajzot kapja meg (falak, ajtó nyitási íve, ablakok parapetmagassággal, kiugrások, pillérek, a meglévő bútorok) a katalógus méreteivel együtt, és konkrét elrendezést ad.

- Az eredmény **új, szerkeszthető berendezési változat** (pl. „AI – három lány”): minden bútor húzható, forgatható, törölhető; a saját változataid nem változnak.
- A program minden javaslatot ugyanazzal az ütközés-, falon kilógás-, ajtónyitás- és pillérellenőrzéssel vizsgál, mint a kézi tervezést. Ha hibát talál, automatikusan visszaküldi javításra (legfeljebb 2 kör); ami ezután is maradna, a válaszban figyelmeztetésként látszik.
- Ugyanabban a beszélgetésben kérhetsz módosítást („Cili ágya helyett legyen komód”) – ez az AI-változatot módosítja, a többi bútor a helyén marad, és Ctrl+Z-vel visszavonható –, vagy új alternatívát („Adj egy másik alternatívát”), ami külön változatba kerül.
- A válasz folyamatosan (streaming) érkezik, a panel alján látszik, mit csinál éppen az AI (gondolkodik, ír, hány bútort helyezett el) és mióta. Ha egy válasz túl hosszúra nyúlna, a program automatikusan egyszer tömörebben újrakéri.
- A katalógusban nem szereplő bútort (pl. emeletes ágy) az AI tipikus méretekkel javasolja; ezek „AI által javasolt méret” jelölést kapnak.
- Az IKEA-importnál ismeretlen terméknél a *Méretek beolvasása AI-val* gomb megnyitja a termékoldalt (Anthropic szerveroldali web_fetch, csak `www.ikea.com`), és kitölti a mezőket. Hozzáadás előtt ellenőrizd őket.

Beállítás: kulcsot a <https://console.anthropic.com> oldalon lehet létrehozni (Settings → API keys; a fiókon legyen egyenleg). A kulcsot az AI fül beállításaiban kell megadni. **A kulcs csak a böngésződ helyi tárhelyén (`zuglak-ai-key`) van, és kizárólag az `api.anthropic.com` felé megy ki**; a JSON-mentés nem tartalmazza. Modell: Claude Sonnet 5.5 (alapértelmezett) vagy Claude Opus 5.5. Az AI nélkül a program minden más funkciója változatlanul, internet nélkül működik.

## Adattárolás, mentés

- Tervek: `localStorage` / `zuglak-v3` (sémaverzió: 3, minden pozíció centiméterben).
- Az 1.x adatok (`zuglak-v2`) első induláskor automatikusan átkerülnek; a régi kulcsot a program **soha nem írja felül**, így az érintetlen biztonsági másolatként megmarad. A régi, képpontban tárolt bútorpozíciók az adott helyiség saját kalibrációjával váltódnak át centiméterre, így semmi nem mozdul el a rajzhoz képest.
- Kedvencek: `zuglak-favorites-v1` (változatlan).
- A *Változatok* fülön JSON biztonsági mentés készíthető és tölthető vissza (1.x és 2.0 fájl is). A böngészőtárhely gépenként és böngészőnként külön van – rendszeresen készíts JSON-mentést.

## Felépítés

Keretrendszer és build lépés nélküli, modulárisan szétválasztott kód:

| Fájl | Feladat |
| --- | --- |
| `core.js` | adatmodell, migráció, változatok és pillanatképek, IKEA-import ellenőrzése |
| `geometry.js` | tiszta geometria: ütközés, illesztés, igazítási segédvonalak, faltávolság, falvastagság-offset, forgatás a középpont körül |
| `floorplans.js` | a három alaprajz rajzról vett falpontjai, a rajz feliratai és az ellentmondások leírása |
| `catalog.js`, `ikea-catalog.js` | bútorkatalógus (ellenőrzött IKEA + tipikus általános elemek) |
| `materials.js` | anyagkönyvtár és procedurális textúrák (közös a 2D és a 3D számára) |
| `furniture2d.js` | felülnézeti bútorrajzok és katalógusképek |
| `models3d.js`, `view3d.js` | procedurális 3D bútormodellek és a Three.js jelenet (PBR anyagok, lágy árnyék, AO) |
| `app.js` | szerkesztő, panelek, előzmények, exportok |
| `ai.js` | AI tervező: szobaleírás, Claude API-hívás, elrendezés-ellenőrzés és -javítás, IKEA-oldal beolvasása |
| `pdf.js` | függőség nélküli PDF-író |
| `vendor/` | helyben tárolt Three.js r169 (MIT) és Inter betűtípus (OFL) |

## Fejlesztői ellenőrzés

Node.js 20 vagy újabb:

```powershell
npm test          # 52 egységteszt: geometria, migráció, változatok, katalógus, PDF, AI (mockolt API)
npm run check     # szintaxis-ellenőrzés + egységtesztek
npm run test:ui   # teljes böngészős végigjátszás headless Chrome/Edge-dzsel
```

A böngészős teszt valódi egérhúzással, billentyűkkel és fájlexporttal ellenőrzi: katalógus, húzás, forgatás, visszavonás, 2D–3D szinkron, anyagok, változatok és pillanatképek, IKEA-import, párbeszédablakok bezárása és jóváhagyása, AI tervező (mockolt API-val), védett falszerkesztés, ajtóelhelyezés, PNG/PDF/3D export, mentés újratöltés után, 1.x migráció és tablet elrendezés. Egyedi böngésző: `CHROME_PATH`; képernyőképek az `artifacts` mappába: `$env:CAPTURE_UI='1'; npm run test:ui`.

## Ismert korlátok

- A tervrajz szerkezeti méreteket mutat; a kész (burkolt) belső méret néhány centivel kisebb lehet – vásárlás előtt mérj a helyszínen.
- A bútorok 3D modelljei procedurálisak (helyben generáltak); külső glTF-modell betöltése nincs.
- A 3D nézethez WebGL kell; gyengébb gépen az AO (✦ gomb) kikapcsolható.
- A helyi tárhely böngészőnként kb. 5 MB; nagyon sok pillanatkép esetén JSON-mentés ajánlott.
