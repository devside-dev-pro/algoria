'use client';
// LA VOIX D'ALGORIA — file de lecture unique (jamais deux phrases en même temps), deux moteurs :
// 1) PREMIUM : /api/voice/tts (ElevenLabs proxifié côté serveur, clé jamais exposée) — voix féminine naturelle.
// 2) REPLI : speechSynthesis du navigateur (voix fr-FR féminine si dispo) — zéro config, zéro coût.
// Le moteur premium est sondé UNE fois : s'il répond 501 (non configuré), on bascule en repli pour la session.
// onSpeaking permet de COUPER LE MICRO pendant qu'Algoria parle (sinon elle s'entendrait elle-même).

export class VoiceEngine {
  private queue: string[] = [];
  private playing = false;
  private premium: boolean | null = null; // null = pas encore sondé
  private audio: HTMLAudioElement | null = null;
  private stopped = false;
  onSpeaking?: (speaking: boolean) => void;
  onText?: (text: string | null) => void; // sous-titre à l'écran pendant la lecture

  constructor(private getToken: () => Promise<string | null>) {}

  speak(text: string) {
    const t = text.trim();
    if (!t) return;
    this.stopped = false;
    this.queue.push(t);
    if (!this.playing) void this.drain();
  }

  stop() {
    this.stopped = true;
    this.queue = [];
    this.audio?.pause();
    this.audio = null;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* environnement sans TTS */
    }
    this.playing = false;
    this.onSpeaking?.(false);
    this.onText?.(null);
  }

  private async drain() {
    this.playing = true;
    this.onSpeaking?.(true);
    while (this.queue.length && !this.stopped) {
      const text = this.queue.shift()!;
      this.onText?.(text);
      try {
        await this.play(text);
      } catch {
        /* une phrase ratée ne bloque pas la file */
      }
    }
    this.playing = false;
    this.onSpeaking?.(false);
    this.onText?.(null);
  }

  private async play(text: string): Promise<void> {
    if (this.premium !== false) {
      const ok = await this.playPremium(text);
      if (ok) return;
    }
    return this.playBrowser(text);
  }

  /** ElevenLabs via notre proxy authentifié. false = indisponible → repli navigateur. */
  private async playPremium(text: string): Promise<boolean> {
    try {
      const token = await this.getToken();
      const res = await fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ text }),
      });
      if (res.status === 501) {
        this.premium = false; // pas configuré → on ne resonde plus
        return false;
      }
      if (!res.ok) return false;
      this.premium = true;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await new Promise<void>((resolve) => {
        const a = new Audio(url);
        this.audio = a;
        a.onended = () => resolve();
        a.onerror = () => resolve();
        void a.play().catch(() => resolve());
      });
      URL.revokeObjectURL(url);
      return true;
    } catch {
      return false;
    }
  }

  /** speechSynthesis — on privilégie une voix EN féminine (heuristique de nom, sinon 1ʳᵉ voix en). */
  private playBrowser(text: string): Promise<void> {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 1.03;
      u.pitch = 1.05;
      const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'));
      const fem = voices.find((v) => /samantha|zira|jenny|aria|ava|allison|susan|karen|serena|female|google us english/i.test(v.name));
      const voice = fem ?? voices[0];
      if (voice) u.voice = voice;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      synth.speak(u);
    });
  }
}

/** Petit carillon d'éveil (WebAudio) — le "ding" quand Algoria commence à écouter. */
export function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.12, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.26);
    o.onended = () => void ctx.close();
  } catch {
    /* pas bloquant */
  }
}
