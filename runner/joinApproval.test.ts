// L'auto-approbation du canal public ne doit plus attendre que MetaApi joigne le broker.
// Aucun réseau, aucune base : les lectures et approveChatJoinRequest sont injectés.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, test } from 'node:test';
import {
  runJoinApprovalPass,
  startJoinApproval,
  stopJoinApproval,
  type JoinApprovalDeps,
  type JoinRow,
} from './joinApproval';

const PUBLIC = -100111;
const VIP = -100777;

const pub = (id: number, user: number): JoinRow => ({ id, chat_id: PUBLIC, user_id: user, username: 'pub' });
const vip = (id: number, user: number): JoinRow => ({ id, chat_id: VIP, user_id: user, username: 'vip' });

type Switch = 'on' | 'off' | null;

function harness(opts: {
  publicSwitch?: Switch;
  vipSwitch?: Switch;
  publicRows?: JoinRow[];
  vipRows?: JoinRow[];
  minAgeMin?: number;
  intervalMs?: number;
  secondary?: boolean;
  vipChatId?: string;
  holdList?: Promise<void>;
}) {
  const approved: Array<{ chatId: number; userId: number }> = [];
  const marked: Array<{ id: number; error: string | null }> = [];
  const lists: Array<{ min: number; limit: number; exclude: number[] }> = [];
  let vipLists = 0;
  let approveResult: { ok: boolean; error: string | null } = { ok: true, error: null };
  const deps: JoinApprovalDeps = {
    secondary: opts.secondary ?? false,
    minAgeMin: opts.minAgeMin ?? 3,
    intervalMs: opts.intervalMs ?? 60_000,
    vipChatId: opts.vipChatId ?? String(VIP),
    runnerSwitch: async (key) => (key === 'vip_autojoin'
      ? (opts.vipSwitch === undefined ? 'off' : opts.vipSwitch)
      : (opts.publicSwitch === undefined ? 'on' : opts.publicSwitch)),
    listPublic: async (min, limit, exclude) => {
      lists.push({ min, limit, exclude: [...exclude] });
      if (opts.holdList) await opts.holdList;
      const done = new Set(marked.map((m) => m.id));
      return (opts.publicRows ?? []).filter((r) => !done.has(r.id));
    },
    listVip: async () => {
      vipLists += 1;
      const done = new Set(marked.map((m) => m.id));
      return (opts.vipRows ?? []).filter((r) => !done.has(r.id));
    },
    approve: async (chatId, userId) => {
      approved.push({ chatId, userId });
      return approveResult;
    },
    mark: async (id, error) => { marked.push({ id, error }); },
    logNote: async () => {},
  };
  return {
    deps,
    approved,
    marked,
    lists,
    vipLists: () => vipLists,
    setApproveResult(r: { ok: boolean; error: string | null }) { approveResult = r; },
  };
}

afterEach(async () => {
  await stopJoinApproval();
});

test('public join requests are approved while MetaApi connect never resolves', async () => {
  const h = harness({ publicRows: [pub(1, 10)], vipRows: [vip(2, 11)] });
  const logs: string[] = [];
  const prev = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map((a) => String(a)).join(' ')); };
  let connectSettled = false;
  try {
    // Même ordre que main() : armer la file, puis attendre un connectMaster qui ne revient pas.
    const boot = (async () => {
      assert.equal(startJoinApproval(h.deps), true);
      await new Promise<void>(() => {});
    })();
    void boot.then(() => { connectSettled = true; }, () => { connectSettled = true; });
    await runJoinApprovalPass();
    assert.deepEqual(h.approved, [{ chatId: PUBLIC, userId: 10 }]);
    assert.equal(h.vipLists(), 0);
    assert.equal(h.lists[0]?.limit, 25);
    assert.deepEqual(h.lists[0]?.exclude, [VIP]);
    assert.equal(connectSettled, false);
    assert.ok(logs.some((l) => l.includes("auto-approbation des demandes d'adhésion : ON (délai 3 min)")));
    assert.ok(logs.some((l) => l.includes('armée avant la connexion MetaApi')));
  } finally {
    console.log = prev;
  }
});

test('VIP join requests are never approved', async () => {
  const h = harness({
    vipSwitch: 'off',
    publicSwitch: 'on',
    // Le SQL exclut déjà le VIP. Ici la liste publique le renvoie quand même : la boucle doit le laisser en attente.
    publicRows: [pub(1, 10), vip(2, 11), vip(3, 12)],
    vipRows: [vip(2, 11), vip(3, 12)],
  });
  assert.equal(startJoinApproval(h.deps), true);
  await runJoinApprovalPass();
  assert.deepEqual(h.approved, [{ chatId: PUBLIC, userId: 10 }]);
  assert.deepEqual(h.marked.map((m) => m.id), [1]);
  assert.equal(h.vipLists(), 0);
});

