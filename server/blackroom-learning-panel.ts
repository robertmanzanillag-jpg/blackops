/** Small standalone renderer for the server-rendered BlackRoom control page. */
export const blackRoomLearningPanelHtml = `<section class="info" aria-labelledby="learningTitle"><h2 id="learningTitle">Aprendizaje verificable</h2><p>Las métricas se comparan por red y a la misma edad. La plataforma puede informar con retraso.</p><div id="learningEvidence" role="status" aria-live="polite" aria-atomic="true">Esperando datos del servidor…</div></section>`;

export const blackRoomLearningPanelScript = String.raw`
function renderLearning(d) {
  const target = document.getElementById('learningEvidence');
  if (!target) return;
  const latest = [...(d.remote?.commands || [])].reverse().find(command => command.type === 'ceo_schedule');
  const candidates = [latest?.analytics, d.agent?.analytics].filter(Boolean)
    .sort((a,b) => (Date.parse(b.lastCheckedAt) || 0) - (Date.parse(a.lastCheckedAt) || 0));
  const decisions = candidates[0]?.verifiedLearning || {};
  const labels = {missing:'Sin métricas verificables',stale:'Métricas antiguas: adaptación detenida',collecting:'Recolectando evidencia',testing:'Comparando prueba controlada'};
  const lines = ['tiktok','facebook','youtube'].map(network => {
    const source = d.remote?.analyticsImports?.[network];
    const coverage = source?.snapshotCoverage || {};
    const detail = ' · Asociación exacta: ' + (source?.exactAttributed || 0) + '/' + (source?.sampleCount || 0)
      + ' · Mediciones 24h/72h/7d: ' + [24,72,168].map(hours => coverage[hours] || 0).join('/');
    const item = decisions[network];
    if (!item) return network + ': sin evaluación verificable disponible.' + detail;
    const stamp = item.sourceObservedAt ? new Date(item.sourceObservedAt) : null;
    const observed = stamp && Number.isFinite(stamp.getTime()) ? stamp.toLocaleString() : 'sin registro';
    const stale = stamp && Number.isFinite(stamp.getTime()) && Date.now() - stamp.getTime() > 12 * 3600000;
    return network + ': ' + (labels[stale ? 'stale' : item.status] || labels.missing)
      + ' · Recolección: ' + observed
      + ' · Muestras comparables: ' + (item.matchedSnapshots || 0)
      + ' · Ventana: ' + (item.windowHours ? item.windowHours + 'h' : 'pendiente')
      + ' · ' + (item.reason || 'Sin decisión')
      + ' · Decisión: ' + (item.id || 'pendiente') + detail;
  });
  const collector = d.remote?.device?.worker?.automaticAnalytics;
  if (!collector) lines.push('Recolector automático: sin estado confirmado.');
  else {
    lines.push('Recolector automático: ' + (collector.setupRequired ? 'requiere iniciar sesión' : collector.running ? 'descargando métricas' : 'en espera'));
    for (const [network,error] of Object.entries(collector.errors || {})) lines.push('Error de recolección (' + network + '): ' + String(error));
  }
  const content = lines.join('\n\n');
  if (target.textContent !== content) target.textContent = content;
  target.style.whiteSpace = 'pre-line';
}
`;
