export type SortDirection = 'asc' | 'desc' | null;

export type ScoreSortable = {
  id?: string;
  likes: number;
  dislikes: number;
};

export type DifficultySortable = {
  difficulty?: number;
};

export type Authored = {
  addedBy: string;
};

export function cycleTableState<T>(current: T, states: readonly T[]): T {
  const currentIndex = states.indexOf(current);
  return states[(currentIndex + 1) % states.length];
}

export function nextSortDirection(direction: SortDirection): SortDirection {
  return cycleTableState(direction, [null, 'asc', 'desc']);
}

export function getDifficultyAriaSort(
  direction: SortDirection
): 'ascending' | 'descending' | 'none' {
  if (direction === 'asc') return 'ascending';
  if (direction === 'desc') return 'descending';
  return 'none';
}

export function getDifficultySortLabel(direction: SortDirection): string {
  if (direction === 'asc') {
    return 'Difficulty, sorted ascending. Activate to sort descending.';
  }
  if (direction === 'desc') {
    return 'Difficulty, sorted descending. Activate to clear sorting.';
  }
  return 'Difficulty, not sorted. Activate to sort ascending.';
}

export function sortByScore<T extends ScoreSortable>(
  items: readonly T[],
  direction: Exclude<SortDirection, null>
): T[] {
  const itemsByScore = new Map<number, T[]>();

  for (const item of items) {
    const score = item.likes - item.dislikes;
    const group = itemsByScore.get(score) ?? [];
    group.push(item);
    itemsByScore.set(score, group);
  }

  for (const group of itemsByScore.values()) {
    group.sort((a, b) => (a.id && b.id ? a.id.localeCompare(b.id) : 0));
  }

  return [...itemsByScore.keys()]
    .sort((a, b) => (direction === 'asc' ? a - b : b - a))
    .flatMap((score) => itemsByScore.get(score) ?? []);
}

export function sortByDifficulty<T extends DifficultySortable>(
  items: readonly T[],
  direction: SortDirection,
  resetSort: (items: readonly T[]) => T[]
): T[] {
  if (direction === null) return resetSort(items);

  return [...items].sort((a, b) => {
    const difference = (a.difficulty ?? 0) - (b.difficulty ?? 0);
    return direction === 'asc' ? difference : -difference;
  });
}

export function getSortedAuthors<T extends Authored>(
  items: readonly T[],
  providedAuthors: readonly string[] = []
): string[] {
  return providedAuthors.length > 0
    ? [...providedAuthors].sort()
    : [...new Set(items.map((item) => item.addedBy))].sort();
}
