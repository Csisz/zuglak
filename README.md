# Zuglak Studio — MVP 1.2

Három eredeti, feltöltött szobaalaprajzot tartalmazó, helyben futó, 2D berendezéstervező.

## Indítás

1. Csomagold ki a ZIP-et teljes egészében.
2. Windows alatt indítsd az `INDITAS_WINDOWS.bat` fájlt (Python 3 kell hozzá).
3. Böngészőben nyisd meg: http://localhost:8765

Alternatíva: a mappában `python -m http.server 8765`, majd a fenti URL.

## Újdonságok az 1.2-ben

- Újratervezett Zuglak Studio felület, világos természetes színpaletta
- Bútorkereső
- Visszavonás és újra (max. 60 állapot, egy böngészős munkameneten belül)
- 5 cm-es igazítás bekapcsolható húzás után
- Ctrl+D: kijelölt bútor másolata; Delete: törlés
- Nyilak: 1 cm-es finommozgatás, Shift + nyilak: 10 cm
- Ctrl+Z / Ctrl+Y: visszavonás / újra
- Az eredeti 1.1 adatok a `zuglak-v2` böngésző-tárhelyről változatlanul betöltődnek, ha ugyanazon a címen futtatod.

## Korlátok

A feltöltött szobaképek egyes rajzolt szakaszai nem pontosan arányosak a felírt centiméterekkel. A v1.2 **becsült, egy referencia-szakasz alapján beállított méretarányt** használ, nem teljes értékű geometriailag rekonstruált CAD alaprajzot. Bútorvásárlás előtt ellenőrizzétek a tényleges méreteket.

A mentés egy böngészőn és azonos webcímen belül működik, nem szinkronizál eszközök között. Időnként töltsétek le a JSON tervmentést. A visszavonási előzmény csak az adott munkamenetben él.

A felület helyben fut, nem használ külső könyvtárakat, nem küld adatokat szerverre.
