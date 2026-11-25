import { senderFromEnv } from '@/lib/emailDraft';
import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/apiSafe';
import { getLeadsByIds, updateOpener, updateResearch } from '@/lib/db';
import { generateOutreach } from '@/lib/opener';
import { offerText, mapLimit } from '@/lib/pipeline';
import { socialLabel } from '@/lib/channel';
import { PROCESS_LABEL, type Process } from '@/lib/evidence';
import { runCounterPitch } from '@/lib/counterPitchRun';

export const POST = safeRoute(async (req: Request) => {
  const { ids, type } = await req.json().catch(() => ({}));
  if (!Array.isArray(ids) || !ids.every(Number.isInteger)) return NextResponse.json({ error: 'ids required' }, { status: 400 });
  const offer = offerText();
  const kind = typeof type === 'string' && type.trim() ? type.trim() : 'local business';
  let ollamaDown = false;
  // 2 at a time: Ollama on a laptop handles small parallelism fine
  await mapLimit(getLeadsByIds(ids), 2, async l => {
    const r = l.research;
    // the model still writes the discovery question and the DM angle; the first-touch email never uses model text
    const o = await generateOutreach({
      name: l.name, type: kind,
      observed: (r?.processes ?? []).map(p => PROCESS_LABEL[p as Process] ?? p), gaps: l.signals,
      ghlStatus: r?.ghlStatus ?? 'insufficient', offer, social: socialLabel(l, r),
    });
    if (o.aiDown) ollamaDown = true;   // only when Ollama is unreachable, not when the quality gate swapped a question
    const { usedFallback, aiDown, ...outreach } = o;
    void usedFallback; void aiDown;
    // Counter Pitch: a checked observation + one question, or "needs further research" (no email written)
    const cp = runCounterPitch(l, kind, { sender: senderFromEnv() });
    if (r) updateResearch(l.id, { ...r, outreach, counterPitch: cp.record });
    // needs further research keeps the short angle (fact + question) so the lead still has something to read
    updateOpener(l.id, cp.text ?? `${outreach.observation} ${outreach.openingQuestion}`);
  });
  return NextResponse.json({ leads: getLeadsByIds(ids), ollamaDown });
});
