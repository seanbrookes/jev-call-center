// Pre-built JEV "analysis packs": ready-to-run sets of typed questions
// (noul / choice / score) for call-center analytics.
//
// Each question is intentionally atomic and well-scoped, per TypeSafe's
// guidance — narrow gut-check decisions, composed in code rather than one
// vague prompt. To add a pack, add an entry here; the frontend and the
// /api/jev/question-sets endpoint pick it up automatically.

export const QUESTION_SETS = {
  'call-quality': {
    id: 'call-quality',
    label: 'Call Quality',
    description: 'Sentiment, escalation, churn risk, resolution, and intent from a support transcript.',
    questions: {
      sentiment: {
        type: 'score',
        instructions: 'Rate the overall sentiment of the CUSTOMER in the support conversation.',
        criteria: ['Calm', 'Mildly frustrated', 'Frustrated', 'Angry'],
      },
      escalation: {
        type: 'noul',
        instructions: 'Does this conversation suggest it should be escalated to a supervisor or tier-2 team?',
      },
      churn_risk: {
        type: 'noul',
        instructions: 'Is the customer at risk of cancelling their account or subscription?',
      },
      resolved: {
        type: 'noul',
        instructions: "Was the customer's issue resolved by the end of the conversation?",
      },
      intent: {
        type: 'choice',
        instructions: "Classify the primary topic of the customer's issue.",
        criteria: {
          billing: 'Charges, invoices, refunds, or payment problems',
          account: 'Login, password, or account access issues',
          'technical-support': 'Device, connectivity, or product malfunction',
          'order-status': 'Where an order is, shipping, or delivery',
          returns: 'Returning or exchanging a product',
          'password-reset': 'Resetting or recovering a password',
          cancellation: 'Cancelling a service or subscription',
          'product-info': 'Questions about a product before or after purchase',
          complaint: 'General dissatisfaction or a complaint',
          upgrade: 'Upgrading a plan, product, or tier',
        },
      },
    },
  },

  'agent-quality': {
    id: 'agent-quality',
    label: 'Agent Quality',
    description: 'Agent helpfulness, customer satisfaction, and product-defect signals from a call.',
    questions: {
      helpfulness: {
        type: 'score',
        instructions: "How helpful was the agent in resolving the customer's issue in this conversation?",
        criteria: ['Unhelpful', 'Somewhat helpful', 'Helpful', 'Very helpful'],
      },
      satisfaction: {
        type: 'score',
        instructions: 'How satisfied is the customer by the end of the conversation?',
        criteria: ['Very dissatisfied', 'Dissatisfied', 'Neutral', 'Satisfied', 'Very satisfied'],
      },
      defect: {
        type: 'noul',
        instructions: 'Does this call relate to a product or service defect or malfunction?',
      },
    },
  },
}

export function listQuestionSets() {
  return Object.values(QUESTION_SETS).map(({ id, label, description, questions }) => ({
    id,
    label,
    description,
    questions,
  }))
}