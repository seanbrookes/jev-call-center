// Conversation (transcript) generator.
//
// Produces a unique, coherent support-call dialogue for a call using:
//   - tracery-grammar: context-free grammar expansion for linguistic variety
//   - @faker-js/faker: realistic entity values (names, order/account numbers,
//     amounts, product names)
//
// Both are seeded from the call id so a given call always renders the same
// transcript (deterministic / reproducible), yet every call differs.
//
// ---------------------------------------------------------------------------
// SCENARIO DIMENSIONS (the extensible interface)
// ---------------------------------------------------------------------------
// A "scenario" describes the conditions of a call. Each dimension selects a
// different family of grammar rules, so it visibly changes the transcript:
//
//   topic    — what the call is about (drives problem + resolution)
//   mood     — the CALLER's emotional state (drives greeting + venting)
//   persona  — the AGENT's personality (drives greeting/ack/closing style)
//   product  — the specific product under discussion (overrides the generic)
//
// To extend: add new entries to MOODS / PERSONAS / PRODUCTS and add the
// matching grammar symbol families below (see "symbol naming convention").
// No other code needs to change — the generator resolves symbols by name.

import tracery from 'tracery-grammar'
import { faker } from '@faker-js/faker'

// --- Seeded PRNG (splitmix32) for Tracery: deterministic per call id --------
function splitmix32(seed) {
  let a = seed | 0
  return function () {
    a = (a + 0x9e3779b9) | 0
    let t = a ^ (a >>> 16)
    t = Math.imul(t, 0x21f0aaad)
    t = t ^ (t >>> 15)
    t = Math.imul(t, 0x735a2d97)
    return ((t = (t ^ (t >>> 15)) >>> 0) / 4294967296)
  }
}

// ---------------------------------------------------------------------------
// DIMENSION CATALOGS — extend these arrays to add new flavors.
// ---------------------------------------------------------------------------

// Caller emotional states. `weight` biases random selection.
export const MOODS = [
  { key: 'calm',       label: 'Calm',       weight: 0.35 },
  { key: 'neutral',    label: 'Neutral',    weight: 0.40 },
  { key: 'frustrated', label: 'Frustrated', weight: 0.18 },
  { key: 'angry',      label: 'Angry',      weight: 0.07 },
]

// Agent personalities/styles.
export const PERSONAS = [
  { key: 'empathetic', label: 'Empathetic',     weight: 0.30 },
  { key: 'efficient',  label: 'Efficient',      weight: 0.30 },
  { key: 'cheerful',   label: 'Cheerful',       weight: 0.25 },
  { key: 'formal',     label: 'Formal',         weight: 0.15 },
]

// Product catalog. Products are only assigned to topics that reference a
// physical/generic product in their grammar; other topics get null.
export const PRODUCTS = [
  'Wireless Router X200', 'Smart Thermostat v2', 'HD Streaming Stick',
  'Bluetooth Earbuds Pro', 'Portable Charger 20K', 'Home Security Camera',
  'Robot Vacuum S9', 'Electric Kettle', 'Noise-Cancelling Headphones',
  'Smart Light Kit', 'USB-C Docking Hub', 'Fitness Tracker',
]

// Topics whose problem/resolution grammar references #product#.
const PRODUCT_TOPICS = new Set(['technical-support', 'returns', 'product-info'])

