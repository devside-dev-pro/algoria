import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Risk Disclosure · Algoria', description: 'The risks of trading and of copy trading with Algoria.' };

export default function Risk() {
  return (
    <LegalPage
      title="Risk Disclosure"
      intro="Please read this before you connect a trading account. Trading gold and currencies with leverage is risky, and copy trading does not remove that risk."
      sections={[
        { title: 'You can lose money', body: [
          'Gold and forex are traded with leverage (CFDs). Leverage makes every price move bigger, up and down. You can lose part or all of the money on your trading account. Only use money you can afford to lose.',
        ] },
        { title: 'Past results are not a promise', body: [
          'Results shown by Algoria are past results. They do not guarantee future results. Losing trades, losing days and losing months happen.',
        ] },
        { title: 'Your results can differ', body: [
          'Your account copies the strategy account, but your results can be different: your copy size, your broker\'s spreads and execution, slippage, the time it takes to copy a trade, and your account balance all play a role.',
        ] },
        { title: 'Software and technical risk', body: [
          'Algoria is automated software. Like any software it can have failures: a bug, a connection loss, a delay at the broker or at the copy-trading provider. Such failures can cause losses. You can pause the copy at any time from the app, and revoke access by changing your trader password.',
        ] },
        { title: 'Not advice', body: [
          'Algoria does not give personal financial advice and does not know your full situation. If you are unsure, talk to an independent financial adviser.',
        ] },
        { title: 'Questions', body: [`Write to ${LEGAL.contact}.`] },
      ]}
    />
  );
}
