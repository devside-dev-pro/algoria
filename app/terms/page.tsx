import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Terms of Service · Algoria', description: 'The terms that apply when you use Algoria.' };

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      intro={`These terms apply to the Algoria website, app and Telegram bot, operated by ${LEGAL.company}, a ${LEGAL.state} limited liability company ("we", "us"). By using Algoria you accept them.`}
      sections={[
        { title: 'What Algoria is', body: [
          'Algoria is a trading software. Our trading strategy runs on a strategy account, and our copy-trading software copies its trades onto your own trading account, at the size you choose.',
          'Your trading account is opened in your own name, at a broker you choose. Your money stays on that account: we never hold, receive or manage your funds, and we are not a broker.',
          'Nothing on Algoria is financial, investment or tax advice. Our content is educational and informative.',
        ] },
        { title: 'Who can use it', body: [
          'You must be at least 18 and allowed to trade where you live. You are responsible for checking that using Algoria and trading leveraged products is legal in your country.',
        ] },
        { title: 'Your responsibilities', body: [
          'You choose your broker, your deposit and your copy size, and you can pause the copy at any time from the app. Only trade with money you can afford to lose.',
          'Keep your login and trading account secure. Give us only your MetaTrader trader password, never the password of your broker client area or of your email.',
        ] },
        { title: 'Price', body: [
          'Access is free when your trading account is opened with one of our partner brokers, which pay us a commission. Otherwise a one-time license fee may apply; its price is always shown to you before you pay.',
        ] },
        { title: 'Risk and no guarantee', body: [
          'Trading involves a high risk of loss. Past results do not guarantee future results, and the results of your account can differ from the strategy account (size, spreads, execution, timing). The software can fail or be interrupted. See our Risk disclosure.',
          'Algoria is provided "as is". To the maximum extent allowed by law, we are not liable for trading losses or for any indirect loss, and our total liability is limited to the amount you paid us in the 12 months before the claim.',
        ] },
        { title: 'Ending the service', body: [
          'You can stop at any time by pausing the copy and changing your trader password. We may suspend access in case of abuse, fraud or breach of these terms.',
        ] },
        { title: 'Changes and law', body: [
          `We may update these terms; the date at the top shows the latest version. These terms are governed by the laws of the State of ${LEGAL.state}, United States.`,
        ] },
        { title: 'Contact', body: [`${LEGAL.contact} · abuse or security: ${LEGAL.abuse}`] },
      ]}
    />
  );
}