// ---------------------------------------------------------------------------
// Faker entity builders, seeded by call id.
// ---------------------------------------------------------------------------
function buildEntities(id, productOverride) {
  faker.seed(id)
  return {
    caller: faker.person.fullName().replace(/\.+$/, ''),
    agent: faker.person.firstName(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    order: `#${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
    account: faker.finance.accountNumber({ length: 10 }),
    amount: faker.finance.amount({ min: 5, max: 400, dec: 2 }),
    product: productOverride || faker.commerce.productName(),
    model: faker.helpers.arrayElement(['Pro', 'Air', 'Max', 'Plus', 'Lite', 'Ultra']),
    days: faker.number.int({ min: 2, max: 14 }),
  }
}

// ---------------------------------------------------------------------------
// GRAMMAR
//
// Symbol naming convention for the extensible dimensions:
//   caller greeting  -> caller_greeting_<mood>
//   caller vent      -> caller_vent_<mood>
//   agent opening    -> opening_<persona>
//   agent ack        -> ack_<persona>
//   agent closing    -> closing_<persona>
//   topic content    -> <topic>_problem / <topic>_resolution
// Shared beats use bare names (verify_ask, verify_email, ...).
// ---------------------------------------------------------------------------
const GRAMMAR = {
  // --- caller greetings by mood -------------------------------------------
  caller_greeting_calm: [
    'Hi there, I was hoping you could help me with something.',
    'Hello! Quick question for you.',
    "Hi, I've got a small issue I'd like to sort out.",
  ],
  caller_greeting_neutral: [
    "Hi, I'm calling about something on my account.",
    "Hello, I need some help with an issue.",
    "Hi there, I have a question about my service.",
  ],
  caller_greeting_frustrated: [
    "Hi. Look, I've been trying to sort this out and I'm not getting anywhere.",
    "Hello. I've already had to call a couple of times about this.",
    "Hi — I really need someone to actually fix this today.",
  ],
  caller_greeting_angry: [
    'I want to speak to someone right now about this.',
    "I am NOT happy — I need this sorted out immediately.",
    "Listen, I've had it. Someone needs to deal with this now.",
  ],

  // --- caller vents (only for negative moods) -----------------------------
  caller_vent_frustrated: [
    "Honestly, this is the third time I've had to call about the same thing.",
    "I've been bounced around between three different people already.",
    "I've spent way too much time on this and it's still not fixed.",
  ],
  caller_vent_angry: [
    'This is completely unacceptable — I should not have to deal with this.',
    "I'm being charged for this and it's absolutely ridiculous.",
    "I'm about to cancel my whole account if this isn't fixed right now.",
  ],

  // --- agent openings by persona ------------------------------------------
  opening_empathetic: [
    "Thank you for calling #company#, this is #agent#. I'm happy to help today.",
    "Hello and welcome to #company#, my name's #agent#. How can I make things right?",
  ],
  opening_efficient: [
    "#company# support, #agent# speaking. What can I do for you?",
    "Thank you for calling #company#, I'm #agent#. Go ahead.",
  ],
  opening_cheerful: [
    "Hi there, you've reached #company#! I'm #agent#. What can I do for you today?",
    "Hey, thanks for calling #company#! #agent# here — how can I help?",
  ],
  opening_formal: [
    "Thank you for contacting #company#. My name is #agent#. How may I assist you today?",
    "Good day, and welcome to #company#. This is #agent# speaking. How may I be of service?",
  ],

  // --- agent acknowledgements by persona ----------------------------------
  ack_empathetic: [
    "I'm really sorry to hear that, #caller#. Let me make this right for you.",
    'Ugh, that sounds frustrating. I apologize — give me a moment and I will fix it.',
    'I understand how that feels, #caller#. I appreciate your patience with us.',
  ],
  ack_efficient: [
    'Got it. Let me take a look right now.',
    'Understood — I will get this fixed for you.',
    "Okay. Can I just verify a couple of details and I'll get started?",
  ],
  ack_cheerful: [
    "No worries at all, #caller#! I've got you covered.",
    "Absolutely, I can help with that — let's get it sorted in no time!",
    'You came to the right person! Let me look into that for you.',
  ],
  ack_formal: [
    'I apologize for the inconvenience, #caller#. Allow me to resolve this promptly.',
    'Thank you for bringing this to our attention. I will address it now.',
  ],

  // --- agent closings by persona ------------------------------------------
  closing_empathetic: [
    "That's all sorted for you, #caller#. Take care, and don't hesitate to reach out if anything else comes up.",
    "You're welcome, #caller#. I'm really glad we could get that resolved. Have a gentle day.",
  ],
  closing_efficient: [
    "All set. Thanks for calling #company# — have a good one.",
    "That's done. Have a great rest of your day, #caller#.",
  ],
  closing_cheerful: [
    "You're all set, #caller#! Thanks for calling, have a fantastic day!",
    "Anytime! Enjoy the rest of your day — you've been awesome.",
  ],
  closing_formal: [
    "Thank you for contacting #company#. Should you require further assistance, do not hesitate to call. Good day, #caller#.",
    'This concludes your request. Thank you and good day.',
  ],

  // --- shared beats --------------------------------------------------------
  verify_ask: [
    'Could I get the email address on your account, please?',
    'Just to verify your account, may I have the email on file?',
    'For account security, can you confirm the email address associated with this account?',
  ],
  verify_email: [
    "Sure, it's #email#.",
    'Yes, that would be #email#.',
    'It should be #email#.',
  ],
  verify_hold: [
    'Thank you. One moment while I pull up your account.',
    'Perfect, give me just a second to bring up your details.',
    'Great, thank you. I am pulling up your account now.',
  ],
  confirm_issue: [
    'Okay, I can see the issue. Can you give me just a moment while I look into it?',
    "I see what's going on now. Let me get this sorted out for you.",
    'Yep, I found it. Bear with me one moment.',
  ],
  anything_else: [
    'Is there anything else I can help you with today, #caller#?',
    'Anything else I can do for you while I have you on the line?',
    "Is there something else you'd like me to look into?",
  ],
  thanks: [
    "No, that's everything. Thank you so much for your help!",
    "That's all, I really appreciate it.",
    "No that's it — thanks again, you've been great.",
  ],

  // --- topic content: problem + resolution ---------------------------------
  billing_problem: [
    "I'm calling because there's a charge on my bill for #amount# that I don't recognize.",
    'I think I have been overcharged — my latest bill shows #amount# that should not be there.',
    'I was just reviewing my bill and noticed an extra #amount# charge I cannot explain.',
  ],
  billing_resolution: [
    'I see the extra #amount# — that was an erroneous charge. I have removed it and issued a refund to your card.',
    'I found the duplicate billing. I have voided the #amount# charge and you will see the credit on your next statement.',
  ],
  account_problem: [
    "I'm having trouble signing into my account. It says my password is incorrect, but I know it's right.",
    "I can't access my account at all — it keeps telling me my login failed.",
    'My account seems to be locked and I cannot get in.',
  ],
  account_resolution: [
    'I have sent a secure unlock link to #email#. Click it to set a new password and get right back in.',
    'Your account was temporarily locked for security. I have unlocked it now — try signing in again.',
  ],
  tech_problem: [
    "My #product# won't turn on. It was working fine yesterday and now nothing happens when I press the power button.",
    "I'm having trouble with my #product# — it keeps freezing and I have to restart it.",
    'My #product# keeps dropping its connection. It has been happening all week.',
  ],
  tech_resolution: [
    "Let's try a reset. Hold the power button for 15 seconds until it cycles — that should clear the problem.",
    "I'm pushing a firmware update to your #product# now. Restart it when it finishes and it should work normally.",
  ],
  order_problem: [
    'I placed an order about #days# days ago — order #order# — and it still has not shipped.',
    "I'm checking on my order #order#. The tracking hasn't updated in days.",
    'I was told my order #order# would arrive by now, but it has not shown up.',
  ],
  order_resolution: [
    "I can see order #order# is in the final shipping stage. It's due to arrive by the end of the week — I've emailed updated tracking.",
    "Looks like there was a delay at the warehouse. I have expedited #order# at no charge, and you'll get a tracking number shortly.",
  ],
  returns_problem: [
    "I'd like to return the #product# I bought. It isn't quite what I expected.",
    'I need to send back a #product# — it arrived damaged.',
    'I want to return an item from order #order#. Can you help me with that?',
  ],
  returns_resolution: [
    "Of course — I've created a return label for you. Check your email and drop it at any courier location, and your refund processes once it's scanned.",
    "No problem. I've issued a prepaid return label to #email#. You'll be refunded after we receive it.",
  ],
  password_problem: [
    'I forgot my password and the reset email never arrives.',
    "I need to reset my password but I'm locked out of the reset page.",
    'Can you help me get back in? My password is not working and I cannot reset it myself.',
  ],
  password_resolution: [
    "I've just sent a fresh reset link to #email#. If it doesn't arrive in a couple of minutes, check your spam folder.",
    "I've triggered a new password reset. You'll get an email with a secure link that's valid for 24 hours.",
  ],
  cancellation_problem: [
    "I'd like to cancel my subscription, please.",
    'I want to close my account. Can you help me with that?',
    "I need to cancel my plan — I'm just not using it anymore.",
  ],
  cancellation_resolution: [
    "I've processed the cancellation, effective at the end of the current billing cycle. You'll get a confirmation email shortly.",
    "I'm sorry to see you go. I have cancelled the subscription — you'll retain access through the end of this period.",
  ],
  product_problem: [
    'I was wondering if the #product# works with my #model# setup at home.',
    "Can you tell me more about the #product#? I'm thinking about buying it.",
  ],
  product_resolution: [
    "Great question — the #product# is fully compatible with the #model#, and I'll email you a spec sheet.",
    "Yes, the #product# supports your #model# configuration. I've mailed you a quick-start guide.",
  ],
  complaint_problem: [
    "I've been on hold for forty minutes and this is the third time I've had to call about the same issue.",
    "I'm really frustrated — I've spoken to three different agents and nothing has changed.",
    "Honestly, the service I've received has been disappointing and I wanted to report it.",
  ],
  complaint_resolution: [
    "I completely understand your frustration and I apologize. I've escalated this and logged your feedback for our team.",
    "I'm sorry you've had that experience. I'm personally seeing this through now, and I've escalated your case to a senior agent.",
  ],
  upgrade_problem: [
    "I'm thinking about upgrading to the #model# plan. What would that involve?",
    "I'd like to move to the next plan up. Can you walk me through it?",
  ],
  upgrade_resolution: [
    "I can upgrade you to #model# right now — starting next cycle it's just a prorated difference. Want me to set that up?",
    "Happy to help. I've enabled the #model# upgrade on your account; you'll see the change on your next statement.",
  ],

  // --- abandoned / voicemail ----------------------------------------------
  hold_prompt: [
    'All our agents are currently busy. Your call is important to us — please hold and we will be with you shortly.',
    'Thank you for your patience. You are number #holdpos# in the queue. A representative will be with you soon.',
  ],
  voicemail_prompt: [
    'All of our agents are currently assisting other customers. Please leave a detailed message after the tone and we will get back to you.',
    "You've reached #company#. Our team is unavailable right now — please leave your name, number, and reason for calling.",
  ],
  voicemail_message: [
    "Hi, this is #caller#. I'm calling about my #topic_label# — you can reach me back at #phone#. Thanks.",
    "Hello, this is #caller# at #phone#. I have a question about my #topic_label#. Please call me back.",
  ],
}

const TOPIC_LABELS = {
  billing: 'bill', account: 'account', 'technical-support': 'device',
  'order-status': 'recent order', returns: 'return', 'password-reset': 'password',
  cancellation: 'subscription', 'product-info': 'a product question',
  complaint: 'recent support experience', upgrade: 'my plan',
}

// Map a call `topic` to the grammar symbol prefix used for its problem and
// resolution rules. Prevents silent fallback when the topic string (slug) and
// the grammar naming differ.
const TOPIC_GRAMMAR_KEY = {
  billing: 'billing',
  account: 'account',
  'technical-support': 'tech',
  'order-status': 'order',
  returns: 'returns',
  'password-reset': 'password',
  cancellation: 'cancellation',
  'product-info': 'product',
  complaint: 'complaint',
  upgrade: 'upgrade',
}

// ---------------------------------------------------------------------------
// Random (seeded-by-Math.random) dimension selection, used by the simulator to
// assign a scenario when the UI/user hasn't specified one.
// ---------------------------------------------------------------------------
function weightedPick(list) {
  const total = list.reduce((s, x) => s + x.weight, 0)
  let r = Math.random() * total
  for (const item of list) {
    r -= item.weight
    if (r <= 0) return item.key
  }
  return list[0].key
}

export const randomMood = () => weightedPick(MOODS)
export const randomPersona = () => weightedPick(PERSONAS)
export const randomProduct = (topic) =>
  PRODUCT_TOPICS.has(topic) ? PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)] : null

// Build a per-call grammar by merging static rules with concrete context.
function buildGrammar(base, context, product) {
  const e = buildEntities(context.id, product)
  return tracery.createGrammar({
    ...GRAMMAR,
    company: [context.company || 'Support'],
    caller: [e.caller],
    agent: [e.agent],
    email: [e.email],
    phone: [e.phone],
    order: [e.order],
    account: [e.account],
    amount: [e.amount],
    product: [e.product],
    model: [e.model],
    days: [String(e.days)],
    holdpos: [String(1 + (context.id % 9))],
    topic_label: [TOPIC_LABELS[context.topic] || 'account'],
  })
}

function line(g, symbol) {
  return g.flatten('#' + symbol + '#')
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
//
// generateTurns(callId, scenario) -> turns
//   scenario = { topic, mood, persona, product, company }
//   All fields optional with sensible falls back; `topic` selects problem/
//   resolution, `mood`/`persona` select caller/agent phrasing, `product`
//   overrides the product entity.
export function generateTurns(callId, scenario = {}) {
  const mood = scenario.mood || 'neutral'
  const persona = scenario.persona || 'efficient'
  const topic = scenario.topic || 'account'
  const company = scenario.company || 'Support'
  const product = scenario.product || null

  const g = buildGrammar({ id: callId, topic }, { company }, product)

  // Resolve symbol families; fall back to neutral/efficient if a family is
  // missing, so adding a mood/persona without every rule still works.
  const moodKey = GRAMMAR[`caller_greeting_${mood}`] ? mood : 'neutral'
  const personaKey = GRAMMAR[`opening_${persona}`] ? persona : 'efficient'
  const ventKey = mood === 'frustrated' || mood === 'angry' ? mood : null

  const problem = GRAMMAR[`${TOPIC_GRAMMAR_KEY[topic]}_problem`]
    ? `${TOPIC_GRAMMAR_KEY[topic]}_problem`
    : 'account_problem'
  const resolution = GRAMMAR[`${TOPIC_GRAMMAR_KEY[topic]}_resolution`]
    ? `${TOPIC_GRAMMAR_KEY[topic]}_resolution`
    : 'account_resolution'

  let turns = []
  const duration = Math.max(120, scenario.talk_seconds || 240)

  if (scenario.outcome === 'voicemail') {
    turns = [
      { speaker: 'ivr', text: line(g, 'voicemail_prompt') },
      { speaker: 'caller', text: line(g, 'voicemail_message') },
    ]
  } else if (scenario.outcome === 'abandoned') {
    const holds = 1 + (callId % 2)
    turns = [{ speaker: 'ivr', text: line(g, 'hold_prompt') }]
    for (let i = 0; i < holds; i++) turns.push({ speaker: 'ivr', text: line(g, 'hold_prompt') })
    turns.push({ speaker: 'caller', text: '[caller hangs up]' })
  } else {
    turns = [
      { speaker: 'agent', text: line(g, `opening_${personaKey}`) },
      { speaker: 'caller', text: line(g, `caller_greeting_${moodKey}`) },
      { speaker: 'caller', text: line(g, problem) },
    ]
    if (ventKey) turns.push({ speaker: 'caller', text: line(g, `caller_vent_${ventKey}`) })
    turns.push(
      { speaker: 'agent', text: line(g, `ack_${personaKey}`) },
      { speaker: 'agent', text: line(g, 'verify_ask') },
      { speaker: 'caller', text: line(g, 'verify_email') },
      { speaker: 'agent', text: line(g, 'verify_hold') },
      { speaker: 'agent', text: line(g, 'confirm_issue') },
      { speaker: 'agent', text: line(g, resolution) },
      { speaker: 'caller', text: mood === 'angry' ? '[sighs] Fine. Thank you.' : 'Oh great, thank you!' },
      { speaker: 'agent', text: line(g, 'anything_else') },
      { speaker: 'caller', text: line(g, 'thanks') },
      { speaker: 'agent', text: line(g, `closing_${personaKey}`) },
    )
  }

  const n = turns.length
  return turns.map((t, i) => ({ ...t, offset_seconds: Math.round((i / n) * duration) }))
}