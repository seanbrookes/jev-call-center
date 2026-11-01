// TypeSafe JEV (System One) integration.
//
// JEV is not a chat/completion model — it evaluates typed *questions* against
// a *state* and returns structured, calibrated answers. See:
//   https://docs.typesafe.ai/api
//
// Primitive types:
//   - noul   : yes/no -> { noul: 0..1 }
//   - choice : pick one option -> { choice, probabilities, confidence }
//   - score  : rate on a rubric -> { score, probabilities, confidence }
//
// Configure via env:
//   TYPESAFE_API_KEY   (required)
//   TYPESAFE_BASE_URL  (default https://api.typesafe.ai/v1)
//   TYPESAFE_MODEL     (default jev-latest)

const ENDPOINT = `${process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1'}/systemone`

export function configured() {
  return Boolean(process.env.TYPESAFE_API_KEY)
}

/**
 * Evaluate typed questions against a state.
 *
 * @param {string|object|array} state  content to evaluate
 * @param {object} questions           map of id -> { type, instructions, criteria? }
 * @param {string} [model]             override the model (default TYPESAFE_MODEL or jev-latest)
 * @returns {Promise<object>}          the API response { model, answers, usage }
 */
export async function evaluate(state, questions, model) {
  if (!configured()) {
    throw new Error(
      'JEV is not configured. Set TYPESAFE_API_KEY in .env (see .env.example).',
    )
  }

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`,
    },
    body: JSON.stringify({
      state,
      model: model || process.env.TYPESAFE_MODEL || 'jev-latest',
      questions,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`JEV request failed (${res.status}): ${body.slice(0, 300)}`)
  }

  return res.json()
}

/** @returns {{ configured: boolean, baseUrl: string, model: string }} */
export function status() {
  return {
    configured: configured(),
    baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1',
    model: process.env.TYPESAFE_MODEL || 'jev-latest',
  }
}