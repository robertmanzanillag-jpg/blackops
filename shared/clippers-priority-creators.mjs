// Primary identities observed in the reviewed 2026-11-18 research artifact.
// Identity, a public RSS feed and public views grant no reuse rights or account-performance evidence.
//
// Clip policy (owner decision 2026-11-19): `clipPolicy` is the owner's clipping rule, separate from
// `permission`, which still records explicit licence/campaign evidence ("unknown" = none on file) and
// keeps gating the legacy marketplace/portfolio publishers (`mayPublish: false`). The streamer-pages
// lane (script/clippers-streamer-discovery.mjs) clips a creator unless they explicitly prohibit it:
//   allowed_unless_prohibited -> may be clipped (credit @handle + source link, short edited clips only)
//   prohibited                -> never clipped; set at runtime with evidence by the prohibition check,
//                                by KNOWN_PROHIBITED_CREATORS below, or by the takedown list.
const freeze = value => { if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);} return value; };
export const LEGACY_DISCOVERY_CREATORS = freeze([
  {
    "id": "thegrefg",
    "handle": "TheGrefg",
    "channelId": "UCCEmjNPpJYhGDgaEqeeA4HA",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@TheGrefg",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "vegetta777",
    "handle": "vegetta777",
    "channelId": "UCam8T03EOFBsNdR0thrFHdQ",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@vegetta777",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "rubius",
    "handle": "elrubiusOMG",
    "channelId": "UCXazgXDIYyWH-yXLAkcrFxw",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@elrubiusOMG",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "lacy",
    "handle": "LacyHimself",
    "channelId": "UCeoZXkaJDtdTHafgoZeDcAA",
    "language": "en",
    "identityEvidenceUrl": "https://www.youtube.com/@LacyHimself",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "alanzoka",
    "handle": "alanzoka",
    "channelId": "UCIwspRtKNszHhIhl36gREjQ",
    "language": "pt-BR",
    "identityEvidenceUrl": "https://www.youtube.com/@alanzoka",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "gotaga",
    "handle": "Gotaga",
    "channelId": "UCCFqUJYKT97UerMmb6DM0bw",
    "language": "fr",
    "identityEvidenceUrl": "https://www.youtube.com/@Gotaga",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "papaplatte",
    "handle": "Papaplatte",
    "channelId": "UCDmbhGe7-wC1a55l5ZYAZJw",
    "language": "de",
    "identityEvidenceUrl": "https://www.youtube.com/@Papaplatte",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  },
  {
    "id": "k4sen",
    "handle": "zzxk4sen",
    "channelId": "UChUjERVG8eKEAJSCef-tTmg",
    "language": "ja",
    "identityEvidenceUrl": "https://www.youtube.com/@zzxk4sen",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z"
  }
]);
export const PRIORITY_CREATORS = freeze([
  {
    "id": "mrbeast",
    "handle": "MrBeast",
    "channelId": "UCX6OQ3DkcsbYNE6H8uQQuVA",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@MrBeast/about",
    "identityVerifiedAt": "2026-11-18T08:51:57.345328+00:00",
    "creatorGroupId": "mrbeast",
    "name": "MrBeast",
    "role": "main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "thegrefg",
    "handle": "TheGrefg",
    "channelId": "UCCEmjNPpJYhGDgaEqeeA4HA",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@TheGrefg",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z",
    "creatorGroupId": "thegrefg",
    "name": "TheGrefg",
    "role": "main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "ishowspeed",
    "handle": "IShowSpeed",
    "channelId": "UCWsDFcIhY2DBi3GB5uykGXA",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@IShowSpeed/about",
    "identityVerifiedAt": "2026-11-18T08:51:57.346699+00:00",
    "creatorGroupId": "ishowspeed",
    "name": "IShowSpeed",
    "role": "main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "tjr-trading",
    "handle": "TJRTrades",
    "channelId": "UCGHBUXjDCeiIXNdKR0HUZnA",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@TJRTrades/about",
    "identityVerifiedAt": "2026-11-18T08:51:59.731897+00:00",
    "creatorGroupId": "tjr-trading",
    "name": "TJR",
    "role": "trading_main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "adin-ross",
    "handle": "AdinRoss",
    "channelId": "UCey-eDTR5J6xU6pZ2f4guoA",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@AdinRoss/about",
    "identityVerifiedAt": "2026-11-18T08:51:57.346956+00:00",
    "creatorGroupId": "adin-ross",
    "name": "Adin Live",
    "role": "live_highlights_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "joe-rogan",
    "handle": "joerogan",
    "channelId": "UCzQUP1qoWDoEbmsQxvdjxgQ",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@joerogan/about",
    "identityVerifiedAt": "2026-11-18T08:51:58.304313+00:00",
    "creatorGroupId": "joe-rogan",
    "name": "PowerfulJRE",
    "role": "podcast_main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "the-wild-project",
    "handle": "TheWildProject",
    "channelId": "UCBYyJBCtCvgqA4NwtoPMwpQ",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@TheWildProject/about",
    "identityVerifiedAt": "2026-11-18T08:51:58.474789+00:00",
    "creatorGroupId": "jordi-wild",
    "name": "The Wild Project",
    "role": "podcast_show",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "jordi-wild",
    "handle": "ElRinconDeGiorgio",
    "channelId": "UCDZsyOkn-WTiTwgAvZSQ_cg",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@ElRinconDeGiorgio/about",
    "identityVerifiedAt": "2026-11-18T08:51:58.664154+00:00",
    "creatorGroupId": "jordi-wild",
    "name": "El Rincón De Giorgio",
    "role": "personal_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "rubius",
    "handle": "elrubiusOMG",
    "channelId": "UCXazgXDIYyWH-yXLAkcrFxw",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@elrubiusOMG",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z",
    "creatorGroupId": "rubius",
    "name": "elrubiusOMG",
    "role": "main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "rubius-z",
    "handle": "elrubius",
    "channelId": "UCcjIvuxmWlS5IEQ0JdPV4Ng",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@elrubius/about",
    "identityVerifiedAt": "2026-11-18T08:54:19.922416+00:00",
    "creatorGroupId": "rubius",
    "name": "Rubius Z",
    "role": "secondary_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "hola-soy-german",
    "handle": "HolaSoyGerman",
    "channelId": "UCZJ7m7EnCNodqnu5SAtg8eQ",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@HolaSoyGerman/about",
    "identityVerifiedAt": "2026-11-18T08:51:59.298624+00:00",
    "creatorGroupId": "german-garmendia",
    "name": "HolaSoyGerman.",
    "role": "sketch_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "juega-german",
    "handle": "JuegaGerman",
    "channelId": "UCYiGq8XF7YQD00x7wAd62Zg",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@JuegaGerman/about",
    "identityVerifiedAt": "2026-11-18T08:51:59.551153+00:00",
    "creatorGroupId": "german-garmendia",
    "name": "JuegaGerman",
    "role": "gaming_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "vegetta777",
    "handle": "vegetta777",
    "channelId": "UCam8T03EOFBsNdR0thrFHdQ",
    "language": "es",
    "identityEvidenceUrl": "https://www.youtube.com/@vegetta777",
    "identityVerifiedAt": "2026-11-18T04:36:15.000Z",
    "creatorGroupId": "vegetta777",
    "name": "VEGETTA777",
    "role": "main_channel",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  }
]);
export const DISCOVERY_CANDIDATES = freeze([
  {
    "id": "ibai",
    "handle": "IbaiLlanos",
    "channelId": "UCaY_-ksFSQtTGk0y1HA_3YQ",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@IbaiLlanos/about",
    "identityVerifiedAt": "2026-11-18T08:55:06.195840+00:00",
    "creatorGroupId": "ibai",
    "name": "Ibai",
    "role": "discovery_candidate",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  },
  {
    "id": "auronplay",
    "handle": "auronplay",
    "channelId": "UCyQqzYXQBUWgBTn4pw_fFSQ",
    "language": null,
    "identityEvidenceUrl": "https://www.youtube.com/@auronplay/about",
    "identityVerifiedAt": "2026-11-18T08:54:21.706725+00:00",
    "creatorGroupId": "auronplay",
    "name": "AuronPlay",
    "role": "discovery_candidate",
    "permission": "unknown",
    "mayPublish": false,
    "clipPolicy": "allowed_unless_prohibited"
  }
]);
export const CREATOR_GROUPS = freeze([
  {
    "id": "mrbeast",
    "name": "MrBeast",
    "aliases": [
      "MrBeast",
      "@MrBeast",
      "MrBeast"
    ]
  },
  {
    "id": "thegrefg",
    "name": "TheGrefg",
    "aliases": [
      "thegreft",
      "TheGrefg",
      "@TheGrefg",
      "TheGrefg"
    ]
  },
  {
    "id": "ishowspeed",
    "name": "IShowSpeed",
    "aliases": [
      "IShowSpeed",
      "@IShowSpeed",
      "IShowSpeed"
    ]
  },
  {
    "id": "tjr-trading",
    "name": "TJR (trading)",
    "aliases": [
      "TJR",
      "TJR (trading)",
      "@TJRTrades",
      "TJR"
    ]
  },
  {
    "id": "adin-ross",
    "name": "Adin Ross",
    "aliases": [
      "AdinRoss",
      "Adin Ross",
      "@AdinRoss",
      "Adin Live"
    ]
  },
  {
    "id": "joe-rogan",
    "name": "Joe Rogan",
    "aliases": [
      "Joe Rogan",
      "@joerogan",
      "PowerfulJRE"
    ]
  },
  {
    "id": "jordi-wild",
    "name": "The Wild Project",
    "aliases": [
      "TheWildProject",
      "The Wild Project",
      "@TheWildProject",
      "JordiWild",
      "Jordi Wild",
      "@ElRinconDeGiorgio",
      "El Rincón De Giorgio"
    ]
  },
  {
    "id": "rubius",
    "name": "Rubius",
    "aliases": [
      "rubuios",
      "Rubius",
      "@elrubiusOMG",
      "elrubiusOMG",
      "@elrubius",
      "Rubius Z"
    ]
  },
  {
    "id": "german-garmendia",
    "name": "SoyGerman / Germán Garmendia",
    "aliases": [
      "SoyGerman",
      "HolaSoyGerman",
      "SoyGerman / Germán Garmendia",
      "@HolaSoyGerman",
      "HolaSoyGerman.",
      "@JuegaGerman",
      "JuegaGerman"
    ]
  },
  {
    "id": "vegetta777",
    "name": "VEGETTA777",
    "aliases": [
      "vegeta777",
      "Vegetta777",
      "VEGETTA777",
      "@vegetta777",
      "VEGETTA777"
    ]
  }
]);
export const KNOWN_CREATOR_GROUPS = freeze([
  {
    "id": "mrbeast",
    "name": "MrBeast",
    "aliases": [
      "MrBeast",
      "@MrBeast",
      "MrBeast"
    ]
  },
  {
    "id": "thegrefg",
    "name": "TheGrefg",
    "aliases": [
      "thegreft",
      "TheGrefg",
      "@TheGrefg",
      "TheGrefg"
    ]
  },
  {
    "id": "ishowspeed",
    "name": "IShowSpeed",
    "aliases": [
      "IShowSpeed",
      "@IShowSpeed",
      "IShowSpeed"
    ]
  },
  {
    "id": "tjr-trading",
    "name": "TJR (trading)",
    "aliases": [
      "TJR",
      "TJR (trading)",
      "@TJRTrades",
      "TJR"
    ]
  },
  {
    "id": "adin-ross",
    "name": "Adin Ross",
    "aliases": [
      "AdinRoss",
      "Adin Ross",
      "@AdinRoss",
      "Adin Live"
    ]
  },
  {
    "id": "joe-rogan",
    "name": "Joe Rogan",
    "aliases": [
      "Joe Rogan",
      "@joerogan",
      "PowerfulJRE"
    ]
  },
  {
    "id": "jordi-wild",
    "name": "The Wild Project",
    "aliases": [
      "TheWildProject",
      "The Wild Project",
      "@TheWildProject",
      "JordiWild",
      "Jordi Wild",
      "@ElRinconDeGiorgio",
      "El Rincón De Giorgio"
    ]
  },
  {
    "id": "rubius",
    "name": "Rubius",
    "aliases": [
      "rubuios",
      "Rubius",
      "@elrubiusOMG",
      "elrubiusOMG",
      "@elrubius",
      "Rubius Z"
    ]
  },
  {
    "id": "german-garmendia",
    "name": "SoyGerman / Germán Garmendia",
    "aliases": [
      "SoyGerman",
      "HolaSoyGerman",
      "SoyGerman / Germán Garmendia",
      "@HolaSoyGerman",
      "HolaSoyGerman.",
      "@JuegaGerman",
      "JuegaGerman"
    ]
  },
  {
    "id": "vegetta777",
    "name": "VEGETTA777",
    "aliases": [
      "vegeta777",
      "Vegetta777",
      "VEGETTA777",
      "@vegetta777",
      "VEGETTA777"
    ]
  },
  {
    "id": "ibai",
    "name": "Ibai",
    "aliases": [
      "Ibai",
      "IbaiLlanos"
    ]
  },
  {
    "id": "auronplay",
    "name": "AuronPlay",
    "aliases": [
      "AuronPlay",
      "auronplay"
    ]
  },
  {
    "id": "lacy",
    "name": "LacyHimself",
    "aliases": [
      "lacy",
      "LacyHimself"
    ]
  },
  {
    "id": "alanzoka",
    "name": "alanzoka",
    "aliases": [
      "alanzoka",
      "alanzoka"
    ]
  },
  {
    "id": "gotaga",
    "name": "Gotaga",
    "aliases": [
      "gotaga",
      "Gotaga"
    ]
  },
  {
    "id": "papaplatte",
    "name": "Papaplatte",
    "aliases": [
      "papaplatte",
      "Papaplatte"
    ]
  },
  {
    "id": "k4sen",
    "name": "zzxk4sen",
    "aliases": [
      "k4sen",
      "zzxk4sen"
    ]
  }
]);
export const DISCOVERY_CREATORS = LEGACY_DISCOVERY_CREATORS;
export const CLIP_POLICIES = freeze(['allowed_unless_prohibited','prohibited']);
// Reviewed explicit prohibitions: { creatorGroupId, evidenceUrl, evidenceText, recordedAt }. Empty until one is found.
export const KNOWN_PROHIBITED_CREATORS = freeze([]);
// Twitch login guesses keyed by creator id. NOT identity evidence: the discovery job resolves each
// through Helix /users and records the returned id; an unresolved login is skipped, never guessed.
export const TWITCH_LOGIN_CANDIDATES = freeze({
  "thegrefg": ["thegrefg"], "rubius": ["rubius"], "vegetta777": ["vegetta777"], "ibai": ["ibai"], "auronplay": ["auronplay"],
  "ishowspeed": ["ishowspeed"], "adin-ross": ["adinross"], "lacy": ["lacy"], "alanzoka": ["alanzoka"], "gotaga": ["gotaga"],
  "papaplatte": ["papaplatte"], "k4sen": ["k4sen"], "juega-german": ["juegagerman"],
  // Account-lane seeds (owner plan 2026-11-20): big English streamers, sports, Latin/Spanish and NYC creators.
  "kai-cenat": ["kaicenat"], "jynxzi": ["jynxzi"], "duke-dennis": ["dukedennis"], "xqc": ["xqc"], "agent00": ["agent00"],
  "fanum": ["fanum"], "plaqueboymax": ["plaqueboymax"], "castro": ["castro_1021"],
  "westcol": ["westcol"], "elmariana": ["elmariana"], "juansguarnizo": ["juansguarnizo"], "rivers": ["rivers_gg"], "spreen": ["spreen"]
});
const priorities = new Set(PRIORITY_CREATORS.map(row => row.channelId));
export const CHALLENGER_CREATORS = freeze([...LEGACY_DISCOVERY_CREATORS.filter(row => !priorities.has(row.channelId)).map(row => ({...row,creatorGroupId:row.id,name:row.handle,role:'legacy_challenger',permission:'unknown',mayPublish:false,clipPolicy:'allowed_unless_prohibited'})),...DISCOVERY_CANDIDATES]);
export const ALL_DISCOVERY_CREATORS = freeze([...PRIORITY_CREATORS,...CHALLENGER_CREATORS]);
const aliasKey = value => typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/^@/,'').replace(/[\s_-]+/g,'') : '';
export function resolveCreatorGroup(value) {
  if (typeof value !== 'string') return null;
  value=value.normalize('NFKC');
  if (value.startsWith('@')) {
    const channel=ALL_DISCOVERY_CREATORS.find(row=>row.handle.toLowerCase()===value.slice(1).toLowerCase());
    return channel?KNOWN_CREATOR_GROUPS.find(group=>group.id===channel.creatorGroupId)??null:null;
  }
  const direct = ALL_DISCOVERY_CREATORS.find(row => row.channelId === value || row.id === value);
  if (direct) return KNOWN_CREATOR_GROUPS.find(group => group.id === direct.creatorGroupId) ?? null;
  const key=aliasKey(value);if (!key) return null;
  const matches=KNOWN_CREATOR_GROUPS.filter(group => aliasKey(group.id)===key || group.aliases.some(alias => aliasKey(alias)===key));
  return matches.length===1?matches[0]:null;
}
export function canonicalSourceIdentity(value) {
  if (typeof value!=='string') return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return 'youtube:'+value;
  try {
    const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    let id;
    if(url.hostname==='youtu.be')id=url.pathname.slice(1);
    else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) {
      if(url.pathname==='/watch' && url.searchParams.getAll('v').length===1) id=url.searchParams.get('v');
      else id=url.pathname.match(/^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1];
    }
    return typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)?'youtube:'+id:null;
  } catch {return null;}
}
// Exact reviewed channel identity only; aliases are for labels/grouping, never asset authorization.
export function resolveCreatorChannel(channelId) {
  return typeof channelId==='string'?ALL_DISCOVERY_CREATORS.find(row=>row.channelId===channelId)??null:null;
}
