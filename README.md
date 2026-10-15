# Zuglak Studio 1.4

Privát, helyben futó 2D otthontervező három eredeti alaprajzzal, saját alaprajzokkal és integrált IKEA-bútorkatalógussal.

## Indítás

1. Csomagold ki a projektet teljes egészében.
2. Windows alatt indítsd az `INDITAS_WINDOWS.bat` fájlt (Python 3 szükséges).
3. Nyisd meg a böngészőben a <http://localhost:8765> címet.

Alternatíva a projekt mappájából:

```powershell
python -m http.server 8765
```

Az alkalmazásnak nincs futásidejű külső függősége és nincs szüksége internetkapcsolatra. A külső IKEA-termékoldal csak akkor nyílik meg, ha a felhasználó rákattint a hivatkozásra.

## Újdonságok az 1.4-ben

- Külön IKEA-katalógus név- és cikkszámkereséssel, hat kategória szűrőjével.
- Ellenőrzött kezdőkatalógus kanapékkal, fotelekkel, gardróbokkal, ággyal, asztalokkal, székkel és tárolóbútorokkal.
- IKEA Hungary terméklink importálása:
  - a helyi katalógusban szereplő terméket automatikusan felismeri;
  - más terméknél az URL-ből csak a biztosan kiolvasható adatokat tölti elő;
  - a hiányzó méreteket kötelező kézzel, a hivatalos termékoldal alapján megadni.
- Külön, tartós Kedvencek gyűjtemény.
- Részletesebb, saját felülnézeti vektoros bútorrajzok, IKEA-fotók másolása nélkül.
- Az eredeti termékméret megjelenik a tulajdonságpanelen, és látható, ha a terven átméretezték.
- Saját PNG/JPEG/WebP alaprajz külön helyiségként feltölthető, majd kalibrálható.
- A JSON-mentés a kedvenceket és a saját alaprajzokat is tartalmazza.

## IKEA-adatok és importbiztonság

A kurált termékadatok az `ikea-catalog.js` fájlban, az alkalmazáslogikától elkülönítve találhatók. A termékek külső, összeszerelt méreteit és cikkszámait a hivatkozott nyilvános IKEA Hungary termékoldalak alapján 2026-10-15-én ellenőriztük.

Az alkalmazás nem végez automatikus scrapinget, nem kerül meg hozzáférési korlátozást, és nem próbál méretet kitalálni. Ismeretlen linknél a név és cikkszám URL-ből történő előkitöltése csak segítség; a felhasználónak kell ellenőriznie és megadnia a hivatalos külső szélességet és mélységet. Az IKEA-termékek elérhetősége és adatai később változhatnak, ezért vásárlás előtt mindig ellenőrizd a hivatkozott termékoldalt.

## Megmaradt szerkesztési funkciók

- három eredeti szobaterv és átnevezhető helyiségek;
- több berendezési változat helyiségenként;
- saját alaprajz feltöltése és méretarány-kalibrálás;
- húzás, forgatás, másolás, átméretezés és törlés;
- zoom, pásztázás, mérés és 5 cm-es rácshoz igazítás;
- visszavonás és újra, legfeljebb 60 állapotig az aktuális munkamenetben;
- helyi automatikus mentés, PNG-export, JSON-mentés és -betöltés.

Gyorsbillentyűk: `Ctrl+D` másolat, `Delete` törlés, nyilak 1 cm-es mozgatás, `Shift` + nyilak 10 cm, `Ctrl+Z` / `Ctrl+Y` visszavonás / újra.

## Adattárolás és kompatibilitás

- Tervek: `localStorage` / `zuglak-v2`.
- Kedvencek: `localStorage` / `zuglak-favorites-v1`.
- A korábbi 1.x tervséma változatlan maradt; a régi `zuglak-v2` adatok automatikusan betöltődnek.
- A saját alaprajz képe a tervvel együtt, helyben tárolódik. A böngészőtárhely védelmében egy feltöltés legfeljebb 3 MB lehet.

A helyi mentés böngészőhöz és webcímhez kötött, eszközök között nem szinkronizál. Rendszeresen készíts JSON-mentést. A program meglévő tervet csak megerősítés után ír felül vagy töröl.

## Fejlesztői ellenőrzés

Node.js 20 vagy újabb verzióval:

```powershell
npm test
npm run check
npm run test:ui
```

A tesztek lefedik az IKEA URL-feldolgozást, a méretadatok szigorú validálását és megőrzését, a kedvencek tartós tárolását, a hibás adatok izolálását, valamint a régi tervformátum kompatibilitását. A `test:ui` Chrome vagy Edge headless módjában ellenőrzi a katalógust, a keresést, a kedvenceket, az ismert és kézi termékimportot, a bútorműveleteket, a saját alaprajz feltöltését és a tablet-elrendezést. Egyedi böngészőútvonal a `CHROME_PATH` környezeti változóval adható meg.

## Pontossági korlát

Az eredeti szobaképek egyes rajzolt szakaszai nem pontosan arányosak a felírt centiméterekkel. A program egy referencia-szakasz alapján becsült méretarányt használ, nem geometriailag rekonstruált CAD-alaprajzot. Bútorvásárlás előtt ellenőrizd a helyszíni méreteket.
