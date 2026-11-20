# Clippers public-content scout

The existing daily discovery worker reads official YouTube feeds from the configured creator catalogue. Its durable global budget remains fourteen RSS requests per UTC day. The viral scout turns those same private receipts into a shortlist in the Office's **Fuentes y tendencias** area; it makes no additional requests and uses no paid model.

The read-only orchestra report recomputes the shortlist whenever it projects the worker's receipts. Up to twenty videos published within seventy-two hours and observed within twenty-six hours qualify for research. Each entry retains its canonical video link, official feed URL, verified catalogue author, source publication time, observation time, and the actual public view counter when present. Likes remain unavailable because the current discovery contract does not collect them.

Two matching author/video/publication snapshots separated by at least an hour can show observed counter growth. Positive observed growth ranks first, by measured views per hour. Remaining candidates sort by observed views and recency. A single counter is explicitly labelled observed popularity, never confirmed virality. Missing counters, unchanged counters and decreasing counters remain distinct. Conflicting ownership or same-time observations are excluded; replayed summaries do not create new samples.

The optional `discovery.scout` wire extension accepts older reports without a shortlist. The new exact, bounded parser checks canonical links, identities, timestamps, arithmetic, ordering, and unchanged safety fields. A stale Office connection or old candidate observation is labelled historical in the UI. Empty recent feeds and missing evidence have separate states.

Scouting does not download, edit, upload, schedule, or publish media, grant reuse rights, change the ready queue, award agent outcomes, or change creator preferences based on public popularity. Candidates remain research items with unknown reuse permission. The existing four approved destinations, posting limits, renderer and permission checks are unchanged.

Rollout order: publish the Office contract and UI extension before installing the new Mac reporter and pure scout module. The previous strict server parser rejects a new `discovery.scout` key. Existing reporters without the optional key remain valid on the new server. For rollback, restore the previous reporter (or omit the field) first, then revert the Office extension; do not leave a new reporter sending to an old parser.

Validation: pure adversarial ranking/parser tests, real discovery producer → report → strict wire integration, and desktop/mobile Office tests with synthetic metadata and no external network. Publisher state is not changed by rollout or rollback.
