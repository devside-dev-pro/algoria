// THÈME DE L'APP MEMBRE — sombre (défaut) ou clair (30/09/2026, demandé par un VIP : « sometimes it is difficult
// to see the writing, so it might be good to have a toggle to switch between dark and light »).
// Le choix vit dans localStorage (par appareil, pas de compte à toucher) et se pose en data-theme sur <html> ;
// app/globals.css porte les deux palettes. Posé AVANT le premier affichage par THEME_BOOT (layout membre) :
// sans ça, un membre en clair verrait l'app flasher en sombre à chaque ouverture.
export type Theme = 'dark' | 'light';
export const THEME_KEY = 'alg_theme';
const META_COLOR: Record<Theme, string> = { dark: '#08101f', light: '#eef2f9' };

/** Script inline exécuté avant l'hydratation : applique le thème mémorisé. try/catch : localStorage peut être bloqué. */
export const THEME_BOOT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'){document.documentElement.dataset.theme='light';var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','${META_COLOR.light}')}}catch(e){}`;

export function currentTheme(): Theme {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[t]);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* navigation privée : le choix vaut pour la session */ }
}
