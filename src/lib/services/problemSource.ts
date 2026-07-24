import { parseKattisProblemId } from '../providers/kattis/ingestion.ts';

/** Determine the problem source using the exact-host Kattis URL validator. */
export function getProblemSource(url: string): 'codeforces' | 'kattis' {
  return parseKattisProblemId(url) ? 'kattis' : 'codeforces';
}
