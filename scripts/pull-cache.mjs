import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const url = 'https://zhalwdaesjzikhovafjl.supabase.co';
const key =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpoYWx3ZGFlc2p6aWtob3ZhZmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDA3MDksImV4cCI6MjA5ODAxNjcwOX0.McgncMVX_qwJ2YUi-XmBKrKQcuFh6yQ9scffOQJbVXs';
const db = createClient(url, key, { auth: { persistSession: false } });

const SYMBOL = process.argv[2] ?? 'XAUUSD';
const TF = process.argv[3] ?? 'M5';
const SIZE = 1000;
const all = [];
for (let from = 0; ; from += SIZE) {
  const { data, error } = await db
    .from('candles')
    .select('time,open,high,low,close,volume')
    .eq('symbol', SYMBOL)
    .eq('timeframe', TF)
    .order('time', { ascending: true })
    .range(from, from + SIZE - 1);
  if (error) {
    console.error('erreur Supabase:', error.message);
    process.exit(1);
  }
  if (!data.length) break;
  for (const c of data)
    all.push({ time: Number(c.time), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) });
  if (data.length < SIZE) break;
}
mkdirSync('backtest/.cache', { recursive: true });
const path = `backtest/.cache/${SYMBOL}-${TF}-15.json`;
writeFileSync(path, JSON.stringify(all));
console.log(`✅ ${all.length} bougies ${TF} écrites dans ${path}`);
if (all.length) console.log(`   du ${new Date(all[0].time).toISOString()} au ${new Date(all[all.length - 1].time).toISOString()}`);
