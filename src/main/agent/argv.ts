/** Splits a command template into argv without a shell. Understands '...' and "..." quotes. */
export function splitCommand(template: string): string[] {
  const out: string[] = []
  let cur = ''
  let has = false
  let quote: '"' | "'" | null = null
  for (let i = 0; i < template.length; i++) {
    const c = template[i]
    if (quote) {
      if (c === quote) quote = null
      else if (c === '\\' && quote === '"' && (template[i + 1] === '"' || template[i + 1] === '\\')) cur += template[++i]
      else cur += c
    }
    else if (c === '"' || c === "'") { quote = c; has = true }
    else if (c === '\\' && (template[i + 1] === ' ' || template[i + 1] === '"' || template[i + 1] === "'")) { cur += template[++i]; has = true }
    else if (/\s/.test(c)) {
      if (has || cur) out.push(cur)
      cur = ''
      has = false
    }
    else { cur += c; has = true }
  }
  if (has || cur) out.push(cur)
  return out
}

export const PROMPT_TOKEN = '{prompt}'

/** Replaces {prompt} inside the already split tokens, so the prompt stays one argument. Appends it when no token has the placeholder. */
export function buildArgv(template: string, prompt: string, extraBeforePrompt: string[] = []): string[] {
  const tokens = splitCommand(template)
  const idx = tokens.findIndex(t => t.includes(PROMPT_TOKEN))
  if (idx === -1) return [...tokens, ...extraBeforePrompt, prompt]
  const before = tokens.slice(0, idx)
  const after = tokens.slice(idx + 1)
  const token = tokens[idx].split(PROMPT_TOKEN).join(prompt)
  return [...before, ...extraBeforePrompt, token, ...after.map(t => t.split(PROMPT_TOKEN).join(prompt))]
}
