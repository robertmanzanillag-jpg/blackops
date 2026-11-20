import test from 'node:test';
import assert from 'node:assert/strict';
import {LEGACY_DISCOVERY_CREATORS,DISCOVERY_CREATORS,PRIORITY_CREATORS,DISCOVERY_CANDIDATES,CHALLENGER_CREATORS,ALL_DISCOVERY_CREATORS,CREATOR_GROUPS,resolveCreatorGroup,resolveCreatorChannel,canonicalSourceIdentity} from '../shared/clippers-priority-creators.mjs';
test('13 primary reviewed channels represent10 requested creator groups without deleting historical8',()=>{
 assert.equal(PRIORITY_CREATORS.length,13);assert.equal(CREATOR_GROUPS.length,10);assert.equal(LEGACY_DISCOVERY_CREATORS.length,8);assert.equal(DISCOVERY_CREATORS,LEGACY_DISCOVERY_CREATORS);
 assert.equal(new Set(PRIORITY_CREATORS.map(r=>r.channelId)).size,13);assert.equal(ALL_DISCOVERY_CREATORS.length,20);assert.equal(CHALLENGER_CREATORS.length,7);assert.equal(DISCOVERY_CANDIDATES.length,2);
 for(const id of ['thegrefg','vegetta777','rubius','lacy','alanzoka','gotaga','papaplatte','k4sen'])assert.ok(LEGACY_DISCOVERY_CREATORS.some(c=>c.id===id));
 assert.ok(ALL_DISCOVERY_CREATORS.every(c=>c.permission==='unknown'&&c.mayPublish===false&&/^UC[A-Za-z0-9_-]{22}$/.test(c.channelId)));
 assert.ok(Object.isFrozen(PRIORITY_CREATORS)&&Object.isFrozen(PRIORITY_CREATORS[0]));
});
test('Jordi/show, Rubius and German channels retain distinct sources but one canonical creator group',()=>{
 for(const aliases of [['JordiWild','The Wild Project','@TheWildProject','UCDZsyOkn-WTiTwgAvZSQ_cg'],['rubuios','Rubius','@elrubius','UCcjIvuxmWlS5IEQ0JdPV4Ng'],['SoyGerman','HolaSoyGerman','JuegaGerman']])assert.equal(new Set(aliases.map(a=>resolveCreatorGroup(a)?.id)).size,1);
 assert.equal(resolveCreatorGroup('TJR')?.id,'tjr-trading');assert.equal(resolveCreatorGroup('@TJRofficial'),null);assert.equal(resolveCreatorGroup('@TRichesTrades'),null);assert.equal(resolveCreatorGroup('@RubiusZ'),null);assert.equal(resolveCreatorGroup('＠RubiusZ'),null);assert.equal(resolveCreatorGroup('@ibai'),null);assert.equal(resolveCreatorGroup('unknown'),null);
 const show=resolveCreatorChannel('UCBYyJBCtCvgqA4NwtoPMwpQ'),personal=resolveCreatorChannel('UCDZsyOkn-WTiTwgAvZSQ_cg');assert.notEqual(show.id,personal.id);assert.equal(show.creatorGroupId,personal.creatorGroupId);
 assert.equal(resolveCreatorChannel('TheWildProject'),null);assert.equal(resolveCreatorChannel('UCzExIqRGZ6EXRBJ_CYIC5LQ'),null);
});
test('canonical video identity deduplicates URL/playlist/shorts variants without guessing cross-upload episodes',()=>{
 for(const v of ['abcdefghijk','https://www.youtube.com/watch?v=abcdefghijk&list=PL123','https://youtu.be/abcdefghijk?t=10','https://m.youtube.com/shorts/abcdefghijk','https://youtube.com/embed/abcdefghijk','https://youtube.com/live/abcdefghijk'])assert.equal(canonicalSourceIdentity(v),'youtube:abcdefghijk');
 for(const v of ['https://youtube.com.evil/watch?v=abcdefghijk','https://u:p@youtube.com/watch?v=abcdefghijk','http://youtube.com/watch?v=abcdefghijk','https://youtube.com/watch?v=abcdefghijk&v=bcdefghijkl','https://youtube.com:444/watch?v=abcdefghijk','PRIVATE_STRING',{}])assert.equal(canonicalSourceIdentity(v),null);
 assert.notEqual(canonicalSourceIdentity('abcdefghijk'),canonicalSourceIdentity('bcdefghijkl'));
});
