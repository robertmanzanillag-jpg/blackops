# Flujo de Edicion - Black Room Radio

## Cada jueves

1. Descarga los videos desde VLC como siempre. El script los busca automaticamente en:
   `~/Movies`

2. Si algun dia quieres poner videos manualmente, usa:
   `radio_video_edits/01_originales`

3. Si tienes un ejemplo visual o captura de referencia, ponlo en:
   `radio_video_edits/02_referencias`

4. Corre el editor automatico:
   `scripts/edit-radio-videos.sh`

5. Los videos finales quedan listos para subir en:
   `radio_video_edits/03_listos_para_subir`

6. Si Google Drive Desktop esta conectado en la Mac, tambien se copian automaticamente a:
   `videos editado para ig`

## Que hace el script

- Crea videos tipo post de Instagram 4:5, en 1080x1350.
- Exporta clips de 30 segundos cuando el video original tiene suficiente duracion.
- Si el video original es mas corto de 30 segundos, lo resume con cortes visibles en vez de dejarlo corrido completo.
- Hace varios cortes automaticamente, tomando momentos repartidos del video original.
- Usa el estilo de referencia: fondo negro de post IG, video horizontal a ancho completo y centrado.
- No agrega texto, logo ni marcas. El nombre del DJ y BR deben venir dentro del video original.
- Mantiene el audio sincronizado.
- Usa el nombre del archivo original/template para nombrar el video final.
- Busca automaticamente en `~/Movies`, ignorando carpetas de apps/cache como `CapCut`, `JianyingPro` y `Cache`.
- Copia los `.mp4` finales a una carpeta de Google Drive llamada `videos editado para ig` cuando Google Drive Desktop esta montado.
- Deja archivos `.mp4` listos para montar.

## YouTube por chat

Tambien puedes pedirlo en el chat del asistente con un link de YouTube y una carpeta de Google Drive:

`sacame los clips de radio de https://youtu.be/... y guardalos en carpeta Radio Junio del Drive`

Por defecto el asistente busca el drop dentro del mismo video que esta editando y usa ese audio recortado al largo exacto de cada clip. Tambien puedes darle un segundo link si algun dia quieres usar una cancion/audio externo como drop:

`sacame los clips de radio de https://youtu.be/VIDEO con el drop de esta cancion https://youtu.be/CANCION y guardalos en carpeta Radio Junio del Drive`

El asistente descarga el YouTube, genera los clips horizontal Instagram y vertical TikTok, y los sube a esa carpeta. Para el audio, busca el drop por volumen. Si no das segundo link, usa el drop del mismo video fuente. Si das un link de cancion, descarga ese audio externo, busca su drop y lo recorta al largo exacto de cada clip.

Si la carpeta no existe, no la crea automaticamente: deja una confirmacion pendiente para que apruebes crearla y guardar ahi. Si hay varias carpetas con el mismo nombre, te pide la ruta completa, por ejemplo:

`Robert A/Videos de Black Room/Radio Junio`

Tambien puede crear carpetas o subcarpetas por chat:

`en la carpeta de radio crea una carpeta con los videos que creaste`

Eso crea una ruta tipo `radio/Videos creados`. Si quieres un nombre exacto, dilo directo:

`crea una subcarpeta Junio en la carpeta Robert A/Videos de Black Room del Drive`

Para descargar YouTube usa `yt-dlp` o `python3 -m yt_dlp`.

## Calidad y costo

El render usa `ffmpeg` local con H.264, CRF 18 y preset `slow`. Eso busca buena calidad visual y archivos razonables sin usar servicios pagos. La calidad final nunca puede ser mayor que la del video original de YouTube o VLC, pero el export evita compresion agresiva.

Costo estimado por video editado: `$0.00 USD`.

Notas de costo:

- `yt-dlp` es gratis.
- `ffmpeg` corre localmente en la Mac/servidor, sin costo por render.
- Google Drive API no cobra por subir archivos.
- El unico costo posible es almacenamiento de Google Drive si la cuenta se queda sin espacio.

## Formato de archivos

El script usa el nombre del archivo que descarga VLC. Por ejemplo:

`2026-06-18_radio_dj_nombre.mp4`

El resultado saldra asi:

`2026-06-18_radio_dj_nombre_30s_reel.mp4`

## Notas

Si quieres cortes exactos, podemos agregar un archivo de timestamps por video. Por ahora el flujo automatico saca cortes repartidos para que el reel tenga movimiento sin tener que marcar tiempos manualmente.

Si un video ya fue editado y existe en la carpeta final, el script lo salta para no repetir trabajo. Para regenerarlo:

`FORCE=1 scripts/edit-radio-videos.sh`

## Opciones utiles

Mas cortes:

`CUTS=10 scripts/edit-radio-videos.sh`

Video vertical full-screen en vez de estilo post:

`STYLE=full scripts/edit-radio-videos.sh`

Duracion diferente:

`TARGET_SECONDS=45 scripts/edit-radio-videos.sh`

Usar otra carpeta de entrada:

`SOURCE_DIR=/ruta/a/la/carpeta scripts/edit-radio-videos.sh`

Buscar mas profundo dentro de `Movies`:

`SEARCH_DEPTH=5 scripts/edit-radio-videos.sh`

Usar una carpeta especifica de Google Drive:

`DRIVE_OUTPUT_DIR="/ruta/a/Google Drive/videos editado para ig" scripts/edit-radio-videos.sh`
