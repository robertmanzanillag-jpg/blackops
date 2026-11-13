# Clippers: inventario motivacional de siete días

El paquete contiene exactamente 70 Shorts originales de texto: 35 ES y 35 EN, organizados en siete jornadas de cinco piezas por canal. Los conceptos ingleses se escribieron de forma nativa y no forman pares de traducción literal con los españoles.

| Día | Temas ES | Themes EN |
| ---: | --- | --- |
| 1 | disciplina, rechazo, miedo, consistencia, empezar tarde | focus, fresh start, patience, self-trust, setback |
| 2 | perfeccionismo, procrastinación, comparación, límites, conversación difícil | curiosity, first draft, protect morning, better question, be seen |
| 3 | decisiones, distracciones, error, progreso invisible, pedir oportunidad | simplify system, end indecision, deliberate practice, keep appointments, release sunk cost |
| 4 | principiante, paciencia, respeto propio, responsabilidad, incertidumbre | build evidence, choose environment, next constraint, feedback without identity, finish before expand |
| 5 | terminar, decir no, reiniciar el día, prioridades, promesas pequeñas | beginner question, honest pace, resist urgency, work in silence, take initiative |
| 6 | crítica, confianza, camino solitario, volver tras una pausa, estándares | recover momentum, make room, standards over mood, clarity through writing, direct message |
| 7 | tomar control, adaptabilidad, preparación, gratitud activa, largo plazo | prepare for pressure, steady leadership, resourcefulness, choose responsibility, next door |

## Contrato editorial

Cada manifest declara:

- `launchDay` entre 1 y 7 y `launchPosition` entre 1 y 5;
- canal estable `motivation-es` o `motivation-en` con el idioma correspondiente;
- conflicto en `hook`, desarrollo en `beats` y una acción práctica en `close`;
- guion `owned_original`, sin fuentes, citas ni discursos externos;
- todas las exclusiones de seguridad requeridas;
- gate aprobado con hook inmediato, cierre accionable y `noQuotaFiller: true`.

Los scripts son distintos por texto, hook, close y tema. Un candidato rechazado en revisión no autoriza una variante débil para completar cinco.

## Audio procedural

Los 70 manifests sustituyen la voz por `audio.mode: "procedural_original"`. Cada plan usa:

- un seed entero exclusivo;
- 24–28 segundos;
- ruido rosa con amplitud 0.08–0.12;
- high-pass entre 45–75 Hz y low-pass entre 3200–4200 Hz;
- volumen entre -18 y -15 dB y fades entre 0.8–1.4 segundos;
- procedencia `owned_original`, generador local `ffmpeg_lavfi_anoisesrc_v1`, sin red, terceros ni costo.

El renderer crea audio determinista con FFmpeg, verifica MP4 1080×1920 con audio, genera subtítulos y frames de evidencia, deduplica guion/manifest/plan de audio y mantiene `publishEnabled: false` y costo USD 0.

## Cuotas y secuencia

El límite es cinco renders diarios por `channelId` en America/New_York. Por eso cada jornada tiene exactamente cinco ES y cinco EN. Los canales mantienen contadores separados; intentar una sexta pieza del mismo canal y día debe bloquearse con `daily_channel_render_limit_reached`.

Antes de programar se debe revisar la salida visual, la legibilidad completa, el ritmo y la cuenta correcta. Este inventario prepara producción; no concede autorización automática de publicación.

## Validación local

La comprobación estática debe confirmar: 70 archivos, 35 por idioma, siete días completos, cinco por día/canal, forma sin blockers, seeds únicos, planes procedurales únicos, ausencia de `voice`, ausencia de campos externos, hooks/closes/scripts únicos y `noQuotaFiller: true`.

Como smoke test proporcional, se renderiza un manifest del día 1 por canal en un workspace temporal. Ambos deben producir MP4, audio procedural original, evidencia de derechos propia, costo USD 0 y publicación deshabilitada.
