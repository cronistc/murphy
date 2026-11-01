// Vozes da Microsoft pelo serviço oficial (Azure Speech), com a chave do
// próprio usuário. O nível gratuito do Azure cobre meio milhão de caracteres
// por mês. Sem chave configurada, o escritório fica sem voz (só balões).

export const VOZES_F = [
  'pt-BR-FranciscaNeural', 'pt-BR-ThalitaMultilingualNeural', 'pt-BR-BrendaNeural', 'pt-BR-ElzaNeural', 'pt-BR-GiovannaNeural',
  'pt-BR-LeilaNeural', 'pt-BR-LeticiaNeural', 'pt-BR-ManuelaNeural', 'pt-BR-YaraNeural',
];
export const VOZES_M = [
  'pt-BR-AntonioNeural', 'pt-BR-DonatoNeural', 'pt-BR-FabioNeural', 'pt-BR-HumbertoNeural', 'pt-BR-JulioNeural', 'pt-BR-NicolauNeural', 'pt-BR-ValerioNeural',
];

function hash(t: string) {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Cada pessoa tem sempre a mesma voz (e um jeito próprio de falar).
export function vozDe(f: { id: string; genero?: 'f' | 'm'; cargo?: string }) {
  const h = hash(f.id);
  const lista = f.genero === 'm' ? VOZES_M : VOZES_F;
  const ritmo = f.cargo === 'junior' || f.cargo === 'social_media' ? '+8%' : f.cargo === 'ti' ? '-8%' : f.cargo === 'chefe' || f.cargo === 'senior' ? '-3%' : '0%';
  const tom = `${(h % 7) - 3}%`;
  return { voz: lista[h % lista.length], ritmo, tom };
}

const escapar = (t: string) => t.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

const cache = new Map<string, Buffer>();

export async function sintetizar(cfg: { chave: string; regiao: string }, texto: string, v: { voz: string; ritmo: string; tom: string }): Promise<Buffer> {
  const limpo = texto.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').slice(0, 600);
  const chave = `${v.voz}|${v.ritmo}|${v.tom}|${limpo}`;
  const guardado = cache.get(chave);
  if (guardado) return guardado;
  const ssml = `<speak version="1.0" xml:lang="pt-BR"><voice name="${v.voz}"><prosody rate="${v.ritmo}" pitch="${v.tom}">${escapar(limpo)}</prosody></voice></speak>`;
  const res = await fetch(`https://${encodeURIComponent(cfg.regiao)}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': cfg.chave,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'User-Agent': 'escritorio-pixel',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'chave do Azure inválida' : `Azure respondeu ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  cache.set(chave, audio);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return audio;
}
