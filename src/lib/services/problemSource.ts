import { parseDmojProblemCode } from '../providers/dmoj/ingestion.ts';
import { parseKattisProblemId } from '../providers/kattis/ingestion.ts';

/** Determine the problem source using the exact-host provider URL validators. */
export function getProblemSource(url: string): 'codeforces' | 'kattis' | 'dmoj' {
  if (parseDmojProblemCode(url)) return 'dmoj';
  return parseKattisProblemId(url) ? 'kattis' : 'codeforces';
}
