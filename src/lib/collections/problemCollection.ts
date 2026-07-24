import type { Problem } from '../queries/problemQueries.ts';
import {
  cycleTableState,
  getSortedAuthors,
  nextSortDirection,
  sortByDifficulty,
  sortByScore,
  type SortDirection
} from '../utils/table.ts';

export const PROBLEM_TOPICS = [
  'graph',
  'array',
  'string',
  'math',
  'tree',
  'queries',
  'geometry',
  'misc'
] as const;
export const NEW_PROBLEM_TOPIC = 'NEW';

export type ProblemTopic = (typeof PROBLEM_TOPICS)[number] | typeof NEW_PROBLEM_TOPIC;
export type SolvedFilter = 'all' | 'solved' | 'unsolved';
export type ProblemSourceFilter = 'all' | Problem['source'];

const SOLVED_FILTER_STATES = ['all', 'solved', 'unsolved'] as const;
const SOURCE_FILTER_STATES = ['all', 'codeforces', 'kattis'] as const;

type ProblemCollectionState = {
  sourceItems: readonly Problem[];
  solvedProblemIds: ReadonlySet<string>;
  defaultSolvedFilter: SolvedFilter;
  selectedTopic: ProblemTopic | null;
  selectedAuthor: string | null;
  sourceFilter: ProblemSourceFilter;
  solvedFilter: SolvedFilter;
  difficultySortDirection: SortDirection;
};

export type CreateProblemCollectionOptions = {
  items?: readonly Problem[];
  solvedProblemIds?: ReadonlySet<string>;
  defaultSolvedFilter?: SolvedFilter;
  selectedTopic?: ProblemTopic | null;
  selectedAuthor?: string | null;
  sourceFilter?: ProblemSourceFilter;
  solvedFilter?: SolvedFilter;
  difficultySortDirection?: SortDirection;
  preserveSourceOrder?: boolean;
};

function sortByDefaultScore(items: readonly Problem[]): Problem[] {
  return sortByScore(items, 'desc');
}

export class ProblemCollection {
  readonly sourceItems: readonly Problem[];
  readonly solvedProblemIds: ReadonlySet<string>;
  readonly defaultSolvedFilter: SolvedFilter;
  readonly selectedTopic: ProblemTopic | null;
  readonly selectedAuthor: string | null;
  readonly sourceFilter: ProblemSourceFilter;
  readonly solvedFilter: SolvedFilter;
  readonly difficultySortDirection: SortDirection;

  constructor(options: CreateProblemCollectionOptions = {}) {
    this.sourceItems = options.preserveSourceOrder
      ? [...(options.items ?? [])]
      : sortByDefaultScore(options.items ?? []);
    this.solvedProblemIds = new Set(options.solvedProblemIds ?? []);
    this.defaultSolvedFilter = options.defaultSolvedFilter ?? 'all';
    this.selectedTopic = options.selectedTopic ?? null;
    this.selectedAuthor = options.selectedAuthor ?? null;
    this.sourceFilter = options.sourceFilter ?? 'all';
    this.solvedFilter = options.solvedFilter ?? this.defaultSolvedFilter;
    this.difficultySortDirection = options.difficultySortDirection ?? null;
  }

  get topicOptions(): readonly string[] {
    return PROBLEM_TOPICS;
  }

  get sortKey(): 'score' | 'difficulty' {
    return this.difficultySortDirection === null ? 'score' : 'difficulty';
  }

  get availableAuthors(): string[] {
    return getSortedAuthors(this.withoutAuthorFilter);
  }

  get rows(): Problem[] {
    const filtered = this.selectedAuthor
      ? this.withoutAuthorFilter.filter((problem) => problem.addedBy === this.selectedAuthor)
      : this.withoutAuthorFilter;
    return this.difficultySortDirection === null
      ? [...filtered]
      : sortByDifficulty(filtered, this.difficultySortDirection, sortByDefaultScore);
  }

  withSourceItems(items: readonly Problem[]): ProblemCollection {
    return this.copy({ sourceItems: sortByDefaultScore(items) });
  }

  updateSourceItem(id: string, update: (problem: Problem) => Problem): ProblemCollection {
    return this.copy({
      sourceItems: this.sourceItems.map((problem) =>
        problem.id === id ? update(problem) : problem
      )
    });
  }

  withSolvedProblemIds(ids: ReadonlySet<string>): ProblemCollection {
    return this.copy({ solvedProblemIds: new Set(ids) });
  }

  selectTopic(topic: ProblemTopic | null): ProblemCollection {
    return this.copy({ selectedTopic: topic });
  }

  selectAuthor(author: string | null): ProblemCollection {
    return this.copy({ selectedAuthor: author });
  }

  cycleSolvedFilter(): ProblemCollection {
    return this.copy({
      solvedFilter: cycleTableState(this.solvedFilter, SOLVED_FILTER_STATES)
    });
  }

  cycleSourceFilter(): ProblemCollection {
    return this.copy({
      sourceFilter: cycleTableState(this.sourceFilter, SOURCE_FILTER_STATES)
    });
  }

  cycleDifficultySort(): ProblemCollection {
    const direction = nextSortDirection(this.difficultySortDirection);
    return this.copy({
      sourceItems: direction === null ? sortByDefaultScore(this.sourceItems) : this.sourceItems,
      difficultySortDirection: direction
    });
  }

  resetFilters(): ProblemCollection {
    return this.copy({
      sourceItems: sortByDefaultScore(this.sourceItems),
      selectedTopic: null,
      selectedAuthor: null,
      sourceFilter: 'all',
      solvedFilter: this.defaultSolvedFilter,
      difficultySortDirection: null
    });
  }

  private get withoutAuthorFilter(): Problem[] {
    return this.sourceItems.filter((problem) => {
      if (this.selectedTopic === NEW_PROBLEM_TOPIC && problem.type) return false;
      if (this.selectedTopic === 'misc' && problem.type && problem.type !== 'misc') {
        return false;
      }
      if (
        this.selectedTopic &&
        this.selectedTopic !== NEW_PROBLEM_TOPIC &&
        this.selectedTopic !== 'misc' &&
        problem.type !== this.selectedTopic
      ) {
        return false;
      }

      if (this.solvedFilter !== 'all') {
        const isSolved = !!problem.id && this.solvedProblemIds.has(problem.id);
        if (this.solvedFilter === 'solved' ? !isSolved : isSolved) return false;
      }

      return this.sourceFilter === 'all' || problem.source === this.sourceFilter;
    });
  }

  private copy(changes: Partial<ProblemCollectionState>): ProblemCollection {
    return new ProblemCollection({
      items: changes.sourceItems ?? this.sourceItems,
      solvedProblemIds: changes.solvedProblemIds ?? this.solvedProblemIds,
      defaultSolvedFilter: changes.defaultSolvedFilter ?? this.defaultSolvedFilter,
      selectedTopic: 'selectedTopic' in changes ? changes.selectedTopic : this.selectedTopic,
      selectedAuthor: 'selectedAuthor' in changes ? changes.selectedAuthor : this.selectedAuthor,
      sourceFilter: changes.sourceFilter ?? this.sourceFilter,
      solvedFilter: changes.solvedFilter ?? this.solvedFilter,
      difficultySortDirection:
        changes.difficultySortDirection === undefined
          ? this.difficultySortDirection
          : changes.difficultySortDirection,
      preserveSourceOrder: true
    });
  }
}
