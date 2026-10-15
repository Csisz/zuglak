# Zuglak Studio 1.5

Privát, helyben futó, magyar nyelvű 2D otthontervező három eredeti alaprajzzal, saját alaprajzokkal, integrált IKEA-bútorkatalógussal és centiméter-alapú intelligens szobatervezővel.

## Indítás

1. Csomagold ki a projektet teljes egészében.
2. Windows alatt indítsd az `INDITAS_WINDOWS.bat` fájlt (Python 3 szükséges).
3. Nyisd meg a böngészőben a <http://localhost:8765> címet.

Alternatíva a projekt mappájából:

```powershell
python -m http.server 8765
```

Az alkalmazásnak nincs futásidejű külső függősége és internetkapcsolat nélkül is működik. Külső IKEA-termékoldal csak felhasználói kattintásra nyílik meg.

## Újdonságok az 1.5-ben

- Négy külön szerkesztési mód: **Berendezés**, **Falak és méretek**, **Nyílászárók** és **Mérés**.
- Képtől független, centiméter-alapú szobageometria: falpontok rajzolása és húzása, poligon zárása, több geometria mentése helyiségenként.
- Pontos falhossz kézi megadása. A program ilyenkor a falszakasz végpontját módosítja, ezért a rajz és a valós méret eltérése kézzel korrigálható.
- Közvetlenül az alaprajzon látható falméretek; a nem megerősített, képről felvett értékek `≈` jelölést kapnak.
- Kapcsolható intelligens illesztés falakhoz, más bútorok éleihez és 5 cm-es szobarácshoz, vizuális segédvonalakkal. A számítás a bútor forgatását és az aktuális nagyítást is figyelembe veszi.
- Valós, forgatott téglalap-geometrián alapuló, nem blokkoló figyelmeztetések bútorütközésre, szobahatár átlépésére és ajtónyitási terület metszésére.
- Falhoz kötött, szerkeszthető ajtók nyitási ívvel és iránnyal, ablakok és radiátorok valós centiméteres méretekkel.
- Kézi távolságmérés, valamint választható 70 és 80 cm-es segédsáv a kijelölt bútor körül.
- A PNG-export a szobageometriát, a méretfeliratokat és az építészeti elemeket is tartalmazza.
- Verziózott, automatikus 1.x → 1.5 adatmigráció, az eredeti adat első migráció előtti biztonsági másolatával.

### Javasolt munkamenet

1. Ha szükséges, tölts fel saját alaprajzot.
2. A **Skála** eszközzel kalibrálj egy ismert hosszúságú szakaszt.
3. A **Falak és méretek** módban hozz létre geometriát, kattintsd végig a falpontokat, majd zárd a poligont.
4. A tulajdonságpanelen add meg az ismert falhosszakat. Ismeretlen értéket ne becsülj meg.
5. A **Nyílászárók** módban helyezd el az ajtókat, ablakokat és radiátorokat.
6. A **Berendezés** módban kapcsold be a kívánt illesztéseket, majd rendezd el a bútorokat.

A falrajzolás és a skálakalibrálás aktuális lépései a vászon feletti súgóban jelennek meg.

## Megmaradt 1.4 és korábbi funkciók

- három eredeti szobaterv, átnevezhető helyiségek és több berendezési változat;
- saját PNG/JPEG/WebP alaprajz feltöltése és kalibrálása;
- IKEA-katalógus név- és cikkszámkereséssel, kategóriaszűrővel és tartós kedvencekkel;
- ismert IKEA Hungary terméklink felismerése, ismeretlen termékhez kötelező kézi adatbevitel;
- részletes felülnézeti vektoros bútorrajzok;
- húzás, forgatás, másolás, átméretezés és törlés;
- zoom, pásztázás, visszavonás és újra;
- helyi automatikus mentés, PNG-export, JSON-mentés és -betöltés.

Gyorsbillentyűk: `Ctrl+D` másolat, `Delete` törlés, nyilak 1 cm-es mozgatás, `Shift` + nyilak 10 cm, `Ctrl+Z` / `Ctrl+Y` visszavonás / újra. A geometria módosításai ugyanebbe a visszavonási előzménybe kerülnek.

## IKEA-adatok és importbiztonság

A kurált termékadatok az `ikea-catalog.js` fájlban, az alkalmazáslogikától elkülönítve találhatók. A termékek külső, összeszerelt méreteit és cikkszámait a hivatkozott nyilvános IKEA Hungary termékoldalak alapján 2026-10-15-én ellenőriztük.

Az alkalmazás nem végez automatikus scrapinget, nem kerül meg hozzáférési korlátozást, és nem talál ki hiányzó adatot. Ismeretlen linknél az URL-ből biztosan kiolvasható név vagy cikkszám csak előkitöltési segítség; a felhasználónak kell a hivatalos termékoldal alapján megadnia és ellenőriznie a külső szélességet és mélységet. Az IKEA adatai később változhatnak, ezért vásárlás előtt mindig ellenőrizd a termékoldalt.

## Adattárolás és kompatibilitás

- Tervek: `localStorage` / `zuglak-v2` (a kulcs nem változott).
- Kedvencek: `localStorage` / `zuglak-favorites-v1`.
- Első sikeres régiadat-migráció előtti másolat: `localStorage` / `zuglak-v2-backup-v1`.
- A jelenlegi tervséma verziója `2`; a régi, `version: 1` helyi adatok és JSON-mentések betöltéskor automatikusan, veszteség nélkül kapják meg az új geometriai mezőket.
- A saját alaprajz képe a tervvel együtt, helyben tárolódik. A böngészőtárhely védelmében egy feltöltés legfeljebb 3 MB lehet.

A helyi mentés böngészőhöz és webcímhez kötött, eszközök között nem szinkronizál. Rendszeresen készíts JSON-mentést. A program meglévő tervet csak megerősítés után ír felül vagy töröl.

## Pontosság és korlátok

Az alaprajzkép és a centiméteres szobageometria szándékosan két külön réteg. Egyetlen skálakalibráció nem bizonyítja, hogy a teljes kép egységesen méretarányos; az ismert falhosszakat kézzel kell helyesbíteni. A program nem talál ki hiányzó méreteket.

Az ütközésjelzések tájékoztatóak és nem tiltják a szándékos átfedést, például szőnyeg és bútor esetén. A 70/80 cm-es sáv egy kijelölt bútor körüli vizuális ellenőrzés, nem útvonaltervezés: az alkalmazás megfelelő pathfinding nélkül nem állítja, hogy a teljes szabad padló járható útvonal.

Vásárlás vagy kivitelezés előtt minden méretet a helyszínen is ellenőrizni kell.

## Fejlesztői ellenőrzés

Node.js 20 vagy újabb verzióval:

```powershell
npm test
npm run check
npm run test:ui
```

Az egységtesztek lefedik a pixel–centiméter átalakítást, pont-poligon vizsgálatot, falszakasz-metszést, forgatott bútorok ütközését, szobahatár-sértést, fal/bútor/rács illesztést, ajtónyitási területet, IKEA-importot, tartós kedvenceket, mentést és verziómigrációt. A headless Chrome/Edge smoke teszt az 1.4 regressziók mellett végigjárja a falgeometriát, pontos méretet, ajtóelhelyezést, mérést, snappinget, ütközési figyelmeztetést és tablet-elrendezést. Egyedi böngészőútvonal a `CHROME_PATH` környezeti változóval adható meg.
