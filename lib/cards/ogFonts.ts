// Polices des images serveur (ImageResponse / Satori), partagées par les cartes /api/card/*.
// Polices (Satori ne synthétise pas le gras) : chargées une fois par instance, repli police par défaut
// si unpkg est injoignable — la carte part quand même, jamais d'échec pour une police.
let fontsCache: Array<{ name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }> | null | undefined;
export async function loadFonts() {
  if (fontsCache !== undefined) return fontsCache ?? undefined;
  try {
    const get = async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`font ${r.status}`);
      return r.arrayBuffer();
    };
    const [bold, reg] = await Promise.all([
      get('https://unpkg.com/@fontsource/space-grotesk@5.0.16/files/space-grotesk-latin-700-normal.woff'),
      get('https://unpkg.com/@fontsource/space-grotesk@5.0.16/files/space-grotesk-latin-500-normal.woff'),
    ]);
    fontsCache = [
      { name: 'Grotesk', data: bold, weight: 700, style: 'normal' },
      { name: 'Grotesk', data: reg, weight: 400, style: 'normal' },
    ];
  } catch {
    fontsCache = null; // repli : police par défaut de Satori
  }
  return fontsCache ?? undefined;
}

