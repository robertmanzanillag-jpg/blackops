# Motivation Shorts: inventario de lanzamiento

Este directorio contiene exactamente 70 manifests listos para el renderer local:

- 35 guiones originales en español para `motivation-es`.
- 35 guiones originales escritos directamente en inglés para `motivation-en`; no son traducciones de los españoles.
- Siete días (`launchDay: 1..7`) con cinco candidatos por canal y día (`launchPosition: 1..5`).

Cada candidato tiene hook inmediato, dos beats, una acción específica y `qualityGate.noQuotaFiller: true`. No contiene citas, discursos, celebridades, podcasts, voces clonadas, promesas de riqueza o salud, ni fuentes externas.

## Audio seguro y original

Todos usan `audio.mode: "procedural_original"`. El audio es una cama no melódica de ruido rosa creada localmente por FFmpeg. Cada manifest tiene un seed numérico único y parámetros permitidos dentro de los límites del renderer. La procedencia declara:

- `status: "owned_original"`;
- generador `ffmpeg_lavfi_anoisesrc_v1`;
- cero activos de terceros;
- cero uso de red;
- costo pagado USD 0.

No existen campos `voice`, rutas placeholder, archivos descargados ni evidencia de derechos externa. El renderer registra el plan y su hash en la evidencia de salida.

## Uso del inventario

Renderiza únicamente los cinco manifests de cada idioma cuyo `launchDay` corresponda a la jornada. El límite técnico es cinco renders por `channelId` y día de America/New_York. Que un manifest forme parte del inventario no obliga a usarlo: si falla una revisión visual o editorial posterior, se rechaza y no se rellena la cuota con una pieza débil.

La generación no publica. Cada salida mantiene `publishEnabled: false` y requiere revisión separada antes de programarse.
