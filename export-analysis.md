# Export button behavior

## Pistas y formato
- El botón **Exportar** crea un archivo `generated.mid` con **formato 0**: un solo track y un único canal de datos.【F:index.html†L2464-L2490】【F:index.html†L1769-L1805】
- No se exporta la pista de bajo usada en la previsualización; esa lógica está marcada explícitamente como "solo playback (NO export)".【F:index.html†L2429-L2458】

## Metadatos MIDI que escribe
- Inserta metadatos de **tempo fijo a 120 BPM** y de **compás 4/4** en el tick 0 antes de los eventos de nota.【F:index.html†L2467-L2485】
- Usa el valor `ppq` de la generación como división del archivo y no aplica swing al renderizado exportado.【F:index.html†L2467-L2489】

## Eventos de canal que exporta
- Antes de exportar, pasa por `normalizeExportEvents`: se vuelven a sanear solapes, se descartan anclajes/dummies (nota 0 con velocidad mínima) y se filtra todo lo que no sea Note On/Off.【F:index.html†L1769-L1805】
- El export final fuerza todos los eventos válidos al **canal 1 (MIDI ch 0)** para evitar que el DAW divida el archivo en varias pistas por canal.【F:index.html†L1769-L1805】【F:index.html†L2464-L2489】
- Cada evento se escribe con tick absoluto, tipo Note On/Off y datos de nota/velocidad dentro de ese único canal.【F:index.html†L1769-L1805】【F:index.html†L2464-L2489】

## Repeticiones y longitud
- La longitud total exportada depende de `generated.lengthTicks`, que resulta de concatenar los segmentos generados y aplicar filtros (densidad, límites de nota, etc.). Ese mismo `ppq`/longitud se refleja en el archivo exportado.【F:index.html†L2210-L2268】【F:index.html†L2276-L2290】【F:index.html†L2461-L2464】
