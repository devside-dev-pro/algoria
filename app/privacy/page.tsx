import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL } from '@/lib/legal';

export const metadata: Metadata = { title: 'Privacy Policy · Algoria', description: 'What Algoria collects, why, who it is shared with, and how to delete it.' };

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={`Algoria is operated by ${LEGAL.company}, a ${LEGAL.state} limited liability company ("we", "us"). This policy explains what we collect when you use the Algoria website, app and Telegram bot, why we collect it, and the choices you have.`}
      sections={[
        { title: 'What we collect', body: [[
          'Your Telegram identity when you log in with Telegram: Telegram ID, name, username and language. We never ask for a phone number, an email or a password to log in.',
          'What you tell us during setup: your country, the partner broker you chose, your copy size (lot), and the amount you plan to trade with if you share it.',
          'Your trading account connection: your MetaTrader login, server and trader password. The password is encrypted (AES-256) and stored on our servers only.',
          'The trading activity of your account that is copied by Algoria, so the app can show you your trades and results.',
          'Messages you send to the Algoria bot or to our support account on Telegram, including screenshots you choose to send.',
          'Technical data: a session cookie to keep you logged in, a cookie recording which link or campaign brought you to us (30 days), your preferences (theme, language) stored on your device, and a push notification subscription if you turn notifications on.',
        ]] },
        { title: 'Why we use it', body: [[
          'To connect your own trading account to our copy-trading software and copy trades onto it at the size you chose.',
          'To show you your status, your trades and your results in the app.',
          'To answer your questions and help you through the setup.',
          'To send you notifications you asked for (for example when a trade closes).',
          'To understand which channels bring members, and to keep the service secure.',
        ]] },
        { title: 'Your trading password', body: [
          'We only ask for the trader password of your MetaTrader account. It allows the copy software to place and close trades on your account. It cannot be used to withdraw money, and it is not the password of your client area at the broker or of your email: never send us those.',
          'You can revoke our access at any time by changing your trader password in your broker\'s client area, or by pausing the copy in the app.',
        ] },
        { title: 'Who we share it with', body: [
          'We never sell your data. We share it only with the service providers we need to run Algoria, and only for that purpose:',
          [
            'our copy-trading technology provider, which receives your trading account connection to copy the trades;',
            'our hosting and database providers;',
            'Telegram, for login and messages;',
            'AI service providers that help us draft support answers and content;',
            'push notification services, if you turned notifications on;',
            'the partner broker you chose, which may tell us that your account was opened through our link and the trading volume, for our commission.',
          ],
          'We may also disclose information when required by law.',
        ] },
        { title: 'How long we keep it', body: [
          'We keep your data while your Algoria account is active. You can ask us to delete your account and your data at any time by writing to ' + LEGAL.contact + '. We may keep what the law requires us to keep.',
        ] },
        { title: 'Your rights', body: [
          'You can ask us for a copy of your data, to correct it, or to delete it, by writing to ' + LEGAL.contact + '. Algoria is not intended for anyone under 18.',
        ] },
        { title: 'Contact', body: [
          `Questions about this policy: ${LEGAL.contact}. To report abuse or a security issue: ${LEGAL.abuse}.`,
        ] },
      ]}
    />
  );
}
