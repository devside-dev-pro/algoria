/** Les 24 bulles du calendrier 18–24 nov 2026 (partie D). Source de vérité du script d'insertion, jamais exécuté tout seul. */
export type BubbleMode = 'prog' | 'live';

export type WeekBubble = {
  day: string;
  slot: 'bubble1' | 'bubble2' | 'bubble3' | 'bubble4';
  time: string; // HH:MM Dubai
  mode: BubbleMode;
  theme: string;
  subject: string;
  points: string[];
  duration: string;
  fallback: string;
};

export const WEEK_BUBBLES: WeekBubble[] = [
  // mercredi 18
  { day: '2026-11-18', slot: 'bubble1', time: '11:24', mode: 'prog', theme: 'Vie à Dubaï', subject: 'A live day in Dubai',
    points: ['What my morning looks like before a live.', 'Why I still do these lives myself.', 'Times for every country are in the channel.'],
    duration: '30 s', fallback: "Morning in Dubai, and tonight I'm on Zoom with you. All the times are in the post above." },
  { day: '2026-11-18', slot: 'bubble2', time: '14:22', mode: 'prog', theme: 'Entrepreneuriat', subject: 'Why I show the product live instead of just running ads',
    points: ['An ad shows 20 seconds, a live shows everything.', 'Questions make the product better.', "It's how I'd want to be sold to."],
    duration: '40 s', fallback: "An ad shows you 20 seconds. A live shows you the whole thing, questions included. That's why I keep doing them." },
  { day: '2026-11-18', slot: 'bubble3', time: '20:35', mode: 'live', theme: 'Coulisses', subject: 'Setting up the live, 2 hours before',
    points: ['Show the desk and the screen.', "What we'll cover tonight.", 'The times for your country are in the post.'],
    duration: '30 s', fallback: 'Setting up for tonight. Screen ready, questions ready. See you at 23:00 Dubai, 19:00 UK. Full times in the post above.' },
  // jeudi 19
  { day: '2026-11-19', slot: 'bubble1', time: '10:41', mode: 'prog', theme: 'Citation commentée',
    subject: 'Seneca: "We suffer more often in imagination than in reality." (Letters to Lucilius, 13)',
    points: ['What it means to me as a founder.', 'Most of the fear before starting something is in your head.', 'One small step today beats a week of worrying.'],
    duration: '40 s', fallback: '"We suffer more often in imagination than in reality." Seneca wrote that 2,000 years ago, and it still applies to anything new you start.' },
  { day: '2026-11-19', slot: 'bubble2', time: '12:58', mode: 'prog', theme: 'Algoria',
    subject: 'The question I got most at the live: is my money really in my account?',
    points: ['Yes, your account, your name, your broker.', 'Algoria only places the trades.', 'You can see everything in the app.'],
    duration: '35 s', fallback: 'Most asked question last night: is my money in my own account? Yes. Your account, your name, at your broker. Algoria only places the trades.' },
  { day: '2026-11-19', slot: 'bubble3', time: '17:40', mode: 'live', theme: 'Or & marché',
    subject: "South Africa's rate decision and the US jobless claims: why they matter for gold",
    points: ['What a central bank decision is, in one sentence.', 'Why gold reacts to US job numbers.', 'No prediction: the AI deals with it, not me.'],
    duration: '40 s', fallback: 'Rate decision in South Africa, jobless claims in the US. News days are when gold moves the most, and Algoria AI was on it the whole time.' },
  { day: '2026-11-19', slot: 'bubble4', time: '21:37', mode: 'live', theme: 'Vie à Dubaï', subject: 'Evening in Dubai',
    points: ['Where I am right now.', 'What a normal working day looks like for me.', 'Short "good evening" to the community.'],
    duration: '30 s', fallback: 'Evening in Dubai. Good night to the UK, good morning to Sydney.' },
  // vendredi 20
  { day: '2026-11-20', slot: 'bubble1', time: '11:15', mode: 'prog', theme: 'Leadership',
    subject: 'Delegating: what I gave to the AI and what I kept',
    points: ['Delegate what a machine does better.', 'Keep what needs a human: the people, the support.', 'Same rule with a team.'],
    duration: '40 s', fallback: 'The best decision I made: let the AI do the trading, and keep the people side for me.' },
  { day: '2026-11-20', slot: 'bubble2', time: '14:35', mode: 'prog', theme: 'Entrepreneuriat',
    subject: "What I'd tell myself on day one of Algoria",
    points: ["Start before it's perfect.", 'Listen to the people using it.', 'Keep going on the boring days.'],
    duration: '40 s', fallback: "If I could tell myself one thing on day one: start before it's perfect, and listen to the people using it." },
  { day: '2026-11-20', slot: 'bubble3', time: '19:15', mode: 'live', theme: 'Or & marché',
    subject: 'Fed speech + US consumer sentiment, explained in 30 seconds',
    points: ["Who's speaking and why markets listen.", 'What consumer sentiment measures.', 'No forecast: "the AI handles the chart".'],
    duration: '30 s', fallback: 'Fed speech, consumer sentiment: plenty of headlines for gold this Friday. Algoria AI took the week as it came.' },
  // samedi 21
  { day: '2026-11-21', slot: 'bubble1', time: '11:48', mode: 'prog', theme: 'Vie à Dubaï', subject: 'A Saturday in Dubai',
    points: ['What I do when the markets are closed.', 'A favourite spot in the city.', 'Weekend wish to everyone.'],
    duration: '30 s', fallback: 'Markets closed, Dubai sunshine. Have a great Saturday, wherever you are.' },
  { day: '2026-11-21', slot: 'bubble2', time: '15:46', mode: 'prog', theme: 'Discipline', subject: 'Why rest is part of discipline',
    points: ['Gold closes, and so do I.', 'Good decisions need a rested head.', 'Same for a trading AI: rules, not emotions.'],
    duration: '35 s', fallback: "Discipline isn't working seven days a week. It's knowing when to stop and come back sharp on Monday." },
  { day: '2026-11-21', slot: 'bubble3', time: '19:22', mode: 'prog', theme: 'Algoria', subject: 'The 3 steps to be ready for Monday',
    points: ['Open your account through the link.', 'Connect it once in the app.', 'Choose your size, then the AI does the rest.'],
    duration: '40 s', fallback: 'Three steps before Monday: open your account, connect it in the app, choose your size.' },
  // dimanche 22
  { day: '2026-11-22', slot: 'bubble1', time: '11:40', mode: 'prog', theme: 'Entrepreneuriat', subject: 'How I plan my week as a founder',
    points: ['Sunday evening: 3 priorities, no more.', 'Block the important stuff first.', 'Leave room for the unexpected.'],
    duration: '40 s', fallback: 'My Sunday ritual: three priorities for the week, written down. No more than three.' },
  { day: '2026-11-22', slot: 'bubble2', time: '16:18', mode: 'prog', theme: 'Citation commentée',
    subject: 'Steve Jobs: "Stay hungry, stay foolish." (Stanford, 2005)',
    points: ['Where the quote comes from.', 'What "hungry" means to me.', 'Keep learning, even when it works.'],
    duration: '35 s', fallback: '"Stay hungry, stay foolish." Steve Jobs, Stanford, 2005. Still the best advice for anyone building something.' },
  { day: '2026-11-22', slot: 'bubble3', time: '20:15', mode: 'prog', theme: 'Or & marché', subject: 'The week ahead in 30 seconds',
    points: ['PCE and GDP on Wednesday.', 'Thanksgiving on Thursday: quieter markets.', 'No forecast, the AI adapts.'],
    duration: '30 s', fallback: 'Big data on Wednesday, Thanksgiving on Thursday. A week with two speeds for gold.' },
  // lundi 23
  { day: '2026-11-23', slot: 'bubble1', time: '10:33', mode: 'prog', theme: 'Discipline', subject: 'My Monday rule: one hard thing before 10am',
    points: ['The hardest task first.', "The phone stays off until it's done.", 'The rest of the week follows.'],
    duration: '35 s', fallback: 'Monday rule: do the hardest thing first. Everything after feels easier.' },
  { day: '2026-11-23', slot: 'bubble2', time: '13:09', mode: 'prog', theme: 'Algoria', subject: 'What you see in the app when a trade opens',
    points: ['The notification.', 'The trade at your own size.', "You don't have to do anything."],
    duration: '35 s', fallback: 'When Algoria AI opens a trade, you see it in the app at your own size. Nothing for you to click.' },
  { day: '2026-11-23', slot: 'bubble3', time: '18:55', mode: 'live', theme: 'Or & marché', subject: 'US PMI just out: what it is, in plain words',
    points: ['A survey of businesses.', 'Why markets watch it.', 'No forecast.'],
    duration: '30 s', fallback: 'The US business survey just came out. Algoria AI is on the chart.' },
  { day: '2026-11-23', slot: 'bubble4', time: '21:52', mode: 'live', theme: 'Leadership', subject: 'What I learned from your messages this week',
    points: ['The most common question.', 'What we changed because of it.', 'Thank you to the community.'],
    duration: '40 s', fallback: 'Your messages shape the app. Two things changed this month because of what you told me.' },
  // mardi 24
  { day: '2026-11-24', slot: 'bubble1', time: '10:44', mode: 'prog', theme: 'Citation commentée',
    subject: 'Jim Rohn (attribution courante): "Discipline is the bridge between goals and accomplishment."',
    points: ['Goals are easy to write.', 'The bridge is the daily routine.', 'Same with a trading AI: rules every single day.'],
    duration: '35 s', fallback: '"Discipline is the bridge between goals and accomplishment." Jim Rohn. A good line for a Tuesday.' },
  { day: '2026-11-24', slot: 'bubble2', time: '12:31', mode: 'prog', theme: 'Coulisses', subject: "Preparing tomorrow's live",
    points: ["What's new since last week.", "The question I'll answer first.", 'All the times are in the channel.'],
    duration: '30 s', fallback: "Preparing tomorrow's live: something new to show you. All times are in the channel." },
  { day: '2026-11-24', slot: 'bubble3', time: '19:10', mode: 'live', theme: 'Or & marché',
    subject: "Consumer confidence just out + tomorrow's big data",
    points: ['What consumer confidence is.', 'PCE and GDP tomorrow at 17:30 Dubai.', 'Thanksgiving Thursday.'],
    duration: '35 s', fallback: 'Consumer confidence is out. Tomorrow at 17:30 Dubai: PCE and GDP. Then Thanksgiving.' },
  { day: '2026-11-24', slot: 'bubble4', time: '22:15', mode: 'live', theme: 'Vie à Dubaï',
    subject: 'Tuesday night in Dubai, the day before the live',
    points: ['Where I am.', "What I'm looking forward to tomorrow.", 'Good night to the UK, good morning to Sydney.'],
    duration: '30 s', fallback: 'Tuesday night in Dubai. Tomorrow we meet on Zoom.' },
];

export function bubbleInsertRows() {
  return WEEK_BUBBLES.map((b) => ({
    day: b.day,
    slot: b.slot,
    kind: 'video' as const,
    text: b.subject,
    status: 'info' as const,
    scheduled_at: `${b.day} ${b.time}:00+04`,
    report: {
      mode: b.mode,
      theme: b.theme,
      subject: b.subject,
      points: b.points,
      duration: b.duration,
      fallback: b.fallback,
    },
  }));
}