test('public_autojoin off approves nothing', async () => {
  const h = harness({
    publicSwitch: 'off',
    vipSwitch: 'off',
    publicRows: [pub(1, 10), pub(2, 11)],
    vipRows: [vip(3, 12)],
  });
  assert.equal(startJoinApproval(h.deps), true);
  await runJoinApprovalPass();
  assert.deepEqual(h.approved, []);
  assert.deepEqual(h.marked, []);
  assert.equal(h.lists.length, 0);
  assert.equal(h.vipLists(), 0);
});

test('public_autojoin unread (null) still approves, same as a missing row', async () => {
  const h = harness({ publicSwitch: null, publicRows: [pub(4, 40)] });
  assert.equal(startJoinApproval(h.deps), true);
  await runJoinApprovalPass();
  assert.deepEqual(h.approved, [{ chatId: PUBLIC, userId: 40 }]);
});

test('a second MetaApi-gated start does not approve the same request twice', async () => {
  let release!: () => void;
  const holdList = new Promise<void>((resolve) => { release = resolve; });
  const h = harness({ publicRows: [pub(1, 10), pub(2, 11)], vipRows: [vip(9, 99)], holdList });
  assert.equal(startJoinApproval(h.deps), true);
  const first = runJoinApprovalPass();
  try {
    await waitFor(() => h.lists.length === 1);
    // Le chemin historique, celui d'après connectMaster(), rappellerait la même entrée.
    assert.equal(startJoinApproval(h.deps), false);
    const second = runJoinApprovalPass();
    assert.equal(h.lists.length, 1);
    release();
    await first;
    await second;
  } finally {
    release();
  }
  assert.deepEqual(h.approved, [
    { chatId: PUBLIC, userId: 10 },
    { chatId: PUBLIC, userId: 11 },
  ]);
  await runJoinApprovalPass();
  assert.equal(h.approved.length, 2);
  assert.deepEqual(h.marked.map((m) => m.id).sort((a, b) => a - b), [1, 2]);
});

test('vip_autojoin on approves the validated VIP batch once, and not from the public list', async () => {
  const h = harness({
    vipSwitch: 'on',
    publicRows: [pub(1, 10), vip(2, 11)],
    vipRows: [vip(2, 11)],
  });
  assert.equal(startJoinApproval(h.deps), true);
  await runJoinApprovalPass();
  assert.deepEqual(h.approved, [
    { chatId: PUBLIC, userId: 10 },
    { chatId: VIP, userId: 11 },
  ]);
  await runJoinApprovalPass();
  assert.equal(h.approved.length, 2);
});

test('a network blip leaves the request pending; a structural refusal is not retried', async () => {
  const pending = harness({ publicRows: [pub(1, 10)] });
  pending.setApproveResult({ ok: false, error: null });
  assert.equal(startJoinApproval(pending.deps), true);
  await runJoinApprovalPass();
  assert.equal(pending.approved.length, 1);
  assert.deepEqual(pending.marked, []);
  await runJoinApprovalPass();
  assert.equal(pending.approved.length, 2);
  await stopJoinApproval();

  const refused = harness({ publicRows: [pub(1, 10)] });
  refused.setApproveResult({ ok: false, error: 'USER_ALREADY_PARTICIPANT: ' + 'x'.repeat(400) });
  assert.equal(startJoinApproval(refused.deps), true);
  await runJoinApprovalPass();
  assert.equal(refused.marked.length, 1);
  assert.equal(refused.marked[0]?.error?.length, 200);
  await runJoinApprovalPass();
  assert.equal(refused.approved.length, 1);
});

test('ALGORIA_AUTOJOIN_MIN <= 0 and a secondary runner do not approve', async () => {
  const off = harness({ minAgeMin: 0, publicRows: [pub(1, 10)] });
  assert.equal(startJoinApproval(off.deps), false);
  await runJoinApprovalPass();
  assert.deepEqual(off.approved, []);

  const secondary = harness({ secondary: true, publicRows: [pub(1, 10)] });
  assert.equal(startJoinApproval(secondary.deps), false);
  await runJoinApprovalPass();
  assert.deepEqual(secondary.approved, []);
});

test('main arms join approval before await connectMaster and does not register it again', () => {
  const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  const mainAt = src.indexOf('async function main()');
  assert.ok(mainAt > 0);
  const body = src.slice(mainAt);
  const startAt = body.indexOf('startJoinApproval(');
  const connectAt = body.indexOf('await connectMaster(');
  assert.ok(startAt > 0, 'startJoinApproval missing from main');
  assert.ok(connectAt > 0);
  assert.ok(startAt < connectAt, 'join approval is still behind await connectMaster');
  const afterConnect = body.slice(connectAt);
  assert.equal(afterConnect.includes('startJoinApproval'), false);
  assert.equal(afterConnect.includes('autoApproveJoins'), false);
  assert.equal(afterConnect.includes('listRipeJoinRequests'), false);
  assert.equal(afterConnect.includes('approveChatJoinRequest'), false);
});

function waitFor(pred: () => boolean, ms = 800): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const t = setInterval(() => {
      if (pred()) { clearInterval(t); resolve(); }
      else if (Date.now() - start > ms) { clearInterval(t); reject(new Error('timeout')); }
    }, 5);
  });
}
