// Contrôle local : npx tsx scripts/checks/metaapi-undeploy.ts
// Machine d'état UNDEPLOYED / deploy guard / backoff (05/11/2026) — sans MetaApi, sans réseau.
import {
  BACKOFF_MS, ALERT_COOLDOWN_MS, DEPLOY_COOLDOWN_MS,
  canAlert, canDeploy, decideDeployAction, freshDeployGuard, isDeployedState,
  isRecoverableMetaApiError, markAlerted, markDeployedAttempt, nextBackoffMs,
} from '../../runner/metaapi/deployGuard';

let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { console.log(`ok  ${name}`); return; }
  failed++;
  console.error(`ECHEC  ${name}${detail ? ` — ${detail}` : ''}`);
}

check('DEPLOYED reconnu', isDeployedState('DEPLOYED') && isDeployedState('deployed'));
check('UNDEPLOYED reconnu', !isDeployedState('UNDEPLOYED') && !isDeployedState(null));

let g = freshDeployGuard();
check('peut déployer au départ', canDeploy(g, 0));
check('peut alerter au départ', canAlert(g, 0));
check('décision : alert-and-deploy', decideDeployAction('UNDEPLOYED', g, 0) === 'alert-and-deploy');

g = markDeployedAttempt(markAlerted(g, 1_000), 1_000);
check('cooldown deploy actif', !canDeploy(g, 1_000 + DEPLOY_COOLDOWN_MS - 1));
check('cooldown alert actif', !canAlert(g, 1_000 + ALERT_COOLDOWN_MS - 1));
check('décision : wait pendant cooldown', decideDeployAction('UNDEPLOYED', g, 1_000 + 60_000) === 'wait');
check('cooldown deploy levé à 30 min', canDeploy(g, 1_000 + DEPLOY_COOLDOWN_MS));
check('DEPLOYED → ok même en cooldown', decideDeployAction('DEPLOYED', g, 1_000) === 'ok');

check('backoff 0 = 2 min', nextBackoffMs(0) === BACKOFF_MS[0]);
check('backoff 1 = 5 min', nextBackoffMs(1) === BACKOFF_MS[1]);
check('backoff 2 = 15 min', nextBackoffMs(2) === BACKOFF_MS[2]);
check('backoff plafonné', nextBackoffMs(99) === BACKOFF_MS[2]);

check('timeout recoverable', isRecoverableMetaApiError(new Error('Timed out waiting for account f9c888c5 to connect to the broker')));
check('no accounts deployed recoverable', isRecoverableMetaApiError(new Error('ValidationError: It seems like you are trying to subscribe to an account, however you have no accounts deployed yet')));
check('autre erreur non recoverable', !isRecoverableMetaApiError(new Error('ECONNRESET weird')));

// goldFeedExpected toujours OK pour le cron (régression PR #574)
import { goldFeedExpected } from '../../lib/market/goldHours';
check('flux attendu lun 16:30 EST', goldFeedExpected(new Date('2026-11-02T21:30:00Z')) === true);
check('flux pas attendu pendant pause hiver', goldFeedExpected(new Date('2026-11-02T22:30:00Z')) === false);

if (failed) { console.error(`\n${failed} échec(s)`); process.exit(1); }
console.log('\ntout est bon');
