import {createHash} from 'node:crypto';
import {buildRevenueMockupPreview} from './revenue-engine';
import {canonicalEvidenceDigest as digest} from './evidence-json';
import {validateRevenuePreviewSource,type RevenuePreviewSource} from './office-revenue-source';
export const REVENUE_PREVIEW_CSP="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export type RevenuePreviewArtifact={version:1;scope:'prospect_public_evidence';candidateId:string;sourceDigest:string;sourceUrl:string;sourceUpdatedAt:string;text:string;html:string;htmlSha256:string;artifactId:string;externalActions:0;fullRoleQualification:false};
/** Creates a reviewable static local HTML deliverable. No filesystem, network,
 * contact, import, ledger, model or customer-approval mutation. */
export function buildOfficeRevenuePreview(raw:RevenuePreviewSource,owner:string,candidateId:string,now:number):RevenuePreviewArtifact{
 const source=validateRevenuePreviewSource(raw,owner,now),candidate=source.items.find(c=>c.id===candidateId);
 if(!candidate)throw Error('REVENUE_VERIFIED_CANDIDATE_REQUIRED');
 const result=buildRevenueMockupPreview({businessName:candidate.businessName,area:candidate.area,niche:candidate.niche,websiteStatus:candidate.websiteStatus,evidence:candidate.evidence,painPoint:candidate.painPoint||'Concepto de presentacion; problema comercial no confirmado.',primaryOffer:'Concepto interno',estimatedOfferUsd:0,includeAutomation:false},{writeFile:false,standalone:true});
 if(!result.html)throw Error('REVENUE_HTML_MISSING');
 // Remove template estimates/QA claims: those are not observed commercial results.
 let html=result.html.replace(/<section class="internal" id="internal">[\s\S]*?<\/section>/,'<section class="internal" id="internal"><h2>Concepto interno pendiente de revision</h2><p>No es una oferta, aprobacion comercial, sitio publicado ni resultado de ventas.</p></section>');
 html=html.replace(/<a\b([^>]*)\shref="#[^"]*"([^>]*)>/g,'<span$1$2 aria-disabled="true">').replace(/<\/a>/g,'</span>');
 html=html.replace('<main>','<main><aside style="padding:16px;background:#fff;color:#111">BORRADOR INTERNO. Direccion creativa propuesta; no representa un sitio aprobado por el negocio. Sin publicaciones, contacto ni formularios activos.</aside>');
 html=html.replace('</main>',`<section class="internal"><h2>Evidencia guardada del prospecto</h2><p>Candidato: ${escape(candidate.id)}</p><p>Fuente registrada (no consultada de nuevo): ${escape(candidate.sourceUrl)}</p><p>Registro actualizado: ${escape(candidate.updatedAt)}</p><blockquote>${escape(candidate.evidence)}</blockquote><p>El registro canonico conserva verificacion publica; este entregable no prueba vigencia actual, importacion de lead ni permiso de contacto.</p></section></main>`);
 if(/<script\b|<iframe\b|<form\b|<[^>]*\son[a-z]+\s*=/i.test(html)||Buffer.byteLength(html)>100000)throw Error('REVENUE_HTML_UNSAFE');
 const body={version:1 as const,scope:'prospect_public_evidence' as const,candidateId,sourceDigest:source.sourceDigest,sourceUrl:candidate.sourceUrl,sourceUpdatedAt:candidate.updatedAt,text:`Maqueta HTML interna para ${candidate.businessName}. Fuente publica guardada: ${candidate.sourceUrl}. Evidencia registrada: ${candidate.updatedAt}. No publicada; no acredita importacion de lead, permiso de contacto, aprobacion comercial ni venta. Revision visual y vigencia actual pendientes.`,html,htmlSha256:createHash('sha256').update(html).digest('hex'),externalActions:0 as const,fullRoleQualification:false as const};
 return {...body,artifactId:digest(body)};
}
export function validateOfficeRevenuePreview(artifact:RevenuePreviewArtifact,source:RevenuePreviewSource,owner:string,at:number){
 if(digest(buildOfficeRevenuePreview(source,owner,artifact.candidateId,at))!==digest(artifact))throw Error('REVENUE_ARTIFACT_INVALID');return artifact;
}
